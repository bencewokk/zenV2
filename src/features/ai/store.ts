import { create } from "zustand";
import type { AIMessage } from "@/services/ai/types";
import { deepseek, streamChatWithTools, chatOnce, type AssistantReply, type Usage } from "@/services/ai/deepseek";
import { TOOL_DEFS, runTool, isReadTool, isAutoTool, describeToolCall, parseToolArgs } from "@/services/ai/tools";
import { policyFor } from "@/services/ai/toolPolicy";
import { loadSettings } from "@/services/ai/settings";
import { memoryContext, recordActivity, recall, formatRecall } from "@/services/memory";
import { useNotes } from "@/features/notes/store";
import { useStatus } from "@/shared/stores/status";
import { notify } from "@/shared/ui/notify";

export interface ChatTurn {
  role: "user" | "assistant" | "tool";
  content: string;
}

/** A mutating tool call the assistant suggests; the user runs or dismisses it. */
export interface Proposal {
  id: string;
  name: string;
  args: Record<string, unknown>;
  title: string;
  detail: string;
  danger: boolean;
  status: "pending" | "running" | "done" | "error" | "dismissed";
  result?: string;
}

export interface PendingQuestion {
  question: string;
  options: string[];
}

export interface Conversation {
  id: string;
  title: string;
  turns: ChatTurn[];
  createdAt: number;
  updatedAt: number;
  /** Cumulative token usage for this conversation (best-effort, from API responses). */
  promptTokens?: number;
  completionTokens?: number;
}

/** One retry on a thrown tool call, then surface the failure as a tool result
 *  (instead of aborting the whole agent loop) so the model can adapt. */
async function runToolSafe(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    return await runTool(name, args);
  } catch {
    try {
      return await runTool(name, args);
    } catch (e2) {
      return `Tool "${name}" failed twice: ${(e2 as Error).message || "unknown error"}. Try a different approach or ask the user.`;
    }
  }
}

const CONV_KEY = "zen.ai.conversations.v1";
const OPEN_KEY = "zen.ai.open.v1";

function readOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; }
}

// Holds the resolver while we wait for the user to answer an ask_user question.
let questionResolver: ((choice: string) => void) | null = null;

function newConv(): Conversation {
  return { id: crypto.randomUUID(), title: "New chat", turns: [], createdAt: Date.now(), updatedAt: Date.now() };
}

function readConversations(): { conversations: Conversation[]; activeId: string } {
  try {
    const raw = localStorage.getItem(CONV_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { conversations: Conversation[]; activeId: string };
      if (Array.isArray(parsed.conversations) && parsed.conversations.length) {
        const activeId = parsed.conversations.some((c) => c.id === parsed.activeId)
          ? parsed.activeId
          : parsed.conversations[0].id;
        return { conversations: parsed.conversations, activeId };
      }
    }
  } catch { /* ignore */ }
  const first = newConv();
  return { conversations: [first], activeId: first.id };
}

function titleFrom(turns: ChatTurn[]): string {
  const firstUser = turns.find((t) => t.role === "user");
  if (!firstUser) return "New chat";
  return firstUser.content.slice(0, 40).trim() + (firstUser.content.length > 40 ? "…" : "");
}

interface AIState {
  open: boolean;
  turns: ChatTurn[];
  streaming: boolean;
  model: string;
  models: string[];
  controller: AbortController | null;
  proposals: Proposal[];
  pendingQuestion: PendingQuestion | null;
  conversations: Conversation[];
  activeId: string;

