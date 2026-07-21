#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, renameSync, readFileSync, writeFileSync, rmSync } from "node:fs";

// Driver for the /release skill — picks up from "local tag exists" (made by
// .githooks/post-commit + scripts/gen-release-note.mjs) through "CI published it".

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function shSafe(cmd) {
  try {
    return sh(cmd);
  } catch {
    return "";
  }
}
function shJson(cmd) {
  const out = sh(cmd);
  return out ? JSON.parse(out) : null;
}
function ghJsonSafe(args) {
  try {
    return shJson(`gh ${args}`);
  } catch {
    return null;
  }
}

const VERSION_TAG_RE = /^v\d+\.\d+\.\d+$/;

function tagsAtHead() {
  return shSafe("git tag --points-at HEAD")
    .split("\n")
    .filter((t) => VERSION_TAG_RE.test(t));
}

function isTagOnOrigin(tag) {
  return shSafe(`git ls-remote --tags origin refs/tags/${tag}`).length > 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// status — read-only picture of where the repo sits relative to a release.
// ---------------------------------------------------------------------------
function cmdStatus() {
  shSafe("git fetch --quiet --tags origin");
  const branch = sh("git rev-parse --abbrev-ref HEAD");
  const headSha = sh("git rev-parse --short HEAD");
  const headSubject = sh("git log -1 --pretty=%s");

  const aheadBehind = shSafe(`git rev-list --left-right --count origin/${branch}...HEAD`);
  const [behind, ahead] = aheadBehind ? aheadBehind.split("\t").map(Number) : [0, 0];

  const headTags = tagsAtHead();
  const pending = headTags.filter((t) => !isTagOnOrigin(t));
  const pushedAtHead = headTags.filter((t) => isTagOnOrigin(t));

  const dirtyNotes = shSafe("git status --porcelain -- release-notes")
    .split("\n")
    .filter(Boolean);

  console.log(`Branch:        ${branch} (${headSha}) "${headSubject}"`);
  console.log(`vs origin:     ${ahead} ahead, ${behind} behind`);
  console.log(`Tags at HEAD:  ${headTags.length ? headTags.join(", ") : "(none)"}`);
  console.log(`  pending push: ${pending.length ? pending.join(", ") : "(none)"}`);
  console.log(`  already on origin: ${pushedAtHead.length ? pushedAtHead.join(", ") : "(none)"}`);
  console.log(`release-notes/ changes: ${dirtyNotes.length ? dirtyNotes.join(" | ") : "(clean)"}`);

  const runs = ghJsonSafe(
    `run list --workflow=release.yml --limit 5 --json headBranch,status,conclusion,displayTitle,createdAt,url`
  );
  console.log("\nLast 5 release workflow runs:");
  for (const r of runs ?? []) {
    console.log(`  ${r.headBranch.padEnd(10)} ${r.status}/${r.conclusion || "-"}  ${r.createdAt}  ${r.url}`);
  }

  const releases = ghJsonSafe(`release list --limit 5 --json tagName,isDraft,publishedAt`);
  console.log("\nLast 5 GitHub releases:");
  for (const r of releases ?? []) {
    console.log(`  ${r.tagName.padEnd(10)} ${r.isDraft ? "DRAFT" : "published"}  ${r.publishedAt || ""}`);
  }

  if (pending.length) {
    console.log(`\nReady to release: run \`node driver.mjs push ${pending[0]}\` (after you confirm with the user).`);
  }
}

// ---------------------------------------------------------------------------
// retag — override the hook's auto patch-bump with a manual minor/major
// version, before anything has been pushed.
// ---------------------------------------------------------------------------
function cmdRetag(newVersionArg) {
  if (!newVersionArg || !/^\d+\.\d+\.\d+$/.test(newVersionArg)) {
    throw new Error("usage: retag <newVersion>  (e.g. retag 3.5.0 — no leading 'v')");
  }
  const headTags = tagsAtHead();
  if (headTags.length !== 1) {
    throw new Error(
      `expected exactly one version tag at HEAD, found: ${headTags.join(", ") || "(none)"}. ` +
        `Nothing to retag — has the post-commit hook run yet?`
    );
  }
  const oldTag = headTags[0];
  if (isTagOnOrigin(oldTag)) {
    throw new Error(`${oldTag} is already pushed to origin — refusing to retag a public tag. Revert manually if needed.`);
  }
  const oldVersion = oldTag.replace(/^v/, "");
  const newTag = `v${newVersionArg}`;
  if (oldVersion === newVersionArg) {
    console.log(`Already ${newTag} — nothing to do.`);
    return;
  }

  const oldNote = `release-notes/${oldVersion}.md`;
  const newNote = `release-notes/${newVersionArg}.md`;
  if (!existsSync(oldNote)) {
    throw new Error(`expected ${oldNote} to exist (written by the post-commit hook) but it's missing.`);
  }
  if (existsSync(newNote)) {
    throw new Error(`${newNote} already exists — pick a version that hasn't been used.`);
  }

  const tracked = shSafe(`git ls-files --error-unmatch ${oldNote}`).length > 0;
  if (tracked) {
    sh(`git mv ${oldNote} ${newNote}`);
  } else {
    renameSync(oldNote, newNote);
  }

  sh(`git tag -d ${oldTag}`);
  sh(`git tag ${newTag}`);

  console.log(`Retagged ${oldTag} -> ${newTag}, moved ${oldNote} -> ${newNote}.`);
  if (tracked) {
    console.log(`${newNote} is staged (git mv) — commit it before pushing.`);
  } else {
    console.log(`${newNote} is untracked — it'll ride along on the next commit, per the usual flow.`);
  }
}

// ---------------------------------------------------------------------------
// push — push the branch + one release tag that isn't on origin yet.
// ---------------------------------------------------------------------------
function cmdPush(tagArg) {
  const branch = sh("git rev-parse --abbrev-ref HEAD");
  let tag = tagArg;
  if (!tag) {
    const pending = tagsAtHead().filter((t) => !isTagOnOrigin(t));
    if (pending.length !== 1) {
      throw new Error(
        `no tag given and HEAD has ${pending.length} pending tags (${pending.join(", ") || "none"}) — pass one explicitly.`
      );
    }
    tag = pending[0];
  }
  if (!VERSION_TAG_RE.test(tag)) throw new Error(`"${tag}" doesn't look like a vX.Y.Z release tag.`);
  if (isTagOnOrigin(tag)) {
    console.log(`${tag} is already on origin — nothing to push. Run \`watch ${tag}\` instead.`);
    return;
  }

  console.log(`Pushing ${branch}...`);
  console.log(sh(`git push origin ${branch} 2>&1`) || "(up to date)");
  console.log(`Pushing tag ${tag} (triggers .github/workflows/release.yml)...`);
  console.log(sh(`git push origin refs/tags/${tag} 2>&1`) || "(no output)");
  console.log(`\nPushed. Run \`node driver.mjs watch ${tag} --follow\` to track the build.`);
}

// ---------------------------------------------------------------------------
// notes — push the local release-notes/<version>.md into the GitHub release
// body. release.yml sets a generic body at publish time; the real note only
// ever exists as a local file at push time (it isn't reliably committed into
// the tagged commit's tree — see SKILL.md Gotchas), so this reads off disk
// rather than from a checkout of the tag.
// ---------------------------------------------------------------------------
function parseNote(raw) {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fm) return { codename: "", body: raw.trim() };
  const c = fm[1].match(/codename:\s*(.+)/);
  return { codename: c ? c[1].trim() : "", body: raw.slice(fm[0].length).trim() };
}

