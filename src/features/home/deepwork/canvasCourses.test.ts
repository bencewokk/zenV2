import { describe, expect, it } from "vitest";
import { canvasCourseSeed } from "./canvasCourses";
import type { CanvasCourse } from "@/services/canvas/client";

function course(patch: Partial<CanvasCourse>): CanvasCourse {
  return {
    id: 42,
    name: "Linear Algebra",
    course_code: "MATH-221",
    workflow_state: "available",
    ...patch,
  };
}

describe("canvasCourseSeed", () => {
  it("carries the Canvas id and name", () => {
    const seed = canvasCourseSeed(course({}));
    expect(seed.canvasCourseId).toBe(42);
    expect(seed.name).toBe("Linear Algebra");
  });

  it("seeds examDate from the course end date (date part only)", () => {
    const seed = canvasCourseSeed(course({ end_at: "2026-12-18T23:59:00Z" }));
    expect(seed.examDate).toBe("2026-12-18");
  });

  it("falls back to the term end date when the course has none", () => {
    const seed = canvasCourseSeed(
      course({ end_at: null, term: { id: 1, name: "Fall 2026", end_at: "2026-12-20T00:00:00Z" } })
    );
    expect(seed.examDate).toBe("2026-12-20");
  });

  it("prefers the course end date over the term end date", () => {
    const seed = canvasCourseSeed(
      course({ end_at: "2026-12-10T00:00:00Z", term: { id: 1, name: "Fall", end_at: "2026-12-20T00:00:00Z" } })
    );
    expect(seed.examDate).toBe("2026-12-10");
  });

  it("leaves examDate undefined when no dates are present", () => {
    expect(canvasCourseSeed(course({ end_at: null })).examDate).toBeUndefined();
  });

  it("falls back to course_code when the name is blank", () => {
    expect(canvasCourseSeed(course({ name: "" })).name).toBe("MATH-221");
  });
});
