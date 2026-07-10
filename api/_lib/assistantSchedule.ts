import type { AssistantRoutine } from "./assistantData.js";

export type RoutineOccurrence = {
  key: string;
  scheduledAt: string;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekDay: number;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function safeTimezone(timezone?: string): string {
  const candidate = timezone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "UTC";
  }
}

function zonedParts(date: Date, timezone?: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone(timezone),
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "0";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    weekDay: DAY_NAMES.indexOf(value("weekday")),
  };
}

function localDate(base: ZonedParts, dayOffset: number): Pick<ZonedParts, "year" | "month" | "day" | "weekDay"> {
  const shifted = new Date(Date.UTC(base.year, base.month - 1, base.day + dayOffset));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekDay: shifted.getUTCDay(),
  };
}

function parseTime(value?: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value || "09:00");
  const hour = Math.min(23, Math.max(0, Number(match?.[1] ?? 9)));
  const minute = Math.min(59, Math.max(0, Number(match?.[2] ?? 0)));
  return { hour, minute };
}

function wallTimeToUtc(
  date: Pick<ZonedParts, "year" | "month" | "day">,
  time: { hour: number; minute: number },
  timezone?: string,
): Date {
  const targetWall = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  let timestamp = targetWall;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(new Date(timestamp), timezone);
    const actualWall = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const correction = targetWall - actualWall;
    timestamp += correction;
    if (correction === 0) break;
  }
  return new Date(timestamp);
}

function dateKey(value: Pick<ZonedParts, "year" | "month" | "day">): string {
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function runsOnDay(routine: AssistantRoutine, weekDay: number): boolean {
  if (routine.schedule.kind === "daily") return true;
  return (routine.schedule.days ?? []).includes(weekDay);
}

export function routineDueOccurrence(routine: AssistantRoutine, now = new Date()): RoutineOccurrence | null {
  if (!routine.enabled) return null;
  const lastRun = routine.lastRunAt ? Date.parse(routine.lastRunAt) : Number.NEGATIVE_INFINITY;
  if (routine.schedule.kind === "once") {
    const scheduled = Date.parse(routine.schedule.at || "");
    if (!Number.isFinite(scheduled) || scheduled > now.getTime() || lastRun >= scheduled) return null;
    const scheduledAt = new Date(scheduled).toISOString();
    return { key: `once:${scheduledAt}`, scheduledAt };
  }

  const today = zonedParts(now, routine.schedule.timezone);
  const time = parseTime(routine.schedule.time);
  const lookback = routine.schedule.kind === "weekly" ? 7 : 1;
  for (let offset = 0; offset >= -lookback; offset -= 1) {
    const day = localDate(today, offset);
    if (!runsOnDay(routine, day.weekDay)) continue;
    const scheduled = wallTimeToUtc(day, time, routine.schedule.timezone);
    if (scheduled.getTime() <= now.getTime() && scheduled.getTime() > lastRun) {
      return { key: `${routine.schedule.kind}:${dateKey(day)}`, scheduledAt: scheduled.toISOString() };
    }
  }
  return null;
}

export function nextRoutineRunAt(routine: AssistantRoutine, after = new Date()): string | undefined {
  if (!routine.enabled) return undefined;
  if (routine.schedule.kind === "once") {
    const scheduled = Date.parse(routine.schedule.at || "");
    if (!Number.isFinite(scheduled)) return undefined;
    if (routine.lastRunAt && Date.parse(routine.lastRunAt) >= scheduled) return undefined;
    return new Date(scheduled).toISOString();
  }

  const today = zonedParts(after, routine.schedule.timezone);
  const time = parseTime(routine.schedule.time);
  for (let offset = 0; offset <= 14; offset += 1) {
    const day = localDate(today, offset);
    if (!runsOnDay(routine, day.weekDay)) continue;
    const scheduled = wallTimeToUtc(day, time, routine.schedule.timezone);
    if (scheduled.getTime() > after.getTime()) return scheduled.toISOString();
  }
  return undefined;
}

export function weekDayInTimezone(date: Date, timezone?: string): number {
  return zonedParts(date, timezone).weekDay;
}
