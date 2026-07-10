import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

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

// Every release carries a codename ("randomword"), scoped to the MAJOR
// version: the whole 3.x line shares one word, and a fresh one is drawn only
// when the major number bumps. It lives only in the note's frontmatter and
// human-facing UI — tags and bundle versions stay plain semver because
// Tauri's updater and version.mjs parse them.
const CODENAMES = [
  "Lantern", "Ember", "Sierra", "Meadow", "Drift", "Halcyon", "Quill", "Vesper",
  "Cairn", "Sable", "Aurora", "Tundra", "Willow", "Zephyr", "Cove", "Onyx",
  "Fable", "Harbor", "Juniper", "Kestrel", "Lumen", "Mistral", "Nimbus", "Opal",
  "Pine", "Quartz", "Reverie", "Solstice", "Thicket", "Umber", "Verdant", "Wren",
];
let codename = "";
try {
  const prevNote = readFileSync(`release-notes/${base}.md`, "utf8");
  const match = prevNote.match(/codename:\s*(.+)/);
  if (match) codename = match[1].trim();
} catch {
  /* no previous note — draw fresh below */
}
if (!codename || parseInt(base.split(".")[0], 10) !== maj) {
  codename = CODENAMES[Math.floor(Math.random() * CODENAMES.length)];
}

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
writeFileSync(file, `---\ndate: ${date}\ncodename: ${codename}\n---\n\n${body}\n`);

sh(`git tag v${version}`);
console.log(`[release] tagged v${version} "${codename}" · ${file}`);
