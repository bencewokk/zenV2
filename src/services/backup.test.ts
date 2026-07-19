// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Note } from "@/shared/lib/types";
import { localStore, readTombstones } from "@/services/storage";
import {
  collectBackup,
  parseBackup,
  applyBackup,
  collectPortableSettings,
  applyPortableSettings,
} from "@/services/backup";
import { AI_SETTINGS_KEY } from "@/services/ai/settings";
import { GOOGLE_SETTINGS_KEY } from "@/services/google/settings";
import { CANVAS_SETTINGS_KEY } from "@/services/canvas/settings";
import { EXTERNAL_CONNECTIONS_KEY } from "@/services/connections/settings";
import { BLOB_DOC_ID, getBlobTs, getDirty } from "@/services/sync/cursor";

const TOOL_POLICY_KEY = "zen.ai.toolPolicy.v1";
const APPEARANCE_KEY = "zen.appearance.v1";

function makeNote(id: string, title: string): Note {
  return {
    id, parentId: null, order: 0, title, content: { type: "doc", content: [] },
    collapsed: false, moc: false, space: null, subject: null, unit: null,
    tags: ["test"], inbox: false, pdfIds: [], createdAt: 1, updatedAt: Date.now(),
  };
}

const SECRET_VALUES = [
  "AI_SECRET",
  "GOOGLE_SECRET",
  "CANVAS_SECRET",
  "ZOTERO_SECRET",
  "GITHUB_SECRET",
  "NESTED_AI_SECRET",
] as const;

const LOCAL_SECRET_VALUES = {
  ai: "DEVICE_CREDENTIAL_A",
  google: "DEVICE_CREDENTIAL_B",
  canvas: "DEVICE_CREDENTIAL_C",
  zotero: "DEVICE_CREDENTIAL_D",
  github: "DEVICE_CREDENTIAL_E",
} as const;

const SETTINGS_KEYS = [
  AI_SETTINGS_KEY,
  GOOGLE_SETTINGS_KEY,
  CANVAS_SETTINGS_KEY,
  EXTERNAL_CONNECTIONS_KEY,
  TOOL_POLICY_KEY,
  APPEARANCE_KEY,
] as const;

const PORTABLE_SYNC_COLLECTIONS = [
  "aiSettings",
  "googleSettings",
  "canvasSettings",
  "externalConnections",
  "toolPolicy",
  "appearance",
] as const;

function expectPortableSettingsMarkedDirty(since: number): void {
  for (const collection of PORTABLE_SYNC_COLLECTIONS) {
    expect(getDirty(collection)).toContain(BLOB_DOC_ID);
    expect(getBlobTs(collection)).toBeGreaterThanOrEqual(since);
  }
}

function seedSettingsWithSecrets(): void {
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({
    provider: "deepseek",
    apiKey: "AI_SECRET",
    baseUrl: "https://ai.example.test",
    model: "deepseek-chat",
    nested: { apiKey: "NESTED_AI_SECRET", keep: true },
  }));
  localStorage.setItem(GOOGLE_SETTINGS_KEY, JSON.stringify({
    clientId: "public-client.apps.googleusercontent.com",
    clientSecret: "GOOGLE_SECRET",
  }));
  localStorage.setItem(CANVAS_SETTINGS_KEY, JSON.stringify({
    baseUrl: "https://school.instructure.test",
    accessToken: "CANVAS_SECRET",
  }));
  localStorage.setItem(EXTERNAL_CONNECTIONS_KEY, JSON.stringify({
    driveFolderIds: ["folder-1"],
    zoteroLibraryType: "user",
    zoteroLibraryId: "42",
    zoteroApiKey: "ZOTERO_SECRET",
    zoteroCollectionKeys: ["collection-1"],
    githubToken: "GITHUB_SECRET",
    githubRepositories: ["example/repo"],
    githubExcludePatterns: ["dist/"],
  }));
  localStorage.setItem(TOOL_POLICY_KEY, JSON.stringify({ create_note: "ask" }));
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ look: "veil", font: "literata" }));
}