  toggle: () => void;
  setModel: (m: string) => void;
  refreshModels: () => Promise<void>;
  send: (userText: string, noteContext?: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
  runProposal: (id: string) => Promise<void>;
  dismissProposal: (id: string) => void;
  answerQuestion: (choice: string) => void;
  newConversation: () => void;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  /** One-shot completion for inline actions; returns the full text. */
  complete: (instruction: string, text: string) => Promise<string>;
}

const SYSTEM = (ctx?: string): AIMessage => ({
  role: "system",
  content:
    "You are Zen's built-in assistant. Always respond in English, even if the user writes " +
    "in another language. Be concise and helpful. Format replies in Markdown. " +
    "Write ALL mathematics as LaTeX wrapped in $...$ for inline or $$...$$ for display math " +
    "(e.g. $\\frac{1}{x}$, $$\\int_0^1 x^2\\,dx$$) — never write bare LaTeX without $ delimiters " +
    "and never paste raw \\frac/\\int outside math delimiters. This applies in chat AND in notes. " +
    "You can act on the user's notes, Google Calendar, and Gmail using the provided tools — " +
    "use them when the request calls for it (searching/creating/opening notes, reading or " +
    "creating events, searching/reading/drafting mail). Use ISO 8601 for event times. " +
    "When the user asks you to create, change, move, delete, send, or otherwise ACT on something, " +
    "you MUST call the matching tool — do not just describe the action or claim it's done without " +
    "calling the tool. Pick the single most specific tool for the request. If you're missing an " +
    "[id:...] or another required argument, first call a search/list/read tool to get it, then call " +
    "the action tool. Some tools may apply immediately and others ask the user to confirm — either " +
    "way, issue the tool call and let the app handle gating; never invent results. " +
    "To reschedule or remove an event/note, first list/search to get its [id:...], then call " +
    "update_event/delete_event (or move/delete note) with that id — never recreate a duplicate. " +
    "When the user tells you a durable fact about themselves or a preference, save it with " +
    "update_profile (about them / how to work) or save_memory (any other fact). Don't ask " +
    "permission to remember — just do it and mention briefly that you saved it. " +
    "STUDY/TUTOR MODE: When the user wants to study, learn, or prepare for an exam using their " +
    "Deep Work material, first call deepwork_read_material to read everything they've gathered " +
    "(notes, full PDF text, their highlights, events, emails). Synthesize the key concepts into a " +
    "'backbone' and save it with deepwork_set_backbone (with the study goal/intent and each " +
    "concept's title + a 1-2 sentence summary). Then teach concept by concept, grounding " +
    "explanations in the actual material and the user's highlights. Quiz the user when they're " +
    "ready: use the ask_user tool for multiple-choice questions — put the FULL question text " +
    "(including any $...$ math) in the question field and the answer choices in options; do not " +
    "leave the real question only in your prose. Ask short-answer questions in plain text. " +
    "After informal tutoring, record progress " +
    "with deepwork_set_mastery (per-concept mastery 0-100 plus an overall readiness). " +
    "PREP BEFORE QUIZZING: when the user wants to prepare, find the notes/PDFs they should read for " +
    "each backbone concept (use recall/search). Pull the relevant ones onto the canvas with deepwork_add. " +
    "If a concept has NO note covering it, create a concise study note (create_note, grounded in the " +
    "material) and add it too — then give the user a short reading checklist. " +
    "FORMAL QUIZ: to run a real quiz, call deepwork_start_quiz with a set of questions (size it to the " +
    "material). Mix question kinds — 'choice' (MCQ A–D / true-false), 'text' (numerical, fill-in-the-blank, " +
    "short answer, written step-by-step, error analysis), 'math' (LaTeX working you then follow), 'order' " +
    "(arrange steps — provide `items` in the CORRECT order; the app shuffles them for the user), " +
    "'match' (match pairs). Tag each question with the `concept` it tests and a hidden " +
    "`rubric`. The user answers in a dedicated quiz surface; when they submit you'll receive their answers — " +
    "grade every question and call deepwork_grade_quiz with {id, verdict, score, feedback}, plus `strengths` " +
    "and `mistakes` summaries (stored with the quiz inside this study session, and read back via " +
    "deepwork_read_material so you can target weak spots in later quizzes). " +
    "Concept mastery updates automatically from the scores, so don't also call deepwork_set_mastery for a quiz. " +
    "Ask the user if they're ready to be evaluated before starting a quiz. " +
    "PDF TOOLING WHILE TEACHING: when you reference a PDF, call pdf_goto to scroll the user's viewer to " +
    "the exact page you're discussing. When a passage is important, highlight_pdf it and tag the `concept` " +
    "it supports plus a one-line `why` — these become concept→page links in the Study panel. When grading " +
    "a quiz question that came from a PDF, include pdfId + page in its result so the user can jump back to review. " +
    "IMPORTANT: Whenever you would offer the user choices, present a numbered/bulleted list of " +
    "options, ask which they'd prefer, or are unsure how to proceed, you MUST call the ask_user " +
    "tool with concise options instead of writing the options as plain text. Use ask_user " +
    "proactively for any 'which would you like / A or B / pick one' moment — never enumerate " +
    "options in prose. " +
    "Today is " + new Date().toString() + "." +
    memoryContext() +
    (ctx ? `\n\nThe user's current note (for context):\n"""\n${ctx.slice(0, 6000)}\n"""` : "") +
    (loadSettings().systemPromptExtra.trim() ? `\n\n${loadSettings().systemPromptExtra.trim()}` : ""),
});

const initialConv = readConversations();

export const useAI = create<AIState>((set, get) => {
  /**
   * Build the model's message list from conversation history. Past tool activity
   * (reads, applied writes, run/dismissed proposals) is surfaced as `[Tool activity]`
   * system notes so the model stays aware of what actually happened across turns —
   * otherwise it can't act on a tool it called earlier.
   */
  function buildMessages(noteContext?: string, userText?: string): AIMessage[] {
    const msgs: AIMessage[] = [SYSTEM(noteContext)];
    for (const t of get().turns) {
      if (t.role === "tool") msgs.push({ role: "system", content: `[Tool activity] ${t.content}` });
      else msgs.push({ role: t.role as "user" | "assistant", content: t.content });
    }
    if (userText) msgs.push({ role: "user", content: userText });
    return msgs;
  }

  /**
   * The agent loop: stream the model → run any tool calls → feed each result back
   * → repeat. Shared by send() and the post-proposal continuation. Owns the
   * streaming/usage/status lifecycle (resets `streaming` in finally).
   */
  async function runAgent(messages: AIMessage[], controller: AbortController): Promise<void> {
    const activeTools = TOOL_DEFS.filter((d) => policyFor(d.function.name) !== "off");
    const maxToolSteps = Math.max(1, loadSettings().maxToolSteps);
    const usage: Usage = { promptTokens: 0, completionTokens: 0 };
    try {
      for (let step = 0; step < maxToolSteps; step++) {
        set((s) => ({ turns: [...s.turns, { role: "assistant", content: "" }] }));
        const turnIndex = get().turns.length - 1;
        let acc = "";
        const gen = streamChatWithTools(messages, get().model, activeTools, controller.signal);
        let reply: AssistantReply;
        for (;;) {
          const next = await gen.next();
          if (next.done) {
            reply = next.value;
            if (reply.usage) {
              usage.promptTokens += reply.usage.promptTokens;
              usage.completionTokens += reply.usage.completionTokens;
            }
            break;
          }
          acc += next.value;
          set((s) => {
            const t = [...s.turns];
            if (t[turnIndex]) t[turnIndex] = { role: "assistant", content: acc };
            return { turns: t };
          });
        }

        if (reply.tool_calls?.length) {
          if (!acc.trim()) set((s) => ({ turns: s.turns.filter((_, i) => i !== turnIndex) }));
          messages.push({ role: "assistant", content: reply.content ?? "", tool_calls: reply.tool_calls });

          const reads = new Map<string, Promise<string>>();
          for (const call of reply.tool_calls) {
            if (call.function.name !== "ask_user" && isReadTool(call.function.name)) {
              reads.set(call.id, runToolSafe(call.function.name, parseToolArgs(call.function.arguments)));
            }
          }

          for (const call of reply.tool_calls) {
            const name = call.function.name;
            const args = parseToolArgs(call.function.arguments);

            let result: string;
            if (name === "ask_user") {
              const question = String(args.question ?? "").trim();
              const options = (Array.isArray(args.options) ? args.options.map(String) : typeof args.options === "string" ? [args.options] : [])
                .map((o) => o.trim())
                .filter(Boolean);
              if (!question && !options.length) {
                result = "ask_user received no question or options. Ask the user directly in plain text instead.";
              } else {
                const choice = await new Promise<string>((resolve) => {
                  questionResolver = resolve;
                  set({ pendingQuestion: { question: question || "Pick one:", options: options.length ? options : ["OK"] } });
                });
                set((s) => ({ turns: [...s.turns, { role: "tool", content: `${question || "Pick one:"} → ${choice}` }] }));
                result = `The user chose: ${choice}`;
              }
            } else if (isReadTool(name)) {
              set((s) => ({ turns: [...s.turns, { role: "tool", content: `🔎 ${describeToolCall(name, args).title}` }] }));
              result = await reads.get(call.id)!;
            } else if (isAutoTool(name)) {
              set((s) => ({ turns: [...s.turns, { role: "tool", content: `🔧 ${describeToolCall(name, args).title}` }] }));
              result = await runToolSafe(name, args);
            } else {
              const policy = policyFor(name);
              const desc = describeToolCall(name, args);
              if (policy === "off") {
                set((s) => ({ turns: [...s.turns, { role: "tool", content: `🚫 ${desc.title} (disabled)` }] }));
                result = `The user has disabled the "${name}" tool. Do not use it; tell the user it's turned off or find another way.`;
              } else if (policy === "auto") {
                set((s) => ({ turns: [...s.turns, { role: "tool", content: `🔧 ${desc.title}` }] }));
                result = await runToolSafe(name, args);
              } else {
                const id = crypto.randomUUID();
                set((s) => ({ proposals: [...s.proposals, { id, name, args, ...desc, status: "pending" }] }));
                result = `Proposed "${desc.title}: ${desc.detail}" to the user; awaiting their action. Do not assume it ran — you'll be told the outcome once they act.`;
              }
            }
            messages.push({ role: "tool", tool_call_id: call.id, content: result });
          }
          continue;
        }

        set((s) => {
          const t = [...s.turns];
          if (t[turnIndex]) t[turnIndex] = { role: "assistant", content: reply.content ?? acc };
          return { turns: t };
        });
        break;
      }
      useStatus.getState().set({ ai: "idle" });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        useStatus.getState().set({ ai: "idle" });
      } else {
        useStatus.getState().set({ ai: "error" });
        notify.error((e as Error).message || "AI request failed");
      }
    } finally {
      set({ streaming: false, controller: null });
      if (usage.promptTokens || usage.completionTokens) addUsageToActive(usage);
      syncActive();
      void nameConversation(get().activeId);
    }
  }

  /**
   * Once every proposed tool has resolved (run or dismissed), feed the outcomes
   * back to the model and let it continue — use returned ids, take the next step,
   * or confirm. This is what lets a gated tool's result reach the AI at all.
   */
  async function resumeAfterProposals(): Promise<void> {
    if (get().streaming) return;
    if (get().proposals.some((p) => p.status === "pending" || p.status === "running")) return;
    const controller = new AbortController();
    set({ streaming: true, controller });
    useStatus.getState().set({ ai: "busy" });
    const messages = buildMessages();
    messages.push({
      role: "system",
      content:
        "The action(s) you proposed have now been handled by the user (see the latest [Tool activity] entries — " +
        "some may have run, some may have been dismissed). Continue accordingly: use any returned ids/results to " +
        "take the next step, or briefly confirm what's done. Do not re-propose an action the user just ran or dismissed.",
    });
    await runAgent(messages, controller);
  }

  return {
  open: readOpen(),
  turns: initialConv.conversations.find((c) => c.id === initialConv.activeId)?.turns ?? [],
  streaming: false,
  model: loadSettings().model,
  models: [],
  controller: null,
  proposals: [],
  pendingQuestion: null,
  conversations: initialConv.conversations,
  activeId: initialConv.activeId,

  toggle() {
    const open = !get().open;
    set({ open });
    try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* ignore */ }
  },

  answerQuestion(choice) {
    questionResolver?.(choice);
    questionResolver = null;
    set({ pendingQuestion: null });
  },
  setModel(m) {
    set({ model: m });
  },

  async refreshModels() {
    const models = await deepseek.listModels();
    set((s) => ({ models, model: models.includes(s.model) ? s.model : models[0] ?? s.model }));
  },

  async send(userText, noteContext) {
    if (get().streaming || !userText.trim()) return;

    const controller = new AbortController();
    recordActivity(`asked AI: "${userText.slice(0, 80)}"`);
    set((s) => ({
      turns: [...s.turns, { role: "user", content: userText }],
      streaming: true,
      controller,
    }));
    useStatus.getState().set({ ai: "busy" });

    const messages = buildMessages(noteContext, userText);

    // Auto-inject relevant notes from memory (RAG) before the model runs, so it
    // has context without needing to call the recall tool itself.
    try {
      const hits = await recall(userText, useNotes.getState().notes, 5);
      if (hits.length) {
        messages.splice(1, 0, {
          role: "system",
          content:
            "Relevant notes from the user's memory (use if helpful, cite [id:...]):\n" + formatRecall(hits),
        });
      }
    } catch { /* memory unavailable — proceed without it */ }

    await runAgent(messages, controller);
  },

  stop() {
    get().controller?.abort();
    if (questionResolver) { questionResolver("(cancelled)"); questionResolver = null; }
    set({ streaming: false, pendingQuestion: null });
  },

  clear() {
    set({ turns: [], proposals: [] });
    syncActive();
  },

  newConversation() {
    syncActive();
    const conv = newConv();
    set((s) => ({ conversations: [...s.conversations, conv], activeId: conv.id, turns: [], proposals: [] }));
    syncActive();
  },

  switchConversation(id) {
    syncActive();
    const target = get().conversations.find((c) => c.id === id);
    if (!target) return;
    set({ activeId: id, turns: target.turns, proposals: [] });
    persistConversations(get().conversations, id);
  },

  deleteConversation(id) {
    let { conversations } = get();
    conversations = conversations.filter((c) => c.id !== id);
    if (!conversations.length) conversations = [newConv()];
    const activeId = get().activeId === id ? conversations[conversations.length - 1].id : get().activeId;
    const turns = conversations.find((c) => c.id === activeId)?.turns ?? [];
    set({ conversations, activeId, turns, proposals: [] });
    persistConversations(conversations, activeId);
  },

  async runProposal(id) {
    const p = get().proposals.find((x) => x.id === id);
    if (!p || p.status !== "pending") return;
    set((s) => ({ proposals: s.proposals.map((x) => (x.id === id ? { ...x, status: "running" } : x)) }));
    try {
      const result = await runTool(p.name, p.args);
      set((s) => ({
        proposals: s.proposals.map((x) => (x.id === id ? { ...x, status: "done", result } : x)),
        // Record the outcome so later turns have context.
        turns: [...s.turns, { role: "tool", content: `✓ ${p.title}: ${p.detail} — ${result}` }],
      }));
      syncActive();
    } catch (e) {
      const result = (e as Error).message || "failed";
      set((s) => ({
        proposals: s.proposals.map((x) => (x.id === id ? { ...x, status: "error", result } : x)),
        // Record the failure inline so the card can leave the bottom of the chat.
        turns: [...s.turns, { role: "tool", content: `✕ ${p.title}: ${p.detail} — ${result}` }],
      }));
      syncActive();
      notify.error(`${p.title} failed: ${result}`);
    }
    // Feed the outcome back to the model so it can take the next step / confirm.
    await resumeAfterProposals();
  },

  async dismissProposal(id) {
    const p = get().proposals.find((x) => x.id === id);
    set((s) => ({
      proposals: s.proposals.map((x) => (x.id === id ? { ...x, status: "dismissed" } : x)),
      // Record the decline so the model knows it was declined.
      turns: p ? [...s.turns, { role: "tool", content: `✕ ${p.title}: ${p.detail} — dismissed by user` }] : s.turns,
    }));
    if (p) syncActive();
    // Continue once nothing is left pending — so a "ran A, dismissed B" batch still
    // gets a single follow-up where the model reacts to both.
    await resumeAfterProposals();
  },

  async complete(instruction, text) {
    const controller = new AbortController();
    const messages: AIMessage[] = [
      {
        role: "system",
        content:
          "You transform text inline. Return ONLY the transformed text — no preamble, no explanation, no markdown fences.",
      },
      { role: "user", content: `${instruction}\n\n"""\n${text}\n"""` },
    ];
    useStatus.getState().set({ ai: "busy" });
    try {
      let out = "";
      for await (const chunk of deepseek.streamChat(messages, get().model, controller.signal)) {
        out += chunk;
      }
      useStatus.getState().set({ ai: "idle" });
      return out.trim();
    } catch (e) {
      useStatus.getState().set({ ai: "error" });
      notify.error((e as Error).message || "AI request failed");
      return text;
    }
  },
  };
});

