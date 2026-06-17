# Zen Desktop (Tauri) — setup

This wraps the existing React/Vite app in a native desktop window and runs Google
OAuth in Rust so the login **persists** (a real refresh token kept in the OS
secure store), instead of the browser's ~1‑hour access token.

## 1. Toolchain (one-time)

- **Rust** — install via <https://rustup.rs/> (gives `cargo` + `rustc`). ✅ already installed.
- **MSVC C++ Build Tools** — install "Desktop development with C++" from the
  [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
  Required to compile native code (and the TLS crate). Restart your terminal afterward so
  `~/.cargo/bin` and the MSVC toolchain are on `PATH`.
- **WebView2** — preinstalled on Windows 11.

> macOS/Linux: in `Cargo.toml` swap the `keyring` feature from `windows-native` to
> `apple-native` (macOS) or `sync-secret-service` (Linux).

## 2. Google OAuth credentials

The desktop flow needs a **Desktop app** OAuth client (the browser build used a Web client):

1. Google Cloud Console → APIs & Services → Credentials → *Create credentials* →
   *OAuth client ID* → Application type **Desktop app**.
2. Copy the **Client ID** and **Client secret**.
3. Provide them to the app one of two ways:
   - **File:** copy `src-tauri/google_oauth.example.json` to `src-tauri/google_oauth.json`
     and fill in the values (this file is gitignored), **or**
   - **Env vars:** set `ZEN_GOOGLE_CLIENT_ID` and `ZEN_GOOGLE_CLIENT_SECRET` before running.

No redirect URI config is needed — the app uses a loopback redirect
(`http://127.0.0.1:<random-port>`), which Google allows for Desktop clients.

## 3. Run

```bash
npm install            # if you haven't since pulling these changes
npm run tauri:dev      # builds the Rust shell + launches the app (first build is slow)
```

The first `tauri:dev` compiles all Rust dependencies — expect a few minutes once.
Subsequent runs are fast. Vite HMR still works inside the window.

## 4. Build an installer

```bash
npm run tauri:build
```

Produces a Windows installer (MSI/NSIS) under `src-tauri/target/release/bundle/`.

## How auth is wired

- `src-tauri/src/auth.rs` — `google_login`, `google_access_token`, `google_logout`,
  `google_is_signed_in` Tauri commands (Authorization Code flow, loopback redirect,
  refresh token in `keyring`).
- `src/services/google/auth.ts` — detects Tauri (`__TAURI_INTERNALS__`) and calls those
  commands via `invoke(...)`; in a plain browser it falls back to the GIS token flow.

## Icons

`src-tauri/icons/` is generated from `app-icon.png` (a placeholder blue square). Replace
`app-icon.png` with real 1024×1024 artwork and regenerate:

```bash
npm run tauri icon app-icon.png
```
