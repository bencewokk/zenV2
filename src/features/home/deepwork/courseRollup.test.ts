import { describe, expect, it } from "vitest";
import { courseMembers, courseRollup, pickExamHero } from "./courseRollup";
import { mostUrgentExam, planHealth, type StudyPlan } from "./studyPlan";
import type { DeepWorkSession, StudyBackbone } from "./deepworkStore";
import type { Course } from "./courseStore";

const NOW = new Date("2026-07-07T09:00:00").getTime();

function dayKeyIn(days: number): string {
  return new Date(NOW + days * 86400000).toISOString().slice(0, 10);
}

function plan(examInDays: number | null): StudyPlan {
  return {
    goal: "Exam prep",
    examDate: examInDays == null ? undefined : dayKeyIn(examInDays),
    horizonDays: 7,
    dailyTargetMin: 60,
    sessions: [],
    generatedAt: NOW,
    revisedAt: NOW,
  };
}

function backbone(overall: number): StudyBackbone {
  return {
    intent: "prep",
    overall,
    generatedAt: NOW,
    concepts: [{ id: "c1", title: "Integration by parts", summary: "", mastery: overall }],
  };
}

/** exam: undefined → no plan; null → plan without a date; number → dated plan.
 *  overall: null → no backbone. */
function mkSession(
  id: string,
  opts: { exam?: number | null; overall?: number | null; archived?: boolean; updatedAt?: number } = {}
): DeepWorkSession {
  const { exam, overall = 40, archived = false, updatedAt = NOW } = opts;
  return {
    id,
    name: `Session ${id}`,
    createdAt: NOW,
    updatedAt,
    archived,
    items: [],
    windows: {},
    layout: "grid" as const,
    intent: "",
    focusMs: 0,
    focusSessions: 0,
    backbone: overall == null ? null : backbone(overall),
    plan: exam === undefined ? null : plan(exam),
  };
}

function mkCourse(id: string, sessionIds: string[], examDate?: string): Course {
  return { id, name: `Course ${id}`, examDate, sessionIds, createdAt: NOW, updatedAt: NOW };
}

function record(list: DeepWorkSession[]): Record<string, DeepWorkSession> {
  return Object.fromEntries(list.map((s) => [s.id, s]));
}

describe("courseMembers", () => {
  it("keeps course order and drops dangling and archived ids", () => {
    const a = mkSession("a");
    const b = mkSession("b", { archived: true });
    const c = mkSession("c");
    const course = mkCourse("k", ["c", "gone", "b", "a"]);
    expect(courseMembers(course, record([a, b, c])).map((s) => s.id)).toEqual(["c", "a"]);
  });
});

describe("courseRollup", () => {
  it("returns nulls for an empty course", () => {
    const r = courseRollup(mkCourse("k", []), {}, NOW);
    expect(r.memberCount).toBe(0);
    expect(r.assessedCount).toBe(0);
    expect(r.readiness).toBeNull();
    expect(r.examDate).toBeNull();
    expect(r.daysLeft).toBeNull();
    expect(r.urgent).toBeNull();
    expect(r.studyTargetId).toBeNull();
  });

  it("averages effectiveReadiness over assessed members only", () => {
    const a = mkSession("a", { exam: 10, overall: 80 });
    const b = mkSession("b", { overall: 40 });
    const bare = mkSession("bare", { overall: null });
    const sessions = record([a, b, bare]);
    const r = courseRollup(mkCourse("k", ["a", "b", "bare"]), sessions, NOW);
    const expected = Math.round(
      (planHealth(a.plan ?? null, a.backbone, NOW).effectiveReadiness +
        planHealth(b.plan ?? null, b.backbone, NOW).effectiveReadiness) / 2
    );
    expect(r.memberCount).toBe(3);
    expect(r.assessedCount).toBe(2);
    expect(r.readiness).toBe(expected);
  });

  it("has null readiness (not 0) when no member is assessed", () => {
    const bare = mkSession("bare", { overall: null });
    const r = courseRollup(mkCourse("k", ["bare"]), record([bare]), NOW);
    expect(r.memberCount).toBe(1);
    expect(r.readiness).toBeNull();
  });

  it("picks the nearest future exam date across course and members", () => {
    const midterm = mkSession("mid", { exam: 5 });
    const sessions = record([midterm]);
    // Member midterm in 5 days beats the course final in 30.
    expect(courseRollup(mkCourse("k", ["mid"], dayKeyIn(30)), sessions, NOW).examDate).toBe(dayKeyIn(5));
    // Course date wins when it is nearer.
    expect(courseRollup(mkCourse("k", ["mid"], dayKeyIn(2)), sessions, NOW).examDate).toBe(dayKeyIn(2));
    expect(courseRollup(mkCourse("k", ["mid"], dayKeyIn(2)), sessions, NOW).daysLeft).toBe(2);
  });

  it("ignores past dates and uses the course date when members have none", () => {
    const undated = mkSession("u", { exam: null });
    const sessions = record([undated]);
    expect(courseRollup(mkCourse("k", ["u"], dayKeyIn(12)), sessions, NOW).examDate).toBe(dayKeyIn(12));
    expect(courseRollup(mkCourse("k", ["u"], dayKeyIn(-3)), sessions, NOW).examDate).toBeNull();
    const passed = mkSession("p", { exam: -2 });
    expect(courseRollup(mkCourse("k", ["p"]), record([passed]), NOW).examDate).toBeNull();
  });

  it("scopes urgent to members via mostUrgentExam", () => {
    const near = mkSession("near", { exam: 3 });
    const far = mkSession("far", { exam: 20 });
    const outsider = mkSession("out", { exam: 1 });
    const sessions = record([near, far, outsider]);
    const r = courseRollup(mkCourse("k", ["near", "far"]), sessions, NOW);
    expect(r.urgent?.sessionId).toBe("near");
    expect(r.urgent).toEqual(mostUrgentExam([near, far], NOW));
  });

  it("targets the urgent member, else the most recently touched assessed one", () => {
    const urgent = mkSession("u", { exam: 3 });
    const fresher = mkSession("f", { updatedAt: NOW + 1000 });
    const sessions = record([urgent, fresher]);
    expect(courseRollup(mkCourse("k", ["u", "f"]), sessions, NOW).studyTargetId).toBe("u");
    const bare = mkSession("bare", { overall: null, updatedAt: NOW + 5000 });
    const assessed = mkSession("a", { updatedAt: NOW + 1000 });
    const older = mkSession("o", { updatedAt: NOW - 1000 });
    const r = courseRollup(mkCourse("k", ["bare", "o", "a"]), record([bare, assessed, older]), NOW);
    expect(r.studyTargetId).toBe("a");
  });
});

