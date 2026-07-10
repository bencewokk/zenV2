import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../_lib/db.js";
import { errorFields, logEvent } from "../_lib/observability.js";
import { reconcileStaleReservations } from "../_lib/billing.js";
import { cleanupTemporaryPdfUploads } from "../pdfs/[id].js";
import { runDueAssistantRoutines, type RoutineRunSummary } from "../_lib/assistantRoutines.js";

const REQUIRED_ENV = ["MONGODB_URI", "GOOGLE_CLIENT_ID", "DEEPSEEK_API_KEY", "CONNECTION_VAULT_KEY", "GITHUB_RELEASES_TOKEN"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") { res.status(405).json({ error: "method not allowed" }); return; }
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  try {
    let maintenance: { reconciled: number; uploadsDeleted: number; routines: RoutineRunSummary } | undefined;
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) {
      const [reconciled, uploadsDeleted, routines] = await Promise.all([
        reconcileStaleReservations(),
        cleanupTemporaryPdfUploads(),
        runDueAssistantRoutines({ limit: 4, timeBudgetMs: 48_000 }),
      ]);
      maintenance = { reconciled, uploadsDeleted, routines };
      logEvent("maintenance_completed", maintenance);
    }
    await Promise.race([
      getDb().then((db) => db.command({ ping: 1 })),
      new Promise((_, reject) => setTimeout(() => reject(new Error("database health check timed out")), 4_000)),
    ]);
    if (missing.length) throw new Error(`missing required configuration: ${missing.join(", ")}`);
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "HEAD") { res.status(200).end(); return; }
    res.status(200).json({ ok: true, service: "zen-api", timestamp: new Date().toISOString(), ...(maintenance ? { maintenance } : {}) });
  } catch (error) {
    logEvent("health_check_failed", { ...errorFields(error), missing }, "error");
    if (req.method === "HEAD") { res.status(503).end(); return; }
    res.status(503).json({ ok: false, service: "zen-api" });
  }
}
