# Zen V2 — Sync API

Serverless sync backend for Zen V2. Stateless functions over a free **MongoDB Atlas
M0** cluster, authenticated with **Google ID tokens** (the same Google account the app
already signs in with). Conflict resolution is **last-write-wins** on each document's
`updatedAt`.

This folder is deployed independently of the desktop app — clients only ever talk to it
over HTTPS, so the Mongo credentials never ship inside the app binary.

## Endpoints

All requests must send `Authorization: Bearer <google_id_token>`; every document is
scoped to the token's Google account (`sub`).

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/sync/:collection?since=<seq>` | Pull docs changed after cursor `<seq>` (incl. tombstones). |
| `POST` | `/api/sync/:collection` | Push `{ docs: [...] }`; LWW upsert; returns `{ accepted, rejected, cursor }`. |
| `GET`  | `/api/account` | Return the authenticated account snapshot and subscription access status. |
| `GET` | `/api/ai-usage` | Return the current tier, UTC month, per-model usage, and caps. |
| `POST` | `/api/ai/chat` | Authenticated, budget-enforced DeepSeek streaming gateway. |
| `GET` | `/api/updates/latest` | Public Tauri update manifest backed by the private GitHub release. |
| `GET` | `/api/updates/asset?id=...` | Redirect to a short-lived authenticated release-asset download. |
| `PUT`  | `/api/pdfs/:id?uploadId=&part=&parts=` | Upload one PDF part; the final part atomically assembles it in GridFS. |
| `GET`  | `/api/pdfs/:id?meta=1` | Read the stored PDF byte length. |
| `GET`  | `/api/pdfs/:id?start=&end=` | Download an end-exclusive byte range. |
| `DELETE` | `/api/pdfs/:id` | Delete a PDF binary. |
| `GET` | `/api/connections` | List encrypted provider connections owned by the Google account. |
| `GET` | `/api/connections?restore=1` | Restore decrypted credentials after Google authentication. |
| `PUT` | `/api/connections?provider=ai|canvas|zotero|github` | Encrypt and upsert one provider connection. |
| `DELETE` | `/api/connections?provider=...` | Revoke a saved provider connection. |

`:collection ∈ { notes, ai, deepwork, studylog, workspace, pdfs, quiz, memoryProfile,
memoryEntries, appearance, toolPolicy, aiSettings, googleSettings }`. The last two
are filtered client-side before push — `apiKey` and `clientSecret`
never leave the device (see `src/services/sync/adapters/filteredBlob.ts`).

## Setup

1. Create a free Atlas M0 cluster, a DB user, and network access (0.0.0.0/0 for dev or
   the host's egress range for prod).
2. `cp .env.example .env` and fill in `MONGODB_URI`, `MONGODB_DB`, `GOOGLE_CLIENT_ID`,
   `CONNECTION_VAULT_KEY`, and `CORS_ALLOWED_ORIGINS`.
3. `npm install`
4. `npm run dev` (`vercel dev`) to run locally, or `vercel deploy` to ship. Set the same
   env vars in the host dashboard for production. AI also requires `DEEPSEEK_API_KEY`.
   Private-repository updates require `GITHUB_RELEASES_TOKEN` with read-only Contents
   access scoped only to this repository.

## Subscription and AI quotas

The existing `users` collection is authoritative. The API matches Google identity using
`googleSub`, accepts `active` or `trialing` subscriptions, and maps plans as follows:

- `basic` → Basic (also accepts the legacy `deepseek` keyword)
- `plus` → Plus (also accepts the legacy `claude`/`anthropic` keywords)
- missing/inactive/unknown → Free (AI hard stop)

Budgets live in `ai_usage_budgets`, keyed by `{ userId, period }`, where period is UTC
`YYYY-MM`. Basic uses `deepseek-v4-flash` with a $5 monthly budget; Plus defaults to
`deepseek-v4-pro` and may switch to `deepseek-v4-flash`, with a $25 monthly budget.
Override budgets with `AI_BUDGET_BASIC_USD` and `AI_BUDGET_PLUS_USD`. The requested model
is validated against the tier's allowed set server-side, so a modified client can never
exceed its tier. Actual spend is calculated from provider token usage using the current V4
cache-hit, cache-miss, and output prices.

`npm run typecheck` validates the handlers without emitting.
