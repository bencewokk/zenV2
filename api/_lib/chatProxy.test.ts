import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const billing = vi.hoisted(() => ({
  reserveAIRequest: vi.fn(),
  markReservationAccepted: vi.fn(),
  settleReservation: vi.fn(),
  costPicoUsd: vi.fn(),
}));

vi.mock("./auth.js", () => ({ userIdFromRequest: vi.fn(async () => "user-123") }));
vi.mock("./cors.js", () => ({ applyCors: vi.fn(() => false), isAllowedOrigin: vi.fn(() => true) }));
vi.mock("./billing.js", () => billing);

import handler from "../ai/chat.js";

class MockResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  headers = new Map<string, string>();
  chunks: Buffer[] = [];
  jsonBody: unknown;
  events: string[] = [];

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  flushHeaders() {
    this.events.push("flush");
    this.headersSent = true;
  }

  write(chunk: Uint8Array) {
    this.events.push("write");
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    return true;
  }

  json(body: unknown) {
    this.events.push("json");
    this.headersSent = true;
    this.writableEnded = true;
    this.jsonBody = body;
    return this;
  }

  end() {
    this.events.push("end");
    this.headersSent = true;
    this.writableEnded = true;
    return this;
  }
}

function request() {
  return Object.assign(new EventEmitter(), {
    method: "POST",
    query: {},
    headers: { authorization: "Bearer token" },
    body: { provider: "deepseek", model: "flash", payload: { messages: [{ role: "user", content: "Hello" }], stream: true } },
    aborted: false,
  });
}

describe("DeepSeek streaming proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEEPSEEK_API_KEY = "test-provider-key";
    billing.reserveAIRequest.mockResolvedValue({
      reservationId: "reservation-1",
      tier: "basic",
      model: "deepseek-v4-flash",
      period: "calendar:2026-07",
      budgetUsd: 5,
      heldPicoUsd: 700,
    });
    billing.markReservationAccepted.mockResolvedValue(undefined);
    billing.settleReservation.mockResolvedValue(undefined);
    billing.costPicoUsd.mockReturnValue(123);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("conservatively commits the hold when the dispatched provider fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const res = new MockResponse();

    await handler(request() as never, res as never);

    expect(res.statusCode).toBe(502);
    expect(res.jsonBody).toMatchObject({ code: "provider_error" });
    expect(res.events).toEqual(["json"]);
    expect(billing.settleReservation).toHaveBeenCalledWith(
      "user-123",
      "reservation-1",
      { costPicoUsd: 700, estimated: true },
    );
  });

  it("returns an error instead of flushing 200 when the first body read fails", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error("stream reset")); },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })));
    const res = new MockResponse();

    await handler(request() as never, res as never);

    expect(res.statusCode).toBe(502);
    expect(res.jsonBody).toMatchObject({ code: "provider_stream_error" });
    expect(res.events).toEqual(["json"]);
    expect(billing.markReservationAccepted).toHaveBeenCalledWith("user-123", "reservation-1");
    expect(billing.settleReservation).toHaveBeenCalledWith(
      "user-123",
      "reservation-1",
      { costPicoUsd: 700, estimated: true },
    );
  });

  it("returns an error instead of a blank 200 for an empty provider stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.close(); },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));
    const res = new MockResponse();

    await handler(request() as never, res as never);

    expect(res.statusCode).toBe(502);
    expect(res.jsonBody).toMatchObject({ code: "provider_empty_response" });
    expect(res.events).toEqual(["json"]);
    expect(billing.settleReservation).toHaveBeenCalledWith(
      "user-123",
      "reservation-1",
      { costPicoUsd: 700, estimated: true },
    );
  });

  it("releases the hold for a known provider rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    const res = new MockResponse();

    await handler(request() as never, res as never);

    expect(res.statusCode).toBe(429);
    expect(res.jsonBody).toMatchObject({ code: "provider_error" });
    expect(billing.markReservationAccepted).not.toHaveBeenCalled();
    expect(billing.settleReservation).toHaveBeenCalledWith("user-123", "reservation-1", null);
  });

  it("flushes the success response with the first byte and settles measured usage", async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}',
      "",
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":2}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })));
    const res = new MockResponse();

    await handler(request() as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.events).toEqual(["flush", "write", "end"]);
    expect(Buffer.concat(res.chunks).toString("utf8")).toBe(body);
    expect(billing.costPicoUsd).toHaveBeenCalledWith(
      "deepseek-v4-flash",
      expect.objectContaining({ prompt_tokens: 10, completion_tokens: 2 }),
    );
    expect(billing.settleReservation).toHaveBeenCalledWith(
      "user-123",
      "reservation-1",
      expect.objectContaining({ costPicoUsd: 123 }),
    );
  });
});
