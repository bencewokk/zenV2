import { useEffect, useMemo, useState } from "react";
import { usePdfs } from "@/features/pdfs/store";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import type { PdfAnnotation } from "@/shared/lib/types";

const EMPTY: PdfAnnotation[] = []; // stable empty ref to avoid re-renders

interface SearchMatch { page: number; snippet: string }

/**
 * PDF viewer built on the browser's native PDF engine (an <iframe>), which is
 * fast and stable. We can't paint on it, so highlights are modelled as
 * bookmarks (page + quoted text) shown in a side panel; clicking one navigates
 * the viewer to that page via the `#page=N` fragment. The AI creates bookmarks
 * through the highlight_pdf tool.
 */
export function PdfViewer({ pdfId }: { pdfId: string }) {
  const pdf = usePdfs((s) => s.pdfs[pdfId]);
  const bookmarks = usePdfs((s) => s.annotations[pdfId] ?? EMPTY);

  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [pages, setPages] = useState<string[] | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);

  const pageCount = pdf?.pageCount ?? pages?.length ?? 0;

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setMissing(false);
    setPage(1);
    usePdfs.getState().urlFor(pdfId).then((u) => {
      if (!alive) return;
      if (u) setUrl(u);
      else setMissing(true);
    });
    void usePdfs.getState().pagesFor(pdfId).then((p) => { if (alive) setPages(p); });
    void usePdfs.getState().loadAnnotations(pdfId);
    return () => { alive = false; };
  }, [pdfId]);

  const runSearch = (q: string) => {
    setQuery(q);
    const needle = q.toLowerCase().trim();
    if (!needle || !pages) { setMatches([]); return; }
    const out: SearchMatch[] = [];
    for (let i = 0; i < pages.length; i++) {
      const idx = pages[i].toLowerCase().indexOf(needle);
      if (idx === -1) continue;
      out.push({ page: i + 1, snippet: pages[i].slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, " ").trim() });
    }
    setMatches(out);
  };

  const go = (p: number) => setPage(Math.min(pageCount || p, Math.max(1, p)));

  const addBookmark = () => {
    const snippet = (pages?.[page - 1] ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    void usePdfs.getState().addAnnotation(pdfId, {
      id: crypto.randomUUID(),
      page,
      text: snippet || `Page ${page}`,
      createdAt: Date.now(),
    });
  };

  const removeBookmark = (id: string) => void usePdfs.getState().removeAnnotation(pdfId, id);

  const sorted = useMemo(() => [...bookmarks].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt), [bookmarks]);

  if (missing) return <div className="p-4 text-sm text-[var(--text-dim)]">This PDF is no longer available.</div>;
  if (!url) return <div className="p-4 text-sm text-[var(--text-dim)]">Loading PDF…</div>;

  // Toolbar/nav hash drives the native viewer's page. Changing the fragment
  // reloads the embedded viewer at that page.
  const src = `${url}#page=${page}&zoom=page-width`;
  const hasPanel = sorted.length > 0 || matches.length > 0;

  return (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      {/* toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-2 py-1.5 text-xs">
        <button className="zen-pressable rounded bg-[var(--bg-elev)] px-2 py-0.5 disabled:opacity-40" onClick={() => go(page - 1)} disabled={page <= 1}>‹</button>
        <input
          value={page}
          onChange={(e) => go(Number(e.target.value) || 1)}
          className="w-10 rounded bg-[var(--bg-elev)] px-1 py-0.5 text-center outline-none"
        />
        <span className="text-[var(--text-dim)]">/ {pageCount || "?"}</span>
        <button className="zen-pressable rounded bg-[var(--bg-elev)] px-2 py-0.5 disabled:opacity-40" onClick={() => go(page + 1)} disabled={!!pageCount && page >= pageCount}>›</button>
        <span className="mx-1 h-4 w-px bg-[var(--border)]" />
        <button className="zen-pressable rounded bg-[var(--bg-elev)] px-2 py-0.5 text-[var(--accent)]" onClick={addBookmark} title="Bookmark this page">＋ Bookmark</button>
        <button className="zen-pressable rounded bg-[var(--bg-elev)] px-2 py-0.5 text-[var(--text-dim)] hover:text-[var(--text)]" onClick={() => useDeepWork.getState().requestAdd({ type: "pdf", id: pdfId })} title="Add this PDF to Deep Work">⊕ Deep Work</button>
        <span className="mx-1 h-4 w-px bg-[var(--border)]" />
        <input
          value={query}
          onChange={(e) => runSearch(e.target.value)}
          placeholder="Find page…"
          className="min-w-[110px] flex-1 rounded bg-[var(--bg-elev)] px-2 py-0.5 outline-none placeholder:text-[var(--text-dim)]"
        />
        {query.trim() && <span className="text-[var(--text-dim)]">{matches.length} hit{matches.length === 1 ? "" : "s"}</span>}
      </div>

      <div className="flex min-h-0 flex-1">
        {hasPanel && (
          <div className="w-52 shrink-0 overflow-auto border-r border-[var(--border)] p-1 text-[11px]">
            {matches.length > 0 && (
              <>
                <div className="px-1 py-1 font-semibold uppercase tracking-wide text-[var(--text-dim)]">Matches</div>
                {matches.map((m, i) => (
                  <button key={i} className="block w-full rounded px-1.5 py-1 text-left hover:bg-[var(--bg-elev)]" onClick={() => go(m.page)}>
                    <span className="text-[var(--accent)]">p{m.page}</span> <span className="text-[var(--text-dim)]">…{m.snippet}…</span>
                  </button>
                ))}
              </>
            )}
            {sorted.length > 0 && (
              <>
                <div className="mt-2 px-1 py-1 font-semibold uppercase tracking-wide text-[var(--text-dim)]">Bookmarks</div>
                {sorted.map((b) => (
                  <div key={b.id} className="group flex items-start gap-1 rounded px-1.5 py-1 hover:bg-[var(--bg-elev)]">
                    <button className="min-w-0 flex-1 text-left" onClick={() => go(b.page)} title="Go to page">
                      <span className="text-[var(--accent)]">p{b.page}</span>{" "}
                      <span className="text-[var(--text-dim)]">{b.text || "(bookmark)"}</span>
                    </button>
                    <button
                      className="shrink-0 text-[var(--text-dim)] opacity-0 hover:text-red-400 group-hover:opacity-100"
                      onClick={() => removeBookmark(b.id)}
                      title="Remove bookmark"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* native PDF viewer; key forces a reload to honor the #page fragment */}
        <iframe key={page} title="pdf" src={src} className="min-w-0 flex-1 border-0 bg-white" />
      </div>
    </div>
  );
}
