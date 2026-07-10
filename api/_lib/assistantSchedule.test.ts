import { describe, expect, it } from "vitest";
import { nextRoutineRunAt, routineDueOccurrence } from "./assistantSchedule.js";
import type { AssistantRoutine } from "./assistantData.js";

function routine(patch: Partial<AssistantRoutine> = {}): AssistantRoutine {
  return {
    id: "routine-1",
    title: "Morning summary",
    prompt: "Summarize my email",
    schedule: { kind: "daily", time: "09:00", timezone: "Europe/Budapest" },
    enabled: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

describe("assistant routine scheduling", () => {
  it("finds a due daily occurrence in the routine timezone", () => {
    const occurrence = routineDueOccurrence(routine(), new Date("2026-07-10T07:05:00.000Z"));
    expect(occurrence).toEqual({ key: "daily:2026-07-10", scheduledAt: "2026-07-10T07:00:00.000Z" });
  });

  it("does not repeat an occurrence that already ran", () => {
    const occurrence = routineDueOccurrence(
      routine({ lastRunAt: "2026-07-10T07:01:00.000Z" }),
      new Date("2026-07-10T10:00:00.000Z"),
    );
    expect(occurrence).toBeNull();
  });

  it("respects weekly day selection", () => {
    const weekly = routine({ schedule: { kind: "weekly", time: "09:00", days: [1], timezone: "Europe/Budapest" } });
    expect(routineDueOccurrence(weekly, new Date("2026-07-06T07:10:00.000Z"))?.key).toBe("weekly:2026-07-06");
    expect(routineDueOccurrence(weekly, new Date("2026-07-07T06:00:00.000Z"))?.key).toBe("weekly:2026-07-06");
  });

  it("calculates the next DST-aware run", () => {
    const next = nextRoutineRunAt(routine(), new Date("2026-12-10T08:30:00.000Z"));
    expect(next).toBe("2026-12-11T08:00:00.000Z");
  });

  it("runs a one-time routine only once", () => {
    const once = routine({ schedule: { kind: "once", at: "2026-07-10T10:00:00.000Z" } });
    expect(routineDueOccurrence(once, new Date("2026-07-10T10:01:00.000Z"))?.key).toContain("once:");
    expect(routineDueOccurrence({ ...once, lastRunAt: "2026-07-10T10:00:01.000Z" }, new Date("2026-07-10T11:00:00.000Z"))).toBeNull();
  });
});
