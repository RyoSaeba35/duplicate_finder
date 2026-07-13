// main.rs — the Tauri shell is intentionally thin. Its only job is:
//   1. launch the C++ backend binary as a sidecar when the app starts
//   2. make sure that process is killed when the app closes
//   3. render the React frontend in a native webview
// All the actual duplicate-finding logic lives in the C++ backend, which
// the frontend talks to directly over HTTP on 127.0.0.1:8721.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use tauri::api::process::{Command, CommandChild, CommandEvent};

fn main() {
    // NOTE on a bug fixed here: the previous version tried to kill the
    // sidecar from a single window's `WindowEvent::Destroyed` handler,
    // looked up via `window.try_state()`. That's fragile — it only fires
    // for that one window's destruction, and window-scoped state lookup
    // isn't a reliable place to hang cleanup logic. This resulted in the
    // backend process surviving after the window closed, which is exactly
    // what caused an uninstall to fail with "Failed to kill Duplicate
    // Finder" earlier — the old process was still running, invisibly,
    // even with no window open. Fixed by hooking `RunEvent::Exit` /
    // `ExitRequested` on the whole app instead, via `.build().run(...)`,
    // which is the documented, reliable place to do last-chance cleanup
    // regardless of *why* the app is exiting.
    let child_handle: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
    let child_handle_for_setup = child_handle.clone();

    let app = tauri::Builder::default()
        .setup(move |_app| {
            let (mut rx, child) = Command::new_sidecar("dupfinder_backend")
                .expect("failed to create sidecar command — did you build the C++ backend and name it per tauri.conf.json's externalBin?")
                .spawn()
                .expect("failed to spawn dupfinder_backend sidecar");

            *child_handle_for_setup.lock().unwrap() = Some(child);

            // Forward the backend's stdout/stderr to this process's own
            // console for easier debugging during development.
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
            if let Some(child) = child_handle.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
