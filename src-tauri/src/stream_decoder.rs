/// Native H.264 stream decoder for the ADB camera scanner.
///
/// Connects to a forwarded TCP port, reads length-prefixed H.264 NAL units
/// from the Android Camera Server, decodes them with `openh264`, extracts a
/// downscaled I420 preview frame, and pushes the newest frame packet to the
/// frontend over a Tauri IPC channel.
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use openh264::decoder::Decoder;
use openh264::formats::YUVSource;
use serde::Serialize;
use tauri::{
    command,
    ipc::{Channel, InvokeResponseBody},
};
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio::task::spawn_blocking;
use tokio::time::sleep;

/// Shared flag to signal the decode loop to stop.
static STREAMING: AtomicBool = AtomicBool::new(false);

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
/// Optional benchmark telemetry layout: unix epoch ms + frame sequence.
const FRAME_PACKET_TELEMETRY_SIZE: usize = 12;

/// Downscaled I420 preview frame payload with telemetry for end-to-end IPC measurement.
const FRAME_CODEC_I420_TELEMETRY: u8 = 4;

/// Keep live preview under roughly 640x360 to reduce IPC overhead and frontend decode cost.
const MAX_PREVIEW_WIDTH: usize = 640;
const MAX_PREVIEW_HEIGHT: usize = 360;

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
pub struct DecoderLifecycleEvent {
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

/// Start receiving and decoding the H.264 video stream from the forwarded port.
#[command]
pub async fn tauri_scanner_start_stream(
    port: u16,
    frame_channel: Channel<InvokeResponseBody>,
    status_channel: Channel<DecoderLifecycleEvent>,
) -> Result<(), String> {
    if STREAMING.swap(true, Ordering::SeqCst) {
        return Err("Stream decoder is already running.".to_string());
    }

    FRAME_SEQ.store(0, Ordering::Relaxed);
    send_decoder_status(
        &status_channel,
        "starting",
        format!("Starting decoder for tcp://127.0.0.1:{port}."),
        true,
        0,
    );

    tauri::async_runtime::spawn(async move {
        let result = decode_stream_loop(port, frame_channel, status_channel.clone()).await;

        match &result {
            Ok(DecodeLoopExit::ManualStop) => {
                send_decoder_status(
                    &status_channel,
                    "stopped",
                    "Stream decoder stopped by request.".to_string(),
                    false,
                    0,
                );
            }
            Ok(DecodeLoopExit::RemoteClosed { detail }) => {
                send_decoder_status(&status_channel, "stopped", detail.clone(), false, 0);
            }
            Err(error) => {
                log::error!("Stream decoder error: {error}");
                send_decoder_status(&status_channel, "error", error.clone(), false, 0);
            }
        }

        STREAMING.store(false, Ordering::SeqCst);
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
async fn decode_stream_loop(
    port: u16,
    frame_channel: Channel<InvokeResponseBody>,
    status_channel: Channel<DecoderLifecycleEvent>,
) -> Result<DecodeLoopExit, String> {
    let address = format!("127.0.0.1:{port}");
    let mut reconnect_attempt = 0usize;
    let mut has_received_frame = false;
    let (mut stream, mut decoder) = connect_decoder_stream(
        &address,
        STARTUP_CONNECT_MAX_ATTEMPTS,
        reconnect_attempt,
        "Waiting for preview stream to become available.",
        &status_channel,
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
                    return if has_received_frame {
                        Err(format!(
                            "Preview stream closed unexpectedly after {STREAM_RECONNECT_MAX_ATTEMPTS} reconnect attempts: {error}"
                        ))
                    } else {
                        Err(format!(
                            "Preview stream closed before the first frame after {STREAM_RECONNECT_MAX_ATTEMPTS} reconnect attempts: {error}"
                        ))
                    };
                }

                let detail = if has_received_frame {
                    format!(
                        "Preview socket read interrupted ({error}). Reconnecting decoder transport."
                    )
                } else {
                    format!(
                        "Preview stream closed before the first frame ({error}). Waiting for the scanner socket to become ready."
                    )
                };
                log::warn!("{detail}");
                send_decoder_status(
                    &status_channel,
                    "reconnecting",
                    detail,
                    true,
                    reconnect_attempt,
                );
                sleep(Duration::from_millis(reconnect_delay_ms(reconnect_attempt))).await;
                let (next_stream, next_decoder) = connect_decoder_stream(
                    &address,
                    STREAM_RECONNECT_MAX_ATTEMPTS,
                    reconnect_attempt,
                    "Reconnecting preview stream after socket interruption.",
                    &status_channel,
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
                    return if has_received_frame {
                        Err(format!(
                            "Preview payload read kept failing after {STREAM_RECONNECT_MAX_ATTEMPTS} reconnect attempts: {error}"
                        ))
                    } else {
                        Err(format!(
                            "Preview stream payload closed before the first frame after {STREAM_RECONNECT_MAX_ATTEMPTS} reconnect attempts: {error}"
                        ))
                    };
                }

                let detail = if has_received_frame {
                    format!(
                        "Preview payload read interrupted ({error}). Reconnecting decoder transport."
                    )
                } else {
                    format!(
                        "Preview stream payload closed before the first frame ({error}). Waiting for the scanner socket to become ready."
                    )
                };
                log::warn!("{detail}");
                send_decoder_status(
                    &status_channel,
                    "reconnecting",
                    detail,
                    true,
                    reconnect_attempt,
                );
                sleep(Duration::from_millis(reconnect_delay_ms(reconnect_attempt))).await;
                let (next_stream, next_decoder) = connect_decoder_stream(
                    &address,
                    STREAM_RECONNECT_MAX_ATTEMPTS,
                    reconnect_attempt,
                    "Reconnecting preview stream after payload interruption.",
                    &status_channel,
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
                let first_frame_ready = !has_received_frame;
                has_received_frame = true;
                reconnect_attempt = 0;
                let seq = FRAME_SEQ.fetch_add(1, Ordering::Relaxed);
                let payload_kb = frame.payload_len as f64 / 1024.0;
                let nal_kb = nal_length as f64 / 1024.0;
                let mut preview_packet = frame.packet;
                let sent_at_epoch_ms = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|error| format!("System clock drifted before unix epoch: {error}"))?
                    .as_millis() as u64;
                write_frame_telemetry(&mut preview_packet, sent_at_epoch_ms, seq as u32)?;

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

                frame_channel
                    .send(InvokeResponseBody::Raw(preview_packet))
                    .map_err(|error| {
                        format!("Failed to deliver the preview frame to the frontend: {error}")
                    })?;

                if first_frame_ready {
                    send_decoder_status(
                        &status_channel,
                        "ready",
                        format!(
                            "Decoder published the first preview frame from tcp://{address}."
                        ),
                        false,
                        0,
                    );
                }
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
    let mut packet = Vec::with_capacity(
        FRAME_PACKET_HEADER_SIZE + FRAME_PACKET_TELEMETRY_SIZE + expected_payload_len,
    );
    packet.push(FRAME_CODEC_I420_TELEMETRY);
    packet.extend_from_slice(&(preview_width as u32).to_be_bytes());
    packet.extend_from_slice(&(preview_height as u32).to_be_bytes());
    packet.resize(FRAME_PACKET_HEADER_SIZE + FRAME_PACKET_TELEMETRY_SIZE, 0);

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
        debug_assert_eq!(
            packet.len(),
            FRAME_PACKET_HEADER_SIZE + FRAME_PACKET_TELEMETRY_SIZE + expected_payload_len
        );
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

    debug_assert_eq!(
        packet.len(),
        FRAME_PACKET_HEADER_SIZE + FRAME_PACKET_TELEMETRY_SIZE + expected_payload_len
    );
    packet
}

fn write_frame_telemetry(
    packet: &mut [u8],
    sent_at_epoch_ms: u64,
    sequence: u32,
) -> Result<(), String> {
    let telemetry_end = FRAME_PACKET_HEADER_SIZE + FRAME_PACKET_TELEMETRY_SIZE;
    if packet.len() < telemetry_end {
        return Err(format!(
            "Preview frame packet is too short to store telemetry: {} bytes.",
            packet.len()
        ));
    }

    packet[FRAME_PACKET_HEADER_SIZE..FRAME_PACKET_HEADER_SIZE + 8]
        .copy_from_slice(&sent_at_epoch_ms.to_be_bytes());
    packet[FRAME_PACKET_HEADER_SIZE + 8..telemetry_end]
        .copy_from_slice(&sequence.to_be_bytes());
    Ok(())
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
#[cfg(test)]
fn copy_plane_contiguous(plane: &[u8], width: usize, height: usize, stride: usize) -> Vec<u8> {
    let mut packed = Vec::with_capacity(width * height);
    append_plane_contiguous(&mut packed, plane, width, height, stride);
    packed
}

/// Downscale a strided image plane by sampling every `factor`th pixel.
#[cfg(test)]
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

/// Emit a structured decoder lifecycle event over the scanner status channel.
fn send_decoder_status(
    channel: &Channel<DecoderLifecycleEvent>,
    state: &str,
    detail: String,
    recoverable: bool,
    reconnect_attempt: usize,
) {
    let _ = channel.send(DecoderLifecycleEvent {
        state: state.to_string(),
        detail,
        recoverable,
        reconnect_attempt,
    });
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
    address: &str,
    max_attempts: usize,
    reconnect_attempt: usize,
    detail_prefix: &str,
    status_channel: &Channel<DecoderLifecycleEvent>,
) -> Result<(TcpStream, Arc<Mutex<Decoder>>), String> {
    let mut attempts = 0usize;

    loop {
        if !STREAMING.load(Ordering::SeqCst) {
            return Err("Stream decoder stopped before TCP connect completed.".to_string());
        }

        match TcpStream::connect(address).await {
            Ok(stream) => {
                if reconnect_attempt > 0 || attempts > 0 {
                    send_decoder_status(
                        status_channel,
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
                send_decoder_status(
                    status_channel,
                    "reconnecting",
                    detail,
                    true,
                    reconnect_attempt.max(attempts),
                );
                sleep(Duration::from_millis(delay_ms)).await;
            }
        }
    }
}

