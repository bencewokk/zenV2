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
   env vars in the host dashboard for production.

`npm run typecheck` validates the handlers without emitting.
