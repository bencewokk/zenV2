export interface ReleaseEntry {
  /** Semver, no leading "v" — taken from the markdown filename. */
  version: string;
  /** From the file's `date:` frontmatter, or "" if absent. */
  date: string;
  /** From the file's `codename:` frontmatter — the release's "randomword". */
  codename: string;
  /** Markdown body (frontmatter stripped). Rendered in the modal. */
  body: string;
  /** First line of the body, plain text — used for the dashboard card. */
  summary: string;
}

/**
 * Release notes live as one markdown file per version in /release-notes
 * (e.g. release-notes/0.2.4.md). The git post-commit hook writes a new file
 * from each commit message (see scripts/gen-release-note.mjs), so the changelog
 * is generated automatically — this module just loads and parses the folder.
 *
 * The filename is the version; an optional `date:` frontmatter line supplies
 * the date. Versions come from git tags, so the newest file always matches the
 * current build.
 */
const files = import.meta.glob("/release-notes/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function parse(path: string, raw: string): ReleaseEntry {
  const version = path.split("/").pop()!.replace(/\.md$/, "");
  let date = "";
  let codename = "";
  let body = raw;

  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    const d = fm[1].match(/date:\s*(.+)/);
    if (d) date = d[1].trim();
    const c = fm[1].match(/codename:\s*(.+)/);
    if (c) codename = c[1].trim();
    body = raw.slice(fm[0].length);
  }
  body = body.trim();

  // First meaningful line for the card, stripped of leading markdown markers.
  // Skip `#` headings that just restate the version/codename (the card already
  // shows both), but fall back to them for notes that are heading-only.
  const lines = body.split("\n").filter((l) => l.trim());
  const summary = (lines.find((l) => !l.trim().startsWith("#")) ?? lines[0] ?? "")
    .replace(/^[-*#>\s]+/, "")
    .slice(0, 120);

  return { version, date, codename, body, summary };
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/** All releases, newest first. */
export const RELEASE_NOTES: ReleaseEntry[] = Object.entries(files)
  .map(([path, raw]) => parse(path, raw))
  .sort((a, b) => cmpSemver(b.version, a.version));

/** Current build version without the leading "v" (`__APP_VERSION__` is `v0.2.4`). */
export const CURRENT_VERSION = __APP_VERSION__.replace(/^v/, "");

/** The entry matching the current build, or the newest as a fallback. */
export const LATEST_RELEASE: ReleaseEntry | undefined =
  RELEASE_NOTES.find((r) => r.version === CURRENT_VERSION) ?? RELEASE_NOTES[0];

if (import.meta.env.DEV && RELEASE_NOTES[0]?.version !== CURRENT_VERSION) {
  console.warn(
    `[releaseNotes] newest note is v${RELEASE_NOTES[0]?.version} but the build is v${CURRENT_VERSION} — ` +
      `the post-commit hook should have generated release-notes/${CURRENT_VERSION}.md.`,
  );
}
