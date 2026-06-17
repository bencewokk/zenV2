/**
 * Persistent "memory files" — discrete facts the agent (or user) saves about
 * anything. Always injected into the system prompt and curatable in the UI.
 * This is the agent's long-term, self-managed memory.
 */
export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  category: string; // free-form, e.g. "preference", "project", "person"
  updatedAt: number;
}

const KEY = "zen.memory.entries.v1";
const INJECT_BUDGET = 4000; // chars of memory injected into the prompt

let seq = 0;
function genId(): string {
  return `m${Date.now().toString(36)}_${seq++}`;
}

export function loadMemories(): MemoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as MemoryEntry[];
  } catch {
    /* ignore */
  }
  return [];
}

function writeMemories(list: MemoryEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

/** Create or update by case-insensitive title. Returns the entry. */
export function saveMemory(title: string, content: string, category = "general"): MemoryEntry {
  const list = loadMemories();
  const existing = list.find((m) => m.title.toLowerCase() === title.toLowerCase());
  if (existing) {
    existing.content = content;
    existing.category = category || existing.category;
    existing.updatedAt = Date.now();
    writeMemories(list);
    return existing;
  }
  const entry: MemoryEntry = { id: genId(), title, content, category, updatedAt: Date.now() };
  list.push(entry);
  writeMemories(list);
  return entry;
}

export function updateMemory(id: string, fields: Partial<Pick<MemoryEntry, "title" | "content" | "category">>): boolean {
  const list = loadMemories();
  const m = list.find((x) => x.id === id);
  if (!m) return false;
  Object.assign(m, fields, { updatedAt: Date.now() });
  writeMemories(list);
  return true;
}

export function deleteMemory(id: string): void {
  writeMemories(loadMemories().filter((m) => m.id !== id));
}

/** Compact block of saved memories for system-prompt injection. */
export function memoriesBlock(): string {
  const list = loadMemories().sort((a, b) => b.updatedAt - a.updatedAt);
  if (!list.length) return "";
  const lines: string[] = [];
  let used = 0;
  for (const m of list) {
    const line = `- (${m.category}) ${m.title}: ${m.content}`;
    if (used + line.length > INJECT_BUDGET) break;
    lines.push(line);
    used += line.length;
  }
  return `\n\nSaved memories about the user (persistent — keep up to date via memory tools):\n${lines.join("\n")}`;
}
