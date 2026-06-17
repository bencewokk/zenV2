/**
 * Layer 2 — Episodic session memory (volatile).
 * A rolling buffer of the user's recent actions, giving the AI situational
 * awareness of the current stream of work. In-memory only: clears on refresh.
 */
export interface Activity {
  at: number;
  text: string; // human-readable, e.g. "opened note 'Queueing Theory'"
}

const MAX = 15;
const buffer: Activity[] = [];

let lastText = "";
export function recordActivity(text: string): void {
  if (!text || text === lastText) return; // dedupe consecutive repeats
  lastText = text;
  buffer.push({ at: Date.now(), text });
  if (buffer.length > MAX) buffer.shift();
}

export function recentActivities(): Activity[] {
  return buffer.slice();
}

/** Compact block for system-prompt injection, newest last. */
export function episodicBlock(): string {
  if (!buffer.length) return "";
  const lines = buffer.map((a) => `- ${a.text}`);
  return `\n\nRecent activity this session (newest last):\n${lines.join("\n")}`;
}
