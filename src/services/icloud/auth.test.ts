// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("iCloud desktop auth service", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("stays unavailable and disconnected in the browser", async () => {
    const auth = await import("./auth");

    expect(auth.isICloudConnectionAvailable()).toBe(false);
    await expect(auth.getAppleCalendarConnectionMode()).resolves.toBe("unavailable");
    await expect(auth.getMacOSCalendarConnectionStatus()).resolves.toEqual({
      connected: false,
      authorization: "unknown",
    });
    await expect(auth.getICloudConnectionStatus()).resolves.toEqual({
      connected: false,
      email: null,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses native commands without persisting the password in the frontend", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke
      .mockResolvedValueOnce({ connected: false, email: null })
      .mockResolvedValueOnce({ connected: true, email: "person@icloud.com" })
      .mockResolvedValueOnce(undefined);
    const auth = await import("./auth");

    await expect(auth.getICloudConnectionStatus()).resolves.toEqual({
      connected: false,
      email: null,
    });
    await expect(
      auth.connectICloudCalendar("person@icloud.com", "abcd-efgh-ijkl-mnop"),
    ).resolves.toEqual({
      connected: true,
      email: "person@icloud.com",
    });
    await auth.disconnectICloudCalendar();

    expect(invoke).toHaveBeenNthCalledWith(1, "icloud_connection_status");
    expect(invoke).toHaveBeenNthCalledWith(2, "icloud_connect", {
      email: "person@icloud.com",
      appSpecificPassword: "abcd-efgh-ijkl-mnop",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "icloud_disconnect");
  });

  it("uses the native macOS Calendar permission flow", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke
      .mockResolvedValueOnce("system")
      .mockResolvedValueOnce({ connected: false, authorization: "not_determined" })
      .mockResolvedValueOnce({ connected: true, authorization: "full_access" })
      .mockResolvedValueOnce(undefined);
    const auth = await import("./auth");

    await expect(auth.getAppleCalendarConnectionMode()).resolves.toBe("system");
    await expect(auth.getMacOSCalendarConnectionStatus()).resolves.toEqual({
      connected: false,
      authorization: "not_determined",
    });
    await expect(auth.requestMacOSCalendarAccess()).resolves.toEqual({
      connected: true,
      authorization: "full_access",
    });
    await auth.openMacOSCalendarSettings();

    expect(invoke).toHaveBeenNthCalledWith(1, "apple_calendar_connection_mode");
    expect(invoke).toHaveBeenNthCalledWith(2, "macos_calendar_connection_status");
    expect(invoke).toHaveBeenNthCalledWith(3, "macos_calendar_request_access");
    expect(invoke).toHaveBeenNthCalledWith(4, "macos_calendar_open_settings");
  });
});
