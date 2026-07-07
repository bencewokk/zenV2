import { useEffect, useState, type ReactNode } from "react";
import { accountTypeLabel, canAccessPaidFeatures, loadAccountStatus, type AccountStatus } from "@/services/account";
import { isConfigured, isSignedIn, onAuthChange, signIn } from "@/services/google/auth";
import { loadSyncSettings, saveSyncSettings } from "@/services/sync/settings";
import { syncOnce } from "@/services/sync/engine";
import { listVaultConnections } from "@/services/connections/vault";
import { loadCanvasSettings } from "@/services/canvas/settings";
import { loadExternalConnectionSettings } from "@/services/connections/settings";
import { loadProfile, saveProfile } from "@/services/memory";
import { notify } from "@/shared/ui/notify";
import { useWorkspace } from "@/shared/stores/workspace";
import { useOnboarding } from "./store";
import { ArtWelcome, ArtAI, ArtGoogle, ArtMemory, ArtGallery } from "./art";

type Decision = "connected" | "skipped";
type Decisions = Record<string, Decision>;
interface Step { key: string; title: string; art: ReactNode; body: ReactNode; required?: string }

/** First-run setup centered on the Google identity and server-owned subscription. */
export function Onboarding() {
  const open = useOnboarding((state) => state.open);
  const finish = useOnboarding((state) => state.finish);
  const [stepIndex, setStepIndex] = useState(0);
  const [decisions, setDecisions] = useState<Decisions>({});

  useEffect(() => {
    if (open) { setStepIndex(0); setDecisions({}); }
  }, [open]);
  if (!open) return null;

  const decide = (key: string, value: Decision) => setDecisions((current) => ({ ...current, [key]: value }));
  const googleConnected = decisions.google === "connected";
  const steps: Step[] = [
    {
      key: "welcome",
      title: "Set up Zen",
      art: <ArtWelcome />,
      body: <p className="text-[var(--text-dim)]">Zen keeps study work calm and local-first. This setup connects your identity, checks your plan, and asks clearly what should sync or connect. Nothing is enabled without your choice.</p>,
    },
    {
      key: "google",
      title: "Start with your Google account",
      art: <ArtGoogle />,
      required: "google",
      body: <GoogleIdentityStep decision={decisions.google} onDecision={(value) => decide("google", value)} />,
    },
    {
      key: "plan",
      title: "Your Zen plan",
      art: <ArtAI />,
      required: "plan",
      body: <PlanStep googleConnected={googleConnected} decision={decisions.plan} onDecision={(value) => decide("plan", value)} />,
    },
    {
      key: "sync",
      title: "Choose where your work lives",
      art: <ArtGoogle />,
      required: "sync",
      body: <SyncChoiceStep googleConnected={googleConnected} decision={decisions.sync} onDecision={(value) => decide("sync", value)} />,
    },
    {
      key: "sources",
      title: "Choose your sources",
      art: <ArtGallery />,
      required: "sources",
      body: <SourcesStep decisions={decisions} onDecision={decide} />,
    },
    {
      key: "profile",
      title: "Make Zen yours",
      art: <ArtMemory />,
      required: "profile",
      body: <ProfileStep decision={decisions.profile} onDecision={(value) => decide("profile", value)} />,
    },
    {
      key: "ready",
      title: "Zen is ready",
      art: <ArtWelcome />,
      body: <ReadyStep decisions={decisions} />,
    },
  ];
  const current = steps[stepIndex];
  const last = stepIndex === steps.length - 1;
  const canContinue = !current.required || !!decisions[current.required];

  function enterZen() {
    finish();
    useWorkspace.getState().set({ surface: "home" });
  }

  return <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
    <div role="dialog" aria-modal="true" aria-label="Set up Zen" className="zen-anim-rise-scale relative flex max-h-[92vh] w-full max-w-[500px] flex-col overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--bg-elev)] shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
      <div className="grid shrink-0 place-items-center bg-[var(--bg)] px-6 pt-7">{current.art}</div>
      <div className="min-h-0 overflow-y-auto px-6 py-5">
        <h2 className="text-lg font-semibold text-[var(--text)]">{current.title}</h2>
        <div className="mt-3 min-h-[150px] text-sm leading-relaxed">{current.body}</div>
        <div className="mt-5 flex items-center justify-center gap-1.5">
          {steps.map((step, index) => <span key={step.key} className="h-1.5 rounded-full transition-all" style={{ width: index === stepIndex ? 20 : 6, background: index === stepIndex ? "var(--accent)" : "var(--border)" }} />)}
        </div>
        <div className="mt-4 flex items-center gap-2">
          {stepIndex > 0 && <button className="zen-btn-ghost" onClick={() => setStepIndex((value) => value - 1)}>Back</button>}
          <span className="ml-auto text-[11px] text-[var(--text-dim)]">{stepIndex + 1} of {steps.length}</span>
          {last
            ? <button className="zen-btn zen-shine" onClick={enterZen}>Enter Zen</button>
            : <button className="zen-btn zen-shine" disabled={!canContinue} onClick={() => setStepIndex((value) => value + 1)}>Continue</button>}
        </div>
        {!canContinue && <p className="mt-2 text-right text-[11px] text-[var(--text-dim)]">Choose one option to continue.</p>}
      </div>
    </div>
  </div>;
}

