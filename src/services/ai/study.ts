import { useAI } from "@/features/ai/store";
import { useDeepWork, type StudyConcept } from "@/features/home/deepwork/deepworkStore";
import { useQuiz, sessionMistakes } from "@/features/home/deepwork/quizStore";
import { useFocusStore } from "@/features/home/deepwork/useFocusSession";
import { useStudyLog } from "@/features/home/deepwork/studyLog";
import { planHealth, KIND_META, type PlannedSession } from "@/features/home/deepwork/studyPlan";

/**
 * Study actions, as structured requests.
 *
 * The Study panel's buttons used to compose loose English and drop it into the chat —
 * "Plan my study week for this Deep Work material. Check my plan status and free time,
 * ask me for my exam date if you don't know it, then build an adaptive study plan."
 * That made every action a multi-turn conversation whose first step was the model
 * re-fetching state the UI already had, and whose outcome depended on the model choosing
 * to call the right tools in the right order.
 *
 * Each function here resolves the local state first — mistake bank, plan health, weak
 * concepts, exam date — and hands the model a single job with the facts already in hand.
 * The tools in `tools.ts` are unchanged and still available to the model; this only stops
 * the UI from asking for work in prose.
 */

/** Send a request, opening the panel so the user can see it run. */
function ask(prompt: string): void {
  const ai = useAI.getState();
  ai.setOpen(true);
  void ai.send(prompt);
}

/** Compact, factual plan state for the model — the same numbers the panel is showing. */
function planStatusBlock(): string {
  const dw = useDeepWork.getState();
  const backbone = dw.backbone;
  if (!backbone?.concepts.length) return "No study backbone yet.";

  const now = Date.now();
  const h = planHealth(dw.plan ?? null, backbone, now);
  const weak = backbone.concepts
    .slice()
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 6)
    .map((c) => `${c.title} (${c.mastery}%)`)
    .join(", ");
  const dailyTargetMin = dw.plan?.dailyTargetMin ?? useStudyLog.getState().goalHours * 60;

  return [
    `Goal: ${dw.plan?.goal || dw.intent || backbone.intent || "(none set)"}`,
    dw.plan?.examDate ? `Exam date: ${dw.plan.examDate} (${h.daysLeft} days away)` : `No exam date; ${h.daysLeft}-day horizon`,
    `Readiness ${h.effectiveReadiness}% (evidence coverage ${h.evidenceCoverage}%), projected ${h.projectedReadiness}%`,
    `Time: ~${h.requiredMin} min needed, ${h.plannedRemainingMin} min booked, ${h.availableMin} min capacity, ${dailyTargetMin} min/day budget`,
    h.missedCount ? `Missed sessions: ${h.missedCount}` : "",
    `Status: ${h.verdict}`,
    `Weakest concepts: ${weak}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Quiz the user on one concept, with its summary so questions are grounded. */
export function drillConcept(concept: StudyConcept | string): void {
  const c = typeof concept === "string" ? null : concept;
  const title = typeof concept === "string" ? concept : concept.title;
  const summary = c?.summary ? `\nWhat it covers: ${c.summary}` : "";
  const subs = c?.subs?.length
    ? `\nSub-skills and current mastery: ${c.subs.map((s) => `${s.title} ${s.mastery}%`).join(", ")}`
    : "";

  ask(
    `Quiz me on "${title}" from my Deep Work material.${summary}${subs}\n\n` +
      `Call deepwork_start_quiz with a few focused questions on this concept, each tagged with ` +
      `its concept${c?.subs?.length ? " and sub-skill" : ""} and an answer key so it grades instantly.`
  );
}

/**
 * Re-test only previously-missed questions.
 *
 * The mistake bank is local, so it is passed in rather than described. Returns false when
 * there is nothing to re-quiz, so the caller can stay silent instead of sending a request
 * the model can only answer with "you have no mistakes".
 */
export function requizMistakes(): boolean {
  const { quizzes, order } = useQuiz.getState();
  const sessionId = useDeepWork.getState().activeId;
  const mistakes = sessionMistakes({ quizzes, order }, sessionId);
  if (!mistakes.length) return false;

  const list = mistakes
    .map((m, i) => `${i + 1}. [${m.concept ?? "general"}] ${m.prompt}\n   my answer: ${m.myAnswer} (${m.verdict})`)
    .join("\n");

  ask(
    `Re-quiz me on exactly these questions I got wrong before — reworded, not identical:\n\n${list}\n\n` +
      `Call deepwork_start_quiz with one question per item above, each tagged with its concept and an answer key.`
  );
  return true;
}

/** Build the week's study plan. The exam date comes from the UI, not a chat round-trip. */
export function planWeek(examDate: string | null): void {
  ask(
    `Build my study plan for this Deep Work material.\n\n${planStatusBlock()}\n` +
      (examDate ? `Exam date: ${examDate}` : "No exam date — plan over a sensible horizon.") +
      `\n\nCall deepwork_set_plan with one entry per study block, weighting the weakest concepts ` +
      `and the days remaining. Check my calendar for free time first.`
  );
}

/** Revise an existing plan against current progress. */
export function replan(): void {
  ask(
    `My study plan needs adjusting. Current state:\n\n${planStatusBlock()}\n\n` +
      `Call deepwork_revise_plan: add sessions for weak or missed concepts, shorten or drop ones ` +
      `I've mastered, and reschedule missed time.`
  );
}

/**
 * Start a planned block: run the timer and credit this row, then ask for the session's
 * content. The timer half is fully deterministic — only the teaching needs the model.
 */
export function startPlanSession(s: PlannedSession): void {
  const focusStore = useFocusStore.getState();
  // Credit any in-progress block before overwriting it, then mark THIS row as the one
  // being studied so focus time credits it (not just today's earliest).
  if (focusStore.session) focusStore.endSession();
  useDeepWork.getState().setActivePlanSession(s.id);
  focusStore.startSession(s.durationMin);

  const focus = s.focus.length ? s.focus.join(", ") : "this material";
  const meta = KIND_META[s.kind];
  ask(
    s.kind === "quiz"
      ? `Start a quiz on ${focus} from my Deep Work material. Call deepwork_start_quiz.`
      : `Tutor me on ${focus} from my Deep Work material — a ${s.durationMin}-minute ${meta.label.toLowerCase()} session.`
  );
}

/**
 * Find and prepare everything worth reading before a quiz.
 *
 * Deliberately left open-ended: unlike the others, there is no local answer to resolve —
 * deciding what is worth reading, and writing a note where one is missing, is the model's
 * judgement call.
 */
export function prepReading(): void {
  ask(
    "Before I take a quiz, prep my reading: find every note and PDF I should read for this Deep Work " +
      "material, pull the relevant ones onto the canvas, and for any backbone concept that has no note, " +
      "create a concise study note (grounded in the material) and add it too. Then give me a short reading checklist."
  );
}
