import { invoke } from "@tauri-apps/api/core";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface ICloudConnectionStatus {
  connected: boolean;
  email: string | null;
}

export type AppleCalendarConnectionMode = "system" | "credentials" | "unavailable";

export type MacOSCalendarAuthorization =
  | "not_determined"
  | "restricted"
  | "denied"
  | "full_access"
  | "write_only"
  | "unknown";

export interface SystemCalendarStatus {
  connected: boolean;
  authorization: MacOSCalendarAuthorization;
}

const DISCONNECTED: ICloudConnectionStatus = { connected: false, email: null };
const NO_SYSTEM_ACCESS: SystemCalendarStatus = {
  connected: false,
  authorization: "unknown",
};

export function isICloudConnectionAvailable(): boolean {
  return IS_TAURI;
}

export async function getAppleCalendarConnectionMode(): Promise<AppleCalendarConnectionMode> {
  if (!IS_TAURI) return "unavailable";
  return invoke<AppleCalendarConnectionMode>("apple_calendar_connection_mode");
}

export async function getMacOSCalendarConnectionStatus(): Promise<SystemCalendarStatus> {
  if (!IS_TAURI) return NO_SYSTEM_ACCESS;
  return invoke<SystemCalendarStatus>("macos_calendar_connection_status");
}

export async function requestMacOSCalendarAccess(): Promise<SystemCalendarStatus> {
  if (!IS_TAURI) {
    throw new Error("Apple Calendar access is available in the Zen desktop app for macOS.");
  }
  return invoke<SystemCalendarStatus>("macos_calendar_request_access");
}

export async function openMacOSCalendarSettings(): Promise<void> {
  if (!IS_TAURI) return;
  await invoke("macos_calendar_open_settings");
}

export async function getICloudConnectionStatus(): Promise<ICloudConnectionStatus> {
  if (!IS_TAURI) return DISCONNECTED;
  return invoke<ICloudConnectionStatus>("icloud_connection_status");
}

export async function connectICloudCalendar(
  email: string,
  appSpecificPassword: string,
): Promise<ICloudConnectionStatus> {
  if (!IS_TAURI) {
    throw new Error("iCloud Calendar connections are available in the Zen desktop app.");
  }
  return invoke<ICloudConnectionStatus>("icloud_connect", { email, appSpecificPassword });
}

export async function disconnectICloudCalendar(): Promise<void> {
  if (!IS_TAURI) return;
  await invoke("icloud_disconnect");
}
