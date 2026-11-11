//! The Tauri shell: one window, one command. All logic lives in `fin-core`.

mod background;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::Ordering;
use std::time::Duration;

use background::{Background, apply_settings, open_route, show_reminder, throwaway_data};

use fin_core::app::{App, AppPaths, Dialogs};
use fin_core::log;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// The open data folder. Requests are handled one at a time, like Electron's main thread.
struct Backend(Mutex<Option<App>>);

/// Native dialogs, shown from Rust so the webview needs no dialog permission. Requests run off
/// the main thread (async command), so the blocking calls cannot freeze the window.
struct NativeDialogs(AppHandle);

impl NativeDialogs {
    fn window(&self) -> Option<tauri::WebviewWindow> {
        self.0.get_webview_window("main")
    }
}

/// Test seam for the end-to-end suite, which cannot click operating-system dialogs. It applies
/// only when the app runs on a throwaway data folder (`FIN_DATA_DIR`) and
/// `FIN_E2E_DIALOG_ANSWERS` names a file: dialogs are then answered with the `path` in that file
/// (`{"path": "..."}`), or cancelled when there is none, and no real dialog or folder opens.
fn scripted_answer() -> Option<Option<PathBuf>> {
    std::env::var_os("FIN_DATA_DIR")?;
    let file = std::env::var_os("FIN_E2E_DIALOG_ANSWERS")?;
    let answer = std::fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|v| v["path"].as_str().map(PathBuf::from));
    Some(answer)
}

impl Dialogs for NativeDialogs {
    fn choose_file(&self, title: &str) -> Option<PathBuf> {
        if let Some(answer) = scripted_answer() {
            return answer;
        }
        let mut d = self
            .0
            .dialog()
            .file()
            .set_title(title)
            .add_filter("Fin backups", &["db", "finbackup"])
            .add_filter("All files", &["*"]);
        if let Some(w) = self.window() {
            d = d.set_parent(&w);
        }
        d.blocking_pick_file().and_then(|p| p.into_path().ok())
    }

    fn choose_save_path(&self, title: &str, default_name: &str, ext: &str) -> Option<PathBuf> {
        if let Some(answer) = scripted_answer() {
            return answer;
        }
        let label = if ext == "json" { "JSON" } else { "CSV (spreadsheets)" };
        let mut d = self.0.dialog().file().set_title(title).set_file_name(default_name).add_filter(label, &[ext]);
        if let Ok(docs) = self.0.path().document_dir() {
            d = d.set_directory(docs);
        }
        if let Some(w) = self.window() {
            d = d.set_parent(&w);
        }
        d.blocking_save_file().and_then(|p| p.into_path().ok())
    }

    fn choose_folder(&self, title: &str) -> Option<PathBuf> {
        if let Some(answer) = scripted_answer() {
            return answer;
        }
        let mut d = self.0.dialog().file().set_title(title).set_can_create_directories(true);
        if let Some(w) = self.window() {
            d = d.set_parent(&w);
        }
        d.blocking_pick_folder().and_then(|p| p.into_path().ok())
    }

    fn open_folder(&self, path: &Path) {
        if scripted_answer().is_some() {
            return;
        }
        let _ = self.0.opener().open_path(path.to_string_lossy(), None::<&str>);
    }
}

/// The only bridge between the interface and the backend, mirroring the Electron preload's
/// `fin:invoke` channel: validation and every error shape are handled by `fin_core::dispatch`.
#[tauri::command]
async fn fin_invoke(
    handle: AppHandle,
    backend: State<'_, Backend>,
    channel: String,
    input: Option<Value>,
) -> Result<Value, ()> {
    let (result, settings) = {
        let mut guard = backend.0.lock().unwrap_or_else(|p| p.into_inner());
        match guard.as_mut() {
            Some(app) => {
                let result = fin_core::dispatch::dispatch(app, &channel, input);
                // Settings that live outside the window follow every change of settings or data.
                let changed = result["ok"] == true && matches!(channel.as_str(), "settings.update" | "backup.restore");
                let settings = changed.then(|| fin_core::dispatch::dispatch(app, "settings.get", None)["data"].clone());
                (result, settings)
            }
            None => (
                json!({ "ok": false, "error": { "code": "IO", "message": "Fin could not open your data folder." } }),
                None,
            ),
        }
    };
    if let Some(s) = settings {
        apply_settings(&handle, &s);
    }
    if channel == "reminders.test" && result["ok"] == true {
        show_reminder(&handle, &result["data"]);
    }
    Ok(result)
}

/// Reminders shortly after start, then every hour while Fin runs (US11). The app is held only
/// to work out what is due; notifications are shown after it is released.
fn remind_hourly(handle: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2));
        loop {
            let due = handle
                .state::<Backend>()
                .0
                .lock()
                .ok()
                .and_then(|g| g.as_ref().map(App::take_due_reminders))
                .unwrap_or_default();
            for r in &due {
                show_reminder(&handle, r);
            }
            std::thread::sleep(Duration::from_secs(60 * 60));
        }
    });
}

