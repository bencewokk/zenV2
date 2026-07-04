import { useEffect, useRef, useState, type ReactNode } from "react";
import JXG from "jsxgraph";
import { loadSettings, saveSettings } from "@/services/ai/settings";
import { loadGoogleSettings, saveGoogleSettings, isUsingBundledCredentials } from "@/services/google/settings";
import { deepseek } from "@/services/ai/deepseek";
import { isSignedIn, isConfigured, onAuthChange, signIn } from "@/services/google/auth";
import { loadSyncSettings, saveSyncSettings } from "@/services/sync/settings";
import { syncOnce } from "@/services/sync/engine";
import { useHome, parseBriefItems } from "@/features/home/store";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { useWorkspace } from "@/shared/stores/workspace";
import { useNotes } from "@/features/notes/store";
import { useAI } from "@/features/ai/store";
import { MathField } from "@/features/math/MathField";
import { type Construction } from "@/features/geometry/model";
import { buildConstruction } from "@/features/geometry/build";
import "@/features/geometry/jsxgraph.css";
import { notify } from "@/shared/ui/notify";
import { backupConnectionsToVault, listVaultConnections, restoreConnectionsFromVault } from "@/services/connections/vault";
import { loadCanvasSettings } from "@/services/canvas/settings";
import { loadExternalConnectionSettings } from "@/services/connections/settings";
import { loadProfile, saveProfile, loadMemories, saveMemory, deleteMemory, type MemoryEntry } from "@/services/memory";
import { useOnboarding } from "./store";
import { ArtWelcome, ArtAI, ArtGoogle, ArtMemory, ArtGallery, ArtDeepWork, ArtStudyQuiz } from "./art";

/** Matches `localDayKey` in features/home/store.ts (not exported) — local, not UTC. */
function localDayKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * First-run walkthrough. A focused, dismissable overlay that (1) helps the user
 * connect the optional AI + Google integrations inline, and (2) tours the things
 * that make Zen worth using — Deep Work, study, and quizzes.
 */
