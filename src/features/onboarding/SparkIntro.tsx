import { useEffect, useRef, useState, type ReactNode } from "react";
import { APP_LOOKS, applyAppearance, loadAppearance, saveAppearance, type AppLook } from "@/services/appearance";
import { isConfigured, isSignedIn, onAuthChange, signIn } from "@/services/google/auth";
import { loadSyncSettings, saveSyncSettings } from "@/services/sync/settings";
import { syncOnce } from "@/services/sync/engine";
import { listVaultConnections } from "@/services/connections/vault";
import { loadCanvasSettings, saveCanvasSettings } from "@/services/canvas/settings";
import { loadExternalConnectionSettings, saveExternalConnectionSettings } from "@/services/connections/settings";
import { loadProfile, saveProfile } from "@/services/memory";
import { notify } from "@/shared/ui/notify";
import { useWorkspace } from "@/shared/stores/workspace";
import { useSparkIntro } from "./sparkStore";
import "./SparkIntro.css";

/**
 * First-run "Spark Intro": a focused setup path. A spark ignites, the user
 * picks an app look, then chooses the account, sync, source, and profile
 * defaults that make the dashboard useful immediately.
 */

type Kind = "ignite" | "title" | "look" | "setup";
interface Beat { kind: Kind; hold: number }

const BEATS: Beat[] = [
  { kind: "ignite", hold: 2000 },
  { kind: "title", hold: 2800 },
  { kind: "look", hold: 0 },
  { kind: "setup", hold: 0 },
];

const LOOK = BEATS.findIndex((b) => b.kind === "look");
const READY = BEATS.length - 1;

export function SparkIntro() {
  const open = useSparkIntro((s) => s.open);
  const finishIntro = useSparkIntro((s) => s.finish);
  const [beat, setBeat] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [look, setLook] = useState<AppLook>(() => loadAppearance().appLook);
  const [lookPicked, setLookPicked] = useState(false);
  const reduceMotion = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    reduceMotion.current = document.documentElement.hasAttribute("data-reduce-motion");
    setLeaving(false);
    setLookPicked(false);
    setLook(loadAppearance().appLook);
    setBeat(reduceMotion.current ? LOOK : 0);
  }, [open]);

  // Auto-advance, except the interactive setup beats.
  useEffect(() => {
    if (!open || reduceMotion.current) return;
    const b = BEATS[beat];
    if (b.kind === "look" || b.kind === "setup") return;
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

      {b.kind === "setup" && <SetupStage onContinue={handOff} />}
    </div>
  );
}

type Decision = "connected" | "skipped";
type Decisions = Record<string, Decision>;

