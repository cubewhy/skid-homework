/// Native H.264 stream decoder for the ADB camera scanner.
///
/// Connects to a forwarded TCP port, reads length-prefixed H.264 NAL units
/// from the Android Camera Server, decodes them with `openh264`, extracts a
/// downscaled I420 preview frame, and serves the newest color frame to the
/// frontend via polling.
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use openh264::decoder::Decoder;
use openh264::formats::YUVSource;
use serde::Serialize;
use tauri::{command, AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio::task::spawn_blocking;

/// Shared flag to signal the decode loop to stop.
static STREAMING: AtomicBool = AtomicBool::new(false);

/// Stores the most recently decoded frame packet.
static LATEST_FRAME: Mutex<Option<PackedFrame>> = Mutex::new(None);

/// Frame counter for periodic perf logging.
static FRAME_SEQ: AtomicU64 = AtomicU64::new(0);

/// Emit the aggregate throughput log every N seconds.
const OVERALL_LOG_INTERVAL_SECS: u64 = 5;
/// Retry a fresh decoder connection briefly to avoid startup churn.
const STARTUP_CONNECT_MAX_ATTEMPTS: usize = 24;
/// Retry a dropped preview socket before surfacing a fatal stop.
const STREAM_RECONNECT_MAX_ATTEMPTS: usize = 12;
/// Base reconnect delay.
const RECONNECT_RETRY_BASE_DELAY_MS: u64 = 100;
/// Upper bound for reconnect backoff.
const RECONNECT_RETRY_MAX_DELAY_MS: u64 = 800;

/// Packet layout: codec byte + width + height.
const FRAME_PACKET_HEADER_SIZE: usize = 9;

/// Downscaled I420 preview frame payload.
const FRAME_CODEC_I420: u8 = 3;

/// Keep live preview under roughly 640x360 to reduce IPC overhead and frontend decode cost.
const MAX_PREVIEW_WIDTH: usize = 640;
const MAX_PREVIEW_HEIGHT: usize = 360;

/// Encoded frame waiting to be consumed by the frontend.
#[derive(Clone, Debug, PartialEq, Eq)]
struct PackedFrame {
    packet: Vec<u8>,
}

/// Decoded preview frame plus timing metadata.
struct PreviewFrame {
    packet: Vec<u8>,
    payload_len: usize,
    width: u32,
    height: u32,
    decode_ms: f64,
    preview_pack_ms: f64,
}

/// Structured decoder lifecycle event for diagnostics and future UI hooks.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DecoderLifecycleEvent {
    state: String,
    detail: String,
    recoverable: bool,
    reconnect_attempt: usize,
}

/// Final exit classification for the decode loop.
#[derive(Clone, Debug, PartialEq, Eq)]
enum DecodeLoopExit {
    ManualStop,
    RemoteClosed { detail: String },
}

/// Poll for the latest decoded frame from the frontend.
#[command]
pub fn tauri_scanner_get_frame() -> Result<tauri::ipc::Response, String> {
    let packed = take_packed_frame(&LATEST_FRAME)?;
    Ok(tauri::ipc::Response::new(packed))
}

/// Start receiving and decoding the H.264 video stream from the forwarded port.
#[command]
pub async fn tauri_scanner_start_stream(app: AppHandle, port: u16) -> Result<(), String> {
    if STREAMING.swap(true, Ordering::SeqCst) {
        return Err("Stream decoder is already running.".to_string());
    }

    if let Ok(mut guard) = LATEST_FRAME.lock() {
        *guard = None;
    }
    FRAME_SEQ.store(0, Ordering::Relaxed);
    emit_decoder_status(
        &app,
        "starting",
        format!("Starting decoder for tcp://127.0.0.1:{port}."),
        true,
        0,
    );

    tauri::async_runtime::spawn(async move {
        let result = decode_stream_loop(&app, port).await;

        match &result {
            Ok(DecodeLoopExit::ManualStop) => {
                emit_decoder_status(
                    &app,
                    "stopped",
                    "Stream decoder stopped by request.".to_string(),
                    false,
                    0,
                );
            }
            Ok(DecodeLoopExit::RemoteClosed { detail }) => {
                emit_decoder_status(&app, "stopped", detail.clone(), false, 0);
            }
            Err(error) => {
                log::error!("Stream decoder error: {error}");
                emit_decoder_status(&app, "error", error.clone(), false, 0);
                let _ = app.emit("scanner:error", error.to_string());
            }
        }

        STREAMING.store(false, Ordering::SeqCst);
        let _ = app.emit("scanner:stopped", ());
    });

    Ok(())
}

