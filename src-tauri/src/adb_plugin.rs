/// Native ADB bridge for Tauri desktop builds.
/// This replaces WebUSB/WebADB from the browser environment with direct
/// host-level access to the local `adb` executable.
use std::{
    env,
    io::ErrorKind,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::OnceLock,
    thread,
    time::{Duration, Instant},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};
use tauri::command;

static ADB_EXECUTABLE: OnceLock<PathBuf> = OnceLock::new();

const CONNECT_READY_TIMEOUT: Duration = Duration::from_secs(3);
const CONNECT_READY_POLL_INTERVAL: Duration = Duration::from_millis(250);
const SCANNER_SERVER_PID_PATH: &str = "/data/local/tmp/skid-scanner-server.pid";
const SCANNER_SERVER_LOG_PATH: &str = "/data/local/tmp/skid-scanner-server.log";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdbPairRequest {
    pub address: String,
    pub pairing_code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdbConnectRequest {
    pub address: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AdbDeviceInfo {
    pub serial: String,
    pub name: String,
    pub state: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdbConnectResponse {
    pub serial: String,
    pub message: String,
}

fn adb_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "adb.exe"
    } else {
        "adb"
    }
}

fn candidate_from_sdk_root(root: &Path) -> PathBuf {
    root.join("platform-tools").join(adb_binary_name())
}

fn push_env_candidate(candidates: &mut Vec<PathBuf>, env_name: &str) {
    if let Ok(value) = env::var(env_name) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            candidates.push(candidate_from_sdk_root(Path::new(trimmed)));
        }
    }
}

fn discover_adb_executable() -> PathBuf {
    if let Ok(value) = env::var("ADB_PATH") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    let mut candidates = Vec::new();
    push_env_candidate(&mut candidates, "ANDROID_HOME");
    push_env_candidate(&mut candidates, "ANDROID_SDK_ROOT");

    if cfg!(target_os = "windows") {
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            candidates.push(candidate_from_sdk_root(
                &PathBuf::from(local_app_data).join("Android").join("Sdk"),
            ));
        }
    }

    if cfg!(target_os = "macos") {
        if let Ok(home) = env::var("HOME") {
            candidates.push(candidate_from_sdk_root(
                &PathBuf::from(home).join("Library").join("Android").join("sdk"),
            ));
        }
    }

    if cfg!(target_os = "linux") {
        if let Ok(home) = env::var("HOME") {
            candidates.push(candidate_from_sdk_root(
                &PathBuf::from(home).join("Android").join("Sdk"),
            ));
        }
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| PathBuf::from(adb_binary_name()))
}

fn resolve_adb_executable() -> PathBuf {
    ADB_EXECUTABLE.get_or_init(discover_adb_executable).clone()
}

fn configure_adb_command(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        // Prevent adb.exe from flashing a console window for background desktop operations.
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn normalize_text_output(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .replace("\r\n", "\n")
        .trim()
        .to_string()
}

fn combine_command_output(output: &Output) -> String {
    let stdout = normalize_text_output(&output.stdout);
    let stderr = normalize_text_output(&output.stderr);

    match (stdout.is_empty(), stderr.is_empty()) {
        (false, false) => format!("{stdout}\n{stderr}"),
        (false, true) => stdout,
        (true, false) => stderr,
        (true, true) => String::new(),
    }
}

fn ensure_non_empty(value: &str, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field_name} is required."));
    }

    Ok(trimmed.to_string())
}

