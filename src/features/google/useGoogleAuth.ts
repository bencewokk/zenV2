import { useEffect, useState } from "react";
import { isConfigured, isSignedIn, onAuthChange, signIn, signOut } from "@/services/google/auth";
import { notify } from "@/shared/ui/notify";
import { useStatus } from "@/shared/stores/status";

export function useGoogleAuth() {
  const [signedIn, setSignedIn] = useState(isSignedIn());
  const [configured] = useState(isConfigured());
  const setStatus = useStatus((s) => s.set);

  useEffect(() => onAuthChange(setSignedIn), []);
  useEffect(() => {
    setStatus({ calendar: signedIn ? "on" : "off" });
  }, [signedIn, setStatus]);

  async function connect() {
    try {
      setStatus({ calendar: "connecting" });
      await signIn();
      notify.success("Connected to Google");
    } catch (e) {
      setStatus({ calendar: "error" });
      notify.error((e as Error).message || "Google sign-in failed");
    }
  }

  return { signedIn, configured, connect, disconnect: signOut };
}
