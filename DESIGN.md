# Zen V2 — Design Document

A from-scratch rewrite of Zen as a modern, web-stack desktop note-taking app.
No code is reused from V1; this document is the single source of truth for the rebuild.

---

## 1. Goals

Rebuild Zen as a **block-based, math-first, AI-integrated** note app with a clean,
feature-modular architecture — escaping V1's god-objects (`ui.py` was 3,277 lines),
duplicated mixins, and three competing math engines.

**Non-negotiable principles:**
1. **Feature-folder structure**, not type-folders. No file over ~400 lines.
2. **No god-components.** The app shell is a thin composer of feature modules.
3. **Service layer is pure TS, UI-agnostic.** AI / sync / storage logic never imports React.
4. **One implementation per concern.** One math engine, one editor, one sync model.
5. Every phase is **independently shippable**.

---

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Shell | **Tauri 2** | Native EXE/installer, ~10MB, OS webview, Rust core for FS/DB/OS |
| UI | **React 18 + TypeScript** | |
| Build | **Vite** | |
| Editor | **TipTap** (ProseMirror) | Block editor; custom nodes for math/table/geometry |
| Block drag | **@tiptap/extension-drag-handle-react** | Grabbable ⠿ handle on every block |
| Note-tree drag | **dnd-kit** | Sidebar hierarchy reorder (separate from block drag) |
| Math render | **KaTeX** | |
| Math edit | **MathLive** | Editable math fields |
| Local DB | **SQLite** via `tauri-plugin-sql` | Replaces V1's `zen_cache.db` |
| State | **Zustand** | Light stores per domain |
| Toasts | **sonner** | Transient feedback (`toast.success/error/promise`) |
| Styling | **Tailwind + CSS variables** | Theme tokens replace V1's `constants.py` |
| AI | provider abstraction | Gemini (cloud) + Ollama (local), streaming |

---

## 3. Architecture

```
zenV2/
├── src-tauri/                 # Rust shell, SQLite, OS integration
└── src/
    ├── app/                   # thin shell: layout, routing, providers
    ├── features/
    │   ├── notes/             # editor, note tree, CRUD
    │   ├── filtering/         # filter bar, facets, search
    │   ├── ai/                # chat panel, providers, inline actions
    │   ├── math/              # MathLive/KaTeX TipTap node
    │   ├── calendar/          # sync, agenda/week/month
    │   ├── home/              # dashboard: clock/weather/insight
    │   └── geometry/          # geometry/graph node
    ├── services/              # pure TS, no React: storage, sync, ai, calendar
    ├── shared/
    │   ├── ui/                # buttons, status bar, toasts wrapper
    │   ├── stores/            # workspace-state store
    │   └── lib/               # utils, types
    └── styles/                # tokens.css
```

**`notify()` wrapper** — all feedback goes through `shared/ui/notify.ts` so the toast
library stays swappable. Sonner is the implementation.

---

## 4. Data model

Notes are a **tree** with rich metadata and cross-links.

```ts
interface Note {
  id: string;
  parentId: string | null;     // hierarchy (#4)
  order: number;                // sibling ordering for drag-reorder
  title: string;
  content: JSONContent;         // TipTap doc (blocks: text/math/table/geometry)
  collapsed: boolean;           // tree collapse/expand state

  // metadata for filtering (#5)
  space: string | null;
  subject: string | null;
  unit: string | null;
  tags: string[];
  inbox: boolean;

  createdAt: number;
  updatedAt: number;
}

interface NoteLink {              // inline [[wiki-links]] (#11)
  fromNoteId: string;
  toNoteId: string;
}
```

SQLite tables: `notes`, `note_links`, `workspace_state`, `ai_config`.
The schema supports hierarchy + tags + links **from day one** to avoid V1-style retrofits.

**Two distinct drag systems:**
- *Within a note* → TipTap drag-handle reorders **blocks**.
- *Sidebar tree* → dnd-kit reorders/moves **notes** (parent/child).

---

## 5. Cross-cutting feedback

