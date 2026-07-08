import { describe, expect, it } from "vitest";
import { budgetUsdFor, costPicoUsd, currentPeriod, estimatePicoUsd, modelFor, modelsFor, resolveModel, periodFor, tierFromExternal } from "./billing.js";

describe("AI billing rules", () => {
  it("keeps tier model access deterministic", () => {
    expect(modelFor("basic")).toBe("deepseek-v4-flash");
    expect(modelFor("plus")).toBe("deepseek-v4-pro");
  });

  it("exposes each tier's allowed model set", () => {
    expect(modelsFor("free")).toEqual([]);
    expect(modelsFor("trial")).toEqual(["deepseek-v4-flash"]);
    expect(modelsFor("basic")).toEqual(["deepseek-v4-flash"]);
    expect(modelsFor("plus")).toEqual(["deepseek-v4-pro", "deepseek-v4-flash"]);
  });

  it("gives the trial tier a small taster budget, Flash-only", () => {
    expect(budgetUsdFor("trial")).toBe(0.5);
    expect(budgetUsdFor("free")).toBe(0);
    expect(resolveModel("trial", "pro")).toBe("deepseek-v4-flash");
  });

  it("maps website plan/status records to tiers", () => {
    expect(tierFromExternal("trial", "active")).toBe("trial");
    expect(tierFromExternal("trial", "trialing")).toBe("trial");
    expect(tierFromExternal("trial", "canceled")).toBe("free");
    expect(tierFromExternal("basic", "active")).toBe("basic");
    expect(tierFromExternal("plus", "active")).toBe("plus");
    expect(tierFromExternal("unknown-plan", "active")).toBe("free");
    expect(tierFromExternal(undefined, undefined)).toBe("free");
  });

  it("enforces the tier's allowed models against client requests", () => {
    // Plus may pick either model (accepts short aliases and canonical ids).
    expect(resolveModel("plus", "flash")).toBe("deepseek-v4-flash");
    expect(resolveModel("plus", "deepseek-v4-pro")).toBe("deepseek-v4-pro");
    // Basic cannot escalate to Pro — it is downgraded to its only allowed model.
    expect(resolveModel("basic", "pro")).toBe("deepseek-v4-flash");
    // Absent/garbage requests fall back to the tier default.
    expect(resolveModel("plus")).toBe("deepseek-v4-pro");
    expect(resolveModel("basic", "nonsense")).toBe("deepseek-v4-flash");
  });

  it("uses subscription-cycle keys when a future period end exists", () => {
    const now = new Date("2026-07-05T00:00:00Z");
    expect(periodFor({ userId: "u", tier: "basic", updatedAt: 0, currentPeriodEnd: new Date("2026-08-05T00:00:00Z") }, now))
      .toBe("subscription:2026-08-05T00:00:00.000Z");
    expect(currentPeriod(now)).toBe("2026-07");
  });

  it("prices cache hits, misses, and output tokens separately", () => {
    expect(costPicoUsd("deepseek-v4-flash", {
      prompt_tokens: 100,
      prompt_cache_hit_tokens: 40,
      prompt_cache_miss_tokens: 60,
      completion_tokens: 20,
    })).toBe(40 * 2_800 + 60 * 140_000 + 20 * 280_000);
  });

  it("creates a positive conservative reservation", () => {
    expect(estimatePicoUsd("deepseek-v4-pro", { messages: [{ role: "user", content: "hello" }], max_tokens: 100 })).toBeGreaterThan(0);
  });
});
