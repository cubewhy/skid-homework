/// Native ADB bridge for Tauri desktop builds.
/// This replaces WebUSB/WebADB from the browser environment with direct
/// host-level access to the local `adb` executable.
use std::{
    env,
    io::{BufReader, ErrorKind, Read},
    net::{SocketAddr, TcpStream as StdTcpStream},
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::OnceLock,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};
use tauri::command;

static ADB_EXECUTABLE: OnceLock<PathBuf> = OnceLock::new();

const CONNECT_READY_TIMEOUT: Duration = Duration::from_secs(3);
const CONNECT_READY_POLL_INTERVAL: Duration = Duration::from_millis(250);
const ADB_SERVER_RECOVERY_RETRY_DELAY: Duration = Duration::from_millis(200);
const STILL_STREAM_CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const STILL_STREAM_READ_TIMEOUT: Duration = Duration::from_secs(20);
const DEVICE_TMP_DIR: &str = "/data/local/tmp";
const SCANNER_SERVER_PID_PATH: &str = "/data/local/tmp/skid-scanner-server.pid";
const SCANNER_SERVER_LOG_PATH: &str = "/data/local/tmp/skid-scanner-server.log";
const STILL_CAPTURE_MAIN_CLASS: &str = "com.skidhomework.server.StillCapture";
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

fn build_app_process_shell_command(
    classpath: &str,
    main_class: &str,
    main_args: &[String],
) -> String {
    let mut command_parts = vec![
        format!("CLASSPATH={}", shell_single_quote(classpath)),
        "app_process".to_string(),
        "/".to_string(),
        shell_single_quote(main_class),
    ];
    command_parts.extend(main_args.iter().map(|value| shell_single_quote(value)));

    command_parts.join(" ")
}

fn build_scanner_server_start_script(
    classpath: &str,
    main_class: &str,
    server_args: &[String],
) -> String {
    let app_process_command = build_app_process_shell_command(classpath, main_class, server_args);

    format!(
        "mkdir -p /data/local/tmp; \
rm -f {pidfile}; \
: >{logfile}; \
{} </dev/null >>{logfile} 2>&1 & echo $! > {pidfile}",
        app_process_command,
        pidfile = shell_single_quote(SCANNER_SERVER_PID_PATH),
        logfile = shell_single_quote(SCANNER_SERVER_LOG_PATH),
    )
}

fn build_still_capture_script(
    classpath: &str,
    socket_name: &str,
    output_path: Option<&str>,
) -> String {
    let mut capture_args = vec!["--socket".to_string(), socket_name.to_string()];
    if let Some(output_path) = output_path {
        capture_args.push("--output".to_string());
        capture_args.push(output_path.to_string());
    }
    let app_process_command =
        build_app_process_shell_command(classpath, STILL_CAPTURE_MAIN_CLASS, &capture_args);

    if let Some(output_path) = output_path {
        return format!(
            "mkdir -p {tmp_dir}; \
 rm -f {output_path}; \
 {app_process_command} >/dev/null",
            tmp_dir = shell_single_quote(DEVICE_TMP_DIR),
            output_path = shell_single_quote(output_path),
        );
    }

    app_process_command
}

fn describe_hex_window(bytes: &[u8], count: usize, from_end: bool) -> String {
    if bytes.is_empty() {
        return "∅".to_string();
    }

    let safe_count = count.max(1).min(bytes.len());
    let slice = if from_end {
        &bytes[bytes.len() - safe_count..]
    } else {
        &bytes[..safe_count]
    };

    slice
        .iter()
        .map(|value| format!("{value:02x}"))
        .collect::<Vec<String>>()
        .join(" ")
}

fn find_marker_offset(
    bytes: &[u8],
    marker_high: u8,
    marker_low: u8,
    from_end: bool,
) -> Option<usize> {
    if bytes.len() < 2 {
        return None;
    }

    if from_end {
        for index in (0..=(bytes.len() - 2)).rev() {
            if bytes[index] == marker_high && bytes[index + 1] == marker_low {
                return Some(index);
            }
        }
        return None;
    }

    for index in 0..=(bytes.len() - 2) {
        if bytes[index] == marker_high && bytes[index + 1] == marker_low {
            return Some(index);
        }
    }

    None
}

