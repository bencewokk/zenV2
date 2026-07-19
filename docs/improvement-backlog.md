# Zen improvement backlog

Last reviewed: 2026-07-19

This is the prioritized follow-up list from the post-v3.4.10 app audit. Keep the
top section short and executable; move completed work into release notes rather
than leaving finished items here indefinitely.

## Completed in this pass (2026-07-19)

1. **Safe backup and settings export** — strip credentials from every export,
   reject imported secrets, and retain a device credential only while its
   provider/client/origin identity is unchanged. The UI now states that JSON
   backups exclude PDF binaries and the IndexedDB source cache.
2. **Conflict-safe sync** — make sequence allocation, quota checks, LWW writes,
   and conflict reads transactional; defer dirty pull records; and advance pull
   cursors only after local generations and server winners are resolved.

## Next priorities

1. **Note durability** *(medium)* — replace the 700 ms fire-and-forget autosave
   window with a serialized write queue or draft journal, flush on visibility /
   page lifecycle changes, and surface save failures.
2. **Startup and install-size diet** *(medium-large)* — lazy-load the AI tool
   runtime, PDF.js, MathLive, Compute Engine, and JSXGraph; reduce the emitted
   ONNX WASM variants; add bundle-size budgets to CI.
3. **Settings state and recovery routing** *(small)* — prevent section changes
   from silently discarding unsaved drafts, and deep-link Sync, Calendar, AI, and
   source setup actions to the relevant settings section.
4. **One-click web capture** *(medium)* — replace the extension's download then
   manual-import flow with a safe direct handoff (custom protocol, native
   messaging, or an authenticated capture endpoint).
5. **Global search quality** *(small-medium)* — fix multi-token false positives,
   remove unreachable hard result caps, add grouped “show all” results, and layer
   semantic matches after instant lexical results.
6. **Decisive study action** *(medium)* — make “What should I do now?” a primary
   action driven by deadline, mastery, missed work, and real calendar capacity.
7. **End-to-end and release confidence** *(medium)* — cover save/reload,
   backup/restore, concurrent sync, AI streaming, PDF import, and quiz flows;
   require successful verification before a release is made public.
8. **Smaller AI prompts** *(medium)* — route the roughly 85 tool schemas by
   intent/category and enforce a true long-conversation context cap.

## Additional hardening

- Add per-user temporary-PDF upload quotas and make PDF generation replacement
  atomic before garbage-collecting the previous generation.
- Make assistant-originated sync mutations compare-and-swap against concurrent
  desktop edits instead of relying only on a fresh wall-clock timestamp.
- Define full-backup restore precedence for every synced domain (not only notes
  and portable settings), then add an optional archive format for PDF/source data.
- Provision critical Mongo indexes and duplicate cleanup as a deployment
  migration instead of request hot paths, and make a failed cached Mongo
  connection retryable. Runtime index checks now fail closed rather than running
  without required uniqueness guarantees.
- Make GitHub source refresh honor the configured repository selection, use
  bounded concurrency and conditional requests, and support cancellation.
- Add a timeout/cancellation path to desktop OAuth and explicit HTTP timeouts for
  token exchange and refresh.
- Configure platform-appropriate keyring backends for every desktop release
  target and smoke-test persisted login on each platform.
- Standardize destructive-action confirmation/Undo behavior and improve keyboard
  and screen-reader semantics in shared navigation controls.
- Offer a fast “Start local now” onboarding path, with integrations introduced
  progressively when they become relevant.
