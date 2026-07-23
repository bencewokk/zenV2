// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/sync/engine", () => ({ syncOnce: vi.fn() }));

import { SparkIntro } from "./SparkIntro";
import { useSparkIntro } from "./sparkStore";

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

function click(element: HTMLElement): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("SparkIntro feature selection", () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    document.documentElement.setAttribute("data-reduce-motion", "");
    useSparkIntro.setState({ open: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    useSparkIntro.setState({ open: false });
    document.documentElement.removeAttribute("data-reduce-motion");
    container.remove();
    consoleError.mockRestore();
  });

  function moveToFeatureChooser(): void {
    act(() => root.render(<SparkIntro />));
    act(() => click(container.querySelector(".spark-look-card") as HTMLElement));
    act(() => click(buttonWithText(container, "Continue")));
    expect(container.textContent).toContain("Choose what you'll use");
  }

  it("disables Canvas and configures only the capabilities the user clicks", () => {
    moveToFeatureChooser();

    const canvas = buttonWithText(container, "Canvas");
    expect(canvas.disabled).toBe(true);
    expect(canvas.textContent).toContain("Disabled for now");

    act(() => click(buttonWithText(container, "Zotero")));
    expect(buttonWithText(container, "Zotero").getAttribute("aria-pressed")).toBe("true");
    act(() => click(buttonWithText(container, "Set up 1 selection")));

    expect(container.textContent).toContain("Connect your choices");
    expect(container.querySelector('input[placeholder="Canvas access token"]')).toBeNull();
    expect(container.querySelector('input[placeholder="Zotero API key"]')).not.toBeNull();
    expect(container.querySelector('input[placeholder="GitHub token"]')).toBeNull();
  });

  it("allows a direct local-only path when nothing is selected", () => {
    moveToFeatureChooser();

    act(() => click(buttonWithText(container, "Continue with local Zen")));

    expect(container.textContent).toContain("You're ready");
    expect(buttonWithText(container, "Enter Zen").disabled).toBe(false);
    expect(container.textContent).toContain("Change choices");
  });
});
