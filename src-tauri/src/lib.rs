//! The Tauri shell: one window, one command. All logic lives in `fin-core`.

use serde_json::Value;
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// The only bridge between the interface and the backend, mirroring the Electron preload's
/// `fin:invoke` channel: validation and every error shape are handled by `fin_core::dispatch`.
#[tauri::command]
fn fin_invoke(channel: String, input: Option<Value>) -> Value {
    fin_core::dispatch::dispatch(&channel, input)
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

pub fn run() {
    tauri::Builder::default()
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
        .run(tauri::generate_context!())
        .expect("Fin failed to start");
}
