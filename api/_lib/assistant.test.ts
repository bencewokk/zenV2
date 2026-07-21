import { beforeEach, describe, expect, it, vi } from "vitest";

const billing = vi.hoisted(() => ({
  reserveAIRequest: vi.fn(),
  markReservationAccepted: vi.fn(),
  settleReservation: vi.fn(),
  costPicoUsd: vi.fn(),
}));

const data = vi.hoisted(() => ({
  persistConversation: vi.fn(),
}));

vi.mock("./billing.js", () => billing);
vi.mock("./assistantData.js", () => ({
  persistConversation: data.persistConversation,
}));
vi.mock("./assistantTools.js", () => ({
  assistantCapabilities: vi.fn(() => []),
  assistantContext: vi.fn(async () => ""),
  executeAssistantTool: vi.fn(),
  toolsForConversation: vi.fn(() => []),
}));
vi.mock("./assistantGoogleOffline.js", () => ({
  googleAccessTokenForUser: vi.fn(async () => undefined),
  googleOfflineConfigured: vi.fn(() => false),
}));
vi.mock("./assistantPush.js", () => ({
  pushConfigured: vi.fn(() => false),
  vapidPublicKey: vi.fn(() => ""),
}));

import { runAssistant } from "./assistant.js";

const request = {
  messages: [{ id: "message-1", role: "user" as const, text: "Hello" }],
  requestId: "request-1",
};

describe("metered server assistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEEPSEEK_API_KEY = "test-key";
    delete process.env.DEEPSEEK_MODEL;
    billing.reserveAIRequest.mockResolvedValue({
      reservationId: "reservation-1",
      model: "deepseek-v4-flash",
      heldPicoUsd: 900,
    });
    billing.markReservationAccepted.mockResolvedValue(undefined);
    billing.settleReservation.mockResolvedValue(undefined);
    billing.costPicoUsd.mockReturnValue(321);
    data.persistConversation.mockResolvedValue(undefined);
  });

  it("reserves and settles each model round against reported usage", async () => {
    const usage = { prompt_tokens: 25, completion_tokens: 10 };
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "Hi" } }],
      usage,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await runAssistant(request, "user-123");

    expect(response.message.text).toBe("Hi");
    expect(billing.reserveAIRequest).toHaveBeenCalledTimes(1);
    expect(billing.markReservationAccepted).toHaveBeenCalledWith("user-123", "reservation-1");
    expect(billing.costPicoUsd).toHaveBeenCalledWith("deepseek-v4-flash", usage);
    expect(billing.settleReservation).toHaveBeenCalledWith("user-123", "reservation-1", {
      costPicoUsd: 321,
      usage,
    });
    const providerBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(providerBody.model).toBe("deepseek-v4-flash");
    expect(providerBody.user_id).toMatch(/^[a-f0-9]{64}$/);
  });

  it("releases the reservation when the provider rejects the request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad request", { status: 400 })));

    await expect(runAssistant(request, "user-123")).rejects.toThrow("DeepSeek failed with 400");

    expect(billing.markReservationAccepted).not.toHaveBeenCalled();
    expect(billing.settleReservation).toHaveBeenCalledWith("user-123", "reservation-1", null);
  });
});
