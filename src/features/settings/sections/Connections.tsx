import { useEffect, useState } from "react";
import { loadSettings, saveSettings } from "@/services/ai/settings";
import { loadGoogleSettings, saveGoogleSettings, isUsingBundledCredentials } from "@/services/google/settings";
import { deepseek } from "@/services/ai/deepseek";
import { isSignedIn, isConfigured, onAuthChange, signIn, signOut } from "@/services/google/auth";
import { loadSyncSettings, saveSyncSettings } from "@/services/sync/settings";
import { clearCanvasSettings, loadCanvasSettings, saveCanvasSettings } from "@/services/canvas/settings";
import { getCanvasProfile, listCanvasCourses } from "@/services/canvas/client";
import { driveFolderId, loadExternalConnectionSettings, saveExternalConnectionSettings, splitConnectionList } from "@/services/connections/settings";
import { refreshDriveSources } from "@/services/sources/drive";
import { testZoteroConnection } from "@/services/sources/zotero";
import { testGitHubConnection } from "@/services/sources/github";
import { backupConnectionsToVault, deleteVaultConnection, listVaultConnections, restoreConnectionsFromVault, type VaultConnectionStatus, type VaultProvider } from "@/services/connections/vault";
import { syncOnce, clearSyncState } from "@/services/sync/engine";
import { notify } from "@/shared/ui/notify";
import { useOnboarding } from "@/features/onboarding/store";
import { useStatus } from "@/shared/stores/status";
import { Field, SettingsSection, SaveBar } from "../ui";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** API keys, endpoints, and Google connection. */
export function Connections() {
  const [ai, setAi] = useState(() => loadSettings());
  const [clientId, setClientId] = useState(() => loadGoogleSettings().clientId);
  const [clientSecret, setClientSecret] = useState(() => loadGoogleSettings().clientSecret);
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [signedIn, setSignedIn] = useState(() => isSignedIn());
  const usingBundled = isUsingBundledCredentials({ clientId, clientSecret });
  const [sync, setSync] = useState(() => loadSyncSettings());
  const [syncing, setSyncing] = useState(false);
  const syncStatus = useStatus((s) => s.sync);
  const [canvas, setCanvas] = useState(() => loadCanvasSettings());
  const [showCanvasToken, setShowCanvasToken] = useState(false);
  const [testingCanvas, setTestingCanvas] = useState(false);
  const [canvasIdentity, setCanvasIdentity] = useState<string | null>(null);
  const [external, setExternal] = useState(() => loadExternalConnectionSettings());
  const [showZoteroKey, setShowZoteroKey] = useState(false);
  const [showGitHubToken, setShowGitHubToken] = useState(false);
  const [testingExternal, setTestingExternal] = useState<"drive" | "zotero" | "github" | null>(null);
  const [vaultConnections, setVaultConnections] = useState<VaultConnectionStatus[]>([]);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);

  useEffect(() => onAuthChange(setSignedIn), []);
  useEffect(() => {
    if (!signedIn) { setVaultConnections([]); setVaultError(null); return; }
    void listVaultConnections().then((items) => { setVaultConnections(items); setVaultError(null); }).catch((error) => setVaultError((error as Error).message || "Vault unavailable"));
  }, [signedIn]);

  function saveAi() {
    saveSettings(ai);
    notify.success("DeepSeek settings saved");
    if (signedIn) void refreshVaultQuietly().catch(() => {});
  }
  function saveGoogle() {
    saveGoogleSettings({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
    notify.success("Google settings saved");
  }

  async function testKey() {
    setTesting(true);
    saveSettings(ai); // test against what the user typed
    try {
      const models = await deepseek.listModels();
      if (models.length) notify.success(`Key works — ${models.length} models available`);
      else notify.error("No models returned. Check the key and base URL.");
    } catch (e) {
      notify.error((e as Error).message || "Key test failed");
    } finally {
      setTesting(false);
    }
  }

  async function connectGoogle() {
    saveGoogleSettings({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
    try {
      await signIn();
      notify.success("Connected to Google");
    } catch (e) {
      notify.error((e as Error).message || "Google sign-in failed");
    }
  }

  function saveCanvas() {
    saveCanvasSettings({ baseUrl: canvas.baseUrl.trim(), accessToken: canvas.accessToken.trim() });
    notify.success("Canvas settings saved");
    if (signedIn) void refreshVaultQuietly().catch(() => {});
  }

  async function testCanvas() {
    setTestingCanvas(true);
    saveCanvasSettings({ baseUrl: canvas.baseUrl.trim(), accessToken: canvas.accessToken.trim() });
    try {
      const [profile, courses] = await Promise.all([getCanvasProfile(), listCanvasCourses()]);
      setCanvasIdentity(profile.name);
      if (signedIn) await refreshVaultQuietly();
      notify.success(`Connected as ${profile.name} · ${courses.length} active course${courses.length === 1 ? "" : "s"}`);
    } catch (e) {
      setCanvasIdentity(null);
      notify.error((e as Error).message || "Canvas connection failed");
    } finally {
      setTestingCanvas(false);
    }
  }

  async function disconnectCanvas() {
    clearCanvasSettings();
    setCanvas({ baseUrl: "", accessToken: "" });
    setCanvasIdentity(null);
    if (signedIn && vaultConnections.some((connection) => connection.provider === "canvas")) {
      await deleteVaultConnection("canvas").catch(() => {});
      setVaultConnections(await listVaultConnections().catch(() => []));
    }
    notify.success("Canvas disconnected");
  }

  function saveExternal() {
    saveExternalConnectionSettings(external);
    notify.success("Source connections saved");
    if (signedIn) void refreshVaultQuietly().catch(() => {});
  }

  async function refreshVaultQuietly() {
    await backupConnectionsToVault();
    setVaultConnections(await listVaultConnections());
  }

  async function testDrive() {
    saveExternalConnectionSettings(external);
    setTestingExternal("drive");
    try {
      const result = await refreshDriveSources();
      notify.success(`Drive works · imported ${result.imported} source${result.imported === 1 ? "" : "s"}`);
    } catch (e) { notify.error((e as Error).message || "Drive test failed"); }
    finally { setTestingExternal(null); }
  }

  async function testZotero() {
    saveExternalConnectionSettings(external);
    setTestingExternal("zotero");
    try { await testZoteroConnection(); if (signedIn) await refreshVaultQuietly(); notify.success("Zotero connection works"); }
    catch (e) { notify.error((e as Error).message || "Zotero test failed"); }
    finally { setTestingExternal(null); }
  }

  async function testGitHub() {
    saveExternalConnectionSettings(external);
    setTestingExternal("github");
    try { const identity = await testGitHubConnection(); if (signedIn) await refreshVaultQuietly(); notify.success(`GitHub connection works · ${identity}`); }
    catch (e) { notify.error((e as Error).message || "GitHub test failed"); }
    finally { setTestingExternal(null); }
  }

  async function secureConnections() {
    setVaultBusy(true);
    try {
      const saved = await backupConnectionsToVault();
      setVaultConnections(await listVaultConnections());
      notify.success(saved.length ? `Secured ${saved.join(", ")} with your Zen account` : "No local provider credentials to secure");
    } catch (e) { setVaultError((e as Error).message || "Vault unavailable"); notify.error((e as Error).message || "Could not update connection vault"); }
    finally { setVaultBusy(false); }
  }

  async function restoreConnections() {
    setVaultBusy(true);
    try {
      const restored = await restoreConnectionsFromVault();
      setCanvas(loadCanvasSettings());
      setExternal(loadExternalConnectionSettings());
      notify.success(restored.length ? `Restored ${restored.join(", ")}` : "No saved provider connections");
    } catch (e) { setVaultError((e as Error).message || "Vault unavailable"); notify.error((e as Error).message || "Could not restore connections"); }
    finally { setVaultBusy(false); }
  }

  async function revokeVault(provider: VaultProvider) {
    if (!confirm(`Remove the saved ${provider} connection from your Zen account?`)) return;
    try { await deleteVaultConnection(provider); setVaultConnections(await listVaultConnections()); notify.success(`${provider} removed from the vault`); }
    catch (e) { notify.error((e as Error).message || "Could not revoke connection"); }
  }

  function saveSync(next = sync) {
    saveSyncSettings(next);
    setSync(next);
  }
  async function toggleSync(enabled: boolean) {
    saveSync({ ...sync, enabled });
    if (enabled) {
      if (!signedIn) notify.error("Connect Google first to sync.");
      else if (!sync.baseUrl.trim()) notify.error("Set the Sync API URL first.");
      else syncOnce().catch((e) => notify.error((e as Error).message || "Sync failed"));
    } else {
      clearSyncState();
      notify.success("Sync turned off");
    }
  }
  async function syncNow() {
    saveSync();
    setSyncing(true);
    try {
      await syncOnce();
      notify.success("Synced");
    } catch (e) {
      notify.error((e as Error).message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const replayWalkthrough = useOnboarding((s) => s.start);

  return (
    <div className="space-y-6">
      <SettingsSection title="Walkthrough" hint="A quick guided tour of connecting services and using Deep Work, study, and quizzes.">
        <button className="zen-btn-ghost" onClick={replayWalkthrough}>Replay walkthrough</button>
      </SettingsSection>

      <SettingsSection title="Zen account vault" hint="Your Google identity owns an encrypted vault so provider connections can follow you to another device.">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: signedIn ? "var(--ok)" : "var(--text-dim)" }} />
          <span className="text-xs text-[var(--text-dim)]">{signedIn ? `${vaultConnections.length} provider connection${vaultConnections.length === 1 ? "" : "s"} secured` : "Sign in with Google below to use the vault"}</span>
          <div className="ml-auto flex gap-2">
            <button className="zen-btn-ghost" disabled={!signedIn || vaultBusy} onClick={() => void restoreConnections()}>Restore</button>
            <button className="zen-btn" disabled={!signedIn || vaultBusy} onClick={() => void secureConnections()}>{vaultBusy ? "Working…" : "Secure connections"}</button>
          </div>
        </div>
        <p className="text-xs text-[var(--text-dim)]">Provider credentials are encrypted at rest and only accessible after authenticating as the same Google account.</p>
        {vaultError && <p className="text-xs text-[var(--danger)]">Vault unavailable: {vaultError}</p>}
        {vaultConnections.length > 0 && <div className="flex flex-wrap gap-1.5">{vaultConnections.map((connection) => <button key={connection.provider} className="zen-btn-ghost capitalize" onClick={() => void revokeVault(connection.provider)} title="Remove from account vault">{connection.provider} · remove</button>)}</div>}
      </SettingsSection>

      <SettingsSection title="DeepSeek" hint="Powers the AI assistant. The key is stored locally in your browser.">
        <Field label="API key">
          <div className="flex gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={ai.apiKey}
              onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
              placeholder="sk-…"
              className="zen-input flex-1"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="zen-btn-ghost shrink-0" onClick={() => setShowKey((s) => !s)}>
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
        </Field>
        <Field label="Base URL" hint="In dev this is the Vite proxy prefix (/deepseek).">
          <input
            value={ai.baseUrl}
            onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
            className="zen-input w-full"
            spellCheck={false}
          />
        </Field>
        <Field label="Default model">
          <input
            value={ai.model}
            onChange={(e) => setAi({ ...ai, model: e.target.value })}
            className="zen-input w-full"
            spellCheck={false}
          />
        </Field>
        <SaveBar onSave={saveAi}>
          <button className="zen-btn-ghost" onClick={testKey} disabled={testing}>
            {testing ? "Testing…" : "Test key"}
          </button>
        </SaveBar>
      </SettingsSection>

      <SettingsSection title="Google Drive" hint="Index only the folders you choose. Requires reconnecting Google once to grant read-only Drive access.">
        <Field label="Folder URLs or IDs" hint="Separate multiple folders with commas or spaces.">
          <textarea
            value={external.driveFolderIds.join("\n")}
            onChange={(e) => setExternal({ ...external, driveFolderIds: splitConnectionList(e.target.value).map(driveFolderId) })}
            placeholder="https://drive.google.com/drive/folders/…"
            className="zen-input min-h-20 w-full"
            spellCheck={false}
          />
        </Field>
        <SaveBar onSave={saveExternal}>
          <button className="zen-btn-ghost" onClick={() => void testDrive()} disabled={testingExternal === "drive" || !signedIn || !external.driveFolderIds.length}>
            {testingExternal === "drive" ? "Importing…" : "Test & import"}
          </button>
        </SaveBar>
      </SettingsSection>

      <SettingsSection title="Zotero" hint="Import collections, papers, annotations, tags, authors, and citation metadata.">
        <div className="grid grid-cols-[140px_1fr] gap-3">
          <Field label="Library type">
            <select className="zen-input w-full" value={external.zoteroLibraryType} onChange={(e) => setExternal({ ...external, zoteroLibraryType: e.target.value as "user" | "group" })}>
              <option value="user">User</option><option value="group">Group</option>
            </select>
          </Field>
          <Field label="Library ID">
            <input className="zen-input w-full" value={external.zoteroLibraryId} onChange={(e) => setExternal({ ...external, zoteroLibraryId: e.target.value })} placeholder="Numeric user or group ID" />
          </Field>
        </div>
        <Field label="API key">
          <div className="flex gap-2"><input type={showZoteroKey ? "text" : "password"} className="zen-input flex-1" value={external.zoteroApiKey} onChange={(e) => setExternal({ ...external, zoteroApiKey: e.target.value })} autoComplete="off" /><button className="zen-btn-ghost" onClick={() => setShowZoteroKey((value) => !value)}>{showZoteroKey ? "Hide" : "Show"}</button></div>
        </Field>
        <Field label="Collection keys" hint="Optional. Leave blank to import the whole library.">
          <input className="zen-input w-full" value={external.zoteroCollectionKeys.join(", ")} onChange={(e) => setExternal({ ...external, zoteroCollectionKeys: splitConnectionList(e.target.value) })} placeholder="ABC123, DEF456" />
        </Field>
        <SaveBar onSave={saveExternal}><button className="zen-btn-ghost" onClick={() => void testZotero()} disabled={testingExternal === "zotero" || !external.zoteroApiKey || !external.zoteroLibraryId}>{testingExternal === "zotero" ? "Testing…" : "Test connection"}</button></SaveBar>
      </SettingsSection>

      <SettingsSection title="GitHub" hint="Index selected repositories, text/code files, issues, and pull requests. Public repositories work without a token.">
        <Field label="Repositories" hint="Use owner/repository, separated by commas or spaces.">
          <textarea className="zen-input min-h-20 w-full" value={external.githubRepositories.join("\n")} onChange={(e) => setExternal({ ...external, githubRepositories: splitConnectionList(e.target.value).map((value) => value.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "")) })} placeholder="owner/repository" spellCheck={false} />
        </Field>
        <Field label="Personal token" hint="Optional for public repositories; required for private repositories and higher rate limits.">
          <div className="flex gap-2"><input type={showGitHubToken ? "text" : "password"} className="zen-input flex-1" value={external.githubToken} onChange={(e) => setExternal({ ...external, githubToken: e.target.value })} autoComplete="off" /><button className="zen-btn-ghost" onClick={() => setShowGitHubToken((value) => !value)}>{showGitHubToken ? "Hide" : "Show"}</button></div>
        </Field>
        <Field label="Excluded paths" hint="Files containing any of these path fragments are not indexed.">
          <input className="zen-input w-full" value={external.githubExcludePatterns.join(", ")} onChange={(e) => setExternal({ ...external, githubExcludePatterns: splitConnectionList(e.target.value) })} />
        </Field>
        <SaveBar onSave={saveExternal}><button className="zen-btn-ghost" onClick={() => void testGitHub()} disabled={testingExternal === "github" || (!external.githubToken && !external.githubRepositories.length)}>{testingExternal === "github" ? "Testing…" : "Test connection"}</button></SaveBar>
      </SettingsSection>

      <SettingsSection
        title="Canvas"
        hint="Read-only access to your courses, assignments, modules, announcements, and files."
      >
        <Field label="Canvas URL" hint="Your institution root URL, without /api/v1.">
          <input
            value={canvas.baseUrl}
            onChange={(e) => setCanvas({ ...canvas, baseUrl: e.target.value })}
            placeholder="https://school.instructure.com"
            className="zen-input w-full"
            spellCheck={false}
          />
        </Field>
        <Field label="Access token" hint="Stored on this device and excluded from cloud sync.">
          <div className="flex gap-2">
            <input
              type={showCanvasToken ? "text" : "password"}
              value={canvas.accessToken}
              onChange={(e) => setCanvas({ ...canvas, accessToken: e.target.value })}
              placeholder="Canvas access token"
              className="zen-input flex-1"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="zen-btn-ghost shrink-0" onClick={() => setShowCanvasToken((s) => !s)}>
              {showCanvasToken ? "Hide" : "Show"}
            </button>
          </div>
        </Field>
        <p className="text-xs text-[var(--text-dim)]">
          Personal tokens support initial testing. A public Zen release should use institution-approved Canvas OAuth.
        </p>
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: canvasIdentity ? "var(--ok)" : "var(--text-dim)" }}
          />
          <span className="text-xs text-[var(--text-dim)]">
            {canvasIdentity ? `Connected as ${canvasIdentity}` : canvas.baseUrl && canvas.accessToken ? "Saved · not verified this session" : "Not connected"}
          </span>
          <div className="ml-auto flex gap-2">
            {(canvas.baseUrl || canvas.accessToken) && (
              <button className="zen-btn-ghost" onClick={() => void disconnectCanvas()}>Disconnect</button>
            )}
            <button className="zen-btn-ghost" onClick={saveCanvas}>Save</button>
            <button className="zen-btn" onClick={testCanvas} disabled={testingCanvas || !canvas.baseUrl.trim() || !canvas.accessToken.trim()}>
              {testingCanvas ? "Testing…" : "Test connection"}
            </button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Google"
        hint={
          IS_TAURI
            ? "Calendar + Gmail access. Use a Google \"Desktop app\" OAuth client (Client ID + Secret)."
            : "Calendar + Gmail access. The Client ID is a public OAuth web client id."
        }
      >
        <Field label="Client ID">
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="…apps.googleusercontent.com"
            className="zen-input w-full"
            spellCheck={false}
          />
        </Field>
        {IS_TAURI && (
          <Field label="Client secret" hint="From your Google Desktop OAuth client. Stored in your OS keyring.">
            <div className="flex gap-2">
              <input
                type={showSecret ? "text" : "password"}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="GOCSPX-…"
                className="zen-input flex-1"
                autoComplete="off"
                spellCheck={false}
              />
              <button className="zen-btn-ghost shrink-0" onClick={() => setShowSecret((s) => !s)}>
                {showSecret ? "Hide" : "Show"}
              </button>
            </div>
          </Field>
        )}
        {usingBundled && isConfigured() && (
          <p className="text-xs text-[var(--text-dim)]">
            Using <span className="text-[var(--text)]">Zen's built-in Google connection</span> — you
            haven't set your own Client ID{IS_TAURI ? " + secret" : ""} above. Fine for personal use;
            while unverified, Google caps shared clients at 100 users and shows a warning screen.
          </p>
        )}
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: signedIn ? "var(--ok)" : "var(--text-dim)" }}
          />
          <span className="text-xs text-[var(--text-dim)]">
            {signedIn ? "Connected" : isConfigured() ? "Not connected" : "No Client ID set"}
            {usingBundled && isConfigured() ? " · built-in client" : ""}
          </span>
          <div className="ml-auto flex gap-2">
            <button className="zen-btn-ghost" onClick={saveGoogle}>Save</button>
            {signedIn ? (
              <button className="zen-btn-ghost" onClick={() => { signOut(); notify.success("Disconnected"); }}>
                Disconnect
              </button>
            ) : (
              <button className="zen-btn" onClick={connectGoogle}>Connect</button>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Cloud sync"
        hint="Sync your notes and data across devices via a MongoDB-backed service. Uses your Google sign-in to identify you — connect Google above first."
      >
        <Field label="Sync API URL" hint="The deployed sync backend, e.g. https://your-zen-sync.vercel.app">
          <input
            value={sync.baseUrl}
            onChange={(e) => setSync({ ...sync, baseUrl: e.target.value })}
            onBlur={() => saveSync()}
            placeholder="https://…"
            className="zen-input w-full"
            spellCheck={false}
          />
        </Field>
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background:
                syncStatus === "on"
                  ? "var(--ok)"
                  : syncStatus === "error"
                    ? "var(--err, #e5484d)"
                    : syncStatus === "connecting"
                      ? "var(--accent)"
                      : "var(--text-dim)",
            }}
          />
          <span className="text-xs text-[var(--text-dim)]">
            {!sync.enabled
              ? "Off"
              : syncStatus === "on"
                ? "Synced"
                : syncStatus === "connecting"
                  ? "Syncing…"
                  : syncStatus === "error"
                    ? "Sync error"
                    : "Idle"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button className="zen-btn-ghost" onClick={syncNow} disabled={syncing || !sync.enabled}>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <button
              className={sync.enabled ? "zen-btn-ghost" : "zen-btn"}
              onClick={() => toggleSync(!sync.enabled)}
            >
              {sync.enabled ? "Turn off" : "Turn on"}
            </button>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
