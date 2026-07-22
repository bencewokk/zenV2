// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { compactPlannerItem, formatUpcoming, type UpcomingItem } from "./upcoming";
import type { CanvasPlannerItem } from "./client";

const NOW = new Date("2026-07-21T12:00:00Z").getTime();

function item(overrides: Partial<UpcomingItem> = {}): UpcomingItem {
  return { title: "Homework 3", course: "Analysis", type: "assignment", dueISO: "2026-07-23T22:00:00Z", points: 10, submitted: false, ...overrides };
}

describe("compactPlannerItem", () => {
  it("reduces a planner item and reads submission state", () => {
    const raw: CanvasPlannerItem = {
      context_name: "Analysis II",
      plannable_type: "assignment",
      plannable: { title: "HW 5", due_at: "2026-07-25T10:00:00Z", points_possible: 20 },
      submissions: { submitted: true, graded: false },
    };
    expect(compactPlannerItem(raw)).toMatchObject({
      title: "HW 5", course: "Analysis II", type: "assignment",
      dueISO: "2026-07-25T10:00:00Z", points: 20, submitted: true,
    });
  });

  it("treats submissions:false (Canvas's 'not applicable') as not submitted", () => {
    const raw: CanvasPlannerItem = {
      plannable_type: "calendar_event",
      plannable: { title: "Lecture" },
      plannable_date: "2026-07-22T08:00:00Z",
      submissions: false,
    };
    const compact = compactPlannerItem(raw);
    expect(compact.submitted).toBe(false);
    expect(compact.dueISO).toBe("2026-07-22T08:00:00Z");
  });
});

describe("formatUpcoming", () => {
  it("returns empty for no pending items", () => {
    expect(formatUpcoming([], NOW)).toBe("");
    expect(formatUpcoming([item({ submitted: true })], NOW)).toBe("");
    expect(formatUpcoming([item({ dueISO: undefined })], NOW)).toBe("");
  });

  it("filters submitted items, sorts soonest first, and marks overdue", () => {
    const out = formatUpcoming([
      item({ title: "Later", dueISO: "2026-07-28T10:00:00Z" }),
      item({ title: "Sooner", dueISO: "2026-07-22T10:00:00Z" }),
      item({ title: "Done already", submitted: true }),
      item({ title: "Just missed", dueISO: "2026-07-21T08:00:00Z" }),
    ], NOW);
    const lines = out.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Just missed");
    expect(lines[0]).toContain("OVERDUE");
    expect(lines[1]).toContain("Sooner");
    expect(lines[2]).toContain("Later");
    expect(out).not.toContain("Done already");
    expect(out).toContain("Analysis: Sooner");
    expect(out).toContain("(assignment, 10 pts)");
  });

  it("drops items more than a day overdue", () => {
    expect(formatUpcoming([item({ dueISO: "2026-07-19T10:00:00Z" })], NOW)).toBe("");
  });

  it("caps the block at six lines and counts the rest", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      item({ title: `HW ${i}`, dueISO: `2026-07-2${2 + (i % 7)}T10:00:00Z` }));
    const out = formatUpcoming(many, NOW);
    expect(out.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(6);
    expect(out).toContain("…and 3 more.");
  });
});
