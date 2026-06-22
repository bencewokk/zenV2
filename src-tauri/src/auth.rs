//! Google OAuth (Authorization Code flow) for the desktop app.
//!
//! Unlike the browser build, here we run the full code flow with a loopback
//! redirect and exchange the code for a **refresh token**, which is stored in the
//! OS secure store (Windows Credential Manager via `keyring`). Access tokens are
//! minted from it on demand and cached in memory, so the session never lapses.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";

const SCOPES: &str = "https://www.googleapis.com/auth/calendar.events \
https://www.googleapis.com/auth/calendar.readonly \
https://www.googleapis.com/auth/gmail.readonly \
https://www.googleapis.com/auth/gmail.compose \
https://www.googleapis.com/auth/gmail.modify";

const KEYRING_SERVICE: &str = "zen-google";
const KEYRING_USER: &str = "refresh_token";
const KEYRING_CREDS_USER: &str = "oauth_credentials";

/// In-memory cache of the current access token (never persisted; the refresh
/// token in the keyring is the durable credential).
static ACCESS: Mutex<Option<CachedToken>> = Mutex::new(None);

/// OAuth client id + secret, set from the in-app Settings and mirrored to the
/// OS keyring so they survive restarts.
static CREDS: Mutex<Option<OAuthCredentials>> = Mutex::new(None);

#[derive(Clone)]
struct CachedToken {
    token: String,
    expires_at: u64, // epoch seconds
}

/// Returned to the frontend after login / refresh.
#[derive(Serialize)]
pub struct TokenOut {
    access_token: String,
    expires_in: u64, // seconds from now
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    #[serde(default)]
    refresh_token: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct OAuthCredentials {
    client_id: String,
    client_secret: String,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn creds_keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_CREDS_USER).map_err(|e| e.to_string())
}

fn valid(c: &OAuthCredentials) -> bool {
    !c.client_id.is_empty() && !c.client_secret.is_empty()
}

/// Persist credentials supplied from the in-app Settings, both in memory and in
/// the OS keyring, so the desktop OAuth flow no longer needs env vars or a JSON file.
#[tauri::command]
pub fn google_set_credentials(client_id: String, client_secret: String) -> Result<(), String> {
    let creds = OAuthCredentials {
        client_id: client_id.trim().to_string(),
        client_secret: client_secret.trim().to_string(),
    };
    if let Ok(entry) = creds_keyring_entry() {
        let _ = entry.set_password(&serde_json::to_string(&creds).unwrap_or_default());
    }
    if let Ok(mut guard) = CREDS.lock() {
        *guard = Some(creds);
    }
    Ok(())
}

