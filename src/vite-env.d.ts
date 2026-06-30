/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Optional build-time default DeepSeek API key. Overridable in-app at Settings → Connections. */
  readonly VITE_DEEPSEEK_API_KEY?: string;
  /** Optional build-time default Google OAuth Client ID. Overridable in-app at Settings → Connections. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
