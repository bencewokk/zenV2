# Zen

A calm, **math-first, AI-integrated** notebook for studying and deep work. Zen brings
your notes, PDFs, calendar, and email into one focused workspace — with a block editor,
inline math, spaced-repetition study tools, and an AI assistant that actually knows your
material.

Zen runs as a lightweight native desktop app (via [Tauri](https://tauri.app/)) or straight
in your browser for a quick look.

> **Local-first & private.** Your notes live on your own device. Nothing is sent anywhere
> until *you* connect an AI provider or your Google account — both optional, both entered
> in-app, no config files required.

Google sign-in also anchors Zen's encrypted connection vault: Canvas, Zotero, and GitHub
credentials can follow the same user across devices without entering them again.

---

## Try it in 60 seconds (browser, no toolchain)

You only need [Node.js](https://nodejs.org/) 18+.

```bash
git clone https://github.com/bencewokk/zenV2.git
cd zenV2
npm install
npm run dev
```

Open the printed URL (http://localhost:5173). That's it — you get the full app, notes save
to your browser, and a welcome note walks you through the rest. No Rust, no API keys, no
Google setup needed to start.

> The browser build is great for trying Zen. For a real, persistent install — a native
> window, a desktop installer, and a Google login that *survives restarts* — use the
> desktop build below.

---

## Features

- **Block editor** with slash (`/`) commands — headings, lists, tables, and more.
- **Math-first** — editable equations (MathLive) rendered with KaTeX, plus geometry/graph blocks.
- **AI assistant** — chat over your notes, inline rewrites, and an auto-generated daily brief (bring your own DeepSeek key).
- **Deep Work sessions** — timed focus blocks, a study backbone, quizzes, and spaced-repetition scheduling.
- **Calendar & Mail** — pull Google Calendar events and Gmail threads into your daily focus (optional).
- **Canvas** — let the assistant read connected courses, assignments, modules, announcements, and files (optional).
- **Connected Sources** — index selected Drive folders, Zotero libraries, GitHub repositories, and browser captures in one searchable library.
- **On-device PDF indexing** — semantic search across your PDFs, computed locally.
- **Local-first storage** — your data stays on your machine.

---

## Optional integrations

Everything below is **off by default** and configured inside the app at
**Settings ⚙ → Connections & keys** — no environment variables or JSON files needed.

| Feature | What you need | Where to get it |
|---|---|---|
| AI assistant | A DeepSeek API key | <https://platform.deepseek.com/> |
| Calendar & Mail | Just sign in — a default Google client is bundled¹ | See [desktop setup](src-tauri/SETUP.md) to use your own |
| Canvas | Your institution URL and a personal access token | Canvas Account settings, when enabled by your institution |
| Google Drive | The existing Google connection plus selected folder IDs | Share or copy a Drive folder URL |
| Zotero | Library ID and API key | <https://www.zotero.org/settings/keys> |
| GitHub | Repository names; token optional for public repositories | <https://github.com/settings/tokens> |

The AI assistant needs a DeepSeek key. Calendar & Mail work out of the box with a bundled
Google client — just connect your account. If you skip these, the rest of the app works
exactly as before; you just won't see the AI or Google panels light up.

> ¹ The bundled Google client is **unverified**, so Google limits it to 100 users and shows
> an "unverified app" notice during sign-in. Bring your own client (Settings → Connections)
> to avoid that. See [src-tauri/SETUP.md](src-tauri/SETUP.md).

---

## Desktop build (native app)

The desktop build wraps the app in a native window and runs Google OAuth in Rust so your
login persists across restarts. It needs the Rust toolchain and platform build tools.

```bash
npm install
npm run tauri:dev      # native dev window (first build compiles Rust — slow once)
npm run tauri:build    # produces an installer under src-tauri/target/release/bundle/
```

Full prerequisites (Rust, MSVC/Xcode/Linux build tools) and the Google OAuth walkthrough
are in **[src-tauri/SETUP.md](src-tauri/SETUP.md)**.

### Prebuilt installers

If you just want to run Zen without building it, grab the latest installer for your OS from
the [**Releases**](https://github.com/bencewokk/zenV2/releases) page.

---

## Project layout

```
src/
  app/        thin app shell (layout, routing)
  features/   notes, ai, home/deepwork, google, pdfs, settings, …
  services/   pure TS: storage, ai, google, memory (no React)
  shared/     ui primitives, stores, libs
src-tauri/    Rust shell: SQLite, OS integration, Google OAuth
```

See [DESIGN.md](DESIGN.md) for the architecture and guiding principles.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Browser dev server (Vite) |
| `npm run build` | Type-check + production web build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run tauri:dev` | Native desktop dev window |
| `npm run tauri:build` | Build native installer |
