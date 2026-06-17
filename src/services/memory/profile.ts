/**
 * Layer 1 — Persistent profile memory (static).
 * A small set of baseline facts/preferences injected into every AI request
 * so the model never forgets who the user is or how they like things done.
 */
export interface Profile {
  name: string;
  about: string; // role, expertise, context
  stack: string; // tools / languages / domains
  preferences: string; // "always do X", formatting, tone
}

const KEY = "zen.memory.profile.v1";

const EMPTY: Profile = { name: "", about: "", stack: "", preferences: "" };

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...EMPTY };
}

export function saveProfile(p: Profile): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

/** Merge a partial update into the stored profile (used by the AI tool). */
export function updateProfile(fields: Partial<Profile>): Profile {
  const next = { ...loadProfile(), ...fields };
  saveProfile(next);
  return next;
}

/** Markdown block for system-prompt injection, or "" if profile is empty. */
export function profileBlock(): string {
  const p = loadProfile();
  const lines: string[] = [];
  if (p.name) lines.push(`Name: ${p.name}`);
  if (p.about) lines.push(`About: ${p.about}`);
  if (p.stack) lines.push(`Stack/domains: ${p.stack}`);
  if (p.preferences) lines.push(`Preferences: ${p.preferences}`);
  if (!lines.length) return "";
  return `\n\nUser profile (persistent — always honor):\n${lines.join("\n")}`;
}