/// Stop the currently running stream decoder.
#[command]
pub async fn tauri_scanner_stop_stream() -> Result<(), String> {
    if !STREAMING.swap(false, Ordering::SeqCst) {
        return Err("No stream decoder is currently running.".to_string());
    }
    Ok(())
}

/// Internal decode loop that reads NAL units from TCP and decodes them.
async fn decode_stream_loop(app: &AppHandle, port: u16) -> Result<DecodeLoopExit, String> {
    let address = format!("127.0.0.1:{port}");
    let mut reconnect_attempt = 0usize;
    let (mut stream, mut decoder) = connect_decoder_stream(
        app,
        &address,
        STARTUP_CONNECT_MAX_ATTEMPTS,
        reconnect_attempt,
        "Waiting for preview stream to become available.",
    )
    .await?;

    let mut length_buf = [0u8; 4];
    let loop_start = Instant::now();
    let mut last_overall_log_sec = 0;

    loop {
        if !STREAMING.load(Ordering::SeqCst) {
            return Ok(DecodeLoopExit::ManualStop);
        }

        let iter_start = Instant::now();

        if let Err(error) = stream.read_exact(&mut length_buf).await {
            if !STREAMING.load(Ordering::SeqCst) {
                return Ok(DecodeLoopExit::ManualStop);
            }

            if is_recoverable_stream_error(&error) {
                reconnect_attempt += 1;
                if reconnect_attempt > STREAM_RECONNECT_MAX_ATTEMPTS {
                    return Err(format!(
                        "Preview stream closed unexpectedly after {STREAM_RECONNECT_MAX_ATTEMPTS} reconnect attempts: {error}"
                    ));
                }

                let detail = format!(
                    "Preview socket read interrupted ({error}). Reconnecting decoder transport."
                );
                log::warn!("{detail}");
                emit_decoder_status(app, "reconnecting", detail, true, reconnect_attempt);
                let (next_stream, next_decoder) = connect_decoder_stream(
                    app,
                    &address,
                    STREAM_RECONNECT_MAX_ATTEMPTS,
                    reconnect_attempt,
                    "Reconnecting preview stream after socket interruption.",
                )
                .await?;
                stream = next_stream;
                decoder = next_decoder;
                continue;
            }

            if error.kind() == std::io::ErrorKind::UnexpectedEof {
                return Ok(DecodeLoopExit::RemoteClosed {
                    detail: "Preview stream ended after the upstream socket closed.".to_string(),
                });
            }
            return Err(format!("Failed to read NAL length: {error}"));
        }

        let nal_length = u32::from_be_bytes(length_buf) as usize;

        if nal_length == 0 || nal_length > 10 * 1024 * 1024 {
            continue;
        }

        let mut nal_data = vec![0u8; nal_length];
        if let Err(error) = stream.read_exact(&mut nal_data).await {
            if !STREAMING.load(Ordering::SeqCst) {
                return Ok(DecodeLoopExit::ManualStop);
            }

            if is_recoverable_stream_error(&error) {
                reconnect_attempt += 1;
                if reconnect_attempt > STREAM_RECONNECT_MAX_ATTEMPTS {
                    return Err(format!(
                        "Preview payload read kept failing after {STREAM_RECONNECT_MAX_ATTEMPTS} reconnect attempts: {error}"
                    ));
                }

                let detail = format!(
                    "Preview payload read interrupted ({error}). Reconnecting decoder transport."
                );
                log::warn!("{detail}");
                emit_decoder_status(app, "reconnecting", detail, true, reconnect_attempt);
                let (next_stream, next_decoder) = connect_decoder_stream(
                    app,
                    &address,
                    STREAM_RECONNECT_MAX_ATTEMPTS,
                    reconnect_attempt,
                    "Reconnecting preview stream after payload interruption.",
                )
                .await?;
                stream = next_stream;
                decoder = next_decoder;
                continue;
            }

            return Err(format!("Failed to read NAL data ({nal_length} bytes): {error}"));
        }

        let tcp_read_ms = iter_start.elapsed().as_secs_f64() * 1000.0;
        let decoder_clone = decoder.clone();
        let decode_result = spawn_blocking(move || decode_nal_to_preview(decoder_clone, nal_data))
            .await
            .map_err(|error| format!("Decode task panicked: {error}"))?;

        match decode_result {
            Ok(Some(frame)) => {
                reconnect_attempt = 0;
                let seq = FRAME_SEQ.fetch_add(1, Ordering::Relaxed);
                let payload_kb = frame.payload_len as f64 / 1024.0;
                let nal_kb = nal_length as f64 / 1024.0;

                if seq % 15 == 0 {
                    log::info!(
                        "[perf] frame#{seq} {}x{} | tcp_read={:.1}ms  h264_decode={:.1}ms  \
                         preview_pack={:.1}ms | NAL={:.1}KB  I420={:.1}KB",
                        frame.width,
                        frame.height,
                        tcp_read_ms,
                        frame.decode_ms,
                        frame.preview_pack_ms,
                        nal_kb,
                        payload_kb
                    );
                }

                publish_encoded_frame(
                    &LATEST_FRAME,
                    PackedFrame {
                        packet: frame.packet,
                    },
                );
            }
            Ok(None) => {}
            Err(error) => {
                return Err(error);
            }
        }

        let elapsed = loop_start.elapsed().as_secs();
        if elapsed > 0 && elapsed >= last_overall_log_sec + OVERALL_LOG_INTERVAL_SECS {
            last_overall_log_sec = elapsed;
            let total = FRAME_SEQ.load(Ordering::Relaxed);
            let fps = total as f64 / loop_start.elapsed().as_secs_f64();
            log::info!("[perf] overall: {total} frames in {elapsed}s = {fps:.1} fps");
        }
    }

}

