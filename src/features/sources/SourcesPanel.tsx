import { useEffect, useMemo, useRef, useState } from "react";
import { notify } from "@/shared/ui/notify";
import { captureToSource, type WebCapturePayload } from "@/services/sources/capture";
import { refreshAllSources } from "@/services/sources/refresh";
import { ensureSourcesLoaded, useSources } from "@/services/sources/store";
import type { ConnectedSource, SourceProvider } from "@/services/sources/types";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import MagicBento from "@/shared/ui/reactbits/MagicBento";
import { CANVAS_INTEGRATION_ENABLED } from "@/services/canvas/availability";

/** A "course" record is the grouping, not study material — everything else can
 *  be pulled onto a Deep Work canvas as a source window. */
function isAttachable(source: ConnectedSource): boolean {
  return source.kind !== "course";
}

/** Route a source onto the Deep Work canvas via the shared session picker. */
function addSourceToDeepWork(source: ConnectedSource): void {
  useDeepWork.getState().requestAdd({ type: "source", id: source.id });
}

const PROVIDERS: Array<{ id: "all" | SourceProvider; label: string }> = [
  { id: "all", label: "All" }, { id: "canvas", label: "Canvas" }, { id: "drive", label: "Drive" },
  { id: "zotero", label: "Zotero" }, { id: "github", label: "GitHub" }, { id: "web", label: "Web" },
];