function cmdNotes(tagArg, dryRun) {
  const tag = tagArg || shSafe("git tag --points-at HEAD").split("\n").find((t) => VERSION_TAG_RE.test(t));
  if (!tag || !VERSION_TAG_RE.test(tag)) throw new Error("usage: notes <tag> [--dry-run]  (e.g. notes v3.4.9)");
  const version = tag.replace(/^v/, "");
  const notePath = `release-notes/${version}.md`;
  if (!existsSync(notePath)) throw new Error(`${notePath} not found — nothing to sync.`);

  const { codename, body } = parseNote(readFileSync(notePath, "utf8"));
  const finalBody = `${codename ? `_Codename: ${codename}_\n\n` : ""}${body}\n`;

  if (dryRun) {
    console.log(`--- would set ${tag}'s release body to: ---\n${finalBody}`);
    return;
  }

  const tmp = `.release-notes-${version}.tmp.md`;
  writeFileSync(tmp, finalBody);
  try {
    sh(`gh release edit ${tag} --notes-file ${tmp}`);
    console.log(`Synced ${tag}'s GitHub release body from ${notePath}.`);
  } finally {
    rmSync(tmp, { force: true });
  }
}

// ---------------------------------------------------------------------------
// watch — find the release.yml run for a tag and report (or follow) it.
// ---------------------------------------------------------------------------
function findRunForTag(tag) {
  const runs =
    ghJsonSafe(
      `run list --workflow=release.yml --limit 20 --json databaseId,headBranch,status,conclusion,url,createdAt`
    ) ?? [];
  return runs.find((r) => r.headBranch === tag) ?? null;
}