function GoogleIdentityStep({ decision, onDecision }: { decision?: Decision; onDecision: (value: Decision) => void }) {
  const [signedIn, setSignedIn] = useState(() => isSignedIn());
  const [busy, setBusy] = useState(false);
  useEffect(() => onAuthChange(setSignedIn), []);
  useEffect(() => { if (signedIn && decision !== "connected") onDecision("connected"); }, [signedIn, decision]);

  async function connect() {
    setBusy(true);
    try { await signIn(); onDecision("connected"); notify.success("Google account connected"); }
    catch (error) { notify.error((error as Error).message || "Google sign-in failed"); }
    finally { setBusy(false); }
  }

  return <div className="space-y-4 text-[var(--text-dim)]">
    <p>One Google login identifies your Zen account and can unlock cloud sync, Drive, Calendar, Gmail, and encrypted connection storage. Zen uses its built-in OAuth client.</p>
    <p className="text-xs">Zen can read Drive files, Calendar events, and Gmail; it can change Calendar events and Gmail state or send mail only for features you request. Google access is optional.{' '}<a className="underline" href="https://zen-website-rust.vercel.app/privacy" target="_blank" rel="noreferrer">Privacy and Google data use</a></p>
    <ChoiceCard active={signedIn} title="Connect Google" detail={signedIn ? "Connected to your Zen account" : "Recommended for the complete experience"} action={!signedIn ? <button className="zen-btn" disabled={busy || !isConfigured()} onClick={() => void connect()}>{busy ? "Connecting…" : "Connect"}</button> : undefined} />
    {!signedIn && <ChoiceCard active={decision === "skipped"} title="Use Zen locally" detail="No Google features, account plan, vault, or cloud sync" action={<button className="zen-btn-ghost" onClick={() => onDecision("skipped")}>Use local-only</button>} />}
  </div>;
}

function PlanStep({ googleConnected, decision, onDecision }: { googleConnected: boolean; decision?: Decision; onDecision: (value: Decision) => void }) {
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    if (!googleConnected) return;
    setLoading(true);
    try {
      const next = await loadAccountStatus();
      setAccount(next);
      if (canAccessPaidFeatures(next)) onDecision("connected");
    } finally { setLoading(false); }
  }
  useEffect(() => { if (googleConnected) void refresh(); }, [googleConnected]);
  const plan = account?.user?.subscription?.plan;
  const paid = canAccessPaidFeatures(account);
  const planName = plan === "plus" ? "Plus plan · DeepSeek V4 Pro" : plan === "basic" ? "Basic plan · DeepSeek V4 Flash" : accountTypeLabel(account);

  return <div className="space-y-3 text-[var(--text-dim)]">
    <p>AI is provided by Zen—there are no API keys to enter. Your website-managed subscription decides the model and monthly budget.</p>
    <div className="grid grid-cols-2 gap-2 text-xs">
      <PlanCard title="Free" model="No AI" budget="$0" />
      <PlanCard title="Basic" model="DeepSeek V4 Flash" budget="$5 / month" />
      <PlanCard title="Plus" model="DeepSeek V4 Pro" budget="$25 / month" />
    </div>
    <div className="flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--bg)] p-3">
      <Status ok={paid} label={!googleConnected ? "Local-only · Free" : loading ? "Checking your plan…" : paid ? planName : "Free · AI unavailable"} />
      {googleConnected && <button className="zen-btn-ghost ml-auto" disabled={loading} onClick={() => void refresh()}>Refresh</button>}
      {!paid && <button className="zen-btn ml-auto" onClick={() => onDecision("skipped")}>Continue without AI</button>}
    </div>
    {decision === "connected" && <p className="text-xs text-[var(--ok)]">Your paid AI access is ready.</p>}
  </div>;
}

