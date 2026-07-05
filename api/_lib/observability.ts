export function logEvent(event: string, fields: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info"): void {
  const payload = JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.info(payload);
}
export function errorFields(error: unknown): { error: string; stack?: string } {
  const value = error instanceof Error ? error : new Error(String(error));
  return {
    error: value.message.slice(0, 500),
    ...(process.env.NODE_ENV !== "production" && value.stack ? { stack: value.stack } : {}),
  };
}
