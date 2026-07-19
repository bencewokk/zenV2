import { createHash, randomUUID } from "node:crypto";
import type { Collection } from "mongodb";
import { getDb, syncCollection, type SyncRecord } from "./db.js";
import { persistReceipt, updateRoutine, type AssistantRoutine } from "./assistantData.js";
import { googleAccessTokenForUser } from "./assistantGoogleOffline.js";
import { sendAssistantPush } from "./assistantPush.js";
import { routineDueOccurrence, nextRoutineRunAt, type RoutineOccurrence } from "./assistantSchedule.js";
import { runAssistant } from "./assistant.js";
import type { AssistantActionReceipt } from "./assistantTypes.js";

type RoutineRunRecord = {
  key: string;
  userId: string;
  routineId: string;
  occurrenceKey: string;
  scheduledAt: Date;
  status: "running" | "done" | "error";
  attempts: number;
  createdAt: Date;
  startedAt: Date;
  completedAt?: Date;
  lockExpiresAt: Date;
  nextRetryAt?: Date;
  conversationId?: string;
  result?: string;
  error?: string;
};

export type RoutineRunSummary = {
  scanned: number;
  due: number;
  claimed: number;
  completed: number;
  failed: number;
};

let runIndexesPromise: Promise<void> | null = null;

async function ensureRunIndexes(collection: Collection<RoutineRunRecord>): Promise<void> {
  let uniqueFailure: { error: unknown } | undefined;
  await Promise.all([
    // This is the occurrence claim guard: without it, two schedulers can run
    // the same routine occurrence concurrently.
    collection.createIndex({ key: 1 }, { unique: true })
      .catch((error: unknown) => { uniqueFailure = { error }; }),
    // These only affect query cost and retention.
    collection.createIndex({ userId: 1, startedAt: -1 }).catch(() => {}),
    collection.createIndex({ status: 1, nextRetryAt: 1 }).catch(() => {}),
    collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 }).catch(() => {}),
  ]);
  if (uniqueFailure) throw uniqueFailure.error;
}

export async function runsCollection() {
  const collection = (await getDb()).collection<RoutineRunRecord>("assistant_routine_runs");
  const indexes = runIndexesPromise ??= ensureRunIndexes(collection);
  try {
    await indexes;
  } catch (error) {
    if (runIndexesPromise === indexes) runIndexesPromise = null;
    throw error;
  }
  return collection;
}

function runKey(userId: string, routineId: string, occurrenceKey: string): string {
  return createHash("sha256").update(`${userId}\0${routineId}\0${occurrenceKey}`).digest("hex");
}

async function claimRoutineRun(userId: string, routine: AssistantRoutine, occurrence: RoutineOccurrence): Promise<RoutineRunRecord | null> {
  const now = new Date();
  const key = runKey(userId, routine.id, occurrence.key);
  try {
    return await (await runsCollection()).findOneAndUpdate(
      {
        key,
        $or: [
          { status: { $exists: false } },
          { status: "error", nextRetryAt: { $lte: now }, attempts: { $lt: 3 } },
          { status: "running", lockExpiresAt: { $lte: now } },
        ],
      },
      {
        $setOnInsert: {
          key,
          userId,
          routineId: routine.id,
          occurrenceKey: occurrence.key,
          scheduledAt: new Date(occurrence.scheduledAt),
          createdAt: now,
        },
        $set: { status: "running", startedAt: now, lockExpiresAt: new Date(now.getTime() + 2 * 60_000) },
        $inc: { attempts: 1 },
        $unset: { error: "", nextRetryAt: "" },
      },
      { upsert: true, returnDocument: "after" },
    );
  } catch (error) {
    if (Number((error as { code?: number }).code) === 11000) return null;
    throw error;
  }
}

function routineFromRecord(record: SyncRecord): AssistantRoutine | null {
  const routine = record.data as AssistantRoutine | null;
  return routine && routine.id && routine.prompt && routine.schedule ? routine : null;
}

function conversationIdFor(routine: AssistantRoutine, occurrence: RoutineOccurrence): string {
  return `routine-${routine.id}-${createHash("sha1").update(occurrence.key).digest("hex").slice(0, 12)}`;
}

async function routineReceipt(userId: string, routine: AssistantRoutine, status: "done" | "error", label: string): Promise<void> {
  const receipt: AssistantActionReceipt = {
    id: randomUUID(),
    tool: "routine_run",
    label,
    status,
    createdAt: new Date().toISOString(),
    undoable: false,
  };
  await persistReceipt(userId, receipt);
}