describe("pickExamHero", () => {
  it("reduces to mostUrgentExam when there are no courses", () => {
    const a = mkSession("a", { exam: 9 });
    const b = mkSession("b", { exam: 3 });
    const archived = mkSession("x", { exam: 1, archived: true });
    const sessions = record([a, b, archived]);
    const hero = pickExamHero([], sessions, ["a", "b", "x"], NOW);
    const direct = mostUrgentExam([a, b], NOW);
    expect(hero?.kind).toBe("session");
    if (hero?.kind === "session") expect(hero.urgent).toEqual(direct);
  });

  it("represents a grouped session by its course, not as a session hero", () => {
    const grouped = mkSession("g", { exam: 2 });
    const loose = mkSession("l", { exam: 8 });
    const sessions = record([grouped, loose]);
    const hero = pickExamHero([mkCourse("k", ["g"])], sessions, ["g", "l"], NOW);
    expect(hero?.kind).toBe("course");
    if (hero?.kind === "course") {
      expect(hero.course.id).toBe("k");
      expect(hero.rollup.urgent?.sessionId).toBe("g");
    }
  });

  it("lets a nearer ungrouped session beat a farther course", () => {
    const grouped = mkSession("g", { exam: 20 });
    const loose = mkSession("l", { exam: 2 });
    const sessions = record([grouped, loose]);
    const hero = pickExamHero([mkCourse("k", ["g"])], sessions, ["g", "l"], NOW);
    expect(hero?.kind).toBe("session");
    if (hero?.kind === "session") expect(hero.urgent.sessionId).toBe("l");
  });

  it("qualifies a course on its own exam date when a member is assessed but unplanned", () => {
    const member = mkSession("m", { overall: 50 });
    const loose = mkSession("l", { exam: 25 });
    const sessions = record([member, loose]);
    const hero = pickExamHero([mkCourse("k", ["m"], dayKeyIn(6))], sessions, ["m", "l"], NOW);
    expect(hero?.kind).toBe("course");
    if (hero?.kind === "course") {
      expect(hero.rollup.daysLeft).toBe(6);
      expect(hero.rollup.urgent).toBeNull();
      expect(hero.rollup.studyTargetId).toBe("m");
    }
  });

  it("skips courses with no assessed member", () => {
    const bare = mkSession("bare", { overall: null });
    const sessions = record([bare]);
    expect(pickExamHero([mkCourse("k", ["bare"], dayKeyIn(4))], sessions, ["bare"], NOW)).toBeNull();
  });

  it("returns null when nothing qualifies", () => {
    const idle = mkSession("i", { exam: null });
    expect(pickExamHero([mkCourse("k", [])], record([idle]), ["i"], NOW)).toBeNull();
  });
});