/// WebView2 answers browser shortcuts itself (Ctrl+N new window, Ctrl+P print, F5 reload, the
/// find bar…), sometimes before the page sees the key. They have no place in a desktop app and
/// clash with Fin's own Ctrl+N / Ctrl+T, so they are turned off, as Electron never had them.
fn disable_browser_shortcuts(webview: tauri::webview::PlatformWebview) {
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows_core::Interface;
        // SAFETY: plain COM calls on the live controller Tauri hands us, on its own thread.
        unsafe {
            if let Ok(core) = webview.controller().CoreWebView2()
                && let Ok(settings) = core.Settings()
                && let Ok(settings) = settings.cast::<ICoreWebView2Settings3>()
            {
                let _ = settings.SetAreBrowserAcceleratorKeysEnabled(false);
            }
        }
    }
    #[cfg(not(windows))]
    let _ = webview;
}

/// Fin's own pages are served from the app protocol (or the dev server while developing).
fn is_app_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => {
            matches!(url.host_str(), Some("tauri.localhost"))
                || (cfg!(debug_assertions) && matches!(url.host_str(), Some("localhost")) && url.port() == Some(5173))
        }
        _ => false,
    }
}

/// `%APPDATA%` (Roaming) on Windows, like Electron's `app.getPath('appData')`.
fn app_data_dir() -> PathBuf {
    std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir)
}

pub fn run() {
    let mut builder = tauri::Builder::default();
    // Opening Fin again (Start menu, sign-in) brings back the running window, which may be in the
    // tray. Throwaway data folders (tests) may run side by side, so they skip this.
    if !throwaway_data() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| open_route(app, None)));
    }
    builder
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Backend(Mutex::new(None)))
        .manage(Background::default())
        .invoke_handler(tauri::generate_handler![fin_invoke])
        .setup(|app| {
            let handle = app.handle().clone();
            let paths = AppPaths::resolve(&app_data_dir());
            // FIN_LOG=debug also records each request's channel and duration (never its data).
            let debug = cfg!(debug_assertions) || std::env::var("FIN_LOG").is_ok_and(|v| v == "debug");
            let level = if debug { log::Level::Debug } else { log::Level::Info };
            log::init(paths.log_file.clone(), level);
            let opened = match App::open(paths, Box::new(NativeDialogs(handle.clone()))) {
                Ok(app) => {
                    log::info("app.ready", &[("version", log::Ctx::Text(env!("CARGO_PKG_VERSION")))]);
                    Some(app)
                }
                Err(e) => {
                    log::error("db.open_failed", &[("kind", log::Ctx::Text(&format!("{:?}", e.code)))]);
                    None
                }
            };
            let settings = opened
                .as_ref()
                .and_then(|a| fin_core::db::settings::get_settings(a.db()).ok())
                .map(Value::Object)
                .unwrap_or(Value::Null);
            *app.state::<Backend>().0.lock().unwrap_or_else(|p| p.into_inner()) = opened;
            // Warm the database while WebView2 starts (creating the window takes about a second),
            // so the Overview's first requests find their data in memory.
            let warm = handle.clone();
            std::thread::spawn(move || {
                if let Some(app) = warm.state::<Backend>().0.lock().ok().as_mut().and_then(|g| g.as_mut()) {
                    app.warm_up();
                }
            });
            // Constitution I: the window can only ever show Fin's own pages.
            // Started at sign-in with the tray option on: stay in the tray until opened.
            let in_background = std::env::args().any(|a| a == "--background") && settings["keepInTray"] == true;
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Fin")
                .inner_size(1320.0, 860.0)
                .min_inner_size(960.0, 640.0)
                .visible(!in_background)
                .on_navigation(is_app_url)
                .build()?;
            window.with_webview(disable_browser_shortcuts)?;
            let closing = handle.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event
                    && closing.state::<Background>().keep_in_tray.load(Ordering::Relaxed)
                {
                    api.prevent_close();
                    if let Some(w) = closing.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
            });
            apply_settings(&handle, &settings);
            remind_hourly(handle.clone());
            // The daily backup never delays startup: the app is held only to read where to write
            // it; the copy itself runs on its own connection while requests carry on.
            std::thread::spawn(move || {
                let plan =
                    handle.state::<Backend>().0.lock().ok().and_then(|g| g.as_ref().and_then(App::daily_backup_plan));
                if let Some(plan) = plan {
                    plan.run();
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Fin failed to start")
        .run(|handle, event| {
            if let tauri::RunEvent::Exit = event
                && let Some(app) = handle.state::<Backend>().0.lock().ok().and_then(|mut g| g.take())
            {
                app.close();
            }
        });
}