function seedExistingLocalSecrets(): void {
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({
    provider: "deepseek",
    apiKey: LOCAL_SECRET_VALUES.ai,
    baseUrl: "https://ai.example.test/old-path",
  }));
  localStorage.setItem(GOOGLE_SETTINGS_KEY, JSON.stringify({
    clientSecret: LOCAL_SECRET_VALUES.google,
    clientId: "public-client.apps.googleusercontent.com",
  }));
  localStorage.setItem(CANVAS_SETTINGS_KEY, JSON.stringify({
    accessToken: LOCAL_SECRET_VALUES.canvas,
    baseUrl: "https://school.instructure.test/api/v1",
  }));
  localStorage.setItem(EXTERNAL_CONNECTIONS_KEY, JSON.stringify({
    zoteroApiKey: LOCAL_SECRET_VALUES.zotero,
    githubToken: LOCAL_SECRET_VALUES.github,
    githubRepositories: ["old/repo"],
  }));
}

function seedMismatchedLocalSecrets(): void {
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({
    provider: "deepseek",
    apiKey: LOCAL_SECRET_VALUES.ai,
    baseUrl: "https://old-ai.test",
  }));
  localStorage.setItem(GOOGLE_SETTINGS_KEY, JSON.stringify({
    clientSecret: LOCAL_SECRET_VALUES.google,
    clientId: "old-client",
  }));
  localStorage.setItem(CANVAS_SETTINGS_KEY, JSON.stringify({
    accessToken: LOCAL_SECRET_VALUES.canvas,
    baseUrl: "https://old-school.test",
  }));
  localStorage.setItem(EXTERNAL_CONNECTIONS_KEY, JSON.stringify({
    zoteroApiKey: LOCAL_SECRET_VALUES.zotero,
    githubToken: LOCAL_SECRET_VALUES.github,
    githubRepositories: ["old/repo"],
  }));
}

function expectExistingLocalSecretsPreserved(): void {
  expect(JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) ?? "null")).toMatchObject({
    apiKey: LOCAL_SECRET_VALUES.ai,
    baseUrl: "https://ai.example.test",
  });
  expect(JSON.parse(localStorage.getItem(GOOGLE_SETTINGS_KEY) ?? "null")).toMatchObject({
    clientSecret: LOCAL_SECRET_VALUES.google,
    clientId: "public-client.apps.googleusercontent.com",
  });
  expect(JSON.parse(localStorage.getItem(CANVAS_SETTINGS_KEY) ?? "null")).toMatchObject({
    accessToken: LOCAL_SECRET_VALUES.canvas,
    baseUrl: "https://school.instructure.test",
  });
  expect(JSON.parse(localStorage.getItem(EXTERNAL_CONNECTIONS_KEY) ?? "null")).toMatchObject({
    zoteroApiKey: LOCAL_SECRET_VALUES.zotero,
    githubToken: LOCAL_SECRET_VALUES.github,
    githubRepositories: ["example/repo"],
  });

  const stored = SETTINGS_KEYS.map((key) => localStorage.getItem(key) ?? "").join("\n");
  for (const importedSecret of SECRET_VALUES) expect(stored).not.toContain(importedSecret);
}

function expectStoredSettingsSanitized(): void {
  const ai = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) ?? "null") as Record<string, unknown>;
  expect(ai).toMatchObject({ baseUrl: "https://ai.example.test", model: "deepseek-chat" });
  expect(ai).not.toHaveProperty("apiKey");
  expect(ai.nested).toEqual({ keep: true });

  const google = JSON.parse(localStorage.getItem(GOOGLE_SETTINGS_KEY) ?? "null") as Record<string, unknown>;
  expect(google).toEqual({ clientId: "public-client.apps.googleusercontent.com" });

  const canvas = JSON.parse(localStorage.getItem(CANVAS_SETTINGS_KEY) ?? "null") as Record<string, unknown>;
  expect(canvas).toEqual({ baseUrl: "https://school.instructure.test" });

  const external = JSON.parse(localStorage.getItem(EXTERNAL_CONNECTIONS_KEY) ?? "null") as Record<string, unknown>;
  expect(external).toMatchObject({
    zoteroLibraryId: "42",
    githubRepositories: ["example/repo"],
    driveFolderIds: ["folder-1"],
  });
  expect(external).not.toHaveProperty("zoteroApiKey");
  expect(external).not.toHaveProperty("githubToken");

  const allStored = [AI_SETTINGS_KEY, GOOGLE_SETTINGS_KEY, CANVAS_SETTINGS_KEY, EXTERNAL_CONNECTIONS_KEY]
    .map((key) => localStorage.getItem(key) ?? "")
    .join("\n");
  for (const secret of SECRET_VALUES) expect(allStored).not.toContain(secret);
}