fn describe_binary_payload(bytes: &[u8]) -> String {
    format!(
        "len={} head=[{}] tail=[{}] first_soi={:?} last_eoi={:?}",
        bytes.len(),
        describe_hex_window(bytes, 16, false),
        describe_hex_window(bytes, 16, true),
        find_marker_offset(bytes, 0xff, 0xd8, false),
        find_marker_offset(bytes, 0xff, 0xd9, true),
    )
}

fn build_remove_file_shell_script(path: &str) -> String {
    format!("rm -f {}", shell_single_quote(path))
}

fn validate_still_capture_payload(
    serial: &str,
    payload: Vec<u8>,
    failure_context: &str,
) -> Result<Vec<u8>, String> {
    if payload.is_empty() {
        return Err(format!("{failure_context} returned no data for {serial}."));
    }

    if payload.len() >= 2 && payload[0] == 0xff && payload[1] == 0xd8 {
        return Ok(payload);
    }

    let text_probe = normalize_text_output(&payload);
    if !text_probe.is_empty() {
        return Err(format!(
            "{failure_context} was not a JPEG for {serial}: {text_probe}"
        ));
    }

    Err(format!(
        "{failure_context} was not a JPEG for {serial}: {}",
        describe_binary_payload(&payload)
    ))
}

fn capture_still_via_exec_out_stdout(
    serial: &str,
    classpath: &str,
    socket_name: &str,
) -> Result<Vec<u8>, String> {
    let capture_script = build_still_capture_script(classpath, socket_name, None);
    let capture_args = vec![
        "-s".to_string(),
        serial.to_string(),
        "exec-out".to_string(),
        "sh".to_string(),
        "-c".to_string(),
        wrap_shell_c_script(&capture_script),
    ];
    let output = run_adb_checked(
        &capture_args,
        &format!("adb -s {serial} exec-out sh -c <capture still to stdout>"),
    )?;

    let stderr = normalize_text_output(&output.stderr);
    if !stderr.is_empty() {
        log::info!("[Scanner][StillDiag] Direct still capture stderr for {serial}: {stderr}");
    }

    let payload =
        validate_still_capture_payload(serial, output.stdout, "Direct still capture stdout")?;
    log::info!(
        "[Scanner][StillDiag] Direct still payload for {serial}: {}",
        describe_binary_payload(&payload)
    );
    Ok(payload)
}

fn capture_still_via_device_file(
    serial: &str,
    classpath: &str,
    socket_name: &str,
) -> Result<Vec<u8>, String> {
    let remote_output_path = build_remote_still_capture_path(serial);
    let capture_script =
        build_still_capture_script(classpath, socket_name, Some(&remote_output_path));

    let capture_args = vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "sh".to_string(),
        "-c".to_string(),
        wrap_shell_c_script(&capture_script),
    ];

    let capture_output = run_adb_checked(
        &capture_args,
        &format!("adb -s {serial} shell sh -c <capture still to file>"),
    )?;
    let capture_details = combine_command_output(&capture_output);
    if !capture_details.is_empty() {
        log::info!(
            "[Scanner][StillDiag] Device capture command output for {serial}: {capture_details}"
        );
    }
    log::info!(
        "[Scanner][StillDiag] Device still capture command completed for {serial}; remote path={remote_output_path}"
    );

    let fetch_result = (|| {
        let fetch_args = vec![
            "-s".to_string(),
            serial.to_string(),
            "exec-out".to_string(),
            "cat".to_string(),
            remote_output_path.clone(),
        ];
        let output = run_adb_checked(
            &fetch_args,
            &format!("adb -s {serial} exec-out cat {remote_output_path}"),
        )?;
        let payload = validate_still_capture_payload(
            serial,
            output.stdout,
            "Device-file still capture fetch",
        )?;

        log::info!(
            "[Scanner][StillDiag] Host fetched still payload for {serial}: {}",
            describe_binary_payload(&payload)
        );

        Ok(payload)
    })();

    let cleanup_script = build_remove_file_shell_script(&remote_output_path);
    let cleanup_args = vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "sh".to_string(),
        "-c".to_string(),
        wrap_shell_c_script(&cleanup_script),
    ];
    let _ = run_adb_command(&cleanup_args);

    fetch_result
}