function SetupStage({ onContinue }: { onContinue: () => void }) {
  const [signedIn, setSignedIn] = useState(() => isSignedIn());
  const [decisions, setDecisions] = useState<Decisions>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [vault, setVault] = useState<string[]>([]);
  const [name, setName] = useState(() => loadProfile().name);
  const [about, setAbout] = useState(() => loadProfile().about);
  const [canvasDraft, setCanvasDraft] = useState(() => loadCanvasSettings());
  const [externalDraft, setExternalDraft] = useState(() => loadExternalConnectionSettings());

  useEffect(() => onAuthChange(setSignedIn), []);
  useEffect(() => {
    const profile = loadProfile();
    setDecisions((current) => ({
      ...current,
      ...(isSignedIn() ? { google: "connected" as const } : {}),
      ...(loadSyncSettings().enabled ? { sync: "connected" as const } : {}),
      ...(profile.name.trim() || profile.about.trim() ? { profile: "connected" as const } : {}),
    }));
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    setDecisions((current) => ({ ...current, google: "connected" }));
    void listVaultConnections().then((items) => setVault(items.map((item) => item.provider))).catch(() => {});
  }, [signedIn]);

  const decide = (key: string, value: Decision) => setDecisions((current) => ({ ...current, [key]: value }));
  const syncEnabled = loadSyncSettings().enabled;
  const sourceRows = [
    { id: "drive", label: "Drive", ready: signedIn },
    { id: "canvas", label: "Canvas", ready: !!canvasDraft.accessToken || vault.includes("canvas") },
    { id: "zotero", label: "Zotero", ready: !!externalDraft.zoteroApiKey || vault.includes("zotero") },
    { id: "github", label: "GitHub", ready: !!externalDraft.githubToken || vault.includes("github") },
  ];
  const sourcesReviewed = sourceRows.every((source) => source.ready || decisions[`source:${source.id}`] === "skipped");
  const googleResolved = signedIn || !!decisions.google;
  const syncResolved = syncEnabled || !!decisions.sync;
  const profileResolved = !!decisions.profile;
  const canContinue = googleResolved && syncResolved && sourcesReviewed && profileResolved;

  async function connectGoogle() {
    setBusy("google");
    try {
      await signIn();
      decide("google", "connected");
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
      decide("sync", "connected");
      notify.success("Cloud sync enabled");
    } catch (error) {
      notify.error((error as Error).message || "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  function keepLocal() {
    saveSyncSettings({ ...loadSyncSettings(), enabled: false });
    decide("sync", "skipped");
  }

  function savePrivateProfile() {
    saveProfile({ ...loadProfile(), name: name.trim(), about: about.trim() });
    decide("profile", "connected");
    notify.success("Profile saved");
  }

  function saveCanvas() {
    const next = { baseUrl: canvasDraft.baseUrl.trim(), accessToken: canvasDraft.accessToken.trim() };
    saveCanvasSettings(next);
    setCanvasDraft(next);
    decide("source:canvas", "connected");
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
    decide("source:zotero", "connected");
    notify.success("Zotero settings saved");
  }

  function saveGitHub() {
    const next = { ...externalDraft, githubToken: externalDraft.githubToken.trim() };
    saveExternalConnectionSettings(next);
    setExternalDraft(next);
    decide("source:github", "connected");
    notify.success("GitHub token saved");
  }

  return (
    <div className="spark-intro__stage spark-setup" onClick={(e) => e.stopPropagation()}>
      <div>
        <h2 className="spark-intro__steptitle">Set your foundation</h2>
        <p className="spark-intro__subtitle spark-intro__subtitle--static">
          Pick what Zen may connect now. You can finish or revise every choice in Settings later.
        </p>
      </div>
      <div className="spark-setup-grid">
        <SetupCard
          done={signedIn || decisions.google === "skipped"}
          title="Google identity"
          detail={signedIn ? "Connected for account, sync, Drive, Calendar, and Mail." : decisions.google === "skipped" ? "Skipped for now. Zen will stay local." : "Optional, but needed for cloud features."}
          action={signedIn ? <span className="spark-setup-status">Connected</span> : (
            <div className="spark-setup-actions">
              <button className="zen-btn" disabled={busy === "google" || !isConfigured()} onClick={() => void connectGoogle()}>
                {busy === "google" ? "Connecting..." : "Connect"}
              </button>
              <button className="zen-btn-ghost" onClick={() => decide("google", "skipped")}>Local-only</button>
            </div>
          )}
        />
        <SetupCard
          done={syncEnabled || !!decisions.sync}
          title="Sync"
          detail="Choose whether notes, study state, PDFs, and settings can follow you."
          action={(
            <div className="spark-setup-actions">
              <button className="zen-btn" disabled={!signedIn || busy === "sync"} onClick={() => void enableSync()}>
                {busy === "sync" ? "Syncing..." : "Enable"}
              </button>
              <button className="zen-btn-ghost" onClick={keepLocal}>Keep local</button>
            </div>
          )}
        />
        <SetupCard
          done={sourcesReviewed}
          title="Sources"
          detail="Drive follows Google. Add Canvas, Zotero, and GitHub now, or mark each one for later."
          action={(
            <div className="spark-source-setup">
              <div className="spark-source-list">
                {sourceRows.map((source) => (
                  <button
                    key={source.id}
                    className={`spark-source-pill${source.ready ? " spark-source-pill--ready" : ""}`}
                    onClick={() => !source.ready && decide(`source:${source.id}`, "skipped")}
                  >
                    {source.label}: {source.ready ? "on" : decisions[`source:${source.id}`] === "skipped" ? "later" : "later?"}
                  </button>
                ))}
              </div>
              <div className="spark-source-fields">
                <div className="spark-source-field">
                  <span>Canvas</span>
                  <input className="zen-input" value={canvasDraft.baseUrl} onChange={(event) => setCanvasDraft((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://school.instructure.com" />
                  <input className="zen-input" type="password" value={canvasDraft.accessToken} onChange={(event) => setCanvasDraft((current) => ({ ...current, accessToken: event.target.value }))} placeholder="Canvas access token" />
                  <button className="zen-btn-ghost" disabled={!canvasDraft.baseUrl.trim() || !canvasDraft.accessToken.trim()} onClick={saveCanvas}>Save Canvas</button>
                </div>
                <div className="spark-source-field">
                  <span>Zotero</span>
                  <div className="grid grid-cols-[88px_1fr] gap-2">
                    <select className="zen-input" value={externalDraft.zoteroLibraryType} onChange={(event) => setExternalDraft((current) => ({ ...current, zoteroLibraryType: event.target.value as "user" | "group" }))}>
                      <option value="user">User</option>
                      <option value="group">Group</option>
                    </select>
                    <input className="zen-input" value={externalDraft.zoteroLibraryId} onChange={(event) => setExternalDraft((current) => ({ ...current, zoteroLibraryId: event.target.value }))} placeholder="Library ID" />
                  </div>
                  <input className="zen-input" type="password" value={externalDraft.zoteroApiKey} onChange={(event) => setExternalDraft((current) => ({ ...current, zoteroApiKey: event.target.value }))} placeholder="Zotero API key" />
                  <button className="zen-btn-ghost" disabled={!externalDraft.zoteroLibraryId.trim() || !externalDraft.zoteroApiKey.trim()} onClick={saveZotero}>Save Zotero</button>
                </div>
                <div className="spark-source-field">
                  <span>GitHub</span>
                  <input className="zen-input" type="password" value={externalDraft.githubToken} onChange={(event) => setExternalDraft((current) => ({ ...current, githubToken: event.target.value }))} placeholder="GitHub token" />
                  <button className="zen-btn-ghost" disabled={!externalDraft.githubToken.trim()} onClick={saveGitHub}>Save GitHub</button>
                </div>
              </div>
            </div>
          )}
        />
        <SetupCard
          done={!!decisions.profile}
          title="Private profile"
          detail="A small memory seed helps Zen speak to your actual classes and goals."
          action={(
            <div className="spark-profile">
              <input className="zen-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
              <textarea className="zen-input" rows={2} value={about} onChange={(event) => setAbout(event.target.value)} placeholder="What are you studying?" />
              <div className="spark-setup-actions">
                <button className="zen-btn-ghost" onClick={() => decide("profile", "skipped")}>Skip</button>
                <button className="zen-btn" disabled={!name.trim() && !about.trim()} onClick={savePrivateProfile}>Save</button>
              </div>
            </div>
          )}
        />
      </div>
      <button className="zen-btn zen-shine spark-look-continue" disabled={!canContinue} onClick={onContinue}>
        {canContinue ? "Continue" : "Choose or skip each setup item"}
      </button>
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
