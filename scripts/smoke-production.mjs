const base = (process.env.ZEN_API_URL || "https://zen-v2-plum.vercel.app").replace(/\/$/, "");
const expected = (process.env.EXPECTED_VERSION || "").replace(/^v/, "");

async function json(path) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

const health = await json("/api/health");
if (health.ok !== true) throw new Error("health response is not healthy");

let update;
for (let attempt = 1; attempt <= (expected ? 8 : 1); attempt++) {
  update = await json("/api/updates/latest");
  if (!expected || update.version === expected) break;
  if (attempt < 8) await new Promise((resolve) => setTimeout(resolve, 10_000));
}
if (!update.version || !update.platforms?.["windows-x86_64"]) throw new Error("updater manifest is incomplete");
if (expected && update.version !== expected) throw new Error(`expected updater ${expected}, received ${update.version}`);

console.log(`Production smoke passed: API healthy, updater ${update.version}`);

if (process.env.CRON_SECRET) {
  const response = await fetch(`${base}/api/health`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`maintenance reconciliation returned ${response.status}`);
  const maintenance = await response.json();
  console.log(`Maintenance passed: ${maintenance.maintenance?.reconciled ?? 0} reservations, ${maintenance.maintenance?.uploadsDeleted ?? 0} uploads reconciled`);
}
