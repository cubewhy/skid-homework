/// Native ADB bridge for Tauri desktop builds.
/// This replaces WebUSB/WebADB from the browser environment with direct
/// host-level access to the local `adb` executable.
use std::{
    env, io,
    net::IpAddr,
    path::{Path, PathBuf},
    process::{Command, ExitStatus},
    sync::OnceLock,
    thread,
    time::{Duration, Instant},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};
use tauri::command;
use tauri::ipc::{Channel, InvokeResponseBody};
use thiserror::Error;

static ADB_EXECUTABLE: OnceLock<PathBuf> = OnceLock::new();

const CONNECT_READY_TIMEOUT: Duration = Duration::from_secs(3);
const CONNECT_READY_POLL_INTERVAL: Duration = Duration::from_millis(250);
const ADB_SERVER_RECOVERY_RETRY_DELAY: Duration = Duration::from_millis(200);

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

type AdbResult<T> = Result<T, AdbError>;

#[derive(Debug, Error)]
pub(crate) enum AdbError {
    #[error("ADB executable was not found. Install Android Platform Tools or set the ADB_PATH environment variable. Looked for `{path}`.")]
    ExecutableNotFound {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("Failed to launch `{path}`: {source}")]
    Launch {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("{message}")]
    InvalidInput { message: String },
    #[error("{action} failed with status {status}.")]
    CommandFailedWithoutDetails { action: String, status: ExitStatus },
    #[error("{action} failed: {details}")]
    CommandFailed { action: String, details: String },
    #[error("{action} failed: {details}\nADB server auto-recovery failed: {recovery_error}")]
    RecoveryFailed {
        action: String,
        details: String,
        recovery_error: String,
    },
}

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

#[derive(Clone, Copy)]
pub(crate) enum CommandCapture {
    MergedText,
    Raw,
}

pub(crate) enum CommandOutput {
    MergedText {
        status: ExitStatus,
        text: String,
    },
    Raw {
        status: ExitStatus,
        stdout: Vec<u8>,
        stderr: Vec<u8>,
    },
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

pub(crate) fn adb_executable_path() -> PathBuf {
    ADB_EXECUTABLE
        .get_or_init(|| {
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
                        &PathBuf::from(home)
                            .join("Library")
                            .join("Android")
                            .join("sdk"),
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
        })
        .clone()
}

fn suppress_windows_console_window(_command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        // Prevent adb.exe from flashing a console window for background desktop operations.
        _command.creation_flags(CREATE_NO_WINDOW);
    }
}

pub(crate) fn normalize_text_output(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .replace("\r\n", "\n")
        .trim()
        .to_string()
}

fn launch_error(path: PathBuf, source: io::Error) -> AdbError {
    if source.kind() == io::ErrorKind::NotFound {
        AdbError::ExecutableNotFound { path, source }
    } else {
        AdbError::Launch { path, source }
    }
}

pub(crate) fn run_command(args: &[String], capture: CommandCapture) -> AdbResult<CommandOutput> {
    let executable = adb_executable_path();

    match capture {
        CommandCapture::MergedText => {
            let output = duct::cmd(executable.clone(), args.to_vec())
                .stderr_to_stdout()
                .stdout_capture()
                .unchecked()
                .before_spawn(|command| {
                    suppress_windows_console_window(command);
                    Ok(())
                })
                .run()
                .map_err(|error| launch_error(executable, error))?;

            Ok(CommandOutput::MergedText {
                status: output.status,
                text: normalize_text_output(&output.stdout),
            })
        }
        CommandCapture::Raw => {
            let mut command = Command::new(&executable);
            suppress_windows_console_window(&mut command);

            let output = command
                .args(args)
                .output()
                .map_err(|error| launch_error(executable, error))?;

            Ok(CommandOutput::Raw {
                status: output.status,
                stdout: output.stdout,
                stderr: output.stderr,
            })
        }
    }
}

fn command_failed(action: &str, status: ExitStatus, details: &str) -> AdbError {
    if details.trim().is_empty() {
        AdbError::CommandFailedWithoutDetails {
            action: action.to_string(),
            status,
        }
    } else {
        AdbError::CommandFailed {
            action: action.to_string(),
            details: details.to_string(),
        }
    }
}

fn require_non_empty_trimmed_value(value: &str, field_name: &str) -> AdbResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AdbError::InvalidInput {
            message: format!("{field_name} is required."),
        });
    }

    Ok(trimmed.to_string())
}

