//! What Fin does outside its window (US11): reminders shown as Windows notifications, the tray icon
//! and starting at sign-in. Which reminders are due is decided in `fin-core`; this only shows them.
//! Nothing here uses the network: Windows shows notifications on this computer.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use fin_core::log;
use serde_json::{Value, json};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

const TRAY_ID: &str = "fin";

/// Whether closing the window keeps Fin running in the tray.
#[derive(Default)]
pub struct Background {
    pub keep_in_tray: AtomicBool,
}

/// A throwaway data folder (tests, trying things out): nothing is written outside it, so no
/// start-at-login entry and no single-instance lock.
pub fn throwaway_data() -> bool {
    std::env::var_os("FIN_DATA_DIR").is_some()
}

/// Test seam: with a throwaway data folder and `FIN_E2E_NOTIFICATIONS` naming a file, reminders are
/// appended to it as JSON lines instead of being shown.
fn notification_file() -> Option<PathBuf> {
    if !throwaway_data() {
        return None;
    }
    std::env::var_os("FIN_E2E_NOTIFICATIONS").map(PathBuf::from)
}

/// Bring the window back and open a screen in it.
pub fn open_route(app: &AppHandle, route: Option<&str>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        if let Some(r) = route {
            let _ = w.emit("fin://navigate", r);
        }
    }
}

/// Show one reminder (`ReminderDto`). Its text is never logged.
pub fn show_reminder(app: &AppHandle, r: &Value) {
    let text = |k: &str| r.get(k).and_then(Value::as_str).unwrap_or_default().to_owned();
    let (title, body, route) = (text("title"), text("body"), text("route"));
    if let Some(file) = notification_file() {
        use std::io::Write;
        let line = json!({ "title": title, "body": body, "route": route }).to_string();
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(file) {
            let _ = writeln!(f, "{line}");
        }
        return;
    }
    #[cfg(windows)]
    {
        use tauri_winrt_notification::Toast;
        // The installer gives Fin's shortcut this identity; a development build borrows PowerShell's.
        let installed = std::env::current_exe()
            .map(|p| !p.components().any(|c| c.as_os_str().eq_ignore_ascii_case("target")))
            .unwrap_or(false);
        let id = if installed { app.config().identifier.clone() } else { Toast::POWERSHELL_APP_ID.to_owned() };
        let handle = app.clone();
        let shown = Toast::new(&id)
            .title(&title)
            .text1(&body)
            .on_activated(move |_| {
                open_route(&handle, Some(&route));
                Ok(())
            })
            .show();
        if shown.is_err() {
            log::warn("notify.show_failed", &[]);
        }
    }
    #[cfg(not(windows))]
    let _ = (app, title, body, route);
}

fn ensure_tray(app: &AppHandle) -> tauri::Result<()> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let open = MenuItem::with_id(app, "open", "Open Fin", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Fin", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Fin")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_route(app, None),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                open_route(tray.app_handle(), None);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Apply the tray and start-at-login settings (`Settings`); run at start and after each change.
pub fn apply_settings(app: &AppHandle, settings: &Value) {
    let tray = settings["keepInTray"] == true;
    app.state::<Background>().keep_in_tray.store(tray, Ordering::Relaxed);
    if tray {
        if ensure_tray(app).is_err() {
            log::warn("tray.failed", &[]);
        }
    } else {
        let _ = app.remove_tray_by_id(TRAY_ID);
    }
    // Starting at sign-in opens Fin in the tray, so it needs the tray option.
    if !throwaway_data() {
        let want = tray && settings["startAtLogin"] == true;
        let auto = app.autolaunch();
        if auto.is_enabled().unwrap_or(false) != want {
            let done = if want { auto.enable() } else { auto.disable() };
            if done.is_err() {
                log::warn("autostart.failed", &[]);
            }
        }
    }
}
