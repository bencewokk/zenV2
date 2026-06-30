import { useEffect, useState } from "react";
import { loadSettings, saveSettings } from "@/services/ai/settings";
import { loadGoogleSettings, saveGoogleSettings } from "@/services/google/settings";
import { deepseek } from "@/services/ai/deepseek";
import { isSignedIn, isConfigured, onAuthChange, signIn, signOut } from "@/services/google/auth";
import { loadSyncSettings, saveSyncSettings } from "@/services/sync/settings";
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
  const [sync, setSync] = useState(() => loadSyncSettings());
  const [syncing, setSyncing] = useState(false);
  const syncStatus = useStatus((s) => s.sync);

  useEffect(() => onAuthChange(setSignedIn), []);

  function saveAi() {
    saveSettings(ai);
    notify.success("DeepSeek settings saved");
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

  function saveSync(next = sync) {
    saveSyncSettings(next);
    setSync(next);
  }
  async function toggleSync(enabled: boolean) {
    saveSync({ ...sync, enabled });
    if (enabled) {
      if (!signedIn) notify.error("Connect Google first to sync.");
      else if (!sync.baseUrl.trim()) notify.error("Set the Sync API URL first.");
      else void syncOnce();
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
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: signedIn ? "var(--ok)" : "var(--text-dim)" }}
          />
          <span className="text-xs text-[var(--text-dim)]">
            {signedIn ? "Connected" : isConfigured() ? "Not connected" : "No Client ID set"}
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
