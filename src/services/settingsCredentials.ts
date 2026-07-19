import { AI_SETTINGS_KEY, AI_SETTINGS_SECRET_FIELDS } from "@/services/ai/settings";
import { GOOGLE_SETTINGS_KEY, GOOGLE_SETTINGS_SECRET_FIELDS } from "@/services/google/settings";
import { CANVAS_SETTINGS_KEY, CANVAS_SETTINGS_SECRET_FIELDS } from "@/services/canvas/settings";
import {
  EXTERNAL_CONNECTIONS_KEY,
  EXTERNAL_CONNECTIONS_SECRET_FIELDS,
} from "@/services/connections/settings";

type SettingsObject = Record<string, unknown>;

interface CredentialPolicy {
  secretFields: readonly string[];
  /** A local credential may survive an incoming update only while this identity
   * remains exactly the same. Fixed-host providers intentionally omit it. */
  identity?: (settings: SettingsObject) => string | null;
}

const RELATIVE_URL_ORIGIN = "https://zen-local.invalid";

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function httpOrigin(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw, RELATIVE_URL_ORIGIN);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

const POLICIES = new Map<string, CredentialPolicy>([
  [AI_SETTINGS_KEY, {
    secretFields: AI_SETTINGS_SECRET_FIELDS,
    identity: (settings) => {
      const provider = text(settings.provider)?.toLowerCase();
      const origin = httpOrigin(settings.baseUrl);
      return provider && origin ? `${provider}\u0000${origin}` : null;
    },
  }],
  [GOOGLE_SETTINGS_KEY, {
    secretFields: GOOGLE_SETTINGS_SECRET_FIELDS,
    identity: (settings) => text(settings.clientId),
  }],
  [CANVAS_SETTINGS_KEY, {
    secretFields: CANVAS_SETTINGS_SECRET_FIELDS,
    identity: (settings) => httpOrigin(settings.baseUrl),
  }],
  // Zotero and GitHub credentials are always sent only to their fixed official
  // API origins, so their portable library/repository metadata is not an origin
  // binding and may change without disconnecting the device.
  [EXTERNAL_CONNECTIONS_KEY, {
    secretFields: EXTERNAL_CONNECTIONS_SECRET_FIELDS,
  }],
]);

function objectValue(value: unknown): SettingsObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as SettingsObject;
}

function stripFields(value: unknown, fields: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => stripFields(item, fields));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !fields.has(key))
      .map(([key, child]) => [key, stripFields(child, fields)]),
  );
}

export function hasCredentialPolicy(storageKey: string): boolean {
  return POLICIES.has(storageKey);
}

/** Strip every registered credential field, including nested occurrences. A
 * malformed secret-bearing value is rejected instead of copied verbatim. */
export function sanitizeCredentialStorageValue(storageKey: string, raw: string): string | null {
  const policy = POLICIES.get(storageKey);
  if (!policy) return raw;
  try {
    const parsed = objectValue(JSON.parse(raw) as unknown);
    if (!parsed) return null;
    return JSON.stringify(stripFields(parsed, new Set(policy.secretFields)));
  } catch {
    return null;
  }
}

/** Merge a sanitized incoming settings value with credentials already on this
 * device. Endpoint/client-bound credentials survive only if both sides have the
 * same valid identity; missing or changed identity fails closed. */
export function mergeIncomingWithLocalCredentials(
  storageKey: string,
  safeIncoming: string,
  currentRaw: string | null,
): string {
  const policy = POLICIES.get(storageKey);
  if (!policy) return safeIncoming;

  try {
    const incoming = objectValue(JSON.parse(safeIncoming) as unknown);
    const current = objectValue(JSON.parse(currentRaw ?? "null") as unknown);
    if (!incoming || !current) return safeIncoming;

    const merged = stripFields(incoming, new Set(policy.secretFields)) as SettingsObject;
    const sameIdentity = !policy.identity || (
      policy.identity(incoming) !== null
      && policy.identity(incoming) === policy.identity(current)
    );
    if (!sameIdentity) return JSON.stringify(merged);

    for (const field of policy.secretFields) {
      if (Object.prototype.hasOwnProperty.call(current, field)) merged[field] = current[field];
    }
    return JSON.stringify(merged);
  } catch {
    return safeIncoming;
  }
}