fn validate_ip_port_if_present(address: &str, field_name: &str) -> AdbResult<()> {
    let Some((host, port_text)) = address.rsplit_once(':') else {
        return Ok(());
    };

    let ip_text = host.trim_matches(&['[', ']'][..]);
    if ip_text.parse::<IpAddr>().is_err() {
        return Ok(());
    }

    let valid_port = port_text
        .parse::<u16>()
        .map(|port| port != 0)
        .unwrap_or(false);

    if valid_port {
        Ok(())
    } else {
        Err(AdbError::InvalidInput {
            message: format!("{field_name} port must be a number from 1 to 65535."),
        })
    }
}

fn validate_adb_remote_address(value: &str, field_name: &str) -> AdbResult<String> {
    let address = require_non_empty_trimmed_value(value, field_name)?;

    if address.len() > 255 {
        return Err(AdbError::InvalidInput {
            message: format!("{field_name} must be 255 characters or less."),
        });
    }

    if address
        .chars()
        .any(|ch| ch.is_whitespace() || ch.is_control())
    {
        return Err(AdbError::InvalidInput {
            message: format!("{field_name} must not contain whitespace or control characters."),
        });
    }

    if address.contains("://") {
        return Err(AdbError::InvalidInput {
            message: format!("{field_name} must be an adb connect target, not a URL."),
        });
    }

    if address.contains('/') || address.contains('\\') {
        return Err(AdbError::InvalidInput {
            message: format!("{field_name} must not contain path separators."),
        });
    }

    if address.starts_with('-') {
        return Err(AdbError::InvalidInput {
            message: format!("{field_name} must not start with '-'."),
        });
    }

    validate_ip_port_if_present(&address, field_name)?;
    Ok(address)
}

fn validate_pairing_code(value: &str) -> AdbResult<String> {
    let pairing_code = require_non_empty_trimmed_value(value, "Pairing code")?;
    if pairing_code.len() != 6 || !pairing_code.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(AdbError::InvalidInput {
            message: "Pairing code must be exactly 6 digits.".to_string(),
        });
    }
    Ok(pairing_code)
}

fn is_adb_server_recoverable_failure(details: &str) -> bool {
    let normalized = details.to_ascii_lowercase();
    [
        "daemon not running",
        "failed to start daemon",
        "cannot connect to daemon",
        "could not read ok from adb server",
        "failed to check server version",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern))
}

fn run_adb_management_command(args: &[&str], action: &str) -> AdbResult<()> {
    let owned_args = args
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<String>>();

    match run_command(&owned_args, CommandCapture::MergedText)? {
        CommandOutput::MergedText {
            status, text: _, ..
        } if status.success() => Ok(()),
        CommandOutput::MergedText { status, text } => Err(command_failed(action, status, &text)),
        CommandOutput::Raw { .. } => unreachable!("management command requested text capture"),
    }
}

fn recover_adb_server() -> AdbResult<()> {
    let first_start_error = match run_adb_management_command(&["start-server"], "adb start-server")
    {
        Ok(_) => return Ok(()),
        Err(error) => error.to_string(),
    };

    let mut recovery_messages = vec![format!(
        "Initial adb start-server attempt failed: {first_start_error}"
    )];

    match run_command(&["kill-server".to_string()], CommandCapture::MergedText) {
        Ok(CommandOutput::MergedText { status, text }) if !status.success() && !text.is_empty() => {
            recovery_messages.push(format!("adb kill-server reported: {text}"));
        }
        Err(error) => {
            recovery_messages.push(format!("Failed to launch adb kill-server: {error}"));
        }
        Ok(CommandOutput::MergedText { .. }) => {}
        Ok(CommandOutput::Raw { .. }) => unreachable!("kill-server requested text capture"),
    }

    thread::sleep(ADB_SERVER_RECOVERY_RETRY_DELAY);

    match run_adb_management_command(&["start-server"], "adb start-server") {
        Ok(_) => Ok(()),
        Err(error) => {
            recovery_messages.push(format!("Retry adb start-server attempt failed: {error}"));
            Err(AdbError::CommandFailed {
                action: "ADB server auto-recovery".to_string(),
                details: recovery_messages.join("\n"),
            })
        }
    }
}

fn find_device_attribute(attributes: &[&str], key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    attributes
        .iter()
        .find_map(|attribute| attribute.strip_prefix(&prefix))
        .map(|value| value.replace('_', " "))
}

