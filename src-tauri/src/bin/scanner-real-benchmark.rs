use std::env;
use std::io::{ErrorKind, Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use openh264::decoder::Decoder;
use openh264::formats::YUVSource;

const OVERALL_LOG_INTERVAL_SECS: u64 = 5;
const SAMPLE_LOG_INTERVAL_FRAMES: u64 = 15;
const FRAME_CODEC_I420_TELEMETRY: u8 = 4;
const FRAME_PACKET_TELEMETRY_SIZE: usize = 12;
const DEFAULT_DURATION_SECS: u64 = 20;
const DEFAULT_CONNECT_TIMEOUT_SECS: u64 = 8;
const DEFAULT_STALL_TIMEOUT_MS: u64 = 5_000;
const DEFAULT_STARTUP_TIMEOUT_MS: u64 = 10_000;
const READ_POLL_TIMEOUT_MS: u64 = 250;
const MAX_PREVIEW_WIDTH: usize = 640;
const MAX_PREVIEW_HEIGHT: usize = 360;

struct Args {
    port: u16,
    duration_secs: u64,
    connect_timeout_secs: u64,
    stall_timeout_ms: u64,
    startup_timeout_ms: u64,
    frontend_address: Option<String>,
}

struct PreviewFrame {
    payload: Vec<u8>,
    width: u32,
    height: u32,
    decode_ms: f64,
    preview_pack_ms: f64,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = parse_args(env::args().skip(1))?;
    let mut stream = connect_with_retry(args.port, args.connect_timeout_secs)?;
    stream
        .set_nodelay(true)
        .map_err(|error| format!("Failed to enable TCP_NODELAY on backend stream: {error}"))?;

    let mut frontend_stream = match args.frontend_address.as_deref() {
        Some(address) => Some(connect_frontend(address, args.connect_timeout_secs)?),
        None => None,
    };

    let mut decoder =
        Decoder::new().map_err(|error| format!("Failed to create H.264 decoder: {error}"))?;
    let loop_start = Instant::now();
    let mut last_overall_log_sec = 0;
    let mut frame_seq = 0u64;
    let mut nal_packet_count = 0u64;
    let mut has_seen_first_nal = false;
    let mut length_buf = [0u8; 4];
    let mut first_packet_summary: Option<String> = None;
    let mut last_packet_summary: Option<String> = None;

    loop {
        if loop_start.elapsed().as_secs() >= args.duration_secs {
            break;
        }

        let iter_start = Instant::now();
        let active_timeout_ms = active_timeout_ms(&args, has_seen_first_nal);
        match read_exact_with_timeout(&mut stream, &mut length_buf, active_timeout_ms) {
            Ok(StreamReadStatus::Complete) => {}
            Ok(StreamReadStatus::TimedOut) => {
                return Err(if has_seen_first_nal {
                    format!(
                        "Stream stalled for {}ms while waiting for the next NAL unit.",
                        args.stall_timeout_ms
                    )
                } else {
                    format!(
                        "Stream did not produce the first NAL unit within {}ms.",
                        args.startup_timeout_ms
                    )
                });
            }
            Ok(StreamReadStatus::Eof) => {
                if frame_seq == 0 {
                    return Err(format!(
                        "Preview stream ended before a decodable frame was produced. NAL packets read: {nal_packet_count}. First packet: {}. Last packet: {}.",
                        first_packet_summary.as_deref().unwrap_or("none"),
                        last_packet_summary.as_deref().unwrap_or("none"),
                    ));
                }
                break;
            }
            Err(error) => return Err(format!("Failed to read NAL length: {error}")),
        }

        let nal_length = u32::from_be_bytes(length_buf) as usize;
        if nal_length == 0 || nal_length > 10 * 1024 * 1024 {
            continue;
        }

        let mut nal_data = vec![0u8; nal_length];
        match read_exact_with_timeout(&mut stream, &mut nal_data, active_timeout_ms) {
            Ok(StreamReadStatus::Complete) => {}
            Ok(StreamReadStatus::TimedOut) => {
                return Err(if has_seen_first_nal {
                    format!(
                        "Timed out after {}ms while reading a {nal_length}-byte NAL payload.",
                        args.stall_timeout_ms
                    )
                } else {
                    format!(
                        "Timed out after {}ms while reading the first {nal_length}-byte NAL payload.",
                        args.startup_timeout_ms
                    )
                });
            }
            Ok(StreamReadStatus::Eof) => {
                if frame_seq == 0 {
                    return Err(format!(
                        "Preview stream payload ended before a decodable frame was produced. NAL packets read: {nal_packet_count}. First packet: {}. Last packet: {}.",
                        first_packet_summary.as_deref().unwrap_or("none"),
                        last_packet_summary.as_deref().unwrap_or("none"),
                    ));
                }
                break;
            }
            Err(error) => {
                return Err(format!(
                    "Failed to read NAL data ({nal_length} bytes): {error}"
                ))
            }
        }

        let tcp_read_ms = iter_start.elapsed().as_secs_f64() * 1000.0;
        has_seen_first_nal = true;
        nal_packet_count += 1;
        let packet_summary = summarize_nal_packet(&nal_data);
        if first_packet_summary.is_none() {
            first_packet_summary = Some(packet_summary.clone());
        }
        last_packet_summary = Some(packet_summary.clone());

        match decode_nal_to_preview(&mut decoder, nal_data)? {
            Some(frame) => {
                if let Some(frontend) = frontend_stream.as_mut() {
                    let sent_at_epoch_ms = current_epoch_ms()?;
                    let packet = pack_frame_packet(
                        FRAME_CODEC_I420_TELEMETRY,
                        frame.width,
                        frame.height,
                        Some((sent_at_epoch_ms, frame_seq as u32)),
                        &frame.payload,
                    )?;
                    send_frontend_packet(frontend, &packet)?;
                }

                let nal_kb = nal_length as f64 / 1024.0;
                let payload_kb = frame.payload.len() as f64 / 1024.0;
                if frame_seq % SAMPLE_LOG_INTERVAL_FRAMES == 0 {
                    println!(
                        "[perf] frame#{frame_seq} {}x{} | tcp_read={:.1}ms  h264_decode={:.1}ms  preview_pack={:.1}ms | NAL={:.1}KB  I420={:.1}KB",
                        frame.width,
                        frame.height,
                        tcp_read_ms,
                        frame.decode_ms,
                        frame.preview_pack_ms,
                        nal_kb,
                        payload_kb
                    );
                }

                frame_seq += 1;
            }
            None => {
                if nal_packet_count <= 5 {
                    println!(
                        "[perf] undecoded_nal#{nal_packet_count} len={nal_length}B | {packet_summary}"
                    );
                }
            }
        }

        let elapsed = loop_start.elapsed().as_secs();
        if elapsed > 0 && elapsed >= last_overall_log_sec + OVERALL_LOG_INTERVAL_SECS {
            last_overall_log_sec = elapsed;
            let fps = frame_seq as f64 / loop_start.elapsed().as_secs_f64();
            println!("[perf] overall: {frame_seq} frames in {elapsed}s = {fps:.1} fps");
        }
    }

    let elapsed_secs = loop_start.elapsed().as_secs_f64();
    let elapsed_display = elapsed_secs.max(1.0).round() as u64;

    if frame_seq == 0 {
        return Err(format!(
            "Preview stream ran for {elapsed_display}s and read {nal_packet_count} NAL packets, but decoder produced 0 preview frames. First packet: {}. Last packet: {}.",
            first_packet_summary.as_deref().unwrap_or("none"),
            last_packet_summary.as_deref().unwrap_or("none"),
        ));
    }

    let fps = frame_seq as f64 / elapsed_secs.max(0.001);
    println!(
        "[perf] overall: {frame_seq} frames in {elapsed_display}s = {fps:.1} fps | nal_packets={nal_packet_count}"
    );

    Ok(())
}

fn parse_args<I>(args: I) -> Result<Args, String>
where
    I: IntoIterator<Item = String>,
{
    let mut port = None;
    let mut duration_secs = DEFAULT_DURATION_SECS;
    let mut connect_timeout_secs = DEFAULT_CONNECT_TIMEOUT_SECS;
    let mut stall_timeout_ms = DEFAULT_STALL_TIMEOUT_MS;
    let mut startup_timeout_ms = DEFAULT_STARTUP_TIMEOUT_MS;
    let mut frontend_address = None;

    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--port" => {
                let value = iter.next().ok_or_else(|| "Missing value for --port.".to_string())?;
                port = Some(
                    value
                        .parse::<u16>()
                        .map_err(|error| format!("Invalid --port value {value:?}: {error}"))?,
                );
            }
            "--duration-secs" => {
                let value = iter
                    .next()
                    .ok_or_else(|| "Missing value for --duration-secs.".to_string())?;
                duration_secs = value.parse::<u64>().map_err(|error| {
                    format!("Invalid --duration-secs value {value:?}: {error}")
                })?;
            }
            "--connect-timeout-secs" => {
                let value = iter.next().ok_or_else(|| {
                    "Missing value for --connect-timeout-secs.".to_string()
                })?;
                connect_timeout_secs = value.parse::<u64>().map_err(|error| {
                    format!("Invalid --connect-timeout-secs value {value:?}: {error}")
                })?;
            }
            "--stall-timeout-ms" => {
                let value = iter
                    .next()
                    .ok_or_else(|| "Missing value for --stall-timeout-ms.".to_string())?;
                stall_timeout_ms = value.parse::<u64>().map_err(|error| {
                    format!("Invalid --stall-timeout-ms value {value:?}: {error}")
                })?;
            }
            "--startup-timeout-ms" => {
                let value = iter
                    .next()
                    .ok_or_else(|| "Missing value for --startup-timeout-ms.".to_string())?;
                startup_timeout_ms = value.parse::<u64>().map_err(|error| {
                    format!("Invalid --startup-timeout-ms value {value:?}: {error}")
                })?;
            }
            "--frontend-address" => {
                let value = iter.next().ok_or_else(|| {
                    "Missing value for --frontend-address.".to_string()
                })?;
                frontend_address = Some(value);
            }
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            other => {
                return Err(format!("Unknown argument: {other}"));
            }
        }
    }

    let port = port.ok_or_else(|| "Missing required --port argument.".to_string())?;
    if duration_secs == 0 {
        return Err("--duration-secs must be greater than 0.".to_string());
    }
    if connect_timeout_secs == 0 {
        return Err("--connect-timeout-secs must be greater than 0.".to_string());
    }
    if stall_timeout_ms < 500 {
        return Err("--stall-timeout-ms must be at least 500.".to_string());
    }
    if startup_timeout_ms < stall_timeout_ms {
        return Err("--startup-timeout-ms must be greater than or equal to --stall-timeout-ms.".to_string());
    }

    Ok(Args {
        port,
        duration_secs,
        connect_timeout_secs,
        stall_timeout_ms,
        startup_timeout_ms,
        frontend_address,
    })
}