fn ensure_remote_address(value: &str, field_name: &str) -> Result<String, String> {
    let address = ensure_non_empty(value, field_name)?;
    if !address.contains(':') {
        return Err(format!("{field_name} must use the host:port format."));
    }

    Ok(address)
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn build_scanner_server_start_script(
    classpath: &str,
    main_class: &str,
    server_args: &[String],
) -> String {
    let mut command_parts = vec![
        format!("CLASSPATH={}", shell_single_quote(classpath)),
        "app_process".to_string(),
        "/".to_string(),
        shell_single_quote(main_class),
    ];
    command_parts.extend(server_args.iter().map(|value| shell_single_quote(value)));

    format!(
        "mkdir -p /data/local/tmp; \
rm -f {pidfile}; \
: >{logfile}; \
{} </dev/null >>{logfile} 2>&1 & echo $! > {pidfile}",
        command_parts.join(" "),
        pidfile = shell_single_quote(SCANNER_SERVER_PID_PATH),
        logfile = shell_single_quote(SCANNER_SERVER_LOG_PATH),
    )
}

fn build_scanner_server_stop_script(main_class: &str) -> String {
    format!(
        "pidfile={pidfile}; \
stopped=0; \
if [ -f \"$pidfile\" ]; then \
  pid=$(cat \"$pidfile\"); \
  if [ -n \"$pid\" ]; then \
    kill \"$pid\" >/dev/null 2>&1 && stopped=1; \
  fi; \
  rm -f \"$pidfile\"; \
fi; \
if command -v pkill >/dev/null 2>&1; then \
  pkill -f {main_class} >/dev/null 2>&1 && stopped=1; \
fi; \
if [ \"$stopped\" -eq 1 ]; then \
  echo \"Camera server stopped.\"; \
fi",
        pidfile = shell_single_quote(SCANNER_SERVER_PID_PATH),
        main_class = shell_single_quote(main_class),
    )
}

fn wrap_shell_c_script(script: &str) -> String {
    shell_single_quote(script)
}

fn run_adb_command(args: &[String]) -> Result<Output, String> {
    let executable = resolve_adb_executable();
    let mut command = Command::new(&executable);
    configure_adb_command(&mut command);

    command
        .args(args)
        .output()
        .map_err(|error| match error.kind() {
            ErrorKind::NotFound => format!(
                "ADB executable was not found. Install Android Platform Tools or set the ADB_PATH environment variable. Looked for `{}`.",
                executable.display()
            ),
            _ => format!("Failed to launch `{}`: {error}", executable.display()),
        })
}

fn run_adb_checked(args: &[String], action: &str) -> Result<Output, String> {
    let output = run_adb_command(args)?;

    if output.status.success() {
        return Ok(output);
    }

    let details = combine_command_output(&output);
    if details.is_empty() {
        Err(format!("{action} failed with status {}.", output.status))
    } else {
        Err(format!("{action} failed: {details}"))
    }
}

fn find_device_attribute(attributes: &[&str], key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    attributes
        .iter()
        .find_map(|attribute| attribute.strip_prefix(&prefix))
        .map(|value| value.replace('_', " "))
}

fn list_devices_inner() -> Result<Vec<AdbDeviceInfo>, String> {
    let args = vec!["devices".to_string(), "-l".to_string()];
    let output = run_adb_checked(&args, "adb devices")?;
    let stdout = normalize_text_output(&output.stdout);

    let mut devices = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('*')
            || trimmed == "List of devices attached"
        {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }

        let serial = parts[0].to_string();
        let state = parts[1].to_string();
        let name = find_device_attribute(&parts[2..], "model")
            .or_else(|| find_device_attribute(&parts[2..], "device"))
            .or_else(|| find_device_attribute(&parts[2..], "product"))
            .unwrap_or_else(|| serial.clone());

        devices.push(AdbDeviceInfo {
            serial,
            name,
            state,
        });
    }

    Ok(devices)
}

fn address_host(address: &str) -> Option<String> {
    address
        .rsplit_once(':')
        .map(|(host, _)| host.trim_matches(&['[', ']'][..]).to_string())
}

fn find_ready_device<'a>(devices: &'a [AdbDeviceInfo], address: &str) -> Option<&'a AdbDeviceInfo> {
    if let Some(device) = devices
        .iter()
        .find(|device| device.state == "device" && device.serial == address)
    {
        return Some(device);
    }

    let target_host = address_host(address)?;

    devices.iter().find(|device| {
        device.state == "device"
            && address_host(&device.serial)
                .map(|serial_host| serial_host == target_host)
                .unwrap_or(false)
    })
}

fn extract_connected_serial(message: &str) -> Option<String> {
    for line in message.lines() {
        let trimmed = line.trim();
        if let Some(serial) = trimmed.strip_prefix("connected to ") {
            return Some(serial.trim().to_string());
        }

        if let Some(serial) = trimmed.strip_prefix("already connected to ") {
            return Some(serial.trim().to_string());
        }
    }

    None
}