beforeEach(() => localStorage.clear());

describe("note store", () => {
  it("round-trips a note through put/get/all", async () => {
    const note = makeNote("n1", "Round trip");
    await localStore.put(note);
    expect(await localStore.get("n1")).toEqual(note);
    expect((await localStore.all()).some((n) => n.id === "n1")).toBe(true);
  });

  it("remove leaves a tombstone; re-put clears it", async () => {
    await localStore.put(makeNote("n2", "Doomed"));
    await localStore.remove("n2");
    expect(await localStore.get("n2")).toBeNull();
    expect(readTombstones()).toHaveProperty("n2");
    await localStore.put(makeNote("n2", "Back"));
    expect(readTombstones()).not.toHaveProperty("n2");
  });
});

describe("backup", () => {
  it("collect → serialize → parse → apply round-trips notes and local state", async () => {
    await localStore.put(makeNote("b1", "Backed up"));
    localStorage.setItem("zen.deepwork.v3", JSON.stringify({ sessions: [1, 2] }));
    localStorage.setItem("zen.quiz.v2", "{\"history\":[]}");

    const backup = await collectBackup("0.0.0-test");
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed).not.toBeNull();

    // wipe, then restore
    localStorage.clear();
    await localStore.remove("b1");
    const result = await applyBackup(parsed!);

    expect(result.notes).toBeGreaterThanOrEqual(1);
    expect((await localStore.get("b1"))?.title).toBe("Backed up");
    expect(localStorage.getItem("zen.deepwork.v3")).toBe(JSON.stringify({ sessions: [1, 2] }));
    expect(localStorage.getItem("zen.quiz.v2")).toBe("{\"history\":[]}");
    // restoring must clear the delete tombstone so sync doesn't re-delete it
    expect(readTombstones()).not.toHaveProperty("b1");
  });

  it("never exports auth tokens or sync cursors", async () => {
    localStorage.setItem("zen.google.token.v1", "SECRET");
    localStorage.setItem("zen.sync.settings.v1", "cursor-state");
    localStorage.setItem("zen.appearance.v1", "{}");
    const backup = await collectBackup("0.0.0-test");
    expect(backup.local).not.toHaveProperty("zen.google.token.v1");
    expect(backup.local).not.toHaveProperty("zen.sync.settings.v1");
    expect(backup.local).toHaveProperty("zen.appearance.v1");
    expect(JSON.stringify(backup)).not.toContain("SECRET");
  });

  it("apply ignores excluded keys smuggled into a backup file", async () => {
    const backup = await collectBackup("0.0.0-test");
    backup.local["zen.google.token.v1"] = "EVIL";
    backup.local["not-a-zen-key"] = "x";
    await applyBackup(backup);
    expect(localStorage.getItem("zen.google.token.v1")).toBeNull();
    expect(localStorage.getItem("not-a-zen-key")).toBeNull();
  });

  it("strips every known provider secret while preserving portable settings", async () => {
    seedSettingsWithSecrets();

    const backup = await collectBackup("0.0.0-test");
    const serialized = JSON.stringify(backup);
    for (const secret of SECRET_VALUES) expect(serialized).not.toContain(secret);

    localStorage.clear();
    await applyBackup(backup);
    expectStoredSettingsSanitized();
    expect(JSON.parse(localStorage.getItem(TOOL_POLICY_KEY) ?? "null")).toEqual({ create_note: "ask" });
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? "null")).toEqual({ look: "veil", font: "literata" });
  });

  it("sanitizes secret fields smuggled into a crafted backup", async () => {
    seedSettingsWithSecrets();
    const craftedLocal = Object.fromEntries(
      SETTINGS_KEYS.map((key) => [key, localStorage.getItem(key) ?? ""]),
    );
    const backup = await collectBackup("0.0.0-test");
    backup.local = { ...backup.local, ...craftedLocal };

    localStorage.clear();
    await applyBackup(backup);
    expectStoredSettingsSanitized();
  });

  it("preserves this device's credentials when restored service identities match", async () => {
    seedSettingsWithSecrets();
    const craftedLocal = Object.fromEntries(
      SETTINGS_KEYS.map((key) => [key, localStorage.getItem(key) ?? ""]),
    );
    const backup = await collectBackup("0.0.0-test");
    backup.local = { ...backup.local, ...craftedLocal };

    localStorage.clear();
    seedExistingLocalSecrets();
    await applyBackup(backup);
    expectExistingLocalSecretsPreserved();
  });

  it("drops endpoint-bound credentials when a crafted backup changes service identity", async () => {
    seedSettingsWithSecrets();
    const craftedLocal = Object.fromEntries(
      SETTINGS_KEYS.map((key) => [key, localStorage.getItem(key) ?? ""]),
    );
    const backup = await collectBackup("0.0.0-test");
    backup.local = { ...backup.local, ...craftedLocal };

    localStorage.clear();
    seedMismatchedLocalSecrets();
    await applyBackup(backup);

    expect(JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) ?? "null")).not.toHaveProperty("apiKey");
    expect(JSON.parse(localStorage.getItem(GOOGLE_SETTINGS_KEY) ?? "null")).not.toHaveProperty("clientSecret");
    expect(JSON.parse(localStorage.getItem(CANVAS_SETTINGS_KEY) ?? "null")).not.toHaveProperty("accessToken");
    expect(JSON.parse(localStorage.getItem(EXTERNAL_CONNECTIONS_KEY) ?? "null")).toMatchObject({
      zoteroApiKey: LOCAL_SECRET_VALUES.zotero,
      githubToken: LOCAL_SECRET_VALUES.github,
      githubRepositories: ["example/repo"],
    });
  });

  it("marks restored portable settings dirty without marking unrelated backup keys", async () => {
    seedSettingsWithSecrets();
    localStorage.setItem("zen.deepwork.v3", JSON.stringify({ sessions: ["local"] }));
    const backup = await collectBackup("0.0.0-test");
    backup.notes = [];

    localStorage.clear();
    const since = Date.now();
    await applyBackup(backup);

    expectPortableSettingsMarkedDirty(since);
    expect(getDirty("deepwork")).not.toContain(BLOB_DOC_ID);
    expect(getBlobTs("deepwork")).toBe(0);
    expect(localStorage.getItem("zen.deepwork.v3")).toBe(JSON.stringify({ sessions: ["local"] }));
  });

  it("parseBackup rejects non-backup JSON and garbage", () => {
    expect(parseBackup("{}")).toBeNull();
    expect(parseBackup("not json")).toBeNull();
    expect(parseBackup(JSON.stringify({ kind: "zen-backup", version: 99, notes: [], local: {} }))).toBeNull();
    expect(parseBackup(JSON.stringify({ kind: "zen-backup", version: 1, appVersion: "1.0.0", notes: [], local: {} }))).toBeNull();
    expect(parseBackup(JSON.stringify({ kind: "zen-backup", version: 1, exportedAt: "not-a-date", appVersion: "1.0.0", notes: [], local: {} }))).toBeNull();
    expect(parseBackup(JSON.stringify({ kind: "zen-backup", version: 1, exportedAt: new Date().toISOString(), notes: [], local: {} }))).toBeNull();
  });
});

