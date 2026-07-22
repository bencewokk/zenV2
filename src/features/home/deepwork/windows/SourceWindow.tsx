import { useState } from "react";
import { useSources } from "@/services/sources/store";
import { usePdfs } from "@/features/pdfs/store";
import { downloadCanvasFile } from "@/services/canvas/client";
import { notify } from "@/shared/ui/notify";

/**
 * Read-only view of a connected source (e.g. a Canvas assignment, module, page,
 * announcement, or file) on the Deep Work canvas. The source's extracted `text`
 * is already populated by the provider refresh, so this just presents it plus a
 * link back to the origin. Canvas PDF files can be saved into the PDF library.
 */
export function SourceWindow({ sourceId }: { sourceId: string }) {
  const source = useSources((s) => s.sources[sourceId]);
  const addPdf = usePdfs((s) => s.add);
  const [saving, setSaving] = useState(false);

  if (!source) {
    return <div className="p-4 text-sm text-[var(--text-dim)]">This source is no longer available on this device.</div>;
  }

  const isPdfFile =
    source.kind === "file" && String(source.metadata?.contentType ?? "").toLowerCase().includes("pdf");

  async function saveToPdfs() {
    if (!source) return;
    setSaving(true);
    try {
      const { file, blob } = await downloadCanvasFile(Number(source.externalId));
      const named = new File([blob], file.filename || `${source.title}.pdf`, { type: "application/pdf" });
      const id = await addPdf(named, source.tags ?? []);
      if (id) notify.success(`Saved "${source.title}" to your PDFs`);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not download that Canvas file.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 p-4 text-left">
      <div className="text-xs uppercase tracking-[0.18em] text-[var(--text-dim)]">
        {source.provider} · {source.kind}
        {source.container ? ` · ${source.container}` : ""}
      </div>
      {source.text ? (
        <div className="whitespace-pre-wrap text-sm leading-6 text-[rgba(232,233,237,0.86)]">{source.text}</div>
      ) : (
        <div className="text-sm text-[var(--text-dim)]">No extracted text for this source.</div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-dim)] transition hover:text-[var(--text)]"
          >
            Open in {source.provider === "canvas" ? "Canvas" : "browser"}
          </a>
        )}
        {isPdfFile && (
          <button
            className="inline-block rounded-[10px] border border-[rgba(var(--accent-rgb),0.4)] bg-[rgba(var(--accent-rgb),0.12)] px-3 py-1.5 text-xs text-[var(--text)] transition hover:bg-[rgba(var(--accent-rgb),0.2)] disabled:opacity-40"
            onClick={saveToPdfs}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save to PDFs"}
          </button>
        )}
      </div>
    </div>
  );
}
