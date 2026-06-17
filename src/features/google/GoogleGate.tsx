import type { ReactNode } from "react";
import { useGoogleAuth } from "@/features/google/useGoogleAuth";

/** Wraps Google features: shows setup/connect prompts until signed in. */
export function GoogleGate({ title, children }: { title: string; children: ReactNode }) {
  const { signedIn, configured, connect } = useGoogleAuth();

  if (!configured) {
    return (
      <div className="mx-auto max-w-md px-8 py-16 text-center text-[var(--text-dim)]">
        <h2 className="mb-2 text-lg font-semibold text-[var(--text)]">{title}</h2>
        <p className="text-sm">
          No Google Client ID configured. Add your OAuth Web Client ID in
          <code className="mx-1 rounded bg-[var(--bg-elev)] px-1">src/services/google/secret.ts</code>
          (or Settings) and reload.
        </p>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-md px-8 py-16 text-center">
        <h2 className="mb-3 text-lg font-semibold">{title}</h2>
        <button
          className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm text-black"
          onClick={connect}
        >
          Connect Google account
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