fn list_devices_inner() -> AdbResult<Vec<AdbDeviceInfo>> {
    let args = vec!["devices".to_string(), "-l".to_string()];

    let text = match run_command(&args, CommandCapture::MergedText)? {
        CommandOutput::MergedText { status, text } if status.success() => text,
        CommandOutput::MergedText { status, text } => {
            if !text.is_empty() && is_adb_server_recoverable_failure(&text) {
                // Restart a wedged ADB server before retrying the visible device list.
                if let Err(recovery_error) = recover_adb_server() {
                    return Err(AdbError::RecoveryFailed {
                        action: "adb devices".to_string(),
                        details: text,
                        recovery_error: recovery_error.to_string(),
                    });
                }

                match run_command(&args, CommandCapture::MergedText)? {
                    CommandOutput::MergedText { status, text } if status.success() => text,
                    CommandOutput::MergedText { status, text } => {
                        return Err(command_failed(
                            "adb devices after ADB server auto-recovery",
                            status,
                            &text,
                        ));
                    }
                    CommandOutput::Raw { .. } => unreachable!("adb devices requested text capture"),
                }
            } else {
                return Err(command_failed("adb devices", status, &text));
            }
        }
        CommandOutput::Raw { .. } => unreachable!("adb devices requested text capture"),
    };

    let mut devices = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('*') || trimmed == "List of devices attached" {
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

fn wait_for_ready_device(address: &str, serial_hint: Option<&str>) -> AdbResult<AdbDeviceInfo> {
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

            let message = if visible_devices.is_empty() {
                format!(
                    "Connected to {address}, but no ready ADB device appeared before the timeout."
                )
            } else {
                format!(
                    "Connected to {address}, but the device was not ready before the timeout. Visible devices: {visible_devices}"
                )
            };

            return Err(AdbError::InvalidInput { message });
        }

        thread::sleep(CONNECT_READY_POLL_INTERVAL);
    }
}

#[command]
pub async fn tauri_adb_list_devices() -> Result<Vec<AdbDeviceInfo>, String> {
    tauri::async_runtime::spawn_blocking(list_devices_inner)
        .await
        .map_err(|error| format!("ADB device listing task failed: {error}"))?
        .map_err(|error| error.to_string())
}

/// Pair with a remote Android device over wireless debugging.
#[command]
pub async fn tauri_adb_pair(request: AdbPairRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> AdbResult<String> {
        let address = validate_adb_remote_address(&request.address, "Pairing address")?;
        let pairing_code = validate_pairing_code(&request.pairing_code)?;

        let args = vec!["pair".to_string(), address.clone(), pairing_code];
        match run_command(&args, CommandCapture::MergedText)? {
            CommandOutput::MergedText { status, text } if status.success() => {
                if text.is_empty() {
                    Ok(format!("Successfully paired to {address}."))
                } else {
                    Ok(text)
                }
            }
            CommandOutput::MergedText { status, text } => {
                if !text.is_empty() && is_adb_server_recoverable_failure(&text) {
                    // Pairing can surface daemon startup failures before the target is contacted.
                    if let Err(recovery_error) = recover_adb_server() {
                        return Err(AdbError::RecoveryFailed {
                            action: format!("adb pair {address}"),
                            details: text,
                            recovery_error: recovery_error.to_string(),
                        });
                    }

                    match run_command(&args, CommandCapture::MergedText)? {
                        CommandOutput::MergedText { status, text } if status.success() => {
                            if text.is_empty() {
                                Ok(format!("Successfully paired to {address}."))
                            } else {
                                Ok(text)
                            }
                        }
                        CommandOutput::MergedText { status, text } => Err(command_failed(
                            &format!("adb pair {address} after ADB server auto-recovery"),
                            status,
                            &text,
                        )),
                        CommandOutput::Raw { .. } => {
                            unreachable!("adb pair requested text capture")
                        }
                    }
                } else {
                    Err(command_failed(
                        &format!("adb pair {address}"),
                        status,
                        &text,
                    ))
                }
            }
            CommandOutput::Raw { .. } => unreachable!("adb pair requested text capture"),
        }
    })
    .await
    .map_err(|error| format!("ADB pairing task failed: {error}"))?
    .map_err(|error| error.to_string())
}