/// Decode a single H.264 NAL unit to a downscaled contiguous I420 preview frame.
fn decode_nal_to_preview(
    decoder: Arc<Mutex<Decoder>>,
    nal_data: Vec<u8>,
) -> Result<Option<PreviewFrame>, String> {
    let data = if nal_data.starts_with(&[0, 0, 0, 1]) || nal_data.starts_with(&[0, 0, 1]) {
        nal_data
    } else {
        let mut prefixed = vec![0, 0, 0, 1];
        prefixed.extend_from_slice(&nal_data);
        prefixed
    };

    let mut decoder_guard = decoder
        .lock()
        .map_err(|error| format!("Decoder mutex poisoned: {error}"))?;

    let decode_start = Instant::now();
    match decoder_guard.decode(&data) {
        Ok(Some(decoded_yuv)) => {
            let decode_ms = decode_start.elapsed().as_secs_f64() * 1000.0;
            let (source_width, source_height) = decoded_yuv.dimensions();
            let (y_stride, u_stride, v_stride) = decoded_yuv.strides();
            let (preview_width, preview_height, factor) =
                select_preview_dimensions(source_width, source_height);

            let pack_start = Instant::now();
            let payload_len = compute_i420_payload_len(preview_width, preview_height);
            let packet = pack_i420_preview_packet(
                decoded_yuv.y(),
                decoded_yuv.u(),
                decoded_yuv.v(),
                y_stride,
                u_stride,
                v_stride,
                preview_width,
                preview_height,
                factor,
            );
            let preview_pack_ms = pack_start.elapsed().as_secs_f64() * 1000.0;

            Ok(Some(PreviewFrame {
                packet,
                payload_len,
                width: preview_width as u32,
                height: preview_height as u32,
                decode_ms,
                preview_pack_ms,
            }))
        }
        Ok(None) => Ok(None),
        Err(error) => {
            log::warn!("H.264 decode error (non-fatal): {error}");
            Ok(None)
        }
    }
}

