import { createHash } from "node:crypto";

export interface SyncTieBreakInput {
  deleted?: boolean;
  data?: unknown;
}

/** Stable JSON for the JSON-compatible values accepted by sync writers. */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${Array.from(value, (item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Equal timestamps use the lexicographically larger digest as the winner. */
export function syncTieBreak(input: SyncTieBreakInput): string {
  return createHash("sha256")
    .update(canonicalJson({ deleted: !!input.deleted, data: input.data ?? null }))
    .digest("hex");
}
