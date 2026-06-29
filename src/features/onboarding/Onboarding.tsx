import { useEffect, useState, type ReactNode } from "react";
import { loadSettings, saveSettings } from "@/services/ai/settings";
import { loadGoogleSettings, saveGoogleSettings } from "@/services/google/settings";
import { deepseek } from "@/services/ai/deepseek";
import { isSignedIn, isConfigured, onAuthChange, signIn } from "@/services/google/auth";
import { useHome } from "@/features/home/store";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { useWorkspace } from "@/shared/stores/workspace";
import { useNotes } from "@/features/notes/store";
import { notify } from "@/shared/ui/notify";
import { loadProfile, saveProfile, loadMemories, saveMemory, deleteMemory, type MemoryEntry } from "@/services/memory";
import { useOnboarding } from "./store";
import { ArtWelcome, ArtAI, ArtGoogle, ArtMemory, ArtDeepWork, ArtStudyQuiz } from "./art";

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
        <p className="text-[var(--text-dim)]">
          A calm, math-first notebook for studying and deep work. This 60-second tour connects the
          optional extras and shows what Zen can do. Everything stays on your device — skip anything
          you like.
        </p>
      ),
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
      {/* Scrim */}
      <button
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        aria-label="Close walkthrough"
        onClick={finish}
      />

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

/** Inline Google connect, mirroring Settings → Connections. */
function GoogleStep() {
  const [clientId, setClientId] = useState(() => loadGoogleSettings().clientId);
  const [clientSecret, setClientSecret] = useState(() => loadGoogleSettings().clientSecret);
  const [show, setShow] = useState(false);
  const [signedIn, setSignedIn] = useState(() => isSignedIn());
  const [connecting, setConnecting] = useState(false);

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
        <Status ok={signedIn} label={signedIn ? "Connected" : isConfigured() ? "Not connected" : "No Client ID set"} />
        {!signedIn && (
          <button className="zen-btn ml-auto" onClick={connect} disabled={connecting || !clientId.trim()}>
            {connecting ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>
    </div>
  );
}

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
