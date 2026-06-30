import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Single source of truth for the app version: the latest git tag.
 *
 * Releases are cut by tagging (`git tag v0.2.4 && git push --tags`); the tag
 * name — minus the leading `v` — is the version used everywhere (frontend
 * `__APP_VERSION__`, the Tauri bundle, the updater). Nothing is hand-edited.
 *
 * `--abbrev=0` returns just the nearest tag (e.g. `0.2.3`), so dev builds
 * between releases report the last shipped version rather than a noisy
 * `0.2.3-4-gabc123` string that isn't valid semver for Tauri/Cargo.
 *
 * Fallback order when git is unavailable (source tarball, shallow CI clone
 * with no tags): the version baked into package.json, then `0.0.0`.
 */
export function gitVersion() {
  // Explicit override, set by CI from the pushed tag ref (GITHUB_REF_NAME).
  // This is authoritative: a tag-triggered release build must use the tag it
  // was triggered by, not whatever `git describe` resolves to in a CI checkout
  // (which has bitten us — see release.yml). Local builds leave it unset and
  // fall through to git.
  const override = process.env.ZEN_RELEASE_VERSION?.trim();
  if (override) return override.replace(/^v/, "");
  try {
    const tag = execSync("git describe --tags --abbrev=0", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (tag) return tag.replace(/^v/, "");
  } catch {
    /* no tags / not a git checkout — fall through */
  }
  try {
    const url = new URL("../package.json", import.meta.url);
    const { version } = JSON.parse(readFileSync(url, "utf8"));
    if (version) return version;
  } catch {
    /* ignore */
  }
  return "0.0.0";
}