function printRunReport(run, jobs) {
  console.log(`Run: ${run.url}`);
  console.log(`Status: ${run.status}${run.conclusion ? `/${run.conclusion}` : ""}`);
  for (const j of jobs ?? []) {
    console.log(`  ${j.name.padEnd(55)} ${j.status}${j.conclusion ? `/${j.conclusion}` : ""}`);
  }
}

async function cmdWatch(tagArg, follow) {
  const tag = tagArg || shSafe("git tag --points-at HEAD").split("\n").find((t) => VERSION_TAG_RE.test(t));
  if (!tag) throw new Error("no tag given and none found at HEAD.");

  const deadline = Date.now() + 25 * 60 * 1000; // release builds run ~10-12 min historically
  let run = findRunForTag(tag);
  while (!run && Date.now() < deadline) {
    console.log(`No workflow run found yet for ${tag}, waiting for it to register...`);
    await sleep(15_000);
    run = findRunForTag(tag);
  }
  if (!run) throw new Error(`no release.yml run appeared for ${tag} within the wait window.`);

  for (;;) {
    const detail = ghJsonSafe(`run view ${run.databaseId} --json status,conclusion,jobs,url`);
    printRunReport({ url: run.url, status: detail.status, conclusion: detail.conclusion }, detail.jobs);
    if (detail.status === "completed" || !follow) {
      if (detail.status === "completed" && detail.conclusion === "success") {
        const rel = ghJsonSafe(`release view ${tag} --json isDraft,publishedAt,assets,url`);
        console.log(`\nRelease: ${rel?.url}`);
        console.log(`  draft: ${rel?.isDraft}  published: ${rel?.publishedAt || "-"}  assets: ${rel?.assets?.length ?? 0}`);
        if (rel?.isDraft) {
          console.log(`  NOTE: still a draft — the "Publish complete release" job un-drafts it after all platforms upload; check back if it's still running.`);
        } else {
          console.log(`  Run \`node driver.mjs notes ${tag}\` to sync the GitHub release body from release-notes/${tag.replace(/^v/, "")}.md.`);
        }
      }
      return detail;
    }
    console.log(`(${new Date().toISOString()}) still running, checking again in 30s...`);
    await sleep(30_000);
  }
}

// ---------------------------------------------------------------------------
const [, , cmd, arg1] = process.argv;
const follow = process.argv.includes("--follow");
const dryRun = process.argv.includes("--dry-run");

try {
  switch (cmd) {
    case "status":
      cmdStatus();
      break;
    case "retag":
      cmdRetag(arg1);
      break;
    case "push":
      cmdPush(arg1);
      break;
    case "notes":
      cmdNotes(arg1, dryRun);
      break;
    case "watch":
      await cmdWatch(arg1, follow);
      break;
    default:
      console.error("usage: node driver.mjs <status|retag <ver>|push [tag]|notes [tag] [--dry-run]|watch [tag] [--follow]>");
      process.exit(1);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
