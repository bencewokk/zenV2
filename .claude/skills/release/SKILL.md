---
name: release
description: Cut, push, and monitor a zenV2 release — check release status, push a pending version tag to trigger the GitHub Actions build, watch it across Windows/macOS/Linux, sync the real release notes onto the GitHub release page, confirm the production smoke test passed, or override the automatic patch bump with a manual minor/major version. Use when asked to release, ship, cut a release, publish a release, bump the version, or check release/CI status.
---

Every commit on `master` is already versioned and tagged locally by
`.githooks/post-commit` (runs `scripts/gen-release-note.mjs`): it bumps the
patch version from the latest tag, writes `release-notes/<version>.md` from
the commit message, and creates a local tag `v<version>`. Nothing is
hand-edited. This skill picks up from there — pushing that tag is what
actually triggers a release, so **driving it is via `gh` and
`.claude/skills/release/driver.mjs`**, not by re-deriving git commands ad hoc.

Paths below are relative to the repo root.

## Prerequisites

GitHub CLI, authenticated as a user with push access to `bencewokk/zenV2`:

```bash
gh auth status   # must show "Logged in to github.com account ..."
```

If missing, install with `winget install --id GitHub.cli -e` (Windows) and
run `gh auth login`. Already installed and authenticated on this machine as
of 2026-07-19 — `C:\Program Files\GitHub CLI` is on the machine `PATH`, so a
fresh shell just has `gh` on PATH.

## Run (agent path)

All commands: `node .claude/skills/release/driver.mjs <command>`

| command | what it does |
|---|---|
| `status` | Read-only. Branch/HEAD vs origin, which tag(s) at HEAD are pending push vs already pushed, dirty `release-notes/` files, last 5 release workflow runs, last 5 GitHub releases. Always start here. |
| `retag <X.Y.Z>` | Overrides the hook's auto patch-bump with a manual version (e.g. for a minor/major milestone release) — retags HEAD and renames `release-notes/<old>.md` → `release-notes/<new>.md`. Refuses if the current tag is already on origin. **No leading `v`.** |
| `push [tag]` | Pushes the branch, then pushes the given tag (or the sole pending tag at HEAD if omitted) — this is what triggers `.github/workflows/release.yml`. Refuses/no-ops if the tag is already on origin. **Pushing is a visible, hard-to-reverse action — confirm with the user before running this**, showing them the pending tag and the release-notes content it'll ship. |
| `watch [tag] [--follow]` | Finds the `release.yml` run for the tag and reports each matrix job (windows-latest/macos-latest/ubuntu-22.04) plus the `Publish complete release` job. Without `--follow`, one snapshot and exit. With `--follow`, polls every 30s until the run completes (~10-12 min historically), then reports the GitHub release's draft/published state and asset count, and — once published — prompts for the `notes` step below. |
| `notes [tag] [--dry-run]` | Sets the GitHub release body from the local `release-notes/<version>.md` (the workflow otherwise leaves the generic "See the assets below..." body from `release.yml`'s `releaseBody`). Reads the file off **local disk**, not from the tag's git history — see Gotchas for why that distinction matters. `--dry-run` prints the computed body without calling `gh`. |

Typical flow:

```bash
node .claude/skills/release/driver.mjs status
# review the pending tag + release-notes/<version>.md with the user, then:
node .claude/skills/release/driver.mjs push v3.5.0
node .claude/skills/release/driver.mjs watch v3.5.0 --follow
node .claude/skills/release/driver.mjs notes v3.5.0
```

`watch --follow` blocks for the length of the build — run it with
`run_in_background: true` (Bash/PowerShell tool) rather than waiting inline.
`notes` edits a public GitHub release page — **confirm with the user before
running it**, same as `push`.

For a milestone release instead of the automatic patch bump:

```bash
node .claude/skills/release/driver.mjs status        # confirm one pending tag at HEAD, not yet pushed
node .claude/skills/release/driver.mjs retag 3.5.0    # only works pre-push
node .claude/skills/release/driver.mjs push v3.5.0
```

## What "done" looks like

`watch` reports `Status: completed/success` for all 3 matrix jobs and
`Publish complete release`, then `draft: false` with a real `published`
timestamp and `assets: 8` (5 installers/signatures + `latest.json` +
sig, across 3 platforms — exact count can drift). If it's still `draft: true`
after the publish job succeeded, something's wrong — check the `publish` job
log; it un-drafts the release and runs `scripts/smoke-production.mjs`
(verifies `/api/health` and the updater manifest) in the same step, so a
still-draft release with a successful publish job shouldn't happen.

## Gotchas

- **Tags are local-only until pushed.** `git push` (no `--tags`/refspec)
  does *not* push tags — that's why `push` explicitly does
  `git push origin refs/tags/<tag>` as a second step.
- **The generated `release-notes/<version>.md` lands *after* the commit
  it describes**, as an untracked file — it rides along on the *next*
  commit, not the one that triggered it. `status` surfaces this under
  `release-notes/ changes` so it isn't mistaken for a problem.
- **Consequence: the note for the release you're actively cutting is often
  not in the tagged commit's git tree yet** (verified: `git show
  v3.4.9:release-notes/3.4.9.md` fails — "exists on disk, but not in
  'v3.4.9'" — while older tags like v3.4.8 do have their own note in-tree,
  once a later commit swept it up). That's why `notes` reads the file off
  local disk instead of teaching `release.yml` to read it from the checkout
  — a CI-side read would silently miss exactly the release being published
  right now, and only work for backfilling older ones.
- **`retag` only works before the tag is pushed.** Once a tag is public,
  retagging would require deleting a remote tag other people/CI may have
  already seen — the driver refuses this outright rather than force-pushing.
- **A tag-triggered run's `headBranch` (in `gh run list --json`) is the tag
  name itself** (e.g. `v3.4.9`), not a branch — that's the field `watch`
  matches on to find the right run.
- **CI needs full git history to resolve the version.** `release.yml`
  checks out with `fetch-depth: 0` specifically so `git describe --tags`
  doesn't fall back to a stale `package.json` version (bit this project
  before — builds 0.2.4–0.2.8 all shipped reporting 0.2.3).

## Troubleshooting

- **`push` says "no tag given and HEAD has 0 pending tags"**: either
  nothing new has been committed since the last release, or the tag at
  HEAD is already on origin (check with `status` first — it lists both).
- **`retag` errors "already pushed to origin — refusing"**: the automatic
  patch-bump tag already made it to GitHub (maybe a previous `push` ran).
  There's no safe automated fix; either ship the patch version as-is or
  manually coordinate a remote tag deletion with the user.
- **`watch` says "no workflow run appeared ... within the wait window"**:
  the tag push may not have actually reached origin — re-run `status` to
  confirm the tag shows under "already on origin" before re-watching.
- **`notes` says "release-notes/X.Y.Z.md not found"**: it only reads the
  local working directory, on whatever machine ran `push` — if you're
  backfilling an old release from a different checkout, `git show
  vX.Y.Z:release-notes/X.Y.Z.md > release-notes/X.Y.Z.md` first (works for
  anything but the very latest, per the Gotcha above).