export function Onboarding() {
  const open = useOnboarding((s) => s.open);
  const finish = useOnboarding((s) => s.finish);
  const [step, setStep] = useState(0);

  // Always restart at the first step when (re)opened.
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open) return null;

  const steps: { title: string; art: ReactNode; body: ReactNode }[] = [
    {
      title: "Welcome to Zen",
      art: <ArtWelcome />,
      body: (
        <div className="space-y-3">
          <p className="text-[var(--text-dim)]">
            A calm, math-first notebook for studying and deep work. This 60-second tour connects the
            optional extras and shows what Zen can do. Your content remains local-first; encrypted
            sync and external connections are optional, and you can skip anything.
          </p>
          <QuickGoogleSync />
        </div>
      ),
    },
    {
      title: "Bring in your world",
      art: <ArtGoogle />,
      body: <SourceConnectionsStep onOpenSettings={() => { finish(); useWorkspace.getState().set({ surface: "settings" }); }} />,
    },
    {
      title: "Connect the AI assistant",
      art: <ArtAI />,
      body: <AIStep />,
    },
    {
      title: "Connect Calendar & Mail",
      art: <ArtGoogle />,
      body: <GoogleStep />,
    },
    {
      title: "Help Zen remember you",
      art: <ArtMemory />,
      body: <MemoryStep />,
    },
    {
      title: "Everything you can do",
      art: <ArtGallery />,
      body: <FeatureGallery onOpenSample={openSampleNote} />,
    },
    {
      title: "Deep Work sessions",
      art: <ArtDeepWork />,
      body: (
        <div className="space-y-2 text-[var(--text-dim)]">
          <p>
            Deep Work is a distraction-free mode. Pull notes, PDFs, calendar events, and emails into
            one <span className="text-[var(--text)]">session</span>, then start a timed focus block
            (25 / 50 / 90 min).
          </p>
          <p>
            Hit <span className="text-[var(--text)]">◐ Zen mode</span> to strip everything but your
            sources. The AI tracks a "backbone" of what you need to master and a daily goal.
          </p>
        </div>
      ),
    },
    {
      title: "Study & Quiz yourself",
      art: <ArtStudyQuiz />,
      body: (
        <div className="space-y-2 text-[var(--text-dim)]">
          <p>
            Inside a session, ask the AI to <span className="text-[var(--text)]">quiz you</span> —
            it generates multiple-choice, ordering, matching, numeric, and open math questions, then
            grades them (objective ones instantly and offline).
          </p>
          <p>
            The <span className="text-[var(--text)]">Study panel</span> shows mastery per topic and
            schedules reviews with spaced repetition, so the right things resurface at the right time.
          </p>
        </div>
      ),
    },
  ];

  const last = step === steps.length - 1;
  const current = steps[step];

  /** Close the tour and drop the user into the seeded sample math note. */
  function openSampleNote() {
    finish();
    const notes = useNotes.getState().notes;
    const sample =
      Object.values(notes).find((n) => n.tags?.includes("sample")) ??
      Object.values(notes).find((n) => n.title.startsWith("Sample:"));
    useHome.getState().setManualDeepWork(false);
    useWorkspace.getState().set({ surface: "home" });
    if (sample) useNotes.getState().select(sample.id);
  }

  function launchDeepWork() {
    finish();
    useNotes.getState().select(null);
    useWorkspace.getState().set({ surface: "home" });
    if (Object.keys(useDeepWork.getState().sessions).length === 0) {
      useDeepWork.getState().createSession();
    }
    useHome.getState().setManualDeepWork(true);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Scrim — purely visual; the tour only closes via "Skip tour"/"Close" below,
          so an accidental click outside the dialog can't lose the user's place. */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Zen walkthrough"
        className="zen-anim-rise-scale relative flex w-full max-w-[460px] flex-col overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--bg-elev)] shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
      >
        <div className="grid place-items-center bg-[var(--bg)] px-6 pt-7">{current.art}</div>

        <div className="flex flex-col gap-3 px-6 py-5">
          <h2 className="text-lg font-semibold text-[var(--text)]">{current.title}</h2>
          <div className="min-h-[112px] text-sm leading-relaxed">{current.body}</div>

          {/* Progress dots */}
          <div className="mt-1 flex items-center justify-center gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: i === step ? 18 : 6,
                  background: i === step ? "var(--accent)" : "var(--border)",
                }}
              />
            ))}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <button className="zen-btn-ghost" onClick={finish}>
              {last ? "Close" : "Skip tour"}
            </button>
            <div className="ml-auto flex gap-2">
              {step > 0 && (
                <button className="zen-btn-ghost" onClick={() => setStep((s) => s - 1)}>
                  Back
                </button>
              )}
              {last ? (
                <button className="zen-btn zen-shine" onClick={launchDeepWork}>
                  Try Deep Work
                </button>
              ) : (
                <button className="zen-btn zen-shine" onClick={() => setStep((s) => s + 1)}>
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Inline DeepSeek key entry + test, mirroring Settings → Connections. */
function AIStep() {
  const [key, setKey] = useState(() => loadSettings().apiKey);
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [ok, setOk] = useState<boolean | null>(null);

  async function saveAndTest() {
    setTesting(true);
    saveSettings({ ...loadSettings(), apiKey: key.trim() });
    try {
      const models = await deepseek.listModels();
      if (models.length) {
        setOk(true);
        if (isSignedIn()) await backupConnectionsToVault();
        notify.success(`Key works — ${models.length} models available`);
      } else {
        setOk(false);
        notify.error("No models returned. Check the key.");
      }
    } catch (e) {
      setOk(false);
      notify.error((e as Error).message || "Key test failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-2.5 text-[var(--text-dim)]">
      <p>
        The assistant chats over your notes, rewrites text inline, and writes your daily brief. Paste
        a <span className="text-[var(--text)]">DeepSeek API key</span> — get one at{" "}
        <span className="text-[var(--accent)]">platform.deepseek.com</span>. Stored locally.
      </p>
      <div className="flex gap-2">
        <input
          type={show ? "text" : "password"}
          value={key}
          onChange={(e) => { setKey(e.target.value); setOk(null); }}
          placeholder="sk-…"
          className="zen-input flex-1"
          autoComplete="off"
          spellCheck={false}
        />
        <button className="zen-btn-ghost shrink-0" onClick={() => setShow((s) => !s)}>
          {show ? "Hide" : "Show"}
        </button>
      </div>
      <div className="flex items-center gap-2">
        {ok === true && <Status ok label="Connected" />}
        {ok === false && <Status label="Not working" />}
        <button className="zen-btn ml-auto" onClick={saveAndTest} disabled={testing || !key.trim()}>
          {testing ? "Testing…" : "Save & test"}
        </button>
      </div>
    </div>
  );
}

/**
 * One-click path for people who just want to sign in with Google and have
 * everything sync — skips the rest of the tour once done. Separate from
 * `GoogleStep` below, which is for the AI-first walkthrough.
 */
function QuickGoogleSync() {
  const [signedIn, setSignedIn] = useState(() => isSignedIn());
  const [busy, setBusy] = useState(false);

  useEffect(() => onAuthChange(setSignedIn), []);

  async function run() {
    setBusy(true);
    try {
      if (!signedIn) await signIn();
      const sync = loadSyncSettings();
      if (!sync.enabled) saveSyncSettings({ ...sync, enabled: true });
      await syncOnce();
      notify.success("Signed in and synced");
    } catch (e) {
      notify.error((e as Error).message || "Sign-in / sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="zen-btn zen-shine w-full" onClick={run} disabled={busy}>
      {busy ? "Signing in & syncing…" : signedIn ? "Google account connected" : "Sign in with Google"}
    </button>
  );
}

function SourceConnectionsStep({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [signedIn, setSignedIn] = useState(() => isSignedIn());
  const [vault, setVault] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => onAuthChange(setSignedIn), []);
  useEffect(() => { if (signedIn) void listVaultConnections().then((items) => setVault(items.map((item) => item.provider))).catch(() => {}); }, [signedIn]);
  const canvas = loadCanvasSettings();
  const external = loadExternalConnectionSettings();
  const cards = [
    { id: "ai", name: "AI provider", ready: !!loadSettings().apiKey || vault.includes("ai"), detail: "Assistant model credentials" },
    { id: "drive", name: "Google Drive", ready: signedIn && external.driveFolderIds.length > 0, detail: "Selected folders only · read-only" },
    { id: "canvas", name: "Canvas", ready: !!canvas.accessToken || vault.includes("canvas"), detail: "Courses, assignments, and files" },
    { id: "zotero", name: "Zotero", ready: !!external.zoteroApiKey || vault.includes("zotero"), detail: "Papers, annotations, and citations" },
    { id: "github", name: "GitHub", ready: !!external.githubRepositories.length, detail: "Selected repositories and issues" },
  ];

  async function secureOrRestore() {
    if (!signedIn) { notify.error("Sign in with Google on the first step."); return; }
    setBusy(true);
    try {
      if (vault.length) await restoreConnectionsFromVault(); else await backupConnectionsToVault();
      const next = await listVaultConnections();
      setVault(next.map((item) => item.provider));
      notify.success(vault.length ? "Connections restored" : "Existing connections secured");
    } catch (e) { notify.error((e as Error).message || "Connection vault failed"); }
    finally { setBusy(false); }
  }

  return <div className="space-y-3 text-[var(--text-dim)]">
    <p>Connect only the places you want Zen to read. Each connection is optional and can be revoked later.</p>
    <div className="grid grid-cols-2 gap-2">
      {cards.map((card) => <div key={card.id} className="rounded-[9px] border border-[var(--border)] bg-[var(--bg)] p-2.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text)]"><span className="h-2 w-2 rounded-full" style={{ background: card.ready ? "var(--ok)" : "var(--text-dim)" }} />{card.name}</div>
        <div className="mt-1 text-[11px] leading-snug">{card.detail}</div>
      </div>)}
    </div>
    <div className="flex gap-2"><button className="zen-btn-ghost flex-1" onClick={onOpenSettings}>Choose connections…</button><button className="zen-btn flex-1" disabled={!signedIn || busy} onClick={() => void secureOrRestore()}>{busy ? "Working…" : vault.length ? "Restore saved" : "Secure existing"}</button></div>
  </div>;
}

/** Inline Google connect, mirroring Settings → Connections. */
function GoogleStep() {
  const [clientId, setClientId] = useState(() => loadGoogleSettings().clientId);
  const [clientSecret, setClientSecret] = useState(() => loadGoogleSettings().clientSecret);
  const [show, setShow] = useState(false);
  const [signedIn, setSignedIn] = useState(() => isSignedIn());
  const [connecting, setConnecting] = useState(false);
  const usingBundled = isUsingBundledCredentials({ clientId, clientSecret });

  useEffect(() => onAuthChange(setSignedIn), []);

  async function connect() {
    setConnecting(true);
    saveGoogleSettings({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
    try {
      await signIn();
      notify.success("Connected to Google");
    } catch (e) {
      notify.error((e as Error).message || "Google sign-in failed");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="space-y-2.5 text-[var(--text-dim)]">
      <p>
        Pull Google Calendar events and Gmail threads into your daily focus. A default client
        is bundled — just <span className="text-[var(--text)]">Connect</span> and sign in.
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer text-[var(--text-dim)] hover:text-[var(--text)]">
          Use my own OAuth client (optional)
        </summary>
        <div className="mt-2 space-y-2">
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="…apps.googleusercontent.com"
            className="zen-input w-full"
            spellCheck={false}
          />
          {IS_TAURI && (
            <div className="flex gap-2">
              <input
                type={show ? "text" : "password"}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="GOCSPX-…"
                className="zen-input flex-1"
                autoComplete="off"
                spellCheck={false}
              />
              <button className="zen-btn-ghost shrink-0" onClick={() => setShow((s) => !s)}>
                {show ? "Hide" : "Show"}
              </button>
            </div>
          )}
        </div>
      </details>
      <div className="flex items-center gap-2">
        <Status
          ok={signedIn}
          label={
            (signedIn ? "Connected" : isConfigured() ? "Not connected" : "No Client ID set") +
            (usingBundled && isConfigured() ? " · built-in client" : "")
          }
        />
        {!signedIn && (
          <button
            className="zen-btn ml-auto"
            onClick={connect}
            disabled={connecting || (!IS_TAURI && !clientId.trim())}
          >
            {connecting ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>
    </div>
  );
}

type FeatureKey = "math" | "graph" | "pdf" | "ai" | "link" | "dash";

/** A 2×3 gallery of Zen's standout features. Clicking a card shows a live example
 *  inline (the tour stays open), with a CTA into the real sample note. */
function FeatureGallery({ onOpenSample }: { onOpenSample: () => void }) {
  const features: { key: FeatureKey; icon: ReactNode; title: string; blurb: string }[] = [
    { key: "math", icon: <IconMath />, title: "Math blocks", blurb: "Type / for live equations" },
    { key: "graph", icon: <IconGraph />, title: "Geometry & graphs", blurb: "Plot functions inline" },
    { key: "pdf", icon: <IconPdf />, title: "PDFs, indexed", blurb: "Semantic search, on-device" },
    { key: "ai", icon: <IconSpark />, title: "Inline AI", blurb: "Select text → rewrite, explain" },
    { key: "link", icon: <IconLink />, title: "Linked notes", blurb: "[[wiki-links]] between notes" },
    { key: "dash", icon: <IconDash />, title: "Daily brief", blurb: "Notes + calendar + mail" },
  ];
  const [selected, setSelected] = useState<FeatureKey>("math");

  return (
    <div className="space-y-3">
      <p className="text-[var(--text-dim)]">Tap a card for a live example — then open the sample note to try it.</p>
      <div className="grid grid-cols-2 gap-2">
        {features.map((f) => {
          const active = selected === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setSelected(f.key)}
              className={`flex items-start gap-2 rounded-[10px] border px-2.5 py-2 text-left transition ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                  : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--text-dim)]"
              }`}
            >
              <span className={`mt-0.5 shrink-0 ${active ? "text-[var(--text)]" : "text-[var(--accent)]"}`}>{f.icon}</span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-[var(--text)]">{f.title}</span>
                <span className="block text-[11px] leading-snug text-[var(--text-dim)]">{f.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="zen-anim-fade rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-3">
        <FeaturePreview feature={selected} />
      </div>

      <button className="zen-btn-ghost w-full" onClick={onOpenSample}>
        Open the sample note →
      </button>
    </div>
  );
}

/** A compact, real, interactive example of one feature, rendered inside the tour. */
function FeaturePreview({ feature }: { feature: FeatureKey }) {
  switch (feature) {
    case "math": return <MathCardPreview />;
    case "graph": return <GraphCardPreview />;
    case "pdf": return <PdfCardPreview />;
    case "ai": return <AiCardPreview />;
    case "link": return <LinkCardPreview />;
    case "dash": return <DashCardPreview />;
  }
}

/** Real, editable MathLive field — the same web component the notes editor uses. */
function MathCardPreview() {
  const [latex, setLatex] = useState("x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}");
  return (
    <div className="space-y-2">
      <MathField value={latex} onChange={setLatex} ariaLabel="Try editing this equation" />
      <p className="text-[11px] text-[var(--text-dim)]">
        Type <code className="text-[var(--text)]">/math</code> or wrap in <code className="text-[var(--text)]">$…$</code> — this is
        the real math field. Try editing it.
      </p>
    </div>
  );
}

/** Real JSXGraph board (the app's actual geometry engine) with a draggable triangle. */
function GraphCardPreview() {
  const hostRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`onboarding-jxg-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!host.id) host.id = idRef.current;
    host.innerHTML = "";

    let board: JXG.Board | null = null;
    try {
      board = JXG.JSXGraph.initBoard(host, {
        boundingbox: [-5, 5, 5, -5],
        axis: true,
        grid: true,
        showCopyright: false,
        showNavigation: false,
        keepAspectRatio: true,
      });
      const con: Construction = {
        objects: [
          { id: "a", kind: "point", x: -3, y: -2, name: "A" },
          { id: "b", kind: "point", x: 3, y: -2, name: "B" },
          { id: "c", kind: "point", x: 0, y: 3, name: "C" },
          { id: "ab", kind: "segment", p1: "a", p2: "b" },
          { id: "bc", kind: "segment", p1: "b", p2: "c" },
          { id: "ca", kind: "segment", p1: "c", p2: "a" },
        ],
      };
      buildConstruction(board, con, () => {});
    } catch {
      /* decorative demo — never let a board-init failure break the tour */
    }

    const created = board;
    return () => {
      try { if (created) JXG.JSXGraph.freeBoard(created); } catch { /* freed */ }
    };
  }, []);

  return (
    <div className="space-y-2">
      <div ref={hostRef} className="zen-geometry-board" style={{ height: 140 }} />
      <p className="text-[11px] text-[var(--text-dim)]">
        Drag a point — this is the real geometry engine. Drop a graph block to plot functions or build
        constructions in any note.
      </p>
    </div>
  );
}

/** The real bundled sample PDF, rendered inline via the same native-iframe approach the PDF viewer uses. */
function PdfCardPreview() {
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-[8px] border border-[var(--border)]" style={{ height: 160 }}>
        <iframe
          src="/quadratic_advanced_insights.pdf#page=3&toolbar=0&navpanes=0"
          title="Sample PDF, page 3"
          className="h-full w-full"
          style={{ border: "none" }}
        />
      </div>
      <p className="text-[11px] text-[var(--text-dim)]">
        The real bundled sample PDF — indexed on your device. Ask the AI to "find the discriminant" and it
        jumps straight to the page.
      </p>
    </div>
  );
}

const AI_SAMPLE_TEXT = "this thing about roots is kinda important";
const AI_CANNED_RESULT = "The nature of the roots is determined by the discriminant.";

/** Real inline rewrite when an AI key is set; a canned example otherwise. */
function AiCardPreview() {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasKey = !!loadSettings().apiKey.trim();

  async function rewrite() {
    setBusy(true);
    try {
      const out = await useAI.getState().complete(
        "Improve the clarity and precision of this sentence, keeping its meaning.",
        AI_SAMPLE_TEXT
      );
      setResult(out);
    } catch (e) {
      notify.error((e as Error).message || "Rewrite failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-[var(--text-dim)] line-through">{AI_SAMPLE_TEXT}</div>
      <div className="text-[12px] text-[var(--text)]">
        <span className="mr-1 text-[var(--accent)]">✦</span>
        {busy ? "Rewriting…" : (result ?? AI_CANNED_RESULT)}
      </div>
      {hasKey ? (
        <button className="zen-btn-ghost" onClick={rewrite} disabled={busy}>
          {busy ? "Rewriting…" : result ? "Rewrite again" : "Rewrite live"}
        </button>
      ) : (
        <p className="text-[11px] text-[var(--text-dim)]">
          Connect AI (previous step) to try this live — showing an example above.
        </p>
      )}
    </div>
  );
}

/** Two real sample notes, really linked — clicking one jumps into it (closes the tour). */
function LinkCardPreview() {
  const notes = useNotes((s) => s.notes);
  const primary = Object.values(notes).find((n) => n.tags?.includes("sample"));
  const secondary = Object.values(notes).find((n) => n.tags?.includes("sample-secondary"));

  function openNote(id: string | undefined) {
    if (!id) return;
    useOnboarding.getState().finish();
    useHome.getState().setManualDeepWork(false);
    useWorkspace.getState().set({ surface: "home" });
    useNotes.getState().select(id);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px]">
        <button
          className="rounded border border-[var(--accent)] bg-[var(--accent-dim)] px-1.5 py-0.5 text-[var(--text)] hover:opacity-80"
          onClick={() => openNote(primary?.id)}
        >
          {primary?.title.replace(/^Sample:\s*/, "") ?? "Quadratics"}
        </button>
        <span className="text-[var(--text-dim)]">↔</span>
        <button
          className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--text)] hover:border-[var(--text-dim)]"
          onClick={() => openNote(secondary?.id)}
        >
          {secondary?.title.replace(/^Sample:\s*/, "") ?? "Functions"}
        </button>
      </div>
      <p className="text-[11px] text-[var(--text-dim)]">
        Real notes, really linked. Type <code className="text-[var(--text)]">[[</code> to link notes — click
        either one to jump straight in.
      </p>
    </div>
  );
}

/** Today's real brief if one exists yet, else a canned example. */
function DashCardPreview() {
  const summary = useHome((s) => s.summary);
  const summaryDayKey = useHome((s) => s.summaryDayKey);
  const live = summaryDayKey === localDayKey() && summary.trim() ? parseBriefItems(summary).slice(0, 3) : null;

  const canned = [
    "Review quadratics — exam in 5 days",
    "Calculus lecture · 2:00 PM",
    "Reply to Prof. Lang about pset 3",
  ].map((text) => ({ key: text, text }));

  return (
    <div className="space-y-1.5">
      {(live ?? canned).map((item) => (
        <div key={item.key} className="flex items-center gap-2 text-[11px] text-[var(--text)]">
          <span className="grid h-3 w-3 place-items-center rounded-[3px] border border-[var(--border)]" />
          {item.text}
        </div>
      ))}
      <p className="text-[11px] text-[var(--text-dim)]">
        {live ? "This is today's real brief." : "Your daily brief fuses notes, calendar, and mail into one focused list."}
      </p>
    </div>
  );
}

/** Tiny 20×20 line icons for the feature gallery (inherit currentColor). */
function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
const IconMath = () => <IconBase><path d="M3 4l4 12 3-8" /><path d="M11 7h6M13 13h4" /></IconBase>;
const IconGraph = () => <IconBase><path d="M4 3v14h13" /><path d="M5 14c4 0 5-9 11-9" /></IconBase>;
const IconPdf = () => <IconBase><path d="M5 3h7l3 3v7a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" /><circle cx="9" cy="11" r="2.5" /><path d="M11 13l2 2" /></IconBase>;
const IconSpark = () => <IconBase><path d="M10 3v5M10 12v5M3 10h5M12 10h5" /><circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" /></IconBase>;
const IconLink = () => <IconBase><circle cx="6" cy="6" r="2.5" /><circle cx="14" cy="14" r="2.5" /><path d="M8 8l4 4" /></IconBase>;
const IconDash = () => <IconBase><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="11" y="3" width="6" height="6" rx="1" /><rect x="3" y="11" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" /></IconBase>;

/** Seed the AI's long-term memory: a couple of profile facts + free-form memories. */
function MemoryStep() {
  const [name, setName] = useState(() => loadProfile().name);
  const [about, setAbout] = useState(() => loadProfile().about);
  const [memories, setMemories] = useState<MemoryEntry[]>(() => loadMemories());
  const [draft, setDraft] = useState("");

  function persistProfile(next: { name?: string; about?: string }) {
    const p = loadProfile();
    saveProfile({ ...p, name: next.name ?? p.name, about: next.about ?? p.about });
  }

  function addMemory() {
    const text = draft.trim();
    if (!text) return;
    // Title from the first few words; full text as content.
    const title = text.split(/\s+/).slice(0, 5).join(" ");
    saveMemory(title, text, "personal");
    setMemories(loadMemories());
    setDraft("");
  }

  function removeMemory(id: string) {
    deleteMemory(id);
    setMemories(loadMemories());
  }

  return (
    <div className="space-y-2.5 text-[var(--text-dim)]">
      <p>
        Zen keeps a private, on-device memory so the AI knows who you are across every chat —
        your name, what you're studying, and any facts you tell it. Add a few now, or skip.
      </p>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); persistProfile({ name: e.target.value }); }}
          placeholder="Your name"
          className="zen-input w-1/3"
          spellCheck={false}
        />
        <input
          value={about}
          onChange={(e) => { setAbout(e.target.value); persistProfile({ about: e.target.value }); }}
          placeholder="About you — e.g. 2nd-year physics student"
          className="zen-input flex-1"
          spellCheck={false}
        />
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addMemory(); }}
          placeholder="A fact to remember — e.g. exam on June 14"
          className="zen-input flex-1"
          spellCheck={false}
        />
        <button className="zen-btn shrink-0" onClick={addMemory} disabled={!draft.trim()}>Add</button>
      </div>
      {memories.length > 0 && (
        <ul className="space-y-1">
          {memories.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-[8px] border border-[var(--border)] px-2.5 py-1.5">
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--text)]">{m.content}</span>
              <button
                className="shrink-0 text-[var(--text-dim)] hover:text-[var(--danger)]"
                onClick={() => removeMemory(m.id)}
                title="Forget this"
                aria-label="Forget this memory"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Status({ ok = false, label }: { ok?: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: ok ? "var(--ok)" : "var(--text-dim)" }} />
      <span className="text-[var(--text-dim)]">{label}</span>
    </span>
  );
}