/// Connect to a remote ADB endpoint and wait until the device is ready.
#[command]
pub async fn tauri_adb_connect(request: AdbConnectRequest) -> Result<AdbConnectResponse, String> {
    tauri::async_runtime::spawn_blocking(move || -> AdbResult<AdbConnectResponse> {
        let address = validate_adb_remote_address(&request.address, "Remote ADB address")?;

        let args = vec!["connect".to_string(), address.clone()];
        let message = match run_command(&args, CommandCapture::MergedText)? {
            CommandOutput::MergedText { status, text } if status.success() => text,
            CommandOutput::MergedText { status, text } => {
                if !text.is_empty() && is_adb_server_recoverable_failure(&text) {
                    // Restart a wedged ADB server before retrying the requested connection.
                    if let Err(recovery_error) = recover_adb_server() {
                        return Err(AdbError::RecoveryFailed {
                            action: format!("adb connect {address}"),
                            details: text,
                            recovery_error: recovery_error.to_string(),
                        });
                    }

                    match run_command(&args, CommandCapture::MergedText)? {
                        CommandOutput::MergedText { status, text } if status.success() => text,
                        CommandOutput::MergedText { status, text } => {
                            return Err(command_failed(
                                &format!("adb connect {address} after ADB server auto-recovery"),
                                status,
                                &text,
                            ));
                        }
                        CommandOutput::Raw { .. } => {
                            unreachable!("adb connect requested text capture")
                        }
                    }
                } else {
                    return Err(command_failed(
                        &format!("adb connect {address}"),
                        status,
                        &text,
                    ));
                }
            }
            CommandOutput::Raw { .. } => unreachable!("adb connect requested text capture"),
        };

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
    .map_err(|error| error.to_string())
}

/// Push a local file to the device filesystem.
#[command]
pub async fn tauri_adb_push(
    serial: String,
    local_path: String,
    remote_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> AdbResult<String> {
        let serial = require_non_empty_trimmed_value(&serial, "ADB serial")?;
        let local_path = require_non_empty_trimmed_value(&local_path, "Local file path")?;
        let remote_path = require_non_empty_trimmed_value(&remote_path, "Remote file path")?;

        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "push".to_string(),
            local_path,
            remote_path.clone(),
        ];

        match run_command(&args, CommandCapture::MergedText)? {
            CommandOutput::MergedText { status, text } if status.success() => Ok(text),
            CommandOutput::MergedText { status, text } => {
                if !text.is_empty() && is_adb_server_recoverable_failure(&text) {
                    // Retry once after bringing the local ADB server back up.
                    if let Err(recovery_error) = recover_adb_server() {
                        return Err(AdbError::RecoveryFailed {
                            action: format!("adb -s {serial} push -> {remote_path}"),
                            details: text,
                            recovery_error: recovery_error.to_string(),
                        });
                    }

                    match run_command(&args, CommandCapture::MergedText)? {
                        CommandOutput::MergedText { status, text } if status.success() => Ok(text),
                        CommandOutput::MergedText { status, text } => Err(command_failed(
                            &format!(
                                "adb -s {serial} push -> {remote_path} after ADB server auto-recovery"
                            ),
                            status,
                            &text,
                        )),
                        CommandOutput::Raw { .. } => {
                            unreachable!("adb push requested text capture")
                        }
                    }
                } else {
                    Err(command_failed(
                        &format!("adb -s {serial} push -> {remote_path}"),
                        status,
                        &text,
                    ))
                }
            }
            CommandOutput::Raw { .. } => unreachable!("adb push requested text capture"),
        }
    })
    .await
    .map_err(|error| format!("ADB push task failed: {error}"))?
    .map_err(|error| error.to_string())
}