describe("settings-only transfer", () => {
  it("exports non-secret settings without any known credentials", () => {
    seedSettingsWithSecrets();

    const exported = collectPortableSettings();
    const serialized = JSON.stringify(exported);
    for (const secret of SECRET_VALUES) expect(serialized).not.toContain(secret);

    localStorage.clear();
    expect(applyPortableSettings(exported)).toBe(SETTINGS_KEYS.length);
    expectStoredSettingsSanitized();
    expect(JSON.parse(localStorage.getItem(TOOL_POLICY_KEY) ?? "null")).toEqual({ create_note: "ask" });
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? "null")).toEqual({ look: "veil", font: "literata" });
  });

  it("cannot import secret fields or unrecognized keys from a crafted file", () => {
    seedSettingsWithSecrets();
    const crafted = Object.fromEntries(
      SETTINGS_KEYS.map((key) => [key, JSON.parse(localStorage.getItem(key) ?? "null") as unknown]),
    );
    Object.assign(crafted, {
      "zen.google.token.v1": "AUTH_SECRET",
      "not-a-zen-key": { apiKey: "UNKNOWN_SECRET" },
    });

    localStorage.clear();
    expect(applyPortableSettings(crafted)).toBe(SETTINGS_KEYS.length);
    expectStoredSettingsSanitized();
    expect(localStorage.getItem("zen.google.token.v1")).toBeNull();
    expect(localStorage.getItem("not-a-zen-key")).toBeNull();
  });

  it("keeps local credentials while importing settings for the same service identities", () => {
    seedSettingsWithSecrets();
    const crafted = Object.fromEntries(
      SETTINGS_KEYS.map((key) => [key, JSON.parse(localStorage.getItem(key) ?? "null") as unknown]),
    );

    localStorage.clear();
    seedExistingLocalSecrets();
    expect(applyPortableSettings(crafted)).toBe(SETTINGS_KEYS.length);
    expectExistingLocalSecretsPreserved();
  });

  it("drops endpoint-bound credentials when a crafted settings file changes service identity", () => {
    seedSettingsWithSecrets();
    const crafted = Object.fromEntries(
      SETTINGS_KEYS.map((key) => [key, JSON.parse(localStorage.getItem(key) ?? "null") as unknown]),
    );

    localStorage.clear();
    seedMismatchedLocalSecrets();
    expect(applyPortableSettings(crafted)).toBe(SETTINGS_KEYS.length);

    expect(JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) ?? "null")).not.toHaveProperty("apiKey");
    expect(JSON.parse(localStorage.getItem(GOOGLE_SETTINGS_KEY) ?? "null")).not.toHaveProperty("clientSecret");
    expect(JSON.parse(localStorage.getItem(CANVAS_SETTINGS_KEY) ?? "null")).not.toHaveProperty("accessToken");
    expect(JSON.parse(localStorage.getItem(EXTERNAL_CONNECTIONS_KEY) ?? "null")).toMatchObject({
      zoteroApiKey: LOCAL_SECRET_VALUES.zotero,
      githubToken: LOCAL_SECRET_VALUES.github,
      githubRepositories: ["example/repo"],
    });
  });

  it("marks every successfully imported portable setting dirty", () => {
    seedSettingsWithSecrets();
    const exported = collectPortableSettings();

    localStorage.clear();
    const since = Date.now();
    expect(applyPortableSettings(exported)).toBe(SETTINGS_KEYS.length);
    expectPortableSettingsMarkedDirty(since);
    expect(getDirty("deepwork")).not.toContain(BLOB_DOC_ID);
  });

  it("omits malformed secret-bearing config instead of copying it verbatim", async () => {
    localStorage.setItem(AI_SETTINGS_KEY, "not-json");
    localStorage.setItem(CANVAS_SETTINGS_KEY, "[]");

    const backup = await collectBackup("0.0.0-test");
    expect(backup.local).not.toHaveProperty(AI_SETTINGS_KEY);
    expect(backup.local).not.toHaveProperty(CANVAS_SETTINGS_KEY);
    expect(collectPortableSettings()).not.toHaveProperty(AI_SETTINGS_KEY);
    expect(collectPortableSettings()).not.toHaveProperty(CANVAS_SETTINGS_KEY);

    localStorage.clear();
    seedExistingLocalSecrets();
    const existingAi = localStorage.getItem(AI_SETTINGS_KEY);
    backup.local[AI_SETTINGS_KEY] = "not-json";
    await applyBackup(backup);
    expect(localStorage.getItem(AI_SETTINGS_KEY)).toBe(existingAi);
    expect(applyPortableSettings({ [CANVAS_SETTINGS_KEY]: "not-an-object" })).toBe(0);
    expect(JSON.parse(localStorage.getItem(CANVAS_SETTINGS_KEY) ?? "null")).toMatchObject({
      accessToken: LOCAL_SECRET_VALUES.canvas,
      baseUrl: "https://school.instructure.test/api/v1",
    });
  });
});
