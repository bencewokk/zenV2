// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/google/auth", () => ({
  isSignedIn: vi.fn(() => false),
  onAuthChange: vi.fn(() => () => undefined),
}));

vi.mock("@/features/pdfs/store", () => {
  const state = {
    annotations: {},
    loadAnnotations: vi.fn(async () => undefined),
  };
  return {
    usePdfs: Object.assign(
      (selector: (value: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});

import { useAI } from "@/features/ai/store";
import { useAiAccess } from "@/features/ai/access";
import { PlanSection } from "./StudyPanel";

describe("PlanSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    useAI.setState({ streaming: false });
    useAiAccess.setState({ access: "ready" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    useAI.setState({ streaming: false });
    container.remove();
  });

  it("keeps its hook order when AI streaming changes", () => {
    act(() => root.render(<PlanSection now={Date.now()} />));

    expect(() => {
      act(() => useAI.setState({ streaming: true }));
      act(() => useAI.setState({ streaming: false }));
    }).not.toThrow();
  });
});