/// Pick a preview size that limits IPC cost while keeping aspect ratio and I420 alignment.
fn select_preview_dimensions(width: usize, height: usize) -> (usize, usize, usize) {
    let mut factor = ((width + MAX_PREVIEW_WIDTH - 1) / MAX_PREVIEW_WIDTH)
        .max((height + MAX_PREVIEW_HEIGHT - 1) / MAX_PREVIEW_HEIGHT)
        .max(1);
    let mut preview_width = clamp_even_dimension(width / factor);
    let mut preview_height = clamp_even_dimension(height / factor);

    while preview_width > MAX_PREVIEW_WIDTH || preview_height > MAX_PREVIEW_HEIGHT {
        factor += 1;
        preview_width = clamp_even_dimension(width / factor);
        preview_height = clamp_even_dimension(height / factor);
    }

    (
        preview_width,
        preview_height,
        factor.max(1),
    )
}

/// Compute the payload length for a tightly packed I420 frame.
fn compute_i420_payload_len(preview_width: usize, preview_height: usize) -> usize {
    let preview_chroma_width = preview_width / 2;
    let preview_chroma_height = preview_height / 2;
    preview_width * preview_height + 2 * (preview_chroma_width * preview_chroma_height)
}

/// Pack a preview I420 frame into a binary frame packet.
#[allow(clippy::too_many_arguments)]
fn pack_i420_preview_packet(
    y_plane: &[u8],
    u_plane: &[u8],
    v_plane: &[u8],
    y_stride: usize,
    u_stride: usize,
    v_stride: usize,
    preview_width: usize,
    preview_height: usize,
    factor: usize,
) -> Vec<u8> {
    debug_assert_eq!(preview_width % 2, 0);
    debug_assert_eq!(preview_height % 2, 0);

    let expected_payload_len = compute_i420_payload_len(preview_width, preview_height);
    let preview_chroma_width = preview_width / 2;
    let preview_chroma_height = preview_height / 2;
    let mut packet = Vec::with_capacity(FRAME_PACKET_HEADER_SIZE + expected_payload_len);
    packet.push(FRAME_CODEC_I420);
    packet.extend_from_slice(&(preview_width as u32).to_be_bytes());
    packet.extend_from_slice(&(preview_height as u32).to_be_bytes());

    if factor == 1 {
        append_plane_contiguous(&mut packet, y_plane, preview_width, preview_height, y_stride);
        append_plane_contiguous(
            &mut packet,
            u_plane,
            preview_chroma_width,
            preview_chroma_height,
            u_stride,
        );
        append_plane_contiguous(
            &mut packet,
            v_plane,
            preview_chroma_width,
            preview_chroma_height,
            v_stride,
        );
        debug_assert_eq!(packet.len(), FRAME_PACKET_HEADER_SIZE + expected_payload_len);
        return packet;
    }

    append_downsampled_plane_by_factor(
        &mut packet,
        y_plane,
        preview_width,
        preview_height,
        y_stride,
        factor,
    );
    append_downsampled_plane_by_factor(
        &mut packet,
        u_plane,
        preview_chroma_width,
        preview_chroma_height,
        u_stride,
        factor.max(1),
    );
    append_downsampled_plane_by_factor(
        &mut packet,
        v_plane,
        preview_chroma_width,
        preview_chroma_height,
        v_stride,
        factor.max(1),
    );

    debug_assert_eq!(packet.len(), FRAME_PACKET_HEADER_SIZE + expected_payload_len);
    packet
}

