import { docToText } from "@/shared/lib/docText";
import { chatOnce } from "@/services/ai/deepseek";
import { useAI } from "@/features/ai/store";
import { useStatus } from "@/shared/stores/status";
import type { AIMessage } from "@/services/ai/types";
import type { Note } from "@/shared/lib/types";
import type { CalEvent } from "@/services/google/calendar";
import type { MailThread } from "@/services/google/gmail";
import { fmtDuration, type AiReadiness } from "@/features/home/deepwork/deepworkStore";

export interface ReadinessMaterials {
  notes: Note[];
  events: CalEvent[];
  emails: MailThread[];
  focusMs: number;
  sessions: number;
}

function clip(text: string, max: number): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function buildMaterials(m: ReadinessMaterials): string {
  const sections: string[] = [];
  if (m.notes.length) {
    sections.push(
      "NOTES:\n" +
        m.notes.map((note) => `- ${note.title || "Untitled"}: ${clip(docToText(note.content), 500) || "(empty)"}`).join("\n")
    );
  }
  if (m.events.length) {
    sections.push(
      "CALENDAR EVENTS:\n" +
        m.events.map((event) => `- ${event.summary} (${event.start})${event.description ? ` — ${clip(event.description, 200)}` : ""}`).join("\n")
    );
  }
  if (m.emails.length) {
    sections.push("EMAILS:\n" + m.emails.map((thread) => `- ${thread.subject}: ${clip(thread.snippet, 200)}`).join("\n"));
  }
  return sections.join("\n\n") || "(no items added yet)";
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("No JSON in response");
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Ask the model how ready the user is to accomplish their stated intent, based on
 * the items they've added to the Deep Work canvas and the time invested.
 */
export async function assessReadiness(
  intent: string,
  materials: ReadinessMaterials,
  signal?: AbortSignal
): Promise<AiReadiness> {
  const model = useAI.getState().model;
  const messages: AIMessage[] = [
    {
      role: "system",
      content:
        "You are a focus coach. Given the user's goal and the materials they've gathered (notes, events, emails) plus how much they've worked, judge how READY they are to accomplish the goal. " +
        'Respond with ONLY compact JSON, no prose, no code fences: {"percent": <integer 0-100>, "summary": "<one short sentence>", "next": ["<concrete next step>", ...up to 4]}. ' +
        "Base percent on coverage of the material, depth of the notes, and time invested. Be honest — low if little has been done.",
    },
    {
      role: "user",
      content:
        `Goal: ${intent}\n` +
        `Work so far: ${fmtDuration(materials.focusMs)} focused across ${materials.sessions} session(s).\n\n` +
        `Gathered materials:\n${buildMaterials(materials)}`,
    },
  ];

  useStatus.getState().set({ ai: "busy" });
  try {
    const reply = await chatOnce(messages, model, [], signal);
    const parsed = extractJson(reply.content ?? "") as { percent?: unknown; summary?: unknown; next?: unknown };

    const percent = Math.max(0, Math.min(100, Math.round(Number(parsed.percent) || 0)));
    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    const next = Array.isArray(parsed.next) ? parsed.next.filter((s): s is string => typeof s === "string").slice(0, 4) : [];

    useStatus.getState().set({ ai: "idle" });
    return { percent, summary, next, assessedAt: Date.now() };
  } catch (e) {
    useStatus.getState().set({ ai: "error" });
    throw e;
  }
}
