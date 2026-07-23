// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Crash({ error }: { error: Error }): never {
  throw error;
}

describe("ErrorBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    consoleError.mockRestore();
  });

  it("passes the original exception and component stack to a fallback renderer", () => {
    const error = new TypeError("Calendar connection exploded");
    const onError = vi.fn();

    act(() => {
      root.render(
        <ErrorBoundary
          fallback={(caught, info) => (
            <div>
              <span data-testid="message">{caught.name}: {caught.message}</span>
              <span data-testid="stack">{info?.componentStack}</span>
            </div>
          )}
          onError={onError}
        >
          <Crash error={error} />
        </ErrorBoundary>,
      );
    });

    expect(container.querySelector('[data-testid="message"]')?.textContent)
      .toBe("TypeError: Calendar connection exploded");
    expect(container.querySelector('[data-testid="stack"]')?.textContent).toContain("Crash");
    expect(onError).toHaveBeenCalledWith(error, expect.objectContaining({
      componentStack: expect.stringContaining("Crash"),
    }));
  });
});