export function SourcesPanel() {
  const sources = useSources((state) => state.sources);
  const [provider, setProvider] = useState<"all" | SourceProvider>("all");
  const [query, setQuery] = useState("");
  const selected = useSources((state) => state.selectedId);
  const [refreshing, setRefreshing] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void ensureSourcesLoaded(); }, []);
  const filtered = useMemo(() => Object.values(sources)
    .filter((source) => provider === "all" || source.provider === provider)
    .filter((source) => !query.trim() || `${source.title} ${source.container ?? ""} ${source.text}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.sourceUpdatedAt ?? b.syncedAt) - (a.sourceUpdatedAt ?? a.syncedAt)), [provider, query, sources]);
  const active = (selected ? sources[selected] : undefined) ?? filtered[0];

  async function refresh() {
    setRefreshing(true);
    try {
      const results = await refreshAllSources();
      const total = results.reduce((sum, result) => sum + result.imported, 0);
      notify.success(results.length ? `Refreshed ${total} connected sources` : "No configured sources to refresh");
    } catch (error) {
      notify.error((error as Error).message || "Source refresh failed");
    } finally { setRefreshing(false); }
  }

  async function importCapture(file: File) {
    try {
      const payload = JSON.parse(await file.text()) as WebCapturePayload;
      const source = captureToSource(payload);
      await useSources.getState().upsertMany([source]);
      setProvider("web"); useSources.getState().select(source.id);
      notify.success("Web capture imported");
    } catch (error) { notify.error((error as Error).message || "Could not import capture"); }
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-4 py-4 sm:px-6">
      <div className="mb-3 flex items-center gap-2">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text)]">Sources</h1>
          <p className="text-xs text-[var(--text-dim)]">Connected course material, research, files, code, and web captures.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <input ref={importRef} type="file" accept=".json,.zenclip.json,application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCapture(file); event.target.value = ""; }} />
          <button className="zen-btn-ghost" onClick={() => importRef.current?.click()}>Import web capture…</button>
          <button className="zen-btn" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? "Refreshing…" : "Refresh all"}</button>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {PROVIDERS.map((item) => {
          const disabled = item.id === "canvas" && !CANVAS_INTEGRATION_ENABLED;
          return (
            <button
              key={item.id}
              className={provider === item.id ? "zen-btn" : "zen-btn-ghost"}
              disabled={disabled}
              title={disabled ? "Canvas is disabled for now" : undefined}
              onClick={() => setProvider(item.id)}
            >
              {item.label}{disabled ? " · Disabled" : item.id === "all" ? ` · ${Object.keys(sources).length}` : ""}
            </button>
          );
        })}
        <input className="zen-input ml-auto min-w-52" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sources…" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,0.38fr)_minmax(0,1fr)] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)]">
        <div className="min-h-0 overflow-y-auto border-r border-[var(--border)]">
          {filtered.length ? filtered.map((source) => (
            <button key={source.id} onClick={() => useSources.getState().select(source.id)} onContextMenu={(e) => { if (isAttachable(source)) { e.preventDefault(); addSourceToDeepWork(source); } }} title={isAttachable(source) ? "Click to preview · right-click to add to Deep Work" : undefined} className={`block w-full border-b border-[var(--border)] px-3 py-3 text-left hover:bg-[var(--bg-elev)] ${active?.id === source.id ? "bg-[var(--bg-elev)]" : ""}`}>
              <div className="truncate text-sm text-[var(--text)]">{source.title}</div>
              <div className="mt-1 flex gap-2 text-[11px] text-[var(--text-dim)]"><span className="capitalize">{source.provider}</span><span>·</span><span>{source.kind.replace(/_/g, " ")}</span>{source.container && <><span>·</span><span className="truncate">{source.container}</span></>}</div>
            </button>
          )) : <div className="p-6 text-sm text-[var(--text-dim)]">No sources here yet. Configure connections, refresh, or import a web capture.</div>}
        </div>
        {active ? <SourceDetail source={active} /> : <SourcesHub onPick={setProvider} />}
      </div>
    </div>
  );
}

/** Shown when nothing is selected (typically before any source is connected):
 *  a MagicBento hub of source categories that filters on click. */
function SourcesHub({ onPick }: { onPick: (provider: "all" | SourceProvider) => void }) {
  return (
    <div className="min-h-0 overflow-y-auto p-6">
      <h2 className="text-base font-semibold text-[var(--text)]">Connect your sources</h2>
      <p className="mb-4 mt-1 text-xs text-[var(--text-dim)]">Course material, research, files, and the web — all searchable in one place.</p>
      <MagicBento
        cards={[
          {
            label: "LMS",
            title: "Canvas",
            description: CANVAS_INTEGRATION_ENABLED ? "Courses, assignments, modules, and files" : "Disabled for now",
            onClick: CANVAS_INTEGRATION_ENABLED ? () => onPick("canvas") : undefined,
          },
          { label: "Files", title: "Google Drive", description: "Every file you allow, read-only", onClick: () => onPick("drive") },
          { label: "Research", title: "Zotero", description: "Papers, annotations, and citations", onClick: () => onPick("zotero") },
          { label: "Code", title: "GitHub", description: "Repositories allowed by your token", onClick: () => onPick("github") },
          { label: "Web", title: "Web captures", description: "Clip any page with the extension", onClick: () => onPick("web") },
          { label: "All", title: "Everything", description: "Browse every connected source", onClick: () => onPick("all") },
        ]}
        calm
      />
    </div>
  );
}

function SourceDetail({ source }: { source?: ConnectedSource }) {
  if (!source) return <div className="grid place-items-center text-sm text-[var(--text-dim)]">Select a source</div>;
  return <article className="min-h-0 overflow-y-auto p-5">
    <div className="mb-1 text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">{source.provider} · {source.kind.replace(/_/g, " ")}</div>
    <h2 className="text-xl font-semibold text-[var(--text)]">{source.title}</h2>
    {source.container && <div className="mt-1 text-sm text-[var(--text-dim)]">{source.container}</div>}
    <div className="mt-3 flex gap-2">{source.url && <a className="zen-btn-ghost" href={source.url} target="_blank" rel="noreferrer">Open original</a>}<button className="zen-btn-ghost" onClick={() => void navigator.clipboard.writeText(source.citation || source.url || source.title)}>Copy citation</button>{isAttachable(source) && <button className="zen-btn-ghost" onClick={() => addSourceToDeepWork(source)}>Add to Deep Work</button>}</div>
    {source.citation && <blockquote className="mt-4 rounded-[8px] border border-[var(--border)] bg-[var(--bg-elev)] p-3 text-xs text-[var(--text-dim)]">{source.citation}</blockquote>}
    {source.imageDataUrl && <img className="mt-4 max-w-full rounded-[8px] border border-[var(--border)]" src={source.imageDataUrl} alt={source.title} />}
    <pre className="mt-5 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-[var(--text)]">{source.text || "No extractable text. The source metadata and original link are still available."}</pre>
  </article>;
}