/// Clamp a dimension to a valid even I420 size.
fn clamp_even_dimension(value: usize) -> usize {
    if value <= 2 {
        return 2;
    }

    value & !1
}

/// Append a strided image plane to a tightly packed destination buffer.
fn append_plane_contiguous(
    destination: &mut Vec<u8>,
    plane: &[u8],
    width: usize,
    height: usize,
    stride: usize,
) {
    if stride == width {
        destination.extend_from_slice(&plane[..width * height]);
        return;
    }

    for row in 0..height {
        let row_start = row * stride;
        destination.extend_from_slice(&plane[row_start..row_start + width]);
    }
}

/// Append a downscaled image plane by sampling every `factor`th pixel.
fn append_downsampled_plane_by_factor(
    destination: &mut Vec<u8>,
    plane: &[u8],
    width: usize,
    height: usize,
    stride: usize,
    factor: usize,
) {
    if factor <= 1 {
        append_plane_contiguous(destination, plane, width, height, stride);
        return;
    }

    for row in 0..height {
        let row_start = row * factor * stride;
        let source_row = &plane[row_start..row_start + (width * factor)];
        for value in source_row.iter().step_by(factor).take(width) {
            destination.push(*value);
        }
    }
}

/// Copy a strided image plane into a tightly packed buffer.
fn copy_plane_contiguous(plane: &[u8], width: usize, height: usize, stride: usize) -> Vec<u8> {
    let mut packed = Vec::with_capacity(width * height);
    append_plane_contiguous(&mut packed, plane, width, height, stride);
    packed
}

/// Downscale a strided image plane by sampling every `factor`th pixel.
fn downsample_plane_by_factor(
    plane: &[u8],
    width: usize,
    height: usize,
    stride: usize,
    factor: usize,
) -> Vec<u8> {
    let mut packed = Vec::with_capacity(width * height);
    append_downsampled_plane_by_factor(&mut packed, plane, width, height, stride, factor);
    packed
}

/// Publish the newest encoded frame for polling.
fn publish_encoded_frame(latest_frame_store: &Mutex<Option<PackedFrame>>, frame: PackedFrame) {
    if let Ok(mut guard) = latest_frame_store.lock() {
        *guard = Some(frame);
    }
}

/// Take the newest encoded frame and pack it into the IPC payload format.
fn take_packed_frame(latest_frame_store: &Mutex<Option<PackedFrame>>) -> Result<Vec<u8>, String> {
    let mut guard = latest_frame_store.lock().map_err(|error| error.to_string())?;

    if let Some(frame) = guard.take() {
        Ok(frame.packet)
    } else {
        Ok(Vec::new())
    }
}

/// Emit a structured decoder lifecycle event for diagnostics and future UI hooks.
fn emit_decoder_status(
    app: &AppHandle,
    state: &str,
    detail: String,
    recoverable: bool,
    reconnect_attempt: usize,
) {
    let _ = app.emit(
        "scanner:decoder-status",
        DecoderLifecycleEvent {
            state: state.to_string(),
            detail,
            recoverable,
            reconnect_attempt,
        },
    );
}

/// Build a fresh H.264 decoder instance for a new preview stream session.
fn create_decoder() -> Result<Arc<Mutex<Decoder>>, String> {
    Ok(Arc::new(Mutex::new(
        Decoder::new().map_err(|error| format!("Failed to create H.264 decoder: {error}"))?,
    )))
}

/// Determine whether a TCP stream error is transient enough to warrant reconnecting.
fn is_recoverable_stream_error(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::UnexpectedEof
            | std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::ConnectionAborted
            | std::io::ErrorKind::BrokenPipe
            | std::io::ErrorKind::TimedOut
            | std::io::ErrorKind::NotConnected
            | std::io::ErrorKind::WouldBlock
            | std::io::ErrorKind::Interrupted
    )
}

