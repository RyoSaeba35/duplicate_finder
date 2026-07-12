// main.rs — the Tauri shell is intentionally thin. Its only job is:
//   1. launch the C++ backend binary as a sidecar when the app starts
//   2. make sure that process is killed when the app closes
//   3. render the React frontend in a native webview
// All the actual duplicate-finding logic lives in the C++ backend, which
// the frontend talks to directly over HTTP on 127.0.0.1:8721.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::api::process::{Command, CommandEvent};
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let (mut rx, child) = Command::new_sidecar("dupfinder_backend")
                .expect("failed to create sidecar command — did you build the C++ backend and name it per tauri.conf.json's externalBin?")
                .spawn()
                .expect("failed to spawn dupfinder_backend sidecar");

            // Keep the child handle alive for the lifetime of the app by
            // stashing it in managed state; forward stdout/stderr to the
            // terminal for easier debugging during development.
            app.manage(std::sync::Mutex::new(Some(child)));

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => println!("[backend] {line}"),
                        CommandEvent::Stderr(line) => eprintln!("[backend] {line}"),
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[backend] exited: {:?}", payload);
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|event| {
            // Make sure the backend process doesn't linger after the
            // window closes.
            if let tauri::WindowEvent::Destroyed = event.event() {
                if let Some(state) = event
                    .window()
                    .try_state::<std::sync::Mutex<Option<tauri::api::process::CommandChild>>>()
                {
                    if let Some(child) = state.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
