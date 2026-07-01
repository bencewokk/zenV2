import { useEffect, useMemo, useState } from "react";
import { usePdfs } from "@/features/pdfs/store";
import { usePdfNav } from "@/features/pdfs/pdfNav";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { useIndexProgress } from "@/features/memory/useIndexProgress";
import { isPdfIndexed, primeIndex, buildPdfIndex } from "@/services/memory";
import { notify } from "@/shared/ui/notify";
import { syncOnce } from "@/services/sync/engine";
import type { PdfAnnotation, PdfOutlineItem } from "@/shared/lib/types";

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
  const [retrying, setRetrying] = useState(false);
  const [pages, setPages] = useState<string[] | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
  const [showToc, setShowToc] = useState(true);
  // Chromium often fails to paint the native PDF toolbar when a blob <iframe> is
  // mounted dynamically (first open), though it works after a full reload. Bump
  // this once after the URL resolves to force a single remount so the toolbar
  // initializes without the user having to refresh.
  const [reloadNonce, setReloadNonce] = useState(0);

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
    void usePdfs.getState().outlineFor(pdfId).then((o) => { if (alive) setOutline(o ?? []); });
    void usePdfs.getState().loadAnnotations(pdfId);
    setReloadNonce(0);
    return () => { alive = false; };
  }, [pdfId]);

  // Once the blob URL is available, trigger exactly one remount of the viewer.
  useEffect(() => {
    if (!url || reloadNonce > 0) return;
    const t = window.setTimeout(() => setReloadNonce(1), 50);
    return () => window.clearTimeout(t);
  }, [url, reloadNonce]);

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

  // Follow AI/Study/Quiz navigation requests aimed at this PDF, flashing the
  // viewer so a programmatic jump is noticeable.
  const navNonce = usePdfNav((s) => s.nonce);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    const nav = usePdfNav.getState();
    if (nav.nonce > 0 && nav.pdfId === pdfId) {
      go(nav.page);
      setFlash((f) => f + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navNonce]);

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

  const retryDownload = async () => {
    setRetrying(true);
    try {
      await syncOnce();
      const nextUrl = await usePdfs.getState().urlFor(pdfId);
      if (!nextUrl) throw new Error("The PDF file is still unavailable on the sync server.");
      setUrl(nextUrl);
      setMissing(false);
    } catch (error) {
      notify.error((error as Error).message || "Could not download PDF");
    } finally {
      setRetrying(false);
    }
  };

  const sorted = useMemo(() => [...bookmarks].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt), [bookmarks]);

  // Group highlights by concept (concept-tagged groups first, plain bookmarks last).
  const grouped = useMemo(() => {
    const groups = new Map<string, PdfAnnotation[]>();
    for (const b of sorted) {
      const key = b.concept?.trim() || "";
      const arr = groups.get(key) ?? [];
      arr.push(b);
      groups.set(key, arr);
    }
    return [...groups.entries()].sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || a[0].localeCompare(b[0]));
  }, [sorted]);

  if (missing) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm">
        <div className="max-w-sm">
          <div className="font-medium text-[var(--text)]">PDF file not downloaded</div>
          <p className="mt-1 text-[var(--text-dim)]">
            Its title and table of contents synced, but the PDF bytes are not available on this device yet.
          </p>
          <button
            className="zen-pressable mt-3 rounded bg-[var(--accent)] px-3 py-1.5 text-white disabled:opacity-50"
            onClick={() => void retryDownload()}
            disabled={retrying}
          >
            {retrying ? "Retrying sync…" : "Retry download"}
          </button>
        </div>
      </div>
    );
  }
  if (!url) return <div className="p-4 text-sm text-[var(--text-dim)]">Loading PDF…</div>;

  // Toolbar/nav hash drives the native viewer's page. Changing the fragment
  // reloads the embedded viewer at that page.
  const src = `${url}#page=${page}&zoom=page-width`;
  const hasPanel = sorted.length > 0 || matches.length > 0 || outline.length > 0;

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
        <IndexBadge pdfId={pdfId} pageCount={pageCount} />
      </div>

      <div className="flex min-h-0 flex-1">
        {hasPanel && (
          <div className="w-52 shrink-0 overflow-auto border-r border-[var(--border)] p-1 text-[11px]">
            {outline.length > 0 && (
              <>
                <button
                  className="flex w-full items-center gap-1 px-1 py-1 font-semibold uppercase tracking-wide text-[var(--text-dim)] hover:text-[var(--text)]"
                  onClick={() => setShowToc((v) => !v)}
                  title={showToc ? "Collapse contents" : "Expand contents"}
                >
                  <span>{showToc ? "▾" : "▸"}</span> Contents
                </button>
                {showToc &&
                  outline.map((o, i) => (
                    <button
                      key={i}
                      className="block w-full truncate rounded px-1.5 py-0.5 text-left hover:bg-[var(--bg-elev)] disabled:opacity-40"
                      style={{ paddingLeft: `${6 + o.level * 10}px` }}
                      onClick={() => o.page && go(o.page)}
                      disabled={!o.page}
                      title={o.title}
                    >
                      <span className="text-[var(--text)]">{o.title}</span>
                      {o.page > 0 && <span className="ml-1 text-[var(--text-dim)]">p{o.page}</span>}
                    </button>
                  ))}
              </>
            )}
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
            {grouped.map(([concept, items]) => (
              <div key={concept || "__plain"}>
                <div className="mt-2 px-1 py-1 font-semibold uppercase tracking-wide text-[var(--text-dim)]">
                  {concept || "Bookmarks"}
                </div>
                {items.map((b) => (
                  <div key={b.id} className="group flex items-start gap-1 rounded px-1.5 py-1 hover:bg-[var(--bg-elev)]">
                    <button className="min-w-0 flex-1 text-left" onClick={() => go(b.page)} title="Go to page">
                      <span className="text-[var(--accent)]">p{b.page}</span>{" "}
                      <span className="text-[var(--text-dim)]">{b.text || "(bookmark)"}</span>
                      {b.note && <span className="mt-0.5 block italic text-[var(--text-dim)] opacity-80">— {b.note}</span>}
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
              </div>
            ))}
          </div>
        )}

        {/* native PDF viewer; key forces a reload to honor the #page fragment */}
        <div className="relative min-w-0 flex-1">
          <iframe key={`${page}-${reloadNonce}`} title="pdf" src={src} className="h-full w-full border-0 bg-white" />
          {flash > 0 && (
            <div
              key={flash}
              className="zen-flash pointer-events-none absolute inset-0 z-10"
              style={{ boxShadow: "inset 0 0 0 3px var(--accent)", background: "var(--accent-dim)" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Semantic-index status for this PDF: "Indexed" (semantic search ready), a live
 * "Indexing x/total" while embedding, or "Index" to build it on demand. Re-checks
 * on every index-progress tick (so it flips to Indexed when a build completes).
 */
function IndexBadge({ pdfId, pageCount }: { pdfId: string; pageCount: number }) {
  const progress = useIndexProgress();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void primeIndex().then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  const indexingThis = !!progress && progress.pdfId === pdfId;
  if (indexingThis) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <span className="ml-auto flex items-center gap-1 text-[var(--accent)]" title="Building the semantic index for this PDF">
        <span className="inline-block h-1.5 w-1.5 rounded-full zen-glow" style={{ background: "var(--accent)", "--zen-glow-color": "rgba(110,168,254,0.45)" } as React.CSSProperties} />
        Indexing {pct}%
      </span>
    );
  }

  const indexed = ready && isPdfIndexed(pdfId, pageCount || undefined);
  if (indexed) {
    return (
      <span className="ml-auto flex items-center gap-1 text-[var(--text-dim)]" title="Semantic (AI) search is ready for this PDF">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--ok)" }} />
        Indexed
      </span>
    );
  }

  return (
    <button
      className="zen-pressable ml-auto flex items-center gap-1 rounded bg-[var(--bg-elev)] px-2 py-0.5 text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-50"
      onClick={async () => {
        const { pdfs, pagesFor } = usePdfs.getState();
        try {
          await buildPdfIndex(pdfId, pdfs, pagesFor);
        } catch (e) {
          console.error("[index] buildPdfIndex failed:", e);
          notify.error(`Indexing failed: ${(e as Error)?.message || e}`);
        }
      }}
      disabled={!ready || !!progress}
      title="Build the on-device semantic index so the AI can search this PDF by meaning (one-time)"
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--text-dim)" }} />
      {progress ? "Indexing…" : "Index"}
    </button>
  );
}
