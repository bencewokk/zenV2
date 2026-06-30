import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

/**
 * Run by the post-commit git hook (.githooks/post-commit). Each commit becomes
 * a new patch release: bump the latest tag, write release-notes/<version>.md
 * from the commit message, and tag the commit `v<version>`.
 *
 * The version is derived from git tags (scripts/version.mjs), so tagging here is
 * all that's needed for the app, bundle, and updater to pick up the new number.
 */
function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

// Idempotency guard: if this commit is already tagged (e.g. the hook somehow
// runs twice), do nothing.
try {
  const existing = sh("git tag --points-at HEAD").split("\n").filter(Boolean);
  if (existing.some((t) => /^v\d+\.\d+\.\d+$/.test(t))) process.exit(0);
} catch {
  /* not a git repo — nothing to do */
  process.exit(0);
}

const subject = sh("git log -1 --pretty=%s");
// Skip merge commits — they don't represent a release.
if (/^Merge /.test(subject)) process.exit(0);

let latest = "";
try {
  latest = sh("git describe --tags --abbrev=0");
} catch {
  /* no tags yet */
}
const base = latest.replace(/^v/, "") || "0.0.0";
const [maj, min, pat] = base.split(".").map((n) => parseInt(n, 10) || 0);
const version = `${maj}.${min}.${pat + 1}`;

const date = new Date().toISOString().slice(0, 10);

// Prefer the commit body (the detailed lines under the subject); fall back to
// the subject for one-line commits. The modal already shows the version as a
// heading, so the subject would just be noise when a body exists.
const rawBody = sh("git log -1 --pretty=%b");
const stripped = rawBody
  .split("\n")
  .filter((l) => !/^(Co-authored-by|Signed-off-by):/i.test(l.trim()))
  .join("\n")
  .trim();

// One-line commit → render the subject as a single bullet.
const body = stripped || `- ${subject}`;

mkdirSync("release-notes", { recursive: true });
const file = `release-notes/${version}.md`;
writeFileSync(file, `---\ndate: ${date}\n---\n\n${body}\n`);

sh(`git tag v${version}`);
console.log(`[release] tagged v${version} · ${file}`);
