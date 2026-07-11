import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTour, type TourStep } from "./tourStore";

const step = (id: string, onPass?: () => void): TourStep => ({
  id,
  title: id,
  body: id,
  onPass,
});

describe("guided tour progress", () => {
  beforeEach(() => useTour.setState({ active: false, index: 0, steps: [] }));

  it("records a step only when advancing past it", () => {
    const firstPassed = vi.fn();
    const secondPassed = vi.fn();
    useTour.getState().start([step("first", firstPassed), step("second", secondPassed)]);

    useTour.getState().back();
    expect(firstPassed).not.toHaveBeenCalled();

    useTour.getState().next();
    expect(firstPassed).toHaveBeenCalledOnce();
    expect(secondPassed).not.toHaveBeenCalled();
    expect(useTour.getState().index).toBe(1);
  });

  it("records the final step before closing the tour", () => {
    const passed = vi.fn();
    useTour.getState().start([step("only", passed)]);

    useTour.getState().next();
    expect(passed).toHaveBeenCalledOnce();
    expect(useTour.getState().active).toBe(false);
  });

  it("does not record the current step when the tour is closed", () => {
    const passed = vi.fn();
    useTour.getState().start([step("only", passed)]);

    useTour.getState().stop();
    expect(passed).not.toHaveBeenCalled();
  });
});
