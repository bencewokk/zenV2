import { describe, expect, it } from "vitest";
import { describeUpdateError } from "./update";

describe("describeUpdateError", () => {
  it("recognizes network / offline failures", () => {
    expect(describeUpdateError(new Error("error sending request: failed to lookup address"))).toMatch(/internet connection/i);
    expect(describeUpdateError("Network Error")).toMatch(/internet connection/i);
    expect(describeUpdateError(new Error("connection timed out"))).toMatch(/internet connection/i);
  });

  it("recognizes a missing/unpublished release", () => {
    expect(describeUpdateError(new Error("Could not fetch a valid release JSON"))).toMatch(/no published release/i);
    expect(describeUpdateError("404 Not Found")).toMatch(/no published release/i);
  });

  it("recognizes signature verification failures", () => {
    expect(describeUpdateError(new Error("signature verification failed"))).toMatch(/signature check/i);
  });

  it("recognizes authorization failures", () => {
    expect(describeUpdateError(new Error("403 Forbidden"))).toMatch(/authorization/i);
  });

  it("falls back to the raw message, then a generic reason", () => {
    expect(describeUpdateError(new Error("disk is full"))).toBe("disk is full");
    expect(describeUpdateError("")).toMatch(/unknown reason/i);
  });
});