fn wait_for_ready_device(address: &str, serial_hint: Option<&str>) -> Result<AdbDeviceInfo, String> {
    let deadline = Instant::now() + CONNECT_READY_TIMEOUT;

    loop {
        let devices = list_devices_inner()?;
        if let Some(serial_hint) = serial_hint {
            if let Some(device) = find_ready_device(&devices, serial_hint) {
                return Ok(device.clone());
            }
        }

        if let Some(device) = find_ready_device(&devices, address) {
            return Ok(device.clone());
        }

        if Instant::now() >= deadline {
            let visible_devices = devices
                .iter()
                .map(|device| format!("{} ({})", device.serial, device.state))
                .collect::<Vec<String>>()
                .join(", ");

            if visible_devices.is_empty() {
                return Err(format!(
                    "Connected to {address}, but no ready ADB device appeared before the timeout."
                ));
            }

            return Err(format!(
                "Connected to {address}, but the device was not ready before the timeout. Visible devices: {visible_devices}"
            ));
        }

        thread::sleep(CONNECT_READY_POLL_INTERVAL);
    }
}

#[command]
pub async fn tauri_adb_list_devices() -> Result<Vec<AdbDeviceInfo>, String> {
    tauri::async_runtime::spawn_blocking(list_devices_inner)
        .await
        .map_err(|error| format!("ADB device listing task failed: {error}"))?
}

/// Pair with a remote Android device over wireless debugging.
#[command]
pub async fn tauri_adb_pair(request: AdbPairRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let address = ensure_remote_address(&request.address, "Pairing address")?;
        let pairing_code = ensure_non_empty(&request.pairing_code, "Pairing code")?;

        let args = vec!["pair".to_string(), address.clone(), pairing_code];
        let output = run_adb_checked(&args, &format!("adb pair {address}"))?;
        let message = combine_command_output(&output);

        if message.is_empty() {
            Ok(format!("Successfully paired to {address}."))
        } else {
            Ok(message)
        }
    })
    .await
    .map_err(|error| format!("ADB pairing task failed: {error}"))?
}

/// Connect to a remote ADB endpoint and wait until the device is ready.
#[command]
pub async fn tauri_adb_connect(request: AdbConnectRequest) -> Result<AdbConnectResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let address = ensure_remote_address(&request.address, "Remote ADB address")?;

        let args = vec!["connect".to_string(), address.clone()];
        let output = run_adb_checked(&args, &format!("adb connect {address}"))?;
        let message = combine_command_output(&output);
        let serial_hint = extract_connected_serial(&message);
        let device = wait_for_ready_device(&address, serial_hint.as_deref())?;

        Ok(AdbConnectResponse {
            serial: device.serial.clone(),
            message: if message.is_empty() {
                format!("Connected to {}.", device.serial)
            } else {
                message
            },
        })
    })
    .await
    .map_err(|error| format!("ADB connect task failed: {error}"))?
}

/// Capture a PNG screenshot from the selected device using `exec-out screencap -p`.
#[command]
pub async fn tauri_adb_screenshot(serial: String) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let serial = ensure_non_empty(&serial, "ADB serial")?;

        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "exec-out".to_string(),
            "screencap".to_string(),
            "-p".to_string(),
        ];
        let output = run_adb_checked(&args, &format!("adb -s {serial} exec-out screencap -p"))?;

        if output.stdout.is_empty() {
            return Err(format!("ADB screenshot returned no data for {serial}."));
        }

        Ok(output.stdout)
    })
    .await
    .map_err(|error| format!("ADB screenshot task failed: {error}"))?
}

/// Execute an arbitrary shell command on the selected device.
#[command]
pub async fn tauri_adb_shell(serial: String, command: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let serial = ensure_non_empty(&serial, "ADB serial")?;
        let command = ensure_non_empty(&command, "ADB shell command")?;

        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "shell".to_string(),
            command,
        ];
        let output = run_adb_checked(&args, &format!("adb -s {serial} shell <command>"))?;

        Ok(combine_command_output(&output))
    })
    .await
    .map_err(|error| format!("ADB shell task failed: {error}"))?
}

/// Push a local file to the device filesystem.
#[command]
pub async fn tauri_adb_push(
    serial: String,
    local_path: String,
    remote_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let serial = ensure_non_empty(&serial, "ADB serial")?;
        let local_path = ensure_non_empty(&local_path, "Local file path")?;
        let remote_path = ensure_non_empty(&remote_path, "Remote file path")?;

        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "push".to_string(),
            local_path,
            remote_path.clone(),
        ];
        let output = run_adb_checked(&args, &format!("adb -s {serial} push -> {remote_path}"))?;

        Ok(combine_command_output(&output))
    })
    .await
    .map_err(|error| format!("ADB push task failed: {error}"))?
}