/// Set up TCP port forwarding to a device-side abstract socket.
#[command]
pub async fn tauri_adb_forward(
    serial: String,
    local_port: u16,
    remote_socket_name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> AdbResult<String> {
        let serial = require_non_empty_trimmed_value(&serial, "ADB serial")?;
        let remote_socket_name =
            require_non_empty_trimmed_value(&remote_socket_name, "Remote socket name")?;

        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "forward".to_string(),
            format!("tcp:{local_port}"),
            format!("localabstract:{remote_socket_name}"),
        ];
        let action =
            format!("adb -s {serial} forward tcp:{local_port} localabstract:{remote_socket_name}");

        match run_command(&args, CommandCapture::MergedText)? {
            CommandOutput::MergedText { status, text } if status.success() => Ok(text),
            CommandOutput::MergedText { status, text } => {
                if !text.is_empty() && is_adb_server_recoverable_failure(&text) {
                    // Retry once after bringing the local ADB server back up.
                    if let Err(recovery_error) = recover_adb_server() {
                        return Err(AdbError::RecoveryFailed {
                            action,
                            details: text,
                            recovery_error: recovery_error.to_string(),
                        });
                    }

                    match run_command(&args, CommandCapture::MergedText)? {
                        CommandOutput::MergedText { status, text } if status.success() => Ok(text),
                        CommandOutput::MergedText { status, text } => Err(command_failed(
                            &format!("{action} after ADB server auto-recovery"),
                            status,
                            &text,
                        )),
                        CommandOutput::Raw { .. } => {
                            unreachable!("adb forward requested text capture")
                        }
                    }
                } else {
                    Err(command_failed(&action, status, &text))
                }
            }
            CommandOutput::Raw { .. } => unreachable!("adb forward requested text capture"),
        }
    })
    .await
    .map_err(|error| format!("ADB forward task failed: {error}"))?
    .map_err(|error| error.to_string())
}

/// Remove a previously established TCP port forward.
#[command]
pub async fn tauri_adb_remove_forward(serial: String, local_port: u16) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> AdbResult<String> {
        let serial = require_non_empty_trimmed_value(&serial, "ADB serial")?;

        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "forward".to_string(),
            "--remove".to_string(),
            format!("tcp:{local_port}"),
        ];
        let action = format!("adb -s {serial} forward --remove tcp:{local_port}");

        match run_command(&args, CommandCapture::MergedText)? {
            CommandOutput::MergedText { status, text } if status.success() => Ok(text),
            CommandOutput::MergedText { status, text } => {
                if !text.is_empty() && is_adb_server_recoverable_failure(&text) {
                    // Retry once after bringing the local ADB server back up.
                    if let Err(recovery_error) = recover_adb_server() {
                        return Err(AdbError::RecoveryFailed {
                            action,
                            details: text,
                            recovery_error: recovery_error.to_string(),
                        });
                    }

                    match run_command(&args, CommandCapture::MergedText)? {
                        CommandOutput::MergedText { status, text } if status.success() => Ok(text),
                        CommandOutput::MergedText { status, text } => Err(command_failed(
                            &format!("{action} after ADB server auto-recovery"),
                            status,
                            &text,
                        )),
                        CommandOutput::Raw { .. } => {
                            unreachable!("adb forward --remove requested text capture")
                        }
                    }
                } else {
                    Err(command_failed(&action, status, &text))
                }
            }
            CommandOutput::Raw { .. } => {
                unreachable!("adb forward --remove requested text capture")
            }
        }
    })
    .await
    .map_err(|error| format!("ADB remove-forward task failed: {error}"))?
    .map_err(|error| error.to_string())
}

// ---------------------------------------------------------------------------
// Screenshot command
// ---------------------------------------------------------------------------

fn send_raw_payload(
    channel: &Channel<InvokeResponseBody>,
    bytes: Vec<u8>,
    context: &str,
) -> Result<(), String> {
    channel
        .send(InvokeResponseBody::Raw(bytes))
        .map_err(|error| format!("Failed to deliver {context} to the frontend: {error}"))
}

/// Capture a device screenshot via `adb exec-out screencap -p`.
#[command]
pub async fn tauri_adb_screenshot(
    serial: String,
    payload_channel: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let png_bytes: Result<Vec<u8>, String> = tauri::async_runtime::spawn_blocking(move || {
        let serial = require_non_empty_trimmed_value(&serial, "ADB serial")
            .map_err(|error| error.to_string())?;
        let args = vec![
            "-s".to_string(),
            serial.clone(),
            "exec-out".to_string(),
            "screencap".to_string(),
            "-p".to_string(),
        ];

        match run_command(&args, CommandCapture::Raw).map_err(|error| error.to_string())? {
            CommandOutput::Raw { status, stdout, .. } if status.success() => Ok(stdout),
            CommandOutput::Raw { status, stderr, .. } => Err(command_failed(
                &format!("adb -s {serial} exec-out screencap -p"),
                status,
                &normalize_text_output(&stderr),
            )
            .to_string()),
            CommandOutput::MergedText { .. } => {
                unreachable!("adb screencap requested raw capture")
            }
        }
    })
    .await
    .map_err(|error| format!("ADB screenshot task failed: {error}"))?;

    send_raw_payload(&payload_channel, png_bytes?, "ADB screenshot")
}