fn capture_still_via_forwarded_socket(port: u16) -> Result<Vec<u8>, String> {
    let address: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|error| format!("Invalid still-stream forward address for port {port}: {error}"))?;
    let started_at = Instant::now();
    let stream = StdTcpStream::connect_timeout(&address, STILL_STREAM_CONNECT_TIMEOUT)
        .map_err(|error| format!("Failed to connect to forwarded still stream at {address}: {error}"))?;
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(STILL_STREAM_READ_TIMEOUT));

    let mut payload = Vec::with_capacity(2 * 1024 * 1024);
    let mut reader = BufReader::with_capacity(256 * 1024, stream);
    reader
        .read_to_end(&mut payload)
        .map_err(|error| format!("Failed to read forwarded still stream from {address}: {error}"))?;

    let address_label = format!("tcp://{address}");
    let payload = validate_still_capture_payload(
        &address_label,
        payload,
        "Forwarded still stream payload",
    )?;
    if payload.len() < 2 || payload[payload.len() - 2] != 0xff || payload[payload.len() - 1] != 0xd9
    {
        return Err(format!(
            "Forwarded still stream payload was truncated for {address_label}: {}",
            describe_binary_payload(&payload)
        ));
    }
    log::info!(
        "[Scanner][StillDiag] Forwarded still payload from {address}: {}",
        describe_binary_payload(&payload)
    );
    log::info!(
        "[Scanner][StillPerf] Forwarded still stream completed from {address} in {:.1}ms.",
        started_at.elapsed().as_secs_f64() * 1000.0,
    );
    Ok(payload)
}