function SyncChoiceStep({ googleConnected, decision, onDecision }: { googleConnected: boolean; decision?: Decision; onDecision: (value: Decision) => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (loadSyncSettings().enabled && googleConnected && decision !== "connected") onDecision("connected"); }, [googleConnected, decision]);
  async function enable() {
    setBusy(true);
    try {
      const current = loadSyncSettings();
      saveSyncSettings({ ...current, enabled: true });
      await syncOnce(); onDecision("connected"); notify.success("Cloud sync enabled");
    } catch (error) { notify.error((error as Error).message || "Sync failed"); }
    finally { setBusy(false); }
  }
  function localOnly() {
    const current = loadSyncSettings();
    saveSyncSettings({ ...current, enabled: false });
    onDecision("skipped");
  }
  return <div className="space-y-3 text-[var(--text-dim)]">
    <p>Cloud sync follows your Google identity. Local-only keeps this device independent; you can change this later.</p>
    <ChoiceCard active={decision === "connected"} title="Sync across devices" detail={googleConnected ? "Notes, study state, settings, and supported PDFs" : "Connect Google first"} action={<button className="zen-btn" disabled={!googleConnected || busy} onClick={() => void enable()}>{busy ? "Syncing…" : "Enable sync"}</button>} />
    <ChoiceCard active={decision === "skipped"} title="Keep this device local" detail="Nothing is uploaded by Zen sync" action={<button className="zen-btn-ghost" onClick={localOnly}>Use local-only</button>} />
  </div>;
}

function SourcesStep({ decisions, onDecision }: { decisions: Decisions; onDecision: (key: string, value: Decision) => void }) {
  const [signedIn, setSignedIn] = useState(() => isSignedIn());
  const [vault, setVault] = useState<string[]>([]);
  useEffect(() => onAuthChange(setSignedIn), []);
  useEffect(() => { if (signedIn) void listVaultConnections().then((items) => setVault(items.map((item) => item.provider))).catch(() => {}); }, [signedIn]);
  const canvas = loadCanvasSettings();
  const external = loadExternalConnectionSettings();
  const sources = [
    { id: "drive", name: "Google Drive", ready: signedIn, detail: "All accessible files · read-only" },
    { id: "canvas", name: "Canvas", ready: !!canvas.accessToken || vault.includes("canvas"), detail: "Courses, assignments, modules, and files" },
    { id: "zotero", name: "Zotero", ready: !!external.zoteroApiKey || vault.includes("zotero"), detail: "Papers, annotations, and citations" },
    { id: "github", name: "GitHub", ready: !!external.githubToken || vault.includes("github"), detail: "Every repository allowed by your token" },
  ];
  const resolved = sources.every((source) => source.ready || decisions[`source:${source.id}`] === "skipped");
  useEffect(() => { if (resolved && !decisions.sources) onDecision("sources", "connected"); }, [resolved, decisions.sources]);

  const unresolved = sources.filter((source) => !source.ready && decisions[`source:${source.id}`] !== "skipped");

  return <div className="space-y-2 text-[var(--text-dim)]">
    <p className="mb-3">Connected sources are detected automatically. Anything marked “Later” stays off until you connect it in Settings.</p>
    {sources.map((source) => <div key={source.id} className="flex items-center gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg)] p-3">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: source.ready ? "var(--ok)" : "var(--text-dim)" }} />
      <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-[var(--text)]">{source.name}</span><span className="block truncate text-[11px]">{source.detail}</span></span>
      {source.ready ? <span className="text-[11px] text-[var(--ok)]">Connected</span> : decisions[`source:${source.id}`] === "skipped" ? <span className="text-[11px]">Later</span> : <button className="zen-btn-ghost" onClick={() => onDecision(`source:${source.id}`, "skipped")}>Later</button>}
    </div>)}
    {unresolved.length > 1 && <button className="zen-btn-ghost w-full" onClick={() => unresolved.forEach((source) => onDecision(`source:${source.id}`, "skipped"))}>Skip all for now</button>}
    <p className="pt-1 text-[11px]">Canvas, Zotero, and GitHub credentials can be added in Settings and secured to your Google account.</p>
  </div>;
}