async function executeRoutine(userId: string, routine: AssistantRoutine, occurrence: RoutineOccurrence, run: RoutineRunRecord): Promise<void> {
  const conversationId = conversationIdFor(routine, occurrence);
  try {
    const googleAccessToken = await googleAccessTokenForUser(userId).catch(() => undefined);
    const response = await runAssistant({
      messages: [{ id: `${conversationId}-prompt`, role: "user", text: routine.prompt }],
      googleAccessToken,
      conversationId,
      conversationTitle: routine.title,
      requestId: run.key,
      timezone: routine.schedule.timezone || "UTC",
    }, userId);
    const toolError = response.audit.find((event) => event.type === "error");
    if (toolError) throw new Error(toolError.label);

    const completedAt = new Date();
    const enabled = routine.schedule.kind !== "once";
    const updated: AssistantRoutine = { ...routine, enabled, lastRunAt: completedAt.toISOString() };
    await updateRoutine(userId, routine.id, {
      enabled,
      lastRunAt: updated.lastRunAt,
      nextRunAt: nextRoutineRunAt(updated, completedAt),
      lastStatus: "done",
      lastResult: response.message.text.slice(0, 1000),
      lastError: undefined,
    });
    await (await runsCollection()).updateOne({ key: run.key }, {
      $set: { status: "done", completedAt, conversationId, result: response.message.text.slice(0, 2000) },
      $unset: { error: "", nextRetryAt: "" },
    });
    await routineReceipt(userId, routine, "done", `Ran routine: ${routine.title}`);
    await sendAssistantPush(userId, {
      title: routine.title,
      body: response.message.text.slice(0, 220),
      url: `/?conversation=${encodeURIComponent(conversationId)}`,
      tag: `zen-routine-${routine.id}`,
      routineId: routine.id,
      conversationId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Routine execution failed.";
    const completedAt = new Date();
    await (await runsCollection()).updateOne({ key: run.key }, {
      $set: {
        status: "error",
        completedAt,
        error: message.slice(0, 1000),
        nextRetryAt: new Date(completedAt.getTime() + 15 * 60_000),
      },
    });
    await updateRoutine(userId, routine.id, { lastStatus: "error", lastError: message.slice(0, 500) });
    await routineReceipt(userId, routine, "error", `Routine needs attention: ${routine.title}`);
    await sendAssistantPush(userId, {
      title: `${routine.title} needs attention`,
      body: message.slice(0, 220),
      url: "/",
      tag: `zen-routine-${routine.id}-error`,
      routineId: routine.id,
    });
    throw error;
  }
}

export async function runDueAssistantRoutines(options: { userId?: string; limit?: number; timeBudgetMs?: number } = {}): Promise<RoutineRunSummary> {
  const limit = Math.min(8, Math.max(1, options.limit ?? 4));
  const deadline = Date.now() + Math.min(50_000, Math.max(5_000, options.timeBudgetMs ?? 45_000));
  const query: Record<string, unknown> = { deleted: false, "data.enabled": true };
  if (options.userId) query.userId = options.userId;
  const collection = await syncCollection("assistantRoutines");
  await collection.createIndex({ "data.enabled": 1, "data.nextRunAt": 1 }).catch(() => {});
  const records = await collection.find(query).sort({ "data.nextRunAt": 1, updatedAt: 1 }).limit(200).toArray();
  const summary: RoutineRunSummary = { scanned: records.length, due: 0, claimed: 0, completed: 0, failed: 0 };

  for (const record of records) {
    if (summary.claimed >= limit || Date.now() >= deadline) break;
    const routine = routineFromRecord(record);
    if (!routine) continue;
    const occurrence = routineDueOccurrence(routine);
    if (!occurrence) continue;
    summary.due += 1;
    const run = await claimRoutineRun(record.userId, routine, occurrence);
    if (!run) continue;
    summary.claimed += 1;
    try {
      await executeRoutine(record.userId, routine, occurrence, run);
      summary.completed += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

export async function latestRoutineRun(userId: string): Promise<Pick<RoutineRunRecord, "status" | "startedAt" | "completedAt" | "result" | "error"> | null> {
  return (await runsCollection()).findOne(
    { userId },
    { sort: { startedAt: -1 }, projection: { status: 1, startedAt: 1, completedAt: 1, result: 1, error: 1 } },
  );
}
