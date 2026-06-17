mod auth;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            auth::google_login,
            auth::google_access_token,
            auth::google_logout,
            auth::google_is_signed_in,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