| System | Shows | Tech |
|---|---|---|
| **Status bar badges** | *persistent* state: sync on/off, AI idle/busy, calendar connected | shared store + `<StatusBar/>` |
| **Toasts** | *transient* events: "Saved", "Sync failed", "AI ready" | sonner via `notify()` |
| **Dirty indicator** | per-note saved/unsaved (#10) | editor store flag |

Autosave debounced; dirty flag clears on successful persist.

---

## 6. Phase plan

Each phase is shippable.

### Phase 0 — Skeleton
Tauri+React+TS+Vite boots; window; theme tokens; SQLite wired; empty TipTap editor;
`<Toaster/>` mounted. Proves the stack end-to-end.

### Phase 1 — Notes core (the spine)
- TipTap block editor: text, heading, list, **table**
- **Grabbable block drag-handle** (⠿) + "+" insert + block menu
- **Slash-command menu** (`/math`, `/table`, `/geometry`) (#2)
- **Note tree**: parent/child, collapse/expand, **dnd-kit drag-reorder** (#4)
- **Metadata schema** + **filter bar**: space/subject/unit/tags/inbox + full-text (#5)
- **`[[wiki-link]]`** node + autocomplete + navigation (#11)
- **Autosave + dirty indicator** (#10)
- **Workspace-state store**: panel widths, active filters, open note — restored on launch (#8)
- **Status-bar** scaffold (#9)
- Undo/Redo — free via TipTap history (#13)

### Phase 2 — AI  ✅ (shipped, basic)
Chat panel, **model picker**, **streaming**, **note-context-aware** prompts, **inline actions**.
`AIProvider` interface. Provider: **DeepSeek** (OpenAI-compatible) — not Gemini/Ollama.

### Phase 3 — Math  ✅
**MathLive-editable** math node (block + inline), KaTeX available for static render.
One engine. Math survives save/reload reliably. Block math supports multi-line via
`\displaylines`. (V1's `ZEN_MATH_MODE` mode-switching dropped.) (#1, #3)

### Phase 4 — AI tooling  ← NEXT
Turn the assistant from chat into an agent that can *act* (DeepSeek supports
OpenAI-style tool/function calling). Tools to expose:
- **Notes**: create / edit / search / set metadata / navigate
- **Calendar** (Google): read agenda, create/move events, find free slots
- **Gmail** (Google): search threads, summarize, draft replies, label
- **Geometry / math**: insert a plotted block from a description
Also: conversation persistence (threads), better/RAG note context.
See `zenv2-ai-backlog` memory. **Calendar + Gmail integrations (below) are built
here or just before, and registered as AI tools as part of this phase.**

### Phase 5 — Integrations & extras
Most need **Google OAuth**, which realistically needs the **Tauri/Rust backend**
(OAuth redirect + token storage) — so the native shell is a prerequisite for this phase.
- **Google Calendar**: connect/sync, agenda/week/month, quick capture (#7)
- **Gmail**: connect, thread list/search, read, draft/send, labels
- **Geometry/graph** node  ✅ (JSXGraph-backed, spec persisted)
- **Home dashboard**: clock/date/weather/insight  ✅
- **PDF export**

### Phase 6 — Sync
Cloud sync + multi-device. Candidate: **local-first CRDT (Yjs)** — pairs with TipTap,
gives offline/real-time merge. Decided at phase start.

---

## 7. Must-have coverage map

| # | Feature | Phase |
|---|---|---|
| 1 | Block editing (text/math/geometry/tables) | 1, 3, 5 |
| 2 | Fast insertion (slash commands) | 1 |
| 3 | Math-first (live + reliable persistence) | 3 |
| 4 | Hierarchical notes (tree, collapse, drag) | 1 |
| 5 | Powerful filtering | 1 |
| 6 | Integrated AI (picker/stream/context/inline) | 2 |
| 7 | Calendar workspace | 5 |
| 8 | Persistent layout/workspace state | 1 |
| 9 | Status feedback (badges) | 1 |
| 10 | Autosave + dirty-state | 1 |
| 11 | Inline linking/navigation | 1 |
| 12 | Home dashboard | 5 |
| 13 | Undo/Redo | 1 (free) |
| + | Grabbable block handles | 1 |
| + | Toast feedback (sonner) | 0/1 |
