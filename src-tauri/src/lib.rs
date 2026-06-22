mod auth;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            auth::google_login,
            auth::google_access_token,
            auth::google_logout,
            auth::google_is_signed_in,
            auth::google_set_credentials,
            auth::google_has_credentials,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
