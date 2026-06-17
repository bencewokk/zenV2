import { create } from "zustand";
import type { AIMessage } from "@/services/ai/types";
import { deepseek, chatOnce } from "@/services/ai/deepseek";
import { TOOL_DEFS, runTool, CONFIRM_TOOLS } from "@/services/ai/tools";
import { loadSettings } from "@/services/ai/settings";
import { memoryContext, recordActivity, recall, formatRecall } from "@/services/memory";
import { useNotes } from "@/features/notes/store";
import { useStatus } from "@/shared/stores/status";
import { notify } from "@/shared/ui/notify";

export interface ChatTurn {
  role: "user" | "assistant" | "tool";
  content: string;
}

const MAX_TOOL_STEPS = 8;

// Holds the resolver while we wait for the user to approve/deny a tool call.
let confirmResolver: ((ok: boolean) => void) | null = null;

interface AIState {
  open: boolean;
  turns: ChatTurn[];
  streaming: boolean;
  model: string;
  models: string[];
  controller: AbortController | null;
  pendingConfirm: { name: string; args: string } | null;

  toggle: () => void;
  answerConfirm: (ok: boolean) => void;
  setModel: (m: string) => void;
  refreshModels: () => Promise<void>;
  send: (userText: string, noteContext?: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
  /** One-shot completion for inline actions; returns the full text. */
  complete: (instruction: string, text: string) => Promise<string>;
}

const SYSTEM = (ctx?: string): AIMessage => ({
  role: "system",
  content:
    "You are Zen's built-in assistant. Be concise and helpful. Format replies in Markdown. " +
    "You can act on the user's notes, Google Calendar, and Gmail using the provided tools — " +
    "use them when the request calls for it (searching/creating/opening notes, reading or " +
    "creating events, searching/reading/drafting mail). Use ISO 8601 for event times. " +
    "To reschedule or remove an event/note, first list/search to get its [id:...], then call " +
    "update_event/delete_event (or move/delete note) with that id — never recreate a duplicate. " +
    "When the user tells you a durable fact about themselves or a preference, save it with " +
    "update_profile (about them / how to work) or save_memory (any other fact). Don't ask " +
    "permission to remember — just do it and mention briefly that you saved it. " +
    "Today is " + new Date().toString() + "." +
    memoryContext() +
    (ctx ? `\n\nThe user's current note (for context):\n"""\n${ctx.slice(0, 6000)}\n"""` : ""),
});

export const useAI = create<AIState>((set, get) => ({
  open: false,
  turns: [],
  streaming: false,
  model: loadSettings().model,
  models: [],
  controller: null,
  pendingConfirm: null,

  toggle() {
    set((s) => ({ open: !s.open }));
  },

  answerConfirm(ok) {
    confirmResolver?.(ok);
    confirmResolver = null;
    set({ pendingConfirm: null });
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

    // Build the running message list from prior user/assistant turns.
    const history = get().turns.filter((t) => t.role !== "tool");
    const messages: AIMessage[] = [
      SYSTEM(noteContext),
      ...history.map((t) => ({ role: t.role as "user" | "assistant", content: t.content })),
      { role: "user", content: userText },
    ];

    const controller = new AbortController();
    recordActivity(`asked AI: "${userText.slice(0, 80)}"`);
    set((s) => ({
      turns: [...s.turns, { role: "user", content: userText }],
      streaming: true,
      controller,
    }));
    useStatus.getState().set({ ai: "busy" });

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

    try {
      // Agent loop: call model → run any tool calls → feed results back → repeat.
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        const reply = await chatOnce(messages, get().model, TOOL_DEFS, controller.signal);

        if (reply.tool_calls?.length) {
          messages.push({ role: "assistant", content: reply.content ?? "", tool_calls: reply.tool_calls });
          for (const call of reply.tool_calls) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* bad json */ }
            set((s) => ({
              turns: [...s.turns, { role: "tool", content: `${call.function.name}(${call.function.arguments || ""})` }],
            }));

            let result: string;
            if (CONFIRM_TOOLS.has(call.function.name)) {
              const approved = await new Promise<boolean>((resolve) => {
                confirmResolver = resolve;
                set({ pendingConfirm: { name: call.function.name, args: call.function.arguments || "" } });
              });
              result = approved
                ? await runTool(call.function.name, args)
                : "The user declined this action. Do not retry it.";
            } else {
              result = await runTool(call.function.name, args);
            }
            messages.push({ role: "tool", tool_call_id: call.id, content: result });
          }
          continue; // let the model use the tool results
        }

        // Final answer.
        set((s) => ({ turns: [...s.turns, { role: "assistant", content: reply.content ?? "" }] }));
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
    }
  },

  stop() {
    get().controller?.abort();
    if (confirmResolver) { confirmResolver(false); confirmResolver = null; }
    set({ streaming: false, pendingConfirm: null });
  },

  clear() {
    set({ turns: [] });
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
}));
