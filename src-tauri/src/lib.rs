//! The Tauri shell: one window, one command. All logic lives in `fin-core`.

use std::sync::Mutex;

use fin_core::app::{App, AppPaths};
use serde_json::{Value, json};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

/// The open data folder. Requests are handled one at a time, like Electron's main thread.
struct Backend(Mutex<Option<App>>);

/// The only bridge between the interface and the backend, mirroring the Electron preload's
/// `fin:invoke` channel: validation and every error shape are handled by `fin_core::dispatch`.
#[tauri::command]
fn fin_invoke(backend: State<Backend>, channel: String, input: Option<Value>) -> Value {
    let mut guard = backend.0.lock().unwrap_or_else(|p| p.into_inner());
    match guard.as_mut() {
        Some(app) => fin_core::dispatch::dispatch(app, &channel, input),
        None => json!({ "ok": false, "error": { "code": "IO", "message": "Fin could not open your data folder." } }),
    }
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
fn app_data_dir() -> std::path::PathBuf {
    std::env::var_os("APPDATA").map(std::path::PathBuf::from).unwrap_or_else(std::env::temp_dir)
}

pub fn run() {
    let app = App::open(AppPaths::resolve(&app_data_dir())).ok();
    tauri::Builder::default()
        .manage(Backend(Mutex::new(app)))
        .invoke_handler(tauri::generate_handler![fin_invoke])
        .setup(|app| {
            // Constitution I: the window can only ever show Fin's own pages.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Fin")
                .inner_size(1320.0, 860.0)
                .min_inner_size(960.0, 640.0)
                .on_navigation(is_app_url)
                .build()?;
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
