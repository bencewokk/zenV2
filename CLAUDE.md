# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build / test / run

```bash
npm run dev              # Vite dev server (http://localhost:5173)
npm run build            # tsc --noEmit + vite build
npm run typecheck        # tsc --noEmit only
npm run test             # vitest run (src/**/*.test.ts, src/**/*.test.tsx)
npm run preview          # Vite preview of production build
npm run tauri:dev        # Native desktop dev window (needs Rust toolchain)
npm run tauri:build      # Native installer
```

There is also a separate `api/` directory with its own vitest config (`api/vitest.config.ts`).

## Architecture

Zen is a local-first, math-and-AI-integrated notebook for studying and deep work. It runs as a Tauri 2 desktop app or in the browser.

**Stack:** React 18, TypeScript (strict), Vite 8, Tailwind v4 (CSS-based, no `tailwind.config.js`), Zustand 5, TipTap (ProseMirror), KaTeX + MathLive, JSXGraph.

**Top-level layout:**
```
src/
  app/App.tsx       Thin shell — composes feature modules, manages surface routing
  features/         Feature folders (notes, ai, home/deepwork, google, pdfs, math, …)
  services/         Pure TS — no React imports. Storage, AI, sync, Google, memory, sources
  shared/
    ui/             Reusable components (StatusBar, notify wrapper, Masonry, …)
    stores/         Cross-cutting Zustand stores (workspace, status)
    lib/            Utilities, types, docText, markdownDoc, sanitize
  styles/tokens.css  All CSS: Tailwind v4 import, theme tokens, motion, editor, UI classes
src-tauri/          Rust shell (SQLite, OS integration, Google OAuth)
api/                Separate backend API (Express/Cloudflare Workers)
```

**Path alias:** `@/` maps to `src/`.

## Key patterns

### Stores (Zustand)
Every feature has its own Zustand store(s) co-located in its feature folder. Cross-cutting state (workspace layout, status badges) lives in `shared/stores/`. Stores that persist use a `KEY` constant and a `hydrate*()` export for sync to re-read from storage into the live store.

### Services are UI-free
Code in `services/` never imports React or Zustand. They're called by stores and React components. Examples: `services/storage.ts` (IndexedDB note CRUD), `services/sync/engine.ts` (pull/push loop), `services/ai/tools.ts` (tool definitions for the AI agent).

### Sync
Adapter-based pull/push sync. Each domain registers a `SyncAdapter` (notes use per-record adapters; everything else uses blob adapters). Local mutations mark a "dirty" cursor; a debounced push follows. Remote changes hydrate the live Zustand store via the `hydrate*()` functions.

### Storage
Notes are stored in IndexedDB (`zen-notes` DB) with a tombstone-based delete model. The `NoteStore` interface (`services/storage.ts`) abstracts the backend — a Tauri SQLite swap would be a new implementation of that interface.

### AI tools
The AI assistant is an agent with tool-calling capabilities. Tools are defined in `services/ai/tools.ts` and follow the `ToolDef` interface from `services/ai/types.ts`. Each tool reads/writes feature stores directly (not through React).

### CSS / theming
Tailwind v4 is imported in `styles/tokens.css` via `@import "tailwindcss"`. Theme tokens are CSS custom properties on `:root`. Three "looks" (zen/veil/orb) are controlled via `data-look` on `<html>` and retint the core tokens. Motion is CSS `@keyframes` with utility classes (`.zen-anim-fade`, `.zen-anim-rise`, `.zen-pressable`, `.zen-shine`). The `.zen-pressable` class owns ALL transition properties — Tailwind `transition-*` utilities on the same element silently lose because the class is unlayered while Tailwind utilities are layered.

### notify()
All toast feedback goes through `shared/ui/notify.ts` (`notify.success()`, `notify.error()`, `notify.promise()`), which wraps sonner so the library stays swappable.

### Deep Work sessions
The study system has several co-located stores in `features/home/deepwork/`:
- `deepworkStore.ts` — named sessions, each with items (note/PDF/event refs), canvas windows, AI backbone, focus time, study plan
- `studyLog.ts` — global daily focus-hours log (cross-session), streak, editable daily goal
- `studyPlan.ts` — adaptive weekly study plan with deadline×mastery pressure model (no React, pure functions)
- `quizStore.ts` / `lessonStore.ts` — quiz taking and interactive lessons
- `useFocusSession.ts` — global focus timer, persists across reloads, credits time to the study log on session end

### Two drag systems
- **Within a note editor:** TipTap drag-handle reorders blocks
- **Sidebar tree:** dnd-kit reorders/moves notes between parent/child