fn print_help() {
    println!(
        "scanner-real-benchmark --port <tcp-port> [--duration-secs <seconds>] [--frontend-address <host:port>] [--connect-timeout-secs <seconds>] [--stall-timeout-ms <ms>] [--startup-timeout-ms <ms>]"
    );
}

fn active_timeout_ms(args: &Args, has_seen_first_nal: bool) -> u64 {
    if has_seen_first_nal {
        args.stall_timeout_ms
    } else {
        args.startup_timeout_ms
    }
}

enum StreamReadStatus {
    Complete,
    TimedOut,
    Eof,
}

fn read_exact_with_timeout(
    stream: &mut TcpStream,
    buffer: &mut [u8],
    timeout_ms: u64,
) -> Result<StreamReadStatus, String> {
    let poll_timeout_ms = timeout_ms.min(READ_POLL_TIMEOUT_MS).max(1);
    stream
        .set_read_timeout(Some(Duration::from_millis(poll_timeout_ms)))
        .map_err(|error| format!("Failed to configure backend stream timeout: {error}"))?;

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut offset = 0usize;

    while offset < buffer.len() {
        match stream.read(&mut buffer[offset..]) {
            Ok(0) => {
                return if offset == 0 {
                    Ok(StreamReadStatus::Eof)
                } else {
                    Err(format!(
                        "Stream closed after reading {offset}/{} bytes.",
                        buffer.len()
                    ))
                };
            }
            Ok(bytes_read) => {
                offset += bytes_read;
            }
            Err(error) if matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) => {
                if Instant::now() >= deadline {
                    return Ok(StreamReadStatus::TimedOut);
                }
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Ok(StreamReadStatus::Complete)
}

fn connect_with_retry(port: u16, timeout_secs: u64) -> Result<TcpStream, String> {
    let address = format!("127.0.0.1:{port}");
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    let mut last_error = None;

    while Instant::now() < deadline {
        match TcpStream::connect(&address) {
            Ok(stream) => return Ok(stream),
            Err(error) => {
                last_error = Some(error.to_string());
                std::thread::sleep(Duration::from_millis(150));
            }
        }
    }

    Err(format!(
        "Failed to connect to backend stream at {address}: {}",
        last_error.unwrap_or_else(|| "timed out".to_string())
    ))
}

fn connect_frontend(address: &str, timeout_secs: u64) -> Result<TcpStream, String> {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    let mut last_error = None;

    while Instant::now() < deadline {
        match TcpStream::connect(address) {
            Ok(stream) => {
                stream.set_nodelay(true).map_err(|error| {
                    format!("Failed to enable TCP_NODELAY on frontend stream: {error}")
                })?;
                return Ok(stream);
            }
            Err(error) => {
                last_error = Some(error.to_string());
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }

    Err(format!(
        "Failed to connect to frontend benchmark listener at {address}: {}",
        last_error.unwrap_or_else(|| "timed out".to_string())
    ))
}

fn send_frontend_packet(stream: &mut TcpStream, packet: &[u8]) -> Result<(), String> {
    let packet_len = u32::try_from(packet.len())
        .map_err(|_| format!("Frontend packet too large: {} bytes", packet.len()))?;
    stream
        .write_all(&packet_len.to_be_bytes())
        .map_err(|error| format!("Failed to write frontend packet header: {error}"))?;
    stream
        .write_all(packet)
        .map_err(|error| format!("Failed to write frontend packet payload: {error}"))?;
    Ok(())
}

fn current_epoch_ms() -> Result<u64, String> {
    Ok(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("System clock drifted before unix epoch: {error}"))?
            .as_millis() as u64,
    )
}

fn summarize_nal_packet(nal_data: &[u8]) -> String {
    let head_hex = nal_data
        .iter()
        .take(8)
        .map(|value| format!("{value:02x}"))
        .collect::<Vec<_>>()
        .join(" ");
    let nal_types = collect_h264_nal_types(nal_data);

    format!(
        "head=[{head_hex}] annexb={} nal_types={}",
        contains_start_code(nal_data),
        if nal_types.is_empty() {
            "?".to_string()
        } else {
            nal_types
                .iter()
                .map(|nal_type| nal_type.to_string())
                .collect::<Vec<_>>()
                .join(",")
        }
    )
}

fn collect_h264_nal_types(nal_data: &[u8]) -> Vec<u8> {
    let mut nal_types = Vec::new();

    if contains_start_code(nal_data) {
        let mut offset = 0usize;
        while offset + 3 < nal_data.len() {
            let Some(start) = find_start_code(nal_data, offset) else {
                break;
            };
            let prefix_len = if nal_data[start..].starts_with(&[0, 0, 0, 1]) {
                4
            } else {
                3
            };
            let nal_header_offset = start + prefix_len;
            if nal_header_offset < nal_data.len() {
                nal_types.push(nal_data[nal_header_offset] & 0x1f);
            }
            offset = nal_header_offset.saturating_add(1);
        }
    } else if let Some(first_byte) = nal_data.first() {
        nal_types.push(first_byte & 0x1f);
    }

    nal_types
}

fn contains_start_code(nal_data: &[u8]) -> bool {
    find_start_code(nal_data, 0).is_some()
}

fn find_start_code(nal_data: &[u8], offset: usize) -> Option<usize> {
    if nal_data.len() < 3 || offset >= nal_data.len().saturating_sub(2) {
        return None;
    }

    for index in offset..nal_data.len().saturating_sub(2) {
        if nal_data[index..].starts_with(&[0, 0, 1]) || nal_data[index..].starts_with(&[0, 0, 0, 1]) {
            return Some(index);
        }
    }

    None
}

fn decode_nal_to_preview(
    decoder: &mut Decoder,
    nal_data: Vec<u8>,
) -> Result<Option<PreviewFrame>, String> {
    let data = if nal_data.starts_with(&[0, 0, 0, 1]) || nal_data.starts_with(&[0, 0, 1]) {
        nal_data
    } else {
        let mut prefixed = vec![0, 0, 0, 1];
        prefixed.extend_from_slice(&nal_data);
        prefixed
    };

    let decode_start = Instant::now();
    match decoder.decode(&data) {
        Ok(Some(decoded_yuv)) => {
            let decode_ms = decode_start.elapsed().as_secs_f64() * 1000.0;
            let (source_width, source_height) = decoded_yuv.dimensions();
            let (y_stride, u_stride, v_stride) = decoded_yuv.strides();
            let (preview_width, preview_height, factor) =
                select_preview_dimensions(source_width, source_height);

            let pack_start = Instant::now();
            let payload = pack_i420_preview(
                decoded_yuv.y(),
                decoded_yuv.u(),
                decoded_yuv.v(),
                source_width,
                source_height,
                y_stride,
                u_stride,
                v_stride,
                preview_width,
                preview_height,
                factor,
            );
            let preview_pack_ms = pack_start.elapsed().as_secs_f64() * 1000.0;

            Ok(Some(PreviewFrame {
                payload,
                width: preview_width as u32,
                height: preview_height as u32,
                decode_ms,
                preview_pack_ms,
            }))
        }
        Ok(None) => Ok(None),
        Err(error) => Err(format!("H.264 decode failed: {error}")),
    }
}

fn select_preview_dimensions(width: usize, height: usize) -> (usize, usize, usize) {
    let mut factor = width
        .div_ceil(MAX_PREVIEW_WIDTH)
        .max(height.div_ceil(MAX_PREVIEW_HEIGHT))
        .max(1);
    let mut preview_width = clamp_even_dimension(width / factor);
    let mut preview_height = clamp_even_dimension(height / factor);

    while preview_width > MAX_PREVIEW_WIDTH || preview_height > MAX_PREVIEW_HEIGHT {
        factor += 1;
        preview_width = clamp_even_dimension(width / factor);
        preview_height = clamp_even_dimension(height / factor);
    }

    (preview_width, preview_height, factor.max(1))
}

#[allow(clippy::too_many_arguments)]
fn pack_i420_preview(
    y_plane: &[u8],
    u_plane: &[u8],
    v_plane: &[u8],
    _source_width: usize,
    _source_height: usize,
    y_stride: usize,
    u_stride: usize,
    v_stride: usize,
    preview_width: usize,
    preview_height: usize,
    factor: usize,
) -> Vec<u8> {
    let preview_chroma_width = preview_width / 2;
    let preview_chroma_height = preview_height / 2;
    let expected_payload_len =
        preview_width * preview_height + 2 * (preview_chroma_width * preview_chroma_height);
    let mut payload = Vec::with_capacity(expected_payload_len);

    if factor == 1 {
        append_plane_contiguous(&mut payload, y_plane, preview_width, preview_height, y_stride);
        append_plane_contiguous(
            &mut payload,
            u_plane,
            preview_chroma_width,
            preview_chroma_height,
            u_stride,
        );
        append_plane_contiguous(
            &mut payload,
            v_plane,
            preview_chroma_width,
            preview_chroma_height,
            v_stride,
        );
        return payload;
    }

    append_downsampled_plane_by_factor(
        &mut payload,
        y_plane,
        preview_width,
        preview_height,
        y_stride,
        factor,
    );
    append_downsampled_plane_by_factor(
        &mut payload,
        u_plane,
        preview_chroma_width,
        preview_chroma_height,
        u_stride,
        factor,
    );
    append_downsampled_plane_by_factor(
        &mut payload,
        v_plane,
        preview_chroma_width,
        preview_chroma_height,
        v_stride,
        factor,
    );

    payload
}

fn clamp_even_dimension(value: usize) -> usize {
    if value <= 2 {
        return 2;
    }

    value & !1
}

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

fn pack_frame_packet(
    codec: u8,
    width: u32,
    height: u32,
    telemetry: Option<(u64, u32)>,
    payload: &[u8],
) -> Result<Vec<u8>, String> {
    let telemetry_size = if telemetry.is_some() {
        FRAME_PACKET_TELEMETRY_SIZE
    } else {
        0
    };
    let mut packet = Vec::with_capacity(9 + telemetry_size + payload.len());
    packet.push(codec);
    packet.extend_from_slice(&width.to_be_bytes());
    packet.extend_from_slice(&height.to_be_bytes());
    if let Some((sent_at_epoch_ms, sequence)) = telemetry {
        packet.extend_from_slice(&sent_at_epoch_ms.to_be_bytes());
        packet.extend_from_slice(&sequence.to_be_bytes());
    } else if codec == FRAME_CODEC_I420_TELEMETRY {
        return Err("Telemetry codec requires telemetry metadata.".to_string());
    }
    packet.extend_from_slice(payload);
    Ok(packet)
}
