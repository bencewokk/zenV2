import { describe, expect, it } from "vitest";
import { mostUrgentExam, type ExamCandidate, type StudyPlan } from "./studyPlan";
import type { StudyBackbone } from "./deepworkStore";

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

function session(id: string, examInDays: number | null, overall = 40): ExamCandidate {
  return { id, name: `Session ${id}`, plan: plan(examInDays), backbone: backbone(overall) };
}

describe("mostUrgentExam", () => {
  it("returns null when no session has an exam date", () => {
    expect(mostUrgentExam([session("a", null)], NOW)).toBeNull();
    expect(mostUrgentExam([{ id: "b", name: "no plan" }], NOW)).toBeNull();
  });

  it("requires a backbone as well as an exam date", () => {
    expect(mostUrgentExam([{ id: "a", name: "a", plan: plan(5), backbone: null }], NOW)).toBeNull();
  });

  it("picks the nearest upcoming exam", () => {
    const result = mostUrgentExam([session("far", 20), session("soon", 3), session("mid", 9)], NOW);
    expect(result?.sessionId).toBe("soon");
    expect(result?.health.daysLeft).toBe(3);
  });

  it("excludes exams whose date has already passed", () => {
    const result = mostUrgentExam([session("passed", -2), session("upcoming", 10)], NOW);
    expect(result?.sessionId).toBe("upcoming");
  });

  it("includes an exam that is today", () => {
    expect(mostUrgentExam([session("today", 0)], NOW)?.health.daysLeft).toBe(0);
  });
});
