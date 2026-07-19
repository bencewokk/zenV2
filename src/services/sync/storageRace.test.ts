// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Note } from "@/shared/lib/types";
import { applyRemoteNote, localStore } from "@/services/storage";
import { pdfStore, type PdfSyncMeta } from "@/services/pdfStore";
import { useNotes } from "@/features/notes/store";
import { notesAdapter } from "./adapters/notes";
import {
  clearDirty,
  getDirty,
  markDirty,
  snapshotDirtyGenerations,
  unchangedDirtyIds,
} from "./cursor";

let sequence = 0;

function note(id: string, title: string, updatedAt: number): Note {
  return {
    id,
    parentId: null,
    order: 0,
    title,
    content: null,
    collapsed: false,
    moc: false,
    space: null,
    subject: null,
    unit: null,
    tags: [],
    inbox: false,
    pdfIds: [],
    createdAt: 1,
    updatedAt,
  };
}

describe("atomic remote apply guards", () => {
  beforeEach(() => {
    localStorage.clear();
    useNotes.setState({ notes: {}, selectedId: null, dirty: false, draftRevisions: {} });
  });

  it("keeps a newly-dirty note but allows the unchanged authoritative winner", async () => {
    const id = `note-race-${sequence++}`;
    const local = note(id, "local", 10);
    const winner = note(id, "server winner", 20);
    await localStore.put(local);
    clearDirty("notes", [id]);

    const racedApply = applyRemoteNote(winner);
    markDirty("notes", id);

    await expect(racedApply).resolves.toBe(false);
    await expect(localStore.get(id)).resolves.toMatchObject({ title: "local" });

    const snapshot = snapshotDirtyGenerations("notes", [id]);
    const canApplyDirty = (candidateId: string) => (
      unchangedDirtyIds("notes", snapshot, [candidateId]).length === 1
    );
    await expect(applyRemoteNote(winner, canApplyDirty)).resolves.toBe(true);
    await expect(localStore.get(id)).resolves.toMatchObject({ title: "server winner" });

    const nextWinner = note(id, "must not overwrite", 30);
    const nextSnapshot = snapshotDirtyGenerations("notes", [id]);
    const guardedApply = applyRemoteNote(nextWinner, (candidateId) => (
      unchangedDirtyIds("notes", nextSnapshot, [candidateId]).length === 1
    ));
    markDirty("notes", id);

    await expect(guardedApply).resolves.toBe(false);
    await expect(localStore.get(id)).resolves.toMatchObject({ title: "server winner" });
  });

  it("protects an unsaved selected-note draft, then allows a conflict when clean", async () => {
    const id = `active-draft-${sequence++}`;
    const local = note(id, "local draft", 10);
    const remoteDelete = { id, updatedAt: Date.now() + 10_000, deleted: true };
    await localStore.put(local);
    clearDirty("notes", [id]);
    useNotes.setState({
      notes: { [id]: local },
      selectedId: id,
      dirty: false,
      draftRevisions: {},
    });

    useNotes.getState().patch(id, {});
    const beforeMaterialize = snapshotDirtyGenerations("notes", [id]);
    await expect(notesAdapter.listDirty()).resolves.toEqual([]);

    expect(getDirty("notes").has(id)).toBe(true);
    expect(unchangedDirtyIds("notes", beforeMaterialize, [id])).toEqual([]);

    await notesAdapter.apply([remoteDelete]);
    await expect(localStore.get(id)).resolves.toMatchObject({ title: "local draft" });
    expect(useNotes.getState().notes[id]).toBeDefined();

    const firstSave = useNotes.getState().saveContent(id, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }],
    });
    useNotes.getState().patch(id, { title: "newer draft" });
    await firstSave;

    expect(useNotes.getState().dirty).toBe(true);
    expect(useNotes.getState().notes[id]?.title).toBe("newer draft");
    await notesAdapter.apply([remoteDelete]);
    await expect(localStore.get(id)).resolves.not.toBeNull();

    await useNotes.getState().saveContent(id, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }],
    });
    expect(useNotes.getState().dirty).toBe(false);
    expect(useNotes.getState().notes[id]?.title).toBe("newer draft");

    const persistedGeneration = snapshotDirtyGenerations("notes", [id]);
    await notesAdapter.apply([remoteDelete], {
      canApplyDirty: (candidateId) => (
        unchangedDirtyIds("notes", persistedGeneration, [candidateId]).length === 1
      ),
    });

    await expect(localStore.get(id)).resolves.toBeNull();
    expect(useNotes.getState().notes[id]).toBeUndefined();
  });

  it("keeps newly-dirty PDF metadata but allows the unchanged authoritative winner", async () => {
    const id = `pdf-race-${sequence++}`;
    const local: PdfSyncMeta = {
      id,
      name: "local.pdf",
      tags: ["local"],
      size: 100,
      addedAt: 1,
      updatedAt: 10,
    };
    const winner: PdfSyncMeta = {
      ...local,
      name: "server.pdf",
      tags: ["server"],
      updatedAt: 20,
    };
    await pdfStore.put(local);
    clearDirty("pdfs", [id]);

    const racedApply = pdfStore.applyRemoteMeta(winner, null);
    markDirty("pdfs", id);

    await expect(racedApply).resolves.toBe(false);
    await expect(pdfStore.syncMeta(id)).resolves.toMatchObject({ name: "local.pdf" });

    const snapshot = snapshotDirtyGenerations("pdfs", [id]);
    const canApplyDirty = (candidateId: string) => (
      unchangedDirtyIds("pdfs", snapshot, [candidateId]).length === 1
    );
    await expect(pdfStore.applyRemoteMeta(winner, null, canApplyDirty)).resolves.toBe(true);
    await expect(pdfStore.syncMeta(id)).resolves.toMatchObject({ name: "server.pdf" });

    const nextWinner = { ...winner, name: "must-not-overwrite.pdf", updatedAt: 30 };
    const nextSnapshot = snapshotDirtyGenerations("pdfs", [id]);
    const guardedApply = pdfStore.applyRemoteMeta(nextWinner, null, (candidateId) => (
      unchangedDirtyIds("pdfs", nextSnapshot, [candidateId]).length === 1
    ));
    markDirty("pdfs", id);

    await expect(guardedApply).resolves.toBe(false);
    await expect(pdfStore.syncMeta(id)).resolves.toMatchObject({ name: "server.pdf" });
  });

  it("does not create dirty PDF markers when patch targets are missing", async () => {
    const ids = {
      meta: `missing-meta-${sequence++}`,
      pages: `missing-pages-${sequence++}`,
      outline: `missing-outline-${sequence++}`,
      annotations: `missing-annotations-${sequence++}`,
    };

    await pdfStore.patchMeta(ids.meta, { name: "missing.pdf" });
    await pdfStore.putPages(ids.pages, ["missing"]);
    await pdfStore.putOutline(ids.outline, []);
    await pdfStore.putAnnotations(ids.annotations, []);

    const dirty = getDirty("pdfs");
    expect(dirty.has(ids.meta)).toBe(false);
    expect(dirty.has(ids.pages)).toBe(false);
    expect(dirty.has(ids.outline)).toBe(false);
    expect(dirty.has(ids.annotations)).toBe(false);
  });
});
