import { useEffect, useRef, useState, type ReactNode } from "react";
import { APP_LOOKS, applyAppearance, loadAppearance, saveAppearance, type AppLook } from "@/services/appearance";
import { isConfigured, isSignedIn, onAuthChange, signIn } from "@/services/google/auth";
import { loadSyncSettings, saveSyncSettings } from "@/services/sync/settings";
import { syncOnce } from "@/services/sync/engine";
import { listVaultConnections } from "@/services/connections/vault";
import { loadCanvasSettings, saveCanvasSettings } from "@/services/canvas/settings";
import { CANVAS_DISABLED_MESSAGE, CANVAS_INTEGRATION_ENABLED } from "@/services/canvas/availability";
import { loadExternalConnectionSettings, saveExternalConnectionSettings } from "@/services/connections/settings";
import { loadProfile, saveProfile } from "@/services/memory";
import { notify } from "@/shared/ui/notify";
import { useWorkspace } from "@/shared/stores/workspace";
import { useSparkIntro } from "./sparkStore";
import "./SparkIntro.css";

/**
 * First-run "Spark Intro": a focused setup path. A spark ignites, the user
 * picks an app look, opts into the capabilities they actually want, then
 * configures only those choices.
 */

type Kind = "ignite" | "title" | "look" | "features" | "setup";
interface Beat { kind: Kind; hold: number }

const BEATS: Beat[] = [
  { kind: "ignite", hold: 2000 },
  { kind: "title", hold: 2800 },
  { kind: "look", hold: 0 },
  { kind: "features", hold: 0 },
  { kind: "setup", hold: 0 },
];

const LOOK = BEATS.findIndex((b) => b.kind === "look");
const FEATURES = BEATS.findIndex((b) => b.kind === "features");
const READY = BEATS.length - 1;