/// Set up TCP port forwarding to a device-side abstract socket.
#[command]
pub async fn tauri_adb_forward(
    serial: String,
    local_port: u16,
    remote_socket_name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let serial = ensure_non_empty(&serial, "ADB serial")?;
        let remote_socket_name = ensure_non_empty(&remote_socket_name, "Remote socket name")?;

        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "forward".to_string(),
            format!("tcp:{local_port}"),
            format!("localabstract:{remote_socket_name}"),
        ];
        let output = run_adb_checked(
            &args,
            &format!("adb -s {serial} forward tcp:{local_port} localabstract:{remote_socket_name}"),
        )?;

        Ok(combine_command_output(&output))
    })
    .await
    .map_err(|error| format!("ADB forward task failed: {error}"))?
}

/// Remove a previously established TCP port forward.
#[command]
pub async fn tauri_adb_remove_forward(serial: String, local_port: u16) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let serial = ensure_non_empty(&serial, "ADB serial")?;

        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "forward".to_string(),
            "--remove".to_string(),
            format!("tcp:{local_port}"),
        ];
        let output = run_adb_checked(
            &args,
            &format!("adb -s {serial} forward --remove tcp:{local_port}"),
        )?;

        Ok(combine_command_output(&output))
    })
    .await
    .map_err(|error| format!("ADB remove-forward task failed: {error}"))?
}

/// Launch the Android Camera Server via `app_process` in the background.
/// Returns after the device-side shell has detached the background process.
#[command]
pub async fn tauri_adb_start_server(
    serial: String,
    classpath: String,
    main_class: String,
    server_args: Vec<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let serial = ensure_non_empty(&serial, "ADB serial")?;
        let classpath = ensure_non_empty(&classpath, "Server classpath")?;
        let main_class = ensure_non_empty(&main_class, "Server main class")?;
        let shell_command =
            build_scanner_server_start_script(&classpath, &main_class, &server_args);
        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "shell".to_string(),
            "sh".to_string(),
            "-c".to_string(),
            wrap_shell_c_script(&shell_command),
        ];
        let output = run_adb_checked(
            &args,
            &format!("adb -s {serial} shell sh -c <start scanner server>"),
        )?;
        let message = combine_command_output(&output);

        if message.is_empty() {
            Ok(format!("Camera server started on {serial}."))
        } else {
            Ok(message)
        }
    })
    .await
    .map_err(|error| format!("ADB start-server task failed: {error}"))?
}

/// Stop the Android Camera Server running on the device.
/// Stops the tracked background process without killing unrelated `app_process` tasks.
#[command]
pub async fn tauri_adb_stop_server(serial: String, classpath: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let serial = ensure_non_empty(&serial, "ADB serial")?;
        let _classpath = ensure_non_empty(&classpath, "Server classpath")?;
        let kill_command = build_scanner_server_stop_script("com.skidhomework.server.Server");
        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "shell".to_string(),
            "sh".to_string(),
            "-c".to_string(),
            wrap_shell_c_script(&kill_command),
        ];

        let output = run_adb_command(&args)?;
        let message = combine_command_output(&output);

        if message.is_empty() {
            Ok(format!("Camera server stopped on {serial}."))
        } else {
            Ok(message)
        }
    })
    .await
    .map_err(|error| format!("ADB stop-server task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_script_uses_explicit_paths_without_shell_variables() {
        let script = build_scanner_server_start_script(
            "/data/local/tmp/camera-server.jar",
            "com.skidhomework.server.Server",
            &[
                "--socket".to_string(),
                "scanner".to_string(),
                "--width".to_string(),
                "640".to_string(),
            ],
        );

        assert!(script.contains("mkdir -p /data/local/tmp;"));
        assert!(script.contains("/data/local/tmp/skid-scanner-server.log"));
        assert!(script.contains("/data/local/tmp/skid-scanner-server.pid"));
        assert!(script.contains("app_process / 'com.skidhomework.server.Server'"));
        assert!(!script.contains("pidfile="));
        assert!(!script.contains("logfile="));
    }

    #[test]
    fn shell_c_wrapper_quotes_entire_script() {
        let wrapped = wrap_shell_c_script("echo hi; echo bye");
        assert_eq!(wrapped, "'echo hi; echo bye'");
    }
}