/// Load the OAuth client id + secret. Order: credentials set from in-app Settings
/// (memory, then keyring), then env vars, then a `google_oauth.json` file.
fn load_credentials() -> Result<OAuthCredentials, String> {
    if let Ok(guard) = CREDS.lock() {
        if let Some(c) = guard.as_ref() {
            if valid(c) {
                return Ok(c.clone());
            }
        }
    }
    if let Ok(entry) = creds_keyring_entry() {
        if let Ok(raw) = entry.get_password() {
            if let Ok(c) = serde_json::from_str::<OAuthCredentials>(&raw) {
                if valid(&c) {
                    if let Ok(mut guard) = CREDS.lock() {
                        *guard = Some(c.clone());
                    }
                    return Ok(c);
                }
            }
        }
    }
    if let (Ok(client_id), Ok(client_secret)) = (
        std::env::var("ZEN_GOOGLE_CLIENT_ID"),
        std::env::var("ZEN_GOOGLE_CLIENT_SECRET"),
    ) {
        if !client_id.is_empty() && !client_secret.is_empty() {
            return Ok(OAuthCredentials { client_id, client_secret });
        }
    }
    for path in ["google_oauth.json", "src-tauri/google_oauth.json"] {
        if let Ok(raw) = std::fs::read_to_string(path) {
            return serde_json::from_str(&raw)
                .map_err(|e| format!("Failed to parse {path}: {e}"));
        }
    }
    Err("No Google OAuth credentials. Add them in Settings → Connections, set \
ZEN_GOOGLE_CLIENT_ID / ZEN_GOOGLE_CLIENT_SECRET, or create google_oauth.json."
        .into())
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

fn store_refresh_token(token: &str) -> Result<(), String> {
    keyring_entry()?.set_password(token).map_err(|e| e.to_string())
}

fn load_refresh_token() -> Option<String> {
    keyring_entry().ok()?.get_password().ok()
}

fn cache_access(token: &str, expires_in: u64) {
    if let Ok(mut guard) = ACCESS.lock() {
        *guard = Some(CachedToken {
            token: token.to_string(),
            expires_at: now_secs() + expires_in,
        });
    }
}

/// A short, URL-safe random string for the CSRF `state` parameter.
fn random_state() -> String {
    let a: u64 = rand::random();
    let b: u64 = rand::random();
    format!("{a:016x}{b:016x}")
}

/// Run the interactive Authorization Code flow: spin a loopback server, open the
/// consent page, capture the code, exchange it, persist the refresh token.
#[tauri::command]
pub fn google_login() -> Result<TokenOut, String> {
    let creds = load_credentials()?;

    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| format!("Could not start loopback server: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or("Loopback server has no IP address")?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let state = random_state();

    let mut auth_url = url::Url::parse(AUTH_URL).map_err(|e| e.to_string())?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", &creds.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("include_granted_scopes", "true")
        .append_pair("state", &state);

    open::that(auth_url.as_str()).map_err(|e| format!("Could not open browser: {e}"))?;

    // Wait for Google to redirect back to the loopback with ?code=...
    let code = loop {
        let request = server.recv().map_err(|e| e.to_string())?;
        let full = format!("http://127.0.0.1:{port}{}", request.url());
        let parsed = url::Url::parse(&full).map_err(|e| e.to_string())?;

        let mut code: Option<String> = None;
        let mut got_state: Option<String> = None;
        let mut error: Option<String> = None;
        for (k, v) in parsed.query_pairs() {
            match k.as_ref() {
                "code" => code = Some(v.into_owned()),
                "state" => got_state = Some(v.into_owned()),
                "error" => error = Some(v.into_owned()),
                _ => {}
            }
        }

        if let Some(err) = error {
            let _ = request.respond(html_response("Authorization failed. You can close this tab."));
            return Err(format!("Google returned an error: {err}"));
        }
        if let Some(c) = code {
            if got_state.as_deref() != Some(state.as_str()) {
                let _ = request.respond(html_response("State mismatch. You can close this tab."));
                return Err("OAuth state mismatch (possible CSRF) — aborted.".into());
            }
            let _ = request.respond(html_response("Connected to Zen. You can close this tab."));
            break c;
        }
        // Ignore unrelated requests (favicon, etc.) and keep waiting.
        let _ = request.respond(html_response("Waiting for Google…"));
    };

    let client = reqwest::blocking::Client::new();
    let resp: TokenResponse = client
        .post(TOKEN_URL)
        .form(&[
            ("client_id", creds.client_id.as_str()),
            ("client_secret", creds.client_secret.as_str()),
            ("code", code.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| format!("Token exchange failed: {e}"))?;

    if let Some(rt) = resp.refresh_token.as_deref() {
        store_refresh_token(rt)?;
    }
    // If Google omitted a refresh token (already granted), keep any existing one.
    cache_access(&resp.access_token, resp.expires_in);

    Ok(TokenOut {
        access_token: resp.access_token,
        expires_in: resp.expires_in,
    })
}

/// Return a valid access token, refreshing from the stored refresh token if the
/// cached one has expired. Errors if the user has never signed in.
#[tauri::command]
pub fn google_access_token() -> Result<TokenOut, String> {
    // Serve a still-valid cached token (with a small safety margin).
    if let Ok(guard) = ACCESS.lock() {
        if let Some(cached) = guard.as_ref() {
            if cached.expires_at > now_secs() + 60 {
                return Ok(TokenOut {
                    access_token: cached.token.clone(),
                    expires_in: cached.expires_at - now_secs(),
                });
            }
        }
    }

    let refresh_token = load_refresh_token().ok_or("Not signed in to Google.")?;
    let creds = load_credentials()?;

    let client = reqwest::blocking::Client::new();
    let resp: TokenResponse = client
        .post(TOKEN_URL)
        .form(&[
            ("client_id", creds.client_id.as_str()),
            ("client_secret", creds.client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| format!("Token refresh failed: {e}"))?;

    cache_access(&resp.access_token, resp.expires_in);
    Ok(TokenOut {
        access_token: resp.access_token,
        expires_in: resp.expires_in,
    })
}

/// Whether a refresh token is stored (i.e. the user has a persisted session).
#[tauri::command]
pub fn google_is_signed_in() -> bool {
    load_refresh_token().is_some()
}

/// Whether usable OAuth credentials are available (from Settings, env, or file).
#[tauri::command]
pub fn google_has_credentials() -> bool {
    load_credentials().is_ok()
}

/// Revoke and forget the stored credentials.
#[tauri::command]
pub fn google_logout() -> Result<(), String> {
    if let Some(rt) = load_refresh_token() {
        let client = reqwest::blocking::Client::new();
        let _ = client.post(REVOKE_URL).form(&[("token", rt.as_str())]).send();
    }
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
    if let Ok(mut guard) = ACCESS.lock() {
        *guard = None;
    }
    Ok(())
}

fn html_response(message: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Zen</title>\
<style>body{{font-family:system-ui,sans-serif;background:#1a1b1e;color:#e8e9ed;\
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}\
p{{font-size:16px}}</style></head><body><p>{message}</p></body></html>"
    );
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
        .expect("valid header");
    tiny_http::Response::from_string(body).with_header(header)
}
