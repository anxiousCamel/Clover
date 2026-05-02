#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, State, WindowEvent};

/// Holds the workspace path used to restrict filesystem operations.
pub struct WorkspaceState {
    pub path: Mutex<Option<PathBuf>>,
}

/// Holds the Node.js backend child process handle for lifecycle management.
pub struct BackendProcess {
    pub child: Mutex<Option<Child>>,
}

/// Validates that the given path is within the configured workspace.
/// Returns an error string if the path is outside the workspace boundary.
#[tauri::command]
fn validate_workspace_path(
    target_path: String,
    state: State<WorkspaceState>,
) -> Result<bool, String> {
    let workspace = state.path.lock().map_err(|e| e.to_string())?;

    let workspace_path = match workspace.as_ref() {
        Some(p) => p,
        None => return Err("Workspace path not configured".to_string()),
    };

    let canonical_workspace = workspace_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve workspace path: {}", e))?;

    let target = PathBuf::from(&target_path);
    let canonical_target = target
        .canonicalize()
        .map_err(|e| format!("Failed to resolve target path: {}", e))?;

    if canonical_target.starts_with(&canonical_workspace) {
        Ok(true)
    } else {
        Err(format!(
            "Permission denied: path '{}' is outside the workspace boundary",
            target_path
        ))
    }
}

/// Sets the workspace path for filesystem restriction.
#[tauri::command]
fn set_workspace_path(
    workspace_path: String,
    state: State<WorkspaceState>,
) -> Result<(), String> {
    let path = PathBuf::from(&workspace_path);
    if !path.exists() {
        return Err(format!("Workspace path does not exist: {}", workspace_path));
    }
    let mut ws = state.path.lock().map_err(|e| e.to_string())?;
    *ws = Some(path);
    Ok(())
}

/// Spawns the Node.js backend process with the workspace path as an environment variable.
/// Returns the Child process handle on success.
fn spawn_backend(workspace_path: &Option<PathBuf>) -> Result<Child, String> {
    let mut cmd = Command::new("node");
    cmd.arg("apps/backend/dist/index.js");

    // Pass workspace path as CLOVER_WORKSPACE environment variable
    if let Some(ref ws_path) = workspace_path {
        cmd.env("CLOVER_WORKSPACE", ws_path.as_os_str());
    }

    // Inherit stdout/stderr so backend logs are visible during development
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    cmd.spawn()
        .map_err(|e| format!("Failed to spawn Node.js backend: {}", e))
}

/// Terminates the backend child process cleanly.
/// Uses SIGTERM on Unix and TerminateProcess on Windows.
fn terminate_backend(child: &mut Child) {
    // Attempt graceful termination first
    #[cfg(unix)]
    {
        // Send SIGTERM for graceful shutdown
        unsafe {
            libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
        }
        // Give the process a short window to shut down gracefully
        let timeout = std::time::Duration::from_secs(5);
        let start = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if start.elapsed() >= timeout {
                        // Force kill if graceful shutdown timed out
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
            }
        }
    }

    #[cfg(windows)]
    {
        // On Windows, kill() calls TerminateProcess
        let _ = child.kill();
        let _ = child.wait();
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn main() {
    let workspace_path = std::env::var("CLOVER_WORKSPACE_PATH")
        .ok()
        .map(PathBuf::from);

    let workspace_for_spawn = workspace_path.clone();

    tauri::Builder::default()
        .manage(WorkspaceState {
            path: Mutex::new(workspace_path),
        })
        .manage(BackendProcess {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            validate_workspace_path,
            set_workspace_path
        ])
        .setup(move |app| {
            // Spawn the Node.js backend process on app start
            match spawn_backend(&workspace_for_spawn) {
                Ok(child) => {
                    let backend_state = app.state::<BackendProcess>();
                    let mut handle = backend_state
                        .child
                        .lock()
                        .expect("Failed to lock backend process mutex");
                    *handle = Some(child);
                    println!("Node.js backend process started successfully");
                }
                Err(e) => {
                    eprintln!("Warning: Could not start Node.js backend: {}", e);
                    // Don't fail app startup — the backend may be started separately
                }
            }
            Ok(())
        })
        .on_window_event(|event| {
            // Terminate the Node.js backend process cleanly on window close
            if let WindowEvent::CloseRequested { .. } = event.event() {
                let app_handle = event.window().app_handle();
                let backend_state = app_handle.state::<BackendProcess>();
                let mut child_guard = backend_state
                    .child
                    .lock()
                    .expect("Failed to lock backend process mutex");

                if let Some(ref mut child) = *child_guard {
                    println!("Terminating Node.js backend process...");
                    terminate_backend(child);
                    println!("Node.js backend process terminated");
                }

                *child_guard = None;
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Clover");
}
