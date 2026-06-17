import { useEffect, useRef, useState } from "react";
import { notify } from "@/shared/ui/notify";

const FOCUS_SESSION_KEY = "zen.focus.session.v1";

export interface FocusSession {
  startedAt: number;
  durationMin: number;
}

function readSession(): FocusSession | null {
  try {
    const raw = localStorage.getItem(FOCUS_SESSION_KEY);
    if (raw) return JSON.parse(raw) as FocusSession;
  } catch {
    /* ignore */
  }
  return null;
}

function writeSession(session: FocusSession | null) {
  try {
    if (session) localStorage.setItem(FOCUS_SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(FOCUS_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export interface FocusSessionApi {
  session: FocusSession | null;
  sessionActive: boolean;
  sessionRemaining: number;
  sessionProgress: number;
  startSession: (durationMin: number) => void;
  endSession: () => void;
}

/**
 * Owns the timed focus session: localStorage persistence, the 1s countdown
 * ticker, and the one-shot "time's up" toast. Behaviour mirrors the original
 * inline implementation in Home.tsx.
 */
export function useFocusSession(): FocusSessionApi {
  const [session, setSession] = useState<FocusSession | null>(() => readSession());
  const [, setTick] = useState(0);
  const completedRef = useRef(false);

  const sessionTotal = session ? session.durationMin * 60000 : 0;
  const sessionElapsed = session ? Date.now() - session.startedAt : 0;
  const sessionRemaining = Math.max(0, sessionTotal - sessionElapsed);
  const sessionProgress = sessionTotal ? Math.min(100, (sessionElapsed / sessionTotal) * 100) : 0;
  const sessionFinished = !!session && sessionRemaining <= 0;

  // 1s ticker for the live countdown — stops once the block is finished.
  useEffect(() => {
    if (!session || sessionFinished) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [session, sessionFinished]);

  // Fire once when the timer reaches zero.
  useEffect(() => {
    if (!session) {
      completedRef.current = false;
      return;
    }
    if (sessionFinished && !completedRef.current) {
      completedRef.current = true;
      notify.success("Focus session complete — time's up");
    }
  }, [session, sessionFinished]);

  function startSession(durationMin: number) {
    const next: FocusSession = { startedAt: Date.now(), durationMin };
    completedRef.current = false;
    writeSession(next);
    setSession(next);
    notify.success(`Focus session started · ${durationMin}m`);
  }

  function endSession() {
    writeSession(null);
    setSession(null);
  }

  return {
    session,
    sessionActive: !!session,
    sessionRemaining,
    sessionProgress,
    startSession,
    endSession,
  };
}