/// Compute a bounded reconnect delay in milliseconds.
fn reconnect_delay_ms(attempt: usize) -> u64 {
    let backoff = RECONNECT_RETRY_BASE_DELAY_MS.saturating_mul(attempt.max(1) as u64);
    backoff.min(RECONNECT_RETRY_MAX_DELAY_MS)
}

/// Connect to the local forwarded preview socket, retrying briefly when the server is healthy but not yet ready.
async fn connect_decoder_stream(
    app: &AppHandle,
    address: &str,
    max_attempts: usize,
    reconnect_attempt: usize,
    detail_prefix: &str,
) -> Result<(TcpStream, Arc<Mutex<Decoder>>), String> {
    let mut attempts = 0usize;

    loop {
        if !STREAMING.load(Ordering::SeqCst) {
            return Err("Stream decoder stopped before TCP connect completed.".to_string());
        }

        match TcpStream::connect(address).await {
            Ok(stream) => {
                if reconnect_attempt > 0 || attempts > 0 {
                    emit_decoder_status(
                        app,
                        "connected",
                        format!(
                            "Decoder connected to {address} after {} reconnect attempt(s).",
                            reconnect_attempt.max(attempts)
                        ),
                        true,
                        reconnect_attempt.max(attempts),
                    );
                }
                return Ok((stream, create_decoder()?));
            }
            Err(error) => {
                attempts += 1;
                if attempts >= max_attempts {
                    return Err(format!(
                        "{detail_prefix} Failed to connect to stream at {address} after {attempts} attempts: {error}"
                    ));
                }

                let delay_ms = reconnect_delay_ms(attempts);
                let detail = format!(
                    "{detail_prefix} Connect attempt {attempts}/{max_attempts} failed: {error}. Retrying in {delay_ms}ms."
                );
                log::warn!("{detail}");
                emit_decoder_status(
                    app,
                    "reconnecting",
                    detail,
                    true,
                    reconnect_attempt.max(attempts),
                );
                std::thread::sleep(Duration::from_millis(delay_ms));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::hint::black_box;

    const BENCHMARK_MIN_FPS: f64 = 30.0;
    const BENCHMARK_WARMUP_ITERATIONS: usize = 32;

    #[derive(Clone, Copy, Debug)]
    struct BenchmarkStats {
        iterations: usize,
        total_ms: f64,
        avg_ms: f64,
        fps: f64,
    }

    fn build_bench_planes(width: usize, height: usize) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        let mut y_plane = Vec::with_capacity(width * height);
        for row in 0..height {
            for column in 0..width {
                y_plane.push(((row * 17 + column * 29) & 0xff) as u8);
            }
        }

        let chroma_width = width / 2;
        let chroma_height = height / 2;
        let mut u_plane = Vec::with_capacity(chroma_width * chroma_height);
        let mut v_plane = Vec::with_capacity(chroma_width * chroma_height);

        for row in 0..chroma_height {
            for column in 0..chroma_width {
                u_plane.push(((128 + row * 7 + column * 11) & 0xff) as u8);
                v_plane.push(((64 + row * 13 + column * 5) & 0xff) as u8);
            }
        }

        (y_plane, u_plane, v_plane)
    }

    fn run_benchmark<F>(label: &str, iterations: usize, mut action: F) -> BenchmarkStats
    where
        F: FnMut(),
    {
        for _ in 0..BENCHMARK_WARMUP_ITERATIONS {
            black_box(action());
        }

        let start = Instant::now();
        for _ in 0..iterations {
            black_box(action());
        }

        let total_ms = start.elapsed().as_secs_f64() * 1000.0;
        let avg_ms = total_ms / iterations as f64;
        let fps = 1000.0 / avg_ms;

        println!(
            "[bench:rust] {label} | iterations={iterations} total={total_ms:.2}ms avg={avg_ms:.4}ms fps={fps:.1}"
        );

        assert!(
            fps >= BENCHMARK_MIN_FPS,
            "{label} dropped below {:.1} FPS: measured {fps:.1} FPS",
            BENCHMARK_MIN_FPS
        );
        assert!(
            avg_ms < 33.0,
            "{label} exceeded the 33ms/frame budget: measured {avg_ms:.4}ms"
        );

        BenchmarkStats {
            iterations,
            total_ms,
            avg_ms,
            fps,
        }
    }

    #[test]
    fn copy_plane_contiguous_trims_stride_padding() {
        let plane = vec![1, 2, 3, 99, 4, 5, 6, 99];

        let packed = copy_plane_contiguous(&plane, 3, 2, 4);

        assert_eq!(packed, vec![1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn downsample_plane_by_factor_samples_every_other_pixel() {
        let plane = vec![
            1, 2, 3, 4,
            5, 6, 7, 8,
            9, 10, 11, 12,
            13, 14, 15, 16,
        ];

        let packed = downsample_plane_by_factor(&plane, 2, 2, 4, 2);

        assert_eq!(packed, vec![1, 3, 9, 11]);
    }

    #[test]
    fn select_preview_dimensions_downscales_large_frames() {
        let (width, height, factor) = select_preview_dimensions(1280, 720);
        assert_eq!((width, height, factor), (640, 360, 2));
    }

    #[test]
    fn select_preview_dimensions_preserves_even_i420_alignment() {
        let (width, height, factor) = select_preview_dimensions(639, 359);
        assert_eq!((width, height, factor), (638, 358, 1));
        assert_eq!(width % 2, 0);
        assert_eq!(height % 2, 0);
    }

    #[test]
    fn select_preview_dimensions_uses_non_power_of_two_scaling_when_needed() {
        let (width, height, factor) = select_preview_dimensions(1920, 1080);
        assert_eq!((width, height, factor), (640, 360, 3));
    }

    #[test]
    fn pack_i420_preview_preserves_plane_order_without_downscale() {
        let packet = pack_i420_preview_packet(
            &[1, 2, 3, 4],
            &[5],
            &[6],
            2,
            1,
            1,
            2,
            2,
            1,
        );

        assert_eq!(packet[0], FRAME_CODEC_I420);
        assert_eq!(&packet[1..5], &2u32.to_be_bytes());
        assert_eq!(&packet[5..9], &2u32.to_be_bytes());
        assert_eq!(&packet[9..], &[1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn pack_i420_preview_downscales_each_plane_consistently() {
        let y_plane = vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
        let u_plane = vec![21, 22, 23, 24];
        let v_plane = vec![31, 32, 33, 34];

        let packet = pack_i420_preview_packet(
            &y_plane,
            &u_plane,
            &v_plane,
            4,
            2,
            2,
            2,
            2,
            2,
        );

        assert_eq!(&packet[9..], &[1, 3, 9, 11, 21, 31]);
    }

    #[test]
    fn pack_i420_preview_downscales_chroma_with_the_same_ratio_as_luma() {
        let y_plane = (1u8..=32).collect::<Vec<u8>>();
        let u_plane = vec![101, 102, 103, 104, 105, 106, 107, 108];
        let v_plane = vec![201, 202, 203, 204, 205, 206, 207, 208];

        let packet = pack_i420_preview_packet(
            &y_plane,
            &u_plane,
            &v_plane,
            8,
            4,
            4,
            4,
            2,
            2,
        );

        assert_eq!(
            &packet[9..],
            &[1, 3, 5, 7, 17, 19, 21, 23, 101, 103, 201, 203],
        );
    }

    #[test]
    fn compute_i420_payload_len_matches_640x360_preview() {
        assert_eq!(compute_i420_payload_len(640, 360), 345_600);
    }

    #[test]
    fn publish_encoded_frame_overwrites_the_previous_frame() {
        let latest_frame_store = Mutex::new(Some(PackedFrame {
            packet: vec![1, 1, 1],
        }));

        publish_encoded_frame(
            &latest_frame_store,
            PackedFrame {
                packet: vec![9, 8, 7],
            },
        );

        let latest = latest_frame_store.lock().unwrap().clone().unwrap();
        assert_eq!(latest.packet, vec![9, 8, 7]);
    }

    #[test]
    fn take_packed_frame_clears_latest_value_after_read() {
        let latest_frame_store = Mutex::new(Some(PackedFrame {
            packet: vec![FRAME_CODEC_I420, 0, 0, 0, 1, 0, 0, 0, 3, 9, 8, 7],
        }));

        let first = take_packed_frame(&latest_frame_store).unwrap();
        let second = take_packed_frame(&latest_frame_store).unwrap();

        assert_eq!(first.len(), FRAME_PACKET_HEADER_SIZE + 3);
        assert!(second.is_empty());
    }

    #[test]
    fn recoverable_stream_error_includes_connection_reset() {
        let error = std::io::Error::new(std::io::ErrorKind::ConnectionReset, "reset");
        assert!(is_recoverable_stream_error(&error));
    }

    #[test]
    fn reconnect_delay_is_bounded() {
        assert_eq!(reconnect_delay_ms(1), RECONNECT_RETRY_BASE_DELAY_MS);
        assert_eq!(reconnect_delay_ms(100), RECONNECT_RETRY_MAX_DELAY_MS);
    }

    #[test]
    #[ignore = "benchmark"]
    fn benchmark_pack_i420_preview_1280x720_to_640x360() {
        let (y_plane, u_plane, v_plane) = build_bench_planes(1280, 720);

        let stats = run_benchmark("pack_i420_preview 1280x720 -> 640x360", 400, || {
            let packet = pack_i420_preview_packet(
                &y_plane, &u_plane, &v_plane, 1280, 640, 640, 640, 360, 2,
            );
            assert_eq!(packet.len(), FRAME_PACKET_HEADER_SIZE + (640 * 360 * 3) / 2);
            black_box(packet);
        });

        assert!(stats.iterations >= 400);
        assert!(stats.total_ms > 0.0);
        assert!(stats.avg_ms > 0.0);
        assert!(stats.fps >= BENCHMARK_MIN_FPS);
    }

    #[test]
    #[ignore = "benchmark"]
    fn benchmark_pack_i420_preview_1920x1080_to_640x360() {
        let (y_plane, u_plane, v_plane) = build_bench_planes(1920, 1080);

        let stats = run_benchmark("pack_i420_preview 1920x1080 -> 640x360", 320, || {
            let packet = pack_i420_preview_packet(
                &y_plane,
                &u_plane,
                &v_plane,
                1920,
                960,
                960,
                640,
                360,
                3,
            );
            assert_eq!(packet.len(), FRAME_PACKET_HEADER_SIZE + (640 * 360 * 3) / 2);
            black_box(packet);
        });

        assert!(stats.iterations >= 320);
        assert!(stats.total_ms > 0.0);
        assert!(stats.avg_ms > 0.0);
        assert!(stats.fps >= BENCHMARK_MIN_FPS);
    }

    #[test]
    #[ignore = "benchmark"]
    fn benchmark_pack_frame_packet_i420_640x360() {
        let (y_plane, u_plane, v_plane) = build_bench_planes(1280, 720);
        let packet = pack_i420_preview_packet(
            &y_plane, &u_plane, &v_plane, 1280, 640, 640, 640, 360, 2,
        );

        let stats = run_benchmark("pack_frame_packet I420 640x360", 2_000, || {
            let packet_clone = packet.clone();
            assert_eq!(packet_clone.len(), FRAME_PACKET_HEADER_SIZE + (640 * 360 * 3) / 2);
            black_box(packet_clone);
        });

        assert!(stats.iterations >= 2_000);
        assert!(stats.total_ms > 0.0);
        assert!(stats.avg_ms > 0.0);
        assert!(stats.fps >= BENCHMARK_MIN_FPS);
    }
}
