import { useEffect, useState } from "react";
import { getThread, replyInThread } from "@/services/google/gmail";
import { notify } from "@/shared/ui/notify";

/** Full email body (sanitized) + an inline reply box, for the Deep Work canvas. */
export function EmailWindow({ threadId, from }: { threadId: string; from: string }) {
  const [html, setHtml] = useState("");
  const [text, setText] = useState("Loading…");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setHtml("");
    setText("Loading…");
    getThread(threadId)
      .then((t) => {
        if (!alive) return;
        setHtml(t.html);
        setText(t.text);
      })
      .catch((e: unknown) => {
        if (alive) setText(`Error: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      alive = false;
    };
  }, [threadId]);

  async function sendReply() {
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await replyInThread(threadId, body);
      setReply("");
      setReplyOpen(false);
      notify.success("Reply sent");
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not send reply");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {html ? (
          <iframe
            title="email"
            className="h-full min-h-[200px] w-full rounded border border-[var(--border)] bg-white"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={`<!doctype html><html><head><base target="_blank"><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;margin:12px;color:#111}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-words text-sm text-[var(--text-dim)]">{text}</pre>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--border)] p-2">
        {replyOpen ? (
          <div className="space-y-2">
            <textarea
              className="w-full resize-none rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[rgba(232,233,237,0.34)] focus:border-[#60A5FA]"
              rows={3}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={`Reply to ${from}…`}
            />
            <div className="flex justify-end gap-2">
              <button
                className="rounded-[10px] border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
                onClick={() => setReplyOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-[10px] bg-[#60A5FA] px-3 py-1 text-xs font-semibold text-black hover:brightness-105 disabled:opacity-60"
                onClick={() => void sendReply()}
                disabled={!reply.trim() || sending}
              >
                {sending ? "Sending…" : "Send reply"}
              </button>
            </div>
          </div>
        ) : (
          <button
            className="w-full rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-1.5 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
            onClick={() => setReplyOpen(true)}
          >
            Reply…
          </button>
        )}
      </div>
    </div>
  );
}
