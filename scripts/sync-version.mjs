import { readFileSync, writeFileSync } from "node:fs";
import { gitVersion } from "./version.mjs";

/**
 * Propagate the git-tag version into the files that can't read git at runtime:
 *  - src-tauri/tauri.conf.json — read by Tauri at build time for the bundle
 *    version and the auto-updater's version comparison.
 *  - package.json — kept in sync purely as the offline fallback for
 *    scripts/version.mjs (so a tarball build still reports the right number).
 *
 * Cargo.toml is intentionally left at 0.0.0: Tauri uses tauri.conf.json's
 * version when present, and touching Cargo.toml forces a full Rust rebuild.
 *
 * Idempotent — only rewrites a file when the value actually changed, so a
 * normal build on a clean tag produces no git diff.
 */
const version = gitVersion();
let changed = false;

function patchJson(relPath, mutate) {
  const url = new URL(`../${relPath}`, import.meta.url);
  const raw = readFileSync(url, "utf8");
  const json = JSON.parse(raw);
  if (mutate(json)) {
    // Preserve a trailing newline; match the existing 2-space indent.
    writeFileSync(url, JSON.stringify(json, null, 2) + "\n");
    console.log(`  synced ${relPath} → ${version}`);
    changed = true;
  }
}

patchJson("src-tauri/tauri.conf.json", (j) => {
  if (j.version === version) return false;
  j.version = version;
  return true;
});

patchJson("package.json", (j) => {
  if (j.version === version) return false;
  j.version = version;
  return true;
});

console.log(changed ? `Version synced to ${version}` : `Version already ${version} — nothing to do`);
