use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCalendarStatus {
    connected: bool,
    authorization: &'static str,
}

#[cfg(any(target_os = "macos", test))]
fn status_from_code(code: isize) -> SystemCalendarStatus {
    let authorization = match code {
        0 => "not_determined",
        1 => "restricted",
        2 => "denied",
        3 => "full_access",
        4 => "write_only",
        _ => "unknown",
    };
    SystemCalendarStatus {
        connected: authorization == "full_access",
        authorization,
    }
}

#[tauri::command]
pub fn apple_calendar_connection_mode() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        return "system";
    }
    #[cfg(target_os = "windows")]
    {
        return "credentials";
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "unavailable"
    }
}

#[cfg(target_os = "macos")]
fn current_status() -> SystemCalendarStatus {
    use objc2_event_kit::{EKEntityType, EKEventStore};

    let status = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
    status_from_code(status.0)
}

#[tauri::command]
pub fn macos_calendar_connection_status() -> Result<SystemCalendarStatus, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(current_status());
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("System Calendar access is only available on macOS.".into())
    }
}

#[cfg(target_os = "macos")]
fn request_on_main_thread(sender: std::sync::mpsc::Sender<Result<(), String>>) {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2::AnyThread;
    use objc2_event_kit::{EKEntityType, EKEventStore};
    use objc2_foundation::{NSError, NSProcessInfo};

    let store = unsafe { EKEventStore::init(EKEventStore::alloc()) };
    let store_for_callback = store.clone();
    let completion: RcBlock<dyn Fn(Bool, *mut NSError)> =
        RcBlock::new(move |granted: Bool, error: *mut NSError| {
            // EventKit requires the store to outlive its callback.
            let _keep_store_alive = &store_for_callback;
            let result = if !error.is_null() {
                let description = unsafe { (&*error).localizedDescription().to_string() };
                Err(description)
            } else if granted.as_bool() {
                Ok(())
            } else {
                // Denial is a valid authorization result, not an invocation failure.
                Ok(())
            };
            let _ = sender.send(result);
        });

    let major_version = NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion;

    unsafe {
        if major_version >= 14 {
            store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&completion));
        } else {
            #[allow(deprecated)]
            store.requestAccessToEntityType_completion(
                EKEntityType::Event,
                RcBlock::as_ptr(&completion),
            );
        }
    }
}

#[tauri::command]
pub async fn macos_calendar_request_access(
    app: tauri::AppHandle,
) -> Result<SystemCalendarStatus, String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;
        use std::time::Duration;

        let (sender, receiver) = mpsc::channel();
        app.run_on_main_thread(move || request_on_main_thread(sender))
            .map_err(|error| {
                format!("Could not show the macOS Calendar permission prompt: {error}")
            })?;

        tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv_timeout(Duration::from_secs(180))
                .map_err(|_| "macOS did not return a Calendar permission result.".to_string())?
        })
        .await
        .map_err(|error| format!("Calendar permission task failed: {error}"))??;

        return Ok(current_status());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("System Calendar access is only available on macOS.".into())
    }
}

#[tauri::command]
pub fn macos_calendar_open_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return open::that(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars",
        )
        .map_err(|error| format!("Could not open macOS System Settings: {error}"));
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Calendar privacy settings are only available on macOS.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::status_from_code;

    #[test]
    fn maps_full_access_as_connected() {
        let status = status_from_code(3);
        assert!(status.connected);
        assert_eq!(status.authorization, "full_access");
    }

    #[test]
    fn keeps_denied_and_not_determined_disconnected() {
        assert!(!status_from_code(0).connected);
        assert_eq!(status_from_code(2).authorization, "denied");
    }
}
