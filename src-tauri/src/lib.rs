mod auth;

/// Opens the OS "installed apps" page so the user can finish uninstalling Zen.
/// The app can't remove its own installer entry, so this hands off to the OS.
#[tauri::command]
fn open_os_uninstall() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return std::process::Command::new("cmd")
        .args(["/C", "start", "ms-settings:appsfeatures"])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string());
    #[cfg(not(target_os = "windows"))]
    return Err("Uninstall Zen from your system's application manager.".to_string());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init());

    // The updater is desktop-only (no mobile sideload updates).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .invoke_handler(tauri::generate_handler![
            auth::google_login,
            auth::google_access_token,
            auth::google_id_token,
            auth::google_logout,
            auth::google_is_signed_in,
            auth::google_has_credentials,
            open_os_uninstall,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
