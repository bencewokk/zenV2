import { useCallback, useEffect, useMemo, useState } from "react";
import { GoogleGate } from "@/features/google/GoogleGate";
import { listThreads, getThread, type MailThread } from "@/services/google/gmail";
import { useAI } from "@/features/ai/store";
import { useHome } from "@/features/home/store";
import { notify } from "@/shared/ui/notify";
import { SkeletonRows } from "@/shared/ui/Skeleton";

export function MailPanel({ embedded = false, initialOpenId = null }: { embedded?: boolean; initialOpenId?: string | null }) {
  return (
    <GoogleGate title="Mail">
      <MailInner embedded={embedded} initialOpenId={initialOpenId} />
    </GoogleGate>
  );
}

const CATEGORIES: { id: string; label: string; q: string }[] = [
  // "All" scopes to the inbox (not Sent/Spam/Trash/archived) and ignores the
  // category tabs, so mail Gmail filed under Promotions/Social/etc still shows.
  { id: "all", label: "All", q: "in:inbox" },
  { id: "primary", label: "Primary", q: "in:inbox category:primary" },
  { id: "unread", label: "Unread", q: "in:inbox is:unread" },
  { id: "promotions", label: "Promotions", q: "in:inbox category:promotions" },
  { id: "social", label: "Social", q: "in:inbox category:social" },
  { id: "updates", label: "Updates", q: "in:inbox category:updates" },
  { id: "forums", label: "Forums", q: "in:inbox category:forums" },
];

function MailInner({ embedded, initialOpenId }: { embedded: boolean; initialOpenId: string | null }) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const processedIdsArr = useHome((s) => s.processedThreadIds);
  const processedIds = useMemo(() => new Set(processedIdsArr), [processedIdsArr]);
  const matchedLabels = useHome((s) => s.matchedThreadLabels);
  const launchDeepWork = useHome((s) => s.launchDeepWork);
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
  const [summary, setSummary] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const complete = useAI((s) => s.complete);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const load = useCallback(async (catId: string, text: string) => {
    setLoading(true);
    try {
      const q = [CATEGORIES.find((c) => c.id === catId)?.q, text.trim()].filter(Boolean).join(" ");
      setThreads(await listThreads(q, 20));
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(cat, query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat]);

  useEffect(() => {
    if (initialOpenId && initialOpenId !== openId) {
      void open(initialOpenId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenId]);

  async function open(id: string) {
    setOpenId(id);
    setHtml("");
    setText("Loading…");
    setSummary("");
    try {
      const t = await getThread(id);
      setHtml(t.html);
      setText(t.text);
    } catch (e) {
      setText(`Error: ${(e as Error).message}`);
    }
  }

  async function summarize() {
    if (!text) return;
    setSummary("…");
    const out = await complete("Summarize this email thread in 2-3 bullet points and note any action items.", text.slice(0, 8000));
    setSummary(out);
  }

  return (
    <div className="flex h-full min-h-0">
      {/* thread list */}
      <div className="flex w-[340px] shrink-0 flex-col border-r border-[var(--border)]">
        <div className="flex gap-2 p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(cat, query)}
            placeholder="Search mail (e.g. from:bank)…"
            className="flex-1 rounded bg-[var(--bg-elev)] px-2 py-1 text-sm outline-none placeholder:text-[var(--text-dim)]"
          />
        </div>
        <div className="flex flex-wrap gap-1 px-2 pb-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={`zen-pressable rounded-full px-2.5 py-0.5 text-xs ${
                cat === c.id
                  ? "bg-[var(--accent-dim)] text-[var(--text)]"
                  : "bg-[var(--bg-elev)] text-[var(--text-dim)] hover:text-[var(--text)]"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <SkeletonRows count={8} className="p-3" />
          ) : threads.length === 0 ? (
            <div className="px-3 py-2 text-sm text-[var(--text-dim)]">No threads</div>
          ) : (
            <div className="zen-stagger">
            {threads.map((t) => {
              const aiChecked = processedIds.has(t.id);
              const eventLabel = matchedLabels[t.id];
              return (
                <button
                  key={t.id}
                  onClick={() => open(t.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ x: event.clientX, y: event.clientY, id: t.id });
                  }}
                  className={`block w-full border-b border-[var(--border)] px-3 py-2 text-left hover:bg-[var(--bg-elev)] ${
                    openId === t.id ? "bg-[var(--bg-elev)]" : ""
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`truncate text-sm ${t.unread ? "font-semibold" : ""}`}>{t.subject}</span>
                    <span
                      className={`shrink-0 text-[10px] ${aiChecked ? "text-[var(--accent)]" : "text-transparent"}`}
                      title={aiChecked ? "AI has checked this email for calendar matches" : undefined}
                    >
                      ✦
                    </span>
                  </div>
                  <div className="truncate text-xs text-[var(--text-dim)]">{t.from}</div>
                  {eventLabel ? (
                    <div className="mt-1 inline-flex items-center rounded-full border border-[var(--accent-dim)] bg-[var(--accent-dim)] px-2 py-0.5 text-[10px] text-[var(--accent)]">
                      {eventLabel}
                    </div>
                  ) : (
                    <div className="truncate text-xs text-[var(--text-dim)]">{t.snippet}</div>
                  )}
                </button>
              );
            })}
            </div>
          )}
        </div>

        {menu && (
          <div
            className="zen-anim-pop fixed z-50 min-w-[180px] rounded-[12px] border border-[var(--border)] bg-[rgba(18,19,24,0.96)] p-1 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur"
            style={{ left: menu.x, top: menu.y, transformOrigin: "top left" }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              className="block w-full rounded-[10px] px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--bg-elev)]"
              onClick={() => {
                launchDeepWork({ type: "mail", id: menu.id });
                setMenu(null);
              }}
            >
              Add to Deep Work
            </button>
          </div>
        )}
      </div>

      {/* reader */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        {!openId ? (
          <div className="text-[var(--text-dim)]">Select a thread</div>
        ) : (
          <>
            <button
              className="zen-pressable mb-3 rounded bg-[var(--accent)] px-3 py-1 text-xs text-black"
              onClick={summarize}
            >
              Summarize with AI
            </button>
            {summary && (
              <div className="zen-anim-rise mb-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elev)] p-3 text-sm whitespace-pre-wrap">
                {summary}
              </div>
            )}
            {html ? (
              <iframe
                title="email"
                className={`zen-anim-fade w-full rounded border border-[var(--border)] bg-white ${embedded ? "min-h-[420px] flex-1" : "h-[calc(100vh-220px)]"}`}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                srcDoc={`<!doctype html><html><head><base target="_blank"><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;margin:12px;color:#111}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`}
              />
            ) : text === "Loading…" ? (
              <SkeletonRows count={6} />
            ) : (
              <pre className="whitespace-pre-wrap break-words text-sm text-[var(--text-dim)]">{text}</pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