function ProfileStep({ decision, onDecision }: { decision?: Decision; onDecision: (value: Decision) => void }) {
  const profile = loadProfile();
  const [name, setName] = useState(profile.name);
  const [about, setAbout] = useState(profile.about);
  function save() { saveProfile({ ...loadProfile(), name: name.trim(), about: about.trim() }); onDecision("connected"); notify.success("Profile saved"); }
  return <div className="space-y-3 text-[var(--text-dim)]">
    <p>This private profile helps Zen tailor study sessions and AI responses. It remains editable later.</p>
    <input className="zen-input w-full" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
    <textarea className="zen-input w-full resize-none" rows={3} value={about} onChange={(event) => setAbout(event.target.value)} placeholder="What are you studying, and what should Zen know?" />
    <div className="flex items-center gap-2">{decision && <Status ok={decision === "connected"} label={decision === "connected" ? "Saved" : "Skipped"} />}<button className="zen-btn-ghost ml-auto" onClick={() => onDecision("skipped")}>Skip</button><button className="zen-btn" disabled={!name.trim() && !about.trim()} onClick={save}>Save profile</button></div>
  </div>;
}

function ReadyStep({ decisions }: { decisions: Decisions }) {
  const rows = [
    ["Google account", decisions.google === "connected" ? "Connected" : "Local-only"],
    ["AI plan", decisions.plan === "connected" ? "Active" : "Free / skipped"],
    ["Cloud sync", decisions.sync === "connected" ? "Enabled" : "Off"],
    ["Sources", "Reviewed"],
    ["Profile", decisions.profile === "connected" ? "Saved" : "Skipped"],
  ];
  return <div className="space-y-3 text-[var(--text-dim)]"><p>Your choices are saved. Zen will open with sample material so you can explore without importing anything first.</p><div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg)]">{rows.map(([label, value]) => <div key={label} className="flex border-b border-[var(--border)] px-3 py-2.5 text-xs last:border-0"><span>{label}</span><span className="ml-auto text-[var(--text)]">{value}</span></div>)}</div></div>;
}

function PlanCard({ title, model, budget }: { title: string; model: string; budget: string }) {
  return <div className="rounded-[9px] border border-[var(--border)] bg-[var(--bg)] p-2.5"><div className="font-semibold text-[var(--text)]">{title}</div><div className="mt-1">{model}</div><div>{budget}</div></div>;
}
function ChoiceCard({ active, title, detail, action }: { active: boolean; title: string; detail: string; action?: ReactNode }) {
  return <div className="flex items-center gap-3 rounded-[10px] border p-3" style={{ borderColor: active ? "var(--accent)" : "var(--border)", background: active ? "var(--accent-dim)" : "var(--bg)" }}><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: active ? "var(--ok)" : "var(--text-dim)" }} /><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-[var(--text)]">{title}</span><span className="block text-[11px]">{detail}</span></span>{action}</div>;
}
function Status({ ok = false, label }: { ok?: boolean; label: string }) {
  return <span className="flex items-center gap-1.5 text-xs"><span className="inline-block h-2 w-2 rounded-full" style={{ background: ok ? "var(--ok)" : "var(--text-dim)" }} /><span className="text-[var(--text-dim)]">{label}</span></span>;
}
