import { describe, expect, it } from "vitest";
import { assistantCapabilities, toolsForConversation } from "./assistantTools.js";

function names(input: string): string[] {
  return toolsForConversation(input).map((tool) => tool.function.name);
}

describe("assistant capability packs", () => {
  it("always includes real Zen data tools", () => {
    expect(names("remember this project decision")).toContain("zen_memory_save");
    expect(names("remember this project decision")).toContain("zen_search");
  });

  it("loads Gmail tools for email work without loading Calendar", () => {
    const selected = names("summarise my inbox and draft a reply");
    expect(selected).toContain("gmail_search");
    expect(selected).toContain("gmail_draft");
    expect(selected).not.toContain("calendar_create");
  });

  it("loads both integration packs for a daily catch-up", () => {
    const selected = names("plan my day and tell me what needs my attention");
    expect(selected).toContain("gmail_search");
    expect(selected).toContain("calendar_today");
  });

  it("publishes unique capability names", () => {
    const capabilities = assistantCapabilities();
    expect(new Set(capabilities).size).toBe(capabilities.length);
    expect(capabilities.length).toBeGreaterThan(25);
  });
});