export function SparkIntro() {
  const open = useSparkIntro((s) => s.open);
  const finishIntro = useSparkIntro((s) => s.finish);
  const [beat, setBeat] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [look, setLook] = useState<AppLook>(() => loadAppearance().appLook);
  const [lookPicked, setLookPicked] = useState(false);
  const [features, setFeatures] = useState<SetupFeature[]>(() => selectedFeaturesFromCurrentSetup());
  const reduceMotion = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    reduceMotion.current = document.documentElement.hasAttribute("data-reduce-motion");
    setLeaving(false);
    setLookPicked(false);
    setLook(loadAppearance().appLook);
    setFeatures(selectedFeaturesFromCurrentSetup());
    setBeat(reduceMotion.current ? LOOK : 0);
  }, [open]);

  // Auto-advance, except the interactive setup beats.
  useEffect(() => {
    if (!open || reduceMotion.current) return;
    const b = BEATS[beat];
    if (b.kind === "look" || b.kind === "features" || b.kind === "setup") return;
    timer.current = setTimeout(() => setBeat((v) => Math.min(v + 1, READY)), b.hold);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [open, beat]);

  if (!open) return null;

  const b = BEATS[beat];
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); };
  const advance = () => { clearTimer(); setBeat((v) => Math.min(v + 1, READY)); };

  const chooseLook = (id: AppLook) => {
    const next = { ...loadAppearance(), appLook: id };
    saveAppearance(next);
    applyAppearance(next); // apply live so the whole intro retints instantly
    setLook(id);
    setLookPicked(true);
  };

  const handOff = () => {
    clearTimer();
    const go = () => {
      finishIntro();
      useWorkspace.getState().set({ surface: "home" });
    };
    if (reduceMotion.current) return go();
    setLeaving(true);
    setTimeout(go, 480);
  };

  const clickToAdvance = b.kind === "title";

  return (
    <div
      className={`spark-intro${leaving ? " spark-intro--leaving" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Zen"
      onClick={clickToAdvance ? advance : undefined}
    >
      <div className="spark-intro__wash" style={{ ["--wash" as string]: 1 }} />
      {/* The intro covers the app titlebar, so it brings its own window-drag strip. */}
      <div className="spark-intro__dragbar" data-tauri-drag-region />
      {b.kind === "ignite" && <div className="spark-intro__spark" />}

      <button className="spark-intro__skip" onClick={(e) => { e.stopPropagation(); handOff(); }}>
        Skip intro
      </button>

      {/* Title */}
      {b.kind === "title" && (
        <div className="spark-intro__stage">
          <SplitTitle text="Welcome to Zen" />
          <p className="spark-intro__subtitle" style={{ ["--sub-d" as string]: "820ms" }}>
            A calm, focused space for study. Let's light it up.
          </p>
        </div>
      )}

      {/* Look chooser */}
      {b.kind === "look" && (
        <div className="spark-intro__stage" onClick={(e) => e.stopPropagation()}>
          <h2 className="spark-intro__steptitle">Choose your look</h2>
          <p className="spark-intro__subtitle spark-intro__subtitle--static">You can change this any time in Settings, Appearance.</p>
          <div className="spark-look-grid">
            {APP_LOOKS.map((option) => (
              <button
                key={option.id}
                className={`spark-look-card${look === option.id ? " spark-look-card--active" : ""}`}
                onClick={() => chooseLook(option.id)}
              >
                <span className="spark-look-swatch" style={{ background: option.swatch }} />
                <span className="spark-look-name">{option.label}</span>
                <span className="spark-look-hint">{option.hint}</span>
              </button>
            ))}
          </div>
          <button className="zen-btn zen-shine spark-look-continue" disabled={!lookPicked} onClick={advance}>
            {lookPicked ? "Continue" : "Pick a look to continue"}
          </button>
        </div>
      )}

      {b.kind === "features" && (
        <FeatureStage
          selected={features}
          onToggle={(id) => setFeatures((current) => (
            current.includes(id) ? current.filter((feature) => feature !== id) : [...current, id]
          ))}
          onContinue={advance}
        />
      )}

      {b.kind === "setup" && (
        <SetupStage
          selected={features}
          onBack={() => setBeat(FEATURES)}
          onContinue={handOff}
        />
      )}
    </div>
  );
}

type SetupFeature = "google" | "sync" | "canvas" | "zotero" | "github" | "profile";

const SETUP_FEATURES: Array<{
  id: SetupFeature;
  eyebrow: string;
  title: string;
  detail: string;
  disabled?: boolean;
}> = [
  { id: "google", eyebrow: "GOOGLE", title: "Calendar, Mail & Drive", detail: "Bring your schedule, inbox, and files into Zen." },
  { id: "sync", eyebrow: "SYNC", title: "Cloud sync", detail: "Keep notes and study state available across devices." },
  {
    id: "canvas",
    eyebrow: "LMS",
    title: "Canvas",
    detail: "Import courses, assignments, modules, and files.",
    disabled: !CANVAS_INTEGRATION_ENABLED,
  },
  { id: "zotero", eyebrow: "CITE", title: "Zotero", detail: "Use papers, collections, annotations, and citations." },
  { id: "github", eyebrow: "CODE", title: "GitHub", detail: "Index repositories as searchable source material." },
  { id: "profile", eyebrow: "YOU", title: "Personal context", detail: "Tell Zen what you study and what you are working toward." },
];

function selectedFeaturesFromCurrentSetup(): SetupFeature[] {
  const selected: SetupFeature[] = [];
  const external = loadExternalConnectionSettings();
  const profile = loadProfile();
  if (isSignedIn()) selected.push("google");
  if (loadSyncSettings().enabled) selected.push("sync");
  if (CANVAS_INTEGRATION_ENABLED && loadCanvasSettings().accessToken.trim()) selected.push("canvas");
  if (external.zoteroApiKey.trim()) selected.push("zotero");
  if (external.githubToken.trim()) selected.push("github");
  if (profile.name.trim() || profile.about.trim()) selected.push("profile");
  return selected;
}

function FeatureStage({
  selected,
  onToggle,
  onContinue,
}: {
  selected: SetupFeature[];
  onToggle: (id: SetupFeature) => void;
  onContinue: () => void;
}) {
  return (
    <div className="spark-intro__stage spark-feature-stage" onClick={(event) => event.stopPropagation()}>
      <div>
        <h2 className="spark-intro__steptitle">Choose what you'll use</h2>
        <p className="spark-intro__subtitle spark-intro__subtitle--static">
          Click the parts you want. Notes and Deep Work are always ready.
        </p>
      </div>
      <div className="spark-feature-grid">
        {SETUP_FEATURES.map((feature) => {
          const disabled = feature.disabled === true;
          const active = !disabled && selected.includes(feature.id);
          return (
            <button
              key={feature.id}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              className={`spark-feature-card${active ? " spark-feature-card--active" : ""}${disabled ? " spark-feature-card--disabled" : ""}`}
              onClick={() => onToggle(feature.id)}
            >
              <span className="spark-feature-eyebrow">{feature.eyebrow}</span>
              <span className="spark-feature-title">{feature.title}</span>
              <span className="spark-feature-detail">{feature.detail}</span>
              <span className="spark-feature-choice">
                {disabled ? CANVAS_DISABLED_MESSAGE : active ? "Selected" : "Click to use"}
              </span>
            </button>
          );
        })}
      </div>
      <button className="zen-btn zen-shine spark-look-continue" onClick={onContinue}>
        {selected.length ? `Set up ${selected.length} selection${selected.length === 1 ? "" : "s"}` : "Continue with local Zen"}
      </button>
    </div>
  );
}

function SetupStage({
  selected,
  onBack,
  onContinue,
}: {
  selected: SetupFeature[];
  onBack: () => void;
  onContinue: () => void;
}) {
  const [signedIn, setSignedIn] = useState(() => isSignedIn());
  const [busy, setBusy] = useState<string | null>(null);
  const [vault, setVault] = useState<string[]>([]);
  const [name, setName] = useState(() => loadProfile().name);
  const [about, setAbout] = useState(() => loadProfile().about);
  const [profileSaved, setProfileSaved] = useState(() => {
    const profile = loadProfile();
    return !!(profile.name.trim() || profile.about.trim());
  });
  const [canvasDraft, setCanvasDraft] = useState(() => loadCanvasSettings());
  const [externalDraft, setExternalDraft] = useState(() => loadExternalConnectionSettings());

  useEffect(() => onAuthChange(setSignedIn), []);
  useEffect(() => {
    if (!signedIn) return;
    void listVaultConnections().then((items) => setVault(items.map((item) => item.provider))).catch(() => {});
  }, [signedIn]);

  const wants = (feature: SetupFeature) => selected.includes(feature);
  const needsGoogle = wants("google") || wants("sync");
  const syncEnabled = loadSyncSettings().enabled;
  const canvasReady = !!canvasDraft.accessToken.trim() || vault.includes("canvas");
  const zoteroReady = !!externalDraft.zoteroApiKey.trim() || vault.includes("zotero");
  const githubReady = !!externalDraft.githubToken.trim() || vault.includes("github");
  const canContinue =
    (!needsGoogle || signedIn)
    && (!wants("sync") || syncEnabled)
    && (!wants("canvas") || canvasReady)
    && (!wants("zotero") || zoteroReady)
    && (!wants("github") || githubReady)
    && (!wants("profile") || profileSaved);

  async function connectGoogle() {
    setBusy("google");
    try {
      await signIn();
      notify.success("Google account connected");
    } catch (error) {
      notify.error((error as Error).message || "Google sign-in failed");
    } finally {
      setBusy(null);
    }
  }

  async function enableSync() {
    setBusy("sync");
    try {
      saveSyncSettings({ ...loadSyncSettings(), enabled: true });
      await syncOnce();
      notify.success("Cloud sync enabled");
    } catch (error) {
      notify.error((error as Error).message || "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  function savePrivateProfile() {
    saveProfile({ ...loadProfile(), name: name.trim(), about: about.trim() });
    setProfileSaved(true);
    notify.success("Profile saved");
  }

  function saveCanvas() {
    const next = { baseUrl: canvasDraft.baseUrl.trim(), accessToken: canvasDraft.accessToken.trim() };
    saveCanvasSettings(next);
    setCanvasDraft(next);
    notify.success("Canvas settings saved");
  }

  function saveZotero() {
    const next = {
      ...externalDraft,
      zoteroLibraryId: externalDraft.zoteroLibraryId.trim(),
      zoteroApiKey: externalDraft.zoteroApiKey.trim(),
    };
    saveExternalConnectionSettings(next);
    setExternalDraft(next);
    notify.success("Zotero settings saved");
  }

  function saveGitHub() {
    const next = { ...externalDraft, githubToken: externalDraft.githubToken.trim() };
    saveExternalConnectionSettings(next);
    setExternalDraft(next);
    notify.success("GitHub token saved");
  }

  return (
    <div className="spark-intro__stage spark-setup" onClick={(e) => e.stopPropagation()}>
      <div>
        <h2 className="spark-intro__steptitle">{selected.length ? "Connect your choices" : "You're ready"}</h2>
        <p className="spark-intro__subtitle spark-intro__subtitle--static">
          {selected.length
            ? "Only the features you selected are shown here."
            : "Notes, Deep Work, PDFs, and local AI settings are available without an account."}
        </p>
      </div>
      <div className="spark-setup-grid">
        {needsGoogle && (
          <SetupCard
            done={signedIn}
            title="Google sign-in"
            detail={wants("google")
              ? "Required for Calendar, Mail, and Drive. It also anchors your Zen account."
              : "Required to identify your account for cloud sync."}
            action={signedIn ? <span className="spark-setup-status">Connected</span> : (
              <button className="zen-btn" disabled={busy === "google" || !isConfigured()} onClick={() => void connectGoogle()}>
                {busy === "google" ? "Connecting..." : "Connect Google"}
              </button>
            )}
          />
        )}
        {wants("sync") && (
          <SetupCard
            done={syncEnabled}
            title="Cloud sync"
            detail="Let notes, study state, PDFs, and settings follow you across devices."
            action={syncEnabled ? <span className="spark-setup-status">Enabled</span> : (
              <button className="zen-btn" disabled={!signedIn || busy === "sync"} onClick={() => void enableSync()}>
                {busy === "sync" ? "Syncing..." : "Enable sync"}
              </button>
            )}
          />
        )}
        {wants("canvas") && (
          <SetupCard
            done={canvasReady}
            title="Canvas"
            detail={vault.includes("canvas") && !canvasDraft.accessToken
              ? "A saved Canvas connection is available in your Zen account vault."
              : "Connect your institution to import courses, assignments, modules, and files."}
            action={canvasReady ? <span className="spark-setup-status">Ready</span> : (
              <div className="spark-profile">
                <input className="zen-input" value={canvasDraft.baseUrl} onChange={(event) => setCanvasDraft((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://school.instructure.com" />
                <input className="zen-input" type="password" value={canvasDraft.accessToken} onChange={(event) => setCanvasDraft((current) => ({ ...current, accessToken: event.target.value }))} placeholder="Canvas access token" />
                <button className="zen-btn" disabled={!canvasDraft.baseUrl.trim() || !canvasDraft.accessToken.trim()} onClick={saveCanvas}>Save Canvas</button>
              </div>
            )}
          />
        )}
        {wants("zotero") && (
          <SetupCard
            done={zoteroReady}
            title="Zotero"
            detail={vault.includes("zotero") && !externalDraft.zoteroApiKey
              ? "A saved Zotero connection is available in your Zen account vault."
              : "Connect a user or group library for papers, annotations, and citations."}
            action={zoteroReady ? <span className="spark-setup-status">Ready</span> : (
              <div className="spark-profile">
                <div className="grid grid-cols-[88px_1fr] gap-2">
                  <select className="zen-input" value={externalDraft.zoteroLibraryType} onChange={(event) => setExternalDraft((current) => ({ ...current, zoteroLibraryType: event.target.value as "user" | "group" }))}>
                    <option value="user">User</option>
                    <option value="group">Group</option>
                  </select>
                  <input className="zen-input" value={externalDraft.zoteroLibraryId} onChange={(event) => setExternalDraft((current) => ({ ...current, zoteroLibraryId: event.target.value }))} placeholder="Library ID" />
                </div>
                <input className="zen-input" type="password" value={externalDraft.zoteroApiKey} onChange={(event) => setExternalDraft((current) => ({ ...current, zoteroApiKey: event.target.value }))} placeholder="Zotero API key" />
                <button className="zen-btn" disabled={!externalDraft.zoteroLibraryId.trim() || !externalDraft.zoteroApiKey.trim()} onClick={saveZotero}>Save Zotero</button>
              </div>
            )}
          />
        )}
        {wants("github") && (
          <SetupCard
            done={githubReady}
            title="GitHub"
            detail={vault.includes("github") && !externalDraft.githubToken
              ? "A saved GitHub connection is available in your Zen account vault."
              : "Add a fine-grained token to index repositories as source material."}
            action={githubReady ? <span className="spark-setup-status">Ready</span> : (
              <div className="spark-profile">
                <input className="zen-input" type="password" value={externalDraft.githubToken} onChange={(event) => setExternalDraft((current) => ({ ...current, githubToken: event.target.value }))} placeholder="GitHub token" />
                <button className="zen-btn" disabled={!externalDraft.githubToken.trim()} onClick={saveGitHub}>Save GitHub</button>
              </div>
            )}
          />
        )}
        {wants("profile") && (
          <SetupCard
            done={profileSaved}
            title="Personal context"
            detail="A private memory seed helps Zen speak to your actual classes and goals."
            action={profileSaved ? <span className="spark-setup-status">Saved</span> : (
              <div className="spark-profile">
                <input className="zen-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
                <textarea className="zen-input" rows={2} value={about} onChange={(event) => setAbout(event.target.value)} placeholder="What are you studying?" />
                <button className="zen-btn" disabled={!name.trim() && !about.trim()} onClick={savePrivateProfile}>Save profile</button>
              </div>
            )}
          />
        )}
      </div>
      <div className="spark-setup-footer">
        <button className="zen-btn-ghost" onClick={onBack}>Change choices</button>
        <button className="zen-btn zen-shine" disabled={!canContinue} onClick={onContinue}>
          {canContinue ? "Enter Zen" : "Finish the selected setup"}
        </button>
      </div>
    </div>
  );
}

function SetupCard({ done, title, detail, action }: { done: boolean; title: string; detail: string; action: ReactNode }) {
  return (
    <section className={`spark-setup-card${done ? " spark-setup-card--done" : ""}`}>
      <div className="spark-setup-card__head">
        <span className="spark-setup-check">{done ? "OK" : ""}</span>
        <div>
          <h3>{title}</h3>
          <p>{detail}</p>
        </div>
      </div>
      {action}
    </section>
  );
}

/** Splits text into per-char spans with a staggered reveal (SplitText, native). */
function SplitTitle({ text }: { text: string }) {
  return (
    <h1 className="spark-intro__title" aria-label={text}>
      {Array.from(text).map((ch, i) => (
        <span key={i} className="spark-intro__char" aria-hidden style={{ ["--d" as string]: `${i * 55}ms` }}>{ch}</span>
      ))}
    </h1>
  );
}