function persistConversations(conversations: Conversation[], activeId: string): void {
  try {
    const max = Math.max(1, loadSettings().maxConversations);
    localStorage.setItem(CONV_KEY, JSON.stringify({ conversations: conversations.slice(-max), activeId }));
  } catch { /* ignore */ }
}

/** Add to the active conversation's cumulative token usage. */
function addUsageToActive(usage: Usage): void {
  const s = useAI.getState();
  const conversations = s.conversations.map((c) =>
    c.id === s.activeId
      ? { ...c, promptTokens: (c.promptTokens ?? 0) + usage.promptTokens, completionTokens: (c.completionTokens ?? 0) + usage.completionTokens }
      : c
  );
  useAI.setState({ conversations });
}

/** Fold the live `turns` back into the active conversation and persist. */
function syncActive(): void {
  const s = useAI.getState();
  const conversations = s.conversations.map((c) =>
    c.id === s.activeId ? { ...c, turns: s.turns, updatedAt: Date.now() } : c
  );
  useAI.setState({ conversations });
  persistConversations(conversations, s.activeId);
}

/** Have the model name a still-unnamed conversation from its first exchange. */
async function nameConversation(id: string): Promise<void> {
  const conv = useAI.getState().conversations.find((c) => c.id === id);
  if (!conv || conv.title !== "New chat") return;
  const firstUser = conv.turns.find((t) => t.role === "user")?.content ?? "";
  const firstAsst = conv.turns.find((t) => t.role === "assistant")?.content ?? "";
  if (!firstUser) return;
  // Fall back to a slice of the first message so it's never stuck on "New chat".
  let title = titleFrom(conv.turns);
  try {
    const reply = await chatOnce(
      [
        { role: "system", content: "Generate a concise 3-5 word title for this conversation. Reply with ONLY the title — no quotes, no trailing punctuation." },
        { role: "user", content: `User: ${firstUser}\nAssistant: ${firstAsst}`.slice(0, 1500) },
      ],
      useAI.getState().model,
      []
    );
    const ai = (reply.content ?? "").trim().replace(/^["']|["']$/g, "").slice(0, 50);
    if (ai) title = ai;
  } catch { /* keep the slice fallback */ }
  const conversations = useAI.getState().conversations.map((c) => (c.id === id && c.title === "New chat" ? { ...c, title } : c));
  useAI.setState({ conversations });
  persistConversations(conversations, useAI.getState().activeId);
}
