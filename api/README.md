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
| `PUT`  | `/api/pdfs/:id` | Upload a PDF binary (octet-stream) to GridFS. |
| `GET`  | `/api/pdfs/:id` | Download a PDF binary. |
| `DELETE` | `/api/pdfs/:id` | Delete a PDF binary. |

`:collection ∈ { notes, ai, deepwork, studylog, workspace, pdfs }`.

## Setup

1. Create a free Atlas M0 cluster, a DB user, and network access (0.0.0.0/0 for dev or
   the host's egress range for prod).
2. `cp .env.example .env` and fill in `MONGODB_URI`, `MONGODB_DB`, `GOOGLE_CLIENT_ID`,
   and `CORS_ALLOWED_ORIGINS`.
3. `npm install`
4. `npm run dev` (`vercel dev`) to run locally, or `vercel deploy` to ship. Set the same
   env vars in the host dashboard for production.

`npm run typecheck` validates the handlers without emitting.
