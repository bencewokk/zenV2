# Zen production runbook

## Automated gates

- `CI` runs app/API tests, TypeScript builds, Rust checks, and production dependency audits on every push and pull request.
- `Production smoke` checks the API health endpoint and updater manifest hourly.
- Releases remain drafts until every platform uploads successfully; publishing then verifies the updater reports the new version.
- An hourly Vercel cron reconciles interrupted AI reservations and removes abandoned PDF upload parts.

## Required Vercel configuration

Production must define every value documented in `.env.example`. Secrets must be encrypted environment variables. Budget, pricing, quota, and rate-limit values should also be explicit so an operational change does not require a desktop release.

`CRON_SECRET` is required for Vercel and the production monitor to authenticate maintenance work through `/api/health`.

## Native code signing

Tauri updater signatures do not provide Windows SmartScreen or macOS Gatekeeper trust.

For Windows, add `WINDOWS_CERTIFICATE` (a base64-encoded PFX) and `WINDOWS_CERTIFICATE_PASSWORD` as GitHub Actions secrets.

For macOS, add `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password), and `APPLE_TEAM_ID`.

The release workflow automatically enables platform signing when the credentials exist.

## Data recovery

- Enable managed MongoDB backups with retention appropriate to the subscription business.
- Run a restore drill into a separate database before public launch and at least quarterly.
- Never test restore procedures against the production database.
- Monitor storage growth in `pdfs.files`, `pdfs.chunks`, sync collections, and AI event collections.

## Rollback

Backend rollback:

1. Promote the last known-good Vercel deployment to production.
2. Run `node scripts/smoke-production.mjs`.
3. Confirm `/api/health` and `/api/updates/latest` before reopening traffic.

Desktop rollback:

1. Do not overwrite a published tag or artifact.
2. Fix forward and publish a higher patch version because Tauri will not downgrade installed clients.
3. If the latest release is unsafe, mark it as a prerelease and publish the fixed higher version immediately.

## Release-day checks

1. CI is green on the release commit.
2. Production API is deployed before a desktop client that depends on it.
3. Provider pricing and both subscription budgets are verified.
4. MongoDB backup status is healthy.
5. Publish the tag and wait for all signed platform artifacts.
6. Confirm the release smoke job and install the Windows artifact on a clean machine.
