import { notify } from "@/shared/ui/notify";

/**
 * Desktop notifications via the Web Notification API (works in the browser build
 * and the Tauri WebView2 shell). Always degrades to an in-app toast so a message
 * is never lost when the OS notification can't show (permission denied, the API
 * is blocked, or the window is focused — where a toast is the better surface).
 *
 * Whether notifications are *enabled* is a per-device preference (localStorage,
 * not synced): each device decides for itself.
 */

const ENABLED_KEY = "zen.notifications.enabled.v1";

function supported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return supported() ? Notification.permission : "unsupported";
}

export function notificationsEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Request permission if undecided. Must be called from a user gesture. */
export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!supported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export interface NotifyOptions {
  body?: string;
  onClick?: () => void;
  tag?: string;
  /** Also mirror to an in-app toast (default true — the window is often focused). */
  toast?: boolean;
}

/**
 * Show a system notification if enabled + permitted; otherwise fall back to a
 * toast. Silently no-ops nothing — the message always reaches the user somehow.
 */
export async function showNotification(title: string, opts: NotifyOptions = {}): Promise<void> {
  const { body, onClick, tag, toast = true } = opts;
  const line = body ? `${title} — ${body}` : title;

  if (!supported() || Notification.permission !== "granted") {
    if (toast) notify.info(line);
    return;
  }

  try {
    const n = new Notification(title, { body, tag, icon: "/logo.ico" });
    if (onClick) {
      n.onclick = () => {
        window.focus();
        onClick();
        n.close();
      };
    }
    if (toast) notify.info(line);
  } catch {
    if (toast) notify.info(line);
  }
}

/** Fire a sample notification so the user can confirm the pipeline + permission. */
export async function sendTestNotification(): Promise<void> {
  const perm = await requestNotificationPermission();
  if (perm === "unsupported") {
    notify.error("This device doesn't support system notifications.");
    return;
  }
  if (perm === "denied") {
    notify.error("Notifications are blocked. Enable them for Zen in your browser or OS settings, then try again.");
    return;
  }
  await showNotification("Zen — test notification", {
    body: "Notifications are working. You'll be pinged when a phone routine finishes or a task arrives.",
    tag: "zen-test",
    toast: false,
  });
  notify.success("Test notification sent.");
}
