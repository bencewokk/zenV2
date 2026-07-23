import { invoke } from "@tauri-apps/api/core";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface ICloudConnectionStatus {
  connected: boolean;
  email: string | null;
}

const DISCONNECTED: ICloudConnectionStatus = { connected: false, email: null };

export function isICloudConnectionAvailable(): boolean {
  return IS_TAURI;
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
