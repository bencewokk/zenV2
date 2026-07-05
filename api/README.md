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
| `POST` | `/api/ai/chat` | Authenticated, quota-enforced DeepSeek/Anthropic streaming gateway. |
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
are filtered client-side before push — `apiKey`/`anthropicApiKey` and `clientSecret`
never leave the device (see `src/services/sync/adapters/filteredBlob.ts`).

## Setup

1. Create a free Atlas M0 cluster, a DB user, and network access (0.0.0.0/0 for dev or
   the host's egress range for prod).
2. `cp .env.example .env` and fill in `MONGODB_URI`, `MONGODB_DB`, `GOOGLE_CLIENT_ID`,
   `CONNECTION_VAULT_KEY`, and `CORS_ALLOWED_ORIGINS`.
3. `npm install`
4. `npm run dev` (`vercel dev`) to run locally, or `vercel deploy` to ship. Set the same
   env vars in the host dashboard for production. AI also requires `DEEPSEEK_API_KEY`;
   later enable Plus Anthropic with `ANTHROPIC_API_KEY` and `ANTHROPIC_ENABLED=true`.

## Subscription and AI quotas

The existing `users` collection is authoritative. The API matches Google identity using
`googleSub`, accepts `active` or `trialing` subscriptions, and maps plans as follows:

- `deepseek` or `basic` → Basic
- `claude`, `anthropic`, or `plus` → Plus
- missing/inactive/unknown → Free (AI hard stop)

Counters live in `ai_usage`, keyed by `{ userId, period, provider, model }`, where period
is UTC `YYYY-MM`. Defaults are 50 DeepSeek calls per model for Basic, 500 DeepSeek calls
per model for Plus, and 100 Anthropic calls per model for Plus. Override with
`AI_CAP_BASIC_DEEPSEEK`, `AI_CAP_PLUS_DEEPSEEK`, and `AI_CAP_PLUS_ANTHROPIC`.

`npm run typecheck` validates the handlers without emitting.
