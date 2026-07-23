//! iCloud Calendar credentials for the Windows desktop app.
//!
//! Apple doesn't expose calendar data through ordinary "Sign in with Apple".
//! Zen therefore uses the documented third-party fallback: an Apple Account
//! email plus an app-specific password. The credential is kept in the OS
//! secure store and is validated against iCloud's CalDAV endpoint before it is
//! persisted.

use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::header::{HeaderValue, CONTENT_TYPE, LOCATION};
use reqwest::{Method, StatusCode, Url};
use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "zen-icloud-calendar";
const KEYRING_USER: &str = "credentials";
const CALDAV_DISCOVERY_URL: &str = "https://caldav.icloud.com/.well-known/caldav";
const MAX_REDIRECTS: usize = 6;
const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal /></d:prop>
</d:propfind>"#;

#[derive(Deserialize, Serialize)]
struct StoredCredentials {
    email: String,
    app_specific_password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IcloudConnectionStatus {
    connected: bool,
    email: Option<String>,
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Windows Credential Manager is unavailable: {e}"))
}

fn load_credentials() -> Option<StoredCredentials> {
    let raw = keyring_entry().ok()?.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}

fn store_credentials(credentials: &StoredCredentials) -> Result<(), String> {
    let raw = serde_json::to_string(credentials)
        .map_err(|e| format!("Could not prepare the iCloud credential: {e}"))?;
    keyring_entry()?
        .set_password(&raw)
        .map_err(|e| format!("Could not save the iCloud credential securely: {e}"))
}

fn valid_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !email.chars().any(char::is_whitespace)
}

fn apple_https_url(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    host == "icloud.com" || host.ends_with(".icloud.com")
}

fn validate_caldav(email: &str, app_specific_password: &str) -> Result<(), String> {
    let client = Client::builder()
        // Follow redirects manually so Basic authentication is only forwarded
        // after checking that the next host is still an Apple iCloud host.
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| format!("Could not prepare the iCloud connection: {e}"))?;
    let method = Method::from_bytes(b"PROPFIND").expect("PROPFIND is a valid HTTP method");
    let mut url = Url::parse(CALDAV_DISCOVERY_URL).expect("static CalDAV URL is valid");

    for _ in 0..=MAX_REDIRECTS {
        let response = client
            .request(method.clone(), url.clone())
            .basic_auth(email, Some(app_specific_password))
            .header("Depth", HeaderValue::from_static("0"))
            .header(CONTENT_TYPE, "application/xml; charset=utf-8")
            .body(PROPFIND_BODY)
            .send()
            .map_err(|e| {
                if e.is_timeout() {
                    "iCloud Calendar timed out. Check your connection and try again.".to_string()
                } else {
                    format!("Could not reach iCloud Calendar: {e}")
                }
            })?;

        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "iCloud returned an invalid redirect.".to_string())?;
            let next = url
                .join(location)
                .map_err(|_| "iCloud returned an invalid redirect URL.".to_string())?;
            if !apple_https_url(&next) {
                return Err(
                    "iCloud redirected to an unexpected server; connection cancelled.".into(),
                );
            }
            url = next;
            continue;
        }

        return match status {
            StatusCode::MULTI_STATUS | StatusCode::OK | StatusCode::NO_CONTENT => Ok(()),
            StatusCode::UNAUTHORIZED => Err(
                "Apple rejected the sign-in. Use an app-specific password, not your normal Apple Account password."
                    .into(),
            ),
            StatusCode::FORBIDDEN => Err(
                "Apple denied calendar access. Make sure iCloud Calendar is enabled for this Apple Account."
                    .into(),
            ),
            _ => Err(format!(
                "iCloud Calendar could not verify the account (HTTP {}).",
                status.as_u16()
            )),
        };
    }

    Err("iCloud returned too many redirects; connection cancelled.".into())
}

#[tauri::command]
pub fn icloud_connect(
    email: String,
    app_specific_password: String,
) -> Result<IcloudConnectionStatus, String> {
    let email = email.trim().to_lowercase();
    let app_specific_password = app_specific_password.trim().to_string();

    if !valid_email(&email) {
        return Err("Enter a valid Apple Account email address.".into());
    }
    if app_specific_password.is_empty() {
        return Err("Enter an app-specific password generated by Apple.".into());
    }

    validate_caldav(&email, &app_specific_password)?;
    store_credentials(&StoredCredentials {
        email: email.clone(),
        app_specific_password,
    })?;

    Ok(IcloudConnectionStatus {
        connected: true,
        email: Some(email),
    })
}

#[tauri::command]
pub fn icloud_connection_status() -> IcloudConnectionStatus {
    match load_credentials() {
        Some(credentials) => IcloudConnectionStatus {
            connected: true,
            email: Some(credentials.email),
        },
        None => IcloudConnectionStatus {
            connected: false,
            email: None,
        },
    }
}

#[tauri::command]
pub fn icloud_disconnect() -> Result<(), String> {
    if let Ok(entry) = keyring_entry() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(format!("Could not remove the iCloud credential: {e}")),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{apple_https_url, valid_email};
    use reqwest::Url;

    #[test]
    fn validates_email_shape_without_accepting_whitespace() {
        assert!(valid_email("student@example.com"));
        assert!(!valid_email("student"));
        assert!(!valid_email("student@localhost"));
        assert!(!valid_email("student @example.com"));
    }

    #[test]
    fn only_allows_https_redirects_within_icloud() {
        assert!(apple_https_url(
            &Url::parse("https://p12-caldav.icloud.com/123/principal").unwrap()
        ));
        assert!(!apple_https_url(
            &Url::parse("http://caldav.icloud.com/").unwrap()
        ));
        assert!(!apple_https_url(
            &Url::parse("https://icloud.com.example.org/").unwrap()
        ));
    }
}