fn build_remote_still_capture_path(serial: &str) -> String {
    let sanitized_serial = serial
        .chars()
        .map(|value| match value {
            'a'..='z' | 'A'..='Z' | '0'..='9' => value,
            _ => '_',
        })
        .collect::<String>();
    let unique_suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    format!("{DEVICE_TMP_DIR}/skid-scanner-still-{sanitized_serial}-{unique_suffix}.jpg")
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

fn build_failed_action_error(action: &str, output: &Output) -> String {
    let details = combine_command_output(output);
    if details.is_empty() {
        format!("{action} failed with status {}.", output.status)
    } else {
        format!("{action} failed: {details}")
    }
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

fn is_adb_server_management_command(args: &[String]) -> bool {
    matches!(
        args.first().map(String::as_str),
        Some("start-server") | Some("kill-server")
    )
}

fn run_adb_management_command(args: &[&str], action: &str) -> Result<Output, String> {
    let owned_args = args
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<String>>();
    let output = run_adb_command(&owned_args)?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(build_failed_action_error(action, &output))
    }
}

fn recover_adb_server() -> Result<(), String> {
    let first_start_error = match run_adb_management_command(&["start-server"], "adb start-server")
    {
        Ok(_) => return Ok(()),
        Err(error) => error,
    };

    let mut recovery_messages = vec![format!(
        "Initial adb start-server attempt failed: {first_start_error}"
    )];

    match run_adb_command(&["kill-server".to_string()]) {
        Ok(output) if !output.status.success() => {
            let details = combine_command_output(&output);
            if !details.is_empty() {
                recovery_messages.push(format!("adb kill-server reported: {details}"));
            }
        }
        Err(error) => {
            recovery_messages.push(format!("Failed to launch adb kill-server: {error}"));
        }
        Ok(_) => {}
    }

    thread::sleep(ADB_SERVER_RECOVERY_RETRY_DELAY);

    match run_adb_management_command(&["start-server"], "adb start-server") {
        Ok(_) => Ok(()),
        Err(error) => {
            recovery_messages.push(format!("Retry adb start-server attempt failed: {error}"));
            Err(recovery_messages.join("\n"))
        }
    }
}

fn run_adb_checked(args: &[String], action: &str) -> Result<Output, String> {
    let output = run_adb_command(args)?;

    if output.status.success() {
        return Ok(output);
    }

    let details = combine_command_output(&output);
    if !details.is_empty()
        && !is_adb_server_management_command(args)
        && is_adb_server_recoverable_failure(&details)
    {
        if let Err(recovery_error) = recover_adb_server() {
            return Err(format!(
                "{action} failed: {details}\nADB server auto-recovery failed: {recovery_error}"
            ));
        }

        let retried_output = run_adb_command(args)?;
        if retried_output.status.success() {
            return Ok(retried_output);
        }

        return Err(build_failed_action_error(
            &format!("{action} after ADB server auto-recovery"),
            &retried_output,
        ));
    }

    Err(build_failed_action_error(action, &output))
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

fn wait_for_ready_device(
    address: &str,
    serial_hint: Option<&str>,
) -> Result<AdbDeviceInfo, String> {
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
pub async fn tauri_adb_screenshot(serial: String) -> Result<tauri::ipc::Response, String> {
    let png_bytes = tauri::async_runtime::spawn_blocking(move || {
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
    .map_err(|error| format!("ADB screenshot task failed: {error}"))?;

    Ok(tauri::ipc::Response::new(png_bytes?))
}

/// Capture a full-resolution still image from the Android camera pipeline.
#[command]
pub async fn tauri_adb_capture_still(
    serial: String,
    classpath: String,
    socket_name: String,
) -> Result<tauri::ipc::Response, String> {
    let jpeg_bytes: Result<Vec<u8>, String> = tauri::async_runtime::spawn_blocking(move || {
        let serial = ensure_non_empty(&serial, "ADB serial")?;
        let classpath = ensure_non_empty(&classpath, "Server classpath")?;
        let socket_name = ensure_non_empty(&socket_name, "Still capture socket name")?;
        let overall_start = Instant::now();
        let direct_start = Instant::now();

        match capture_still_via_exec_out_stdout(&serial, &classpath, &socket_name) {
            Ok(payload) => {
                log::info!(
                    "[Scanner][StillPerf] Fast-path still capture succeeded for {serial} in {:.1}ms (total {:.1}ms).",
                    direct_start.elapsed().as_secs_f64() * 1000.0,
                    overall_start.elapsed().as_secs_f64() * 1000.0,
                );
                Ok(payload)
            }
            Err(direct_error) => {
                let direct_elapsed_ms = direct_start.elapsed().as_secs_f64() * 1000.0;
                log::warn!(
                    "[Scanner][StillPerf] Fast-path still capture failed for {serial} after {:.1}ms: {}. Falling back to device-file transfer.",
                    direct_elapsed_ms,
                    direct_error,
                );

                let fallback_start = Instant::now();
                let payload = capture_still_via_device_file(&serial, &classpath, &socket_name)?;
                log::info!(
                    "[Scanner][StillPerf] Fallback still capture succeeded for {serial} in {:.1}ms after fast-path miss; total {:.1}ms.",
                    fallback_start.elapsed().as_secs_f64() * 1000.0,
                    overall_start.elapsed().as_secs_f64() * 1000.0,
                );
                Ok(payload)
            }
        }
    })
    .await
    .map_err(|error| format!("ADB still-capture task failed: {error}"))?;

    Ok(tauri::ipc::Response::new(jpeg_bytes?))
}

/// Capture a full-resolution still image over a persistent forwarded still-stream socket.
#[command]
pub async fn tauri_adb_capture_still_stream(port: u16) -> Result<tauri::ipc::Response, String> {
    let jpeg_bytes: Result<Vec<u8>, String> =
        tauri::async_runtime::spawn_blocking(move || capture_still_via_forwarded_socket(port))
            .await
            .map_err(|error| format!("ADB forwarded still-stream task failed: {error}"))?;

    Ok(tauri::ipc::Response::new(jpeg_bytes?))
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
