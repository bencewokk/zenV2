import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken(): never {
      throw new Error("JWT verification is outside these access-token tests");
    }
  },
}));

vi.mock("./assistantSession.js", () => ({
  userIdFromAssistantSession: vi.fn(),
}));

const ORIGINAL_GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

function googleResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function googleFetch(options: { expiresIn?: string; failFirstIntrospection?: boolean } = {}) {
  let introspections = 0;
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      introspections += 1;
      if (options.failFirstIntrospection && introspections === 1) return googleResponse({}, 401);
      return googleResponse({ aud: "browser-client", expires_in: options.expiresIn ?? "120" });
    }
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
      return googleResponse({ sub: "google-user-123" });
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
}

describe("browser Google access-token auth cache", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00Z"));
    process.env.GOOGLE_CLIENT_ID = "browser-client";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (ORIGINAL_GOOGLE_CLIENT_ID === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = ORIGINAL_GOOGLE_CLIENT_ID;
  });

  it("reuses only a successful validation for the same bearer token", async () => {
    const fetchMock = googleFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { userIdFromRequest } = await import("./auth.js");

    await expect(userIdFromRequest("Bearer test-access-token")).resolves.toBe("google-user-123");
    await expect(userIdFromRequest("Bearer test-access-token")).resolves.toBe("google-user-123");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("expires conservatively before Google's expires_in deadline", async () => {
    const fetchMock = googleFetch({ expiresIn: "6" });
    vi.stubGlobal("fetch", fetchMock);
    const { userIdFromRequest } = await import("./auth.js");

    await userIdFromRequest("Bearer short-lived-token");
    vi.advanceTimersByTime(999);
    await userIdFromRequest("Bearer short-lived-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(2);
    await userIdFromRequest("Bearer short-lived-token");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("never caches a failed validation", async () => {
    const fetchMock = googleFetch({ failFirstIntrospection: true });
    vi.stubGlobal("fetch", fetchMock);
    const { userIdFromRequest } = await import("./auth.js");

    await expect(userIdFromRequest("Bearer retry-token")).rejects.toThrow("access token introspection failed");
    await expect(userIdFromRequest("Bearer retry-token")).resolves.toBe("google-user-123");
    await expect(userIdFromRequest("Bearer retry-token")).resolves.toBe("google-user-123");

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("evicts the least-recently-used validation when the cache is full", async () => {
    const fetchMock = googleFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { userIdFromRequest } = await import("./auth.js");

    for (let i = 0; i <= 256; i += 1) {
      await userIdFromRequest(`Bearer bounded-token-${i}`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(514);

    await userIdFromRequest("Bearer bounded-token-0");
    expect(fetchMock).toHaveBeenCalledTimes(516);
  });
});
