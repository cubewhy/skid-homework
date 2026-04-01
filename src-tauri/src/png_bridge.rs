use png::{BitDepth, ColorType, Encoder};
use tauri::{
    command,
    ipc::{Channel, InvokeResponseBody},
};

fn send_raw_payload(
    channel: &Channel<InvokeResponseBody>,
    bytes: Vec<u8>,
    context: &str,
) -> Result<(), String> {
    channel
        .send(InvokeResponseBody::Raw(bytes))
        .map_err(|error| format!("Failed to deliver {context} to the frontend: {error}"))
}

#[command]
pub async fn tauri_scanner_encode_png_rgba(
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    payload_channel: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let encoded_png = tauri::async_runtime::spawn_blocking(move || {
        if width == 0 || height == 0 {
            return Err("PNG encode dimensions must be greater than zero.".to_string());
        }

        let expected_len = (width as usize)
            .checked_mul(height as usize)
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(|| "PNG encode dimensions overflowed.".to_string())?;

        if rgba.len() != expected_len {
            return Err(format!(
                "PNG encode payload length mismatch: expected {expected_len} bytes for {width}x{height}, got {}.",
                rgba.len()
            ));
        }

        let mut output = Vec::new();
        {
            let mut encoder = Encoder::new(&mut output, width, height);
            encoder.set_color(ColorType::Rgba);
            encoder.set_depth(BitDepth::Eight);

            let mut writer = encoder
                .write_header()
                .map_err(|error| format!("Failed to write PNG header: {error}"))?;
            writer
                .write_image_data(&rgba)
                .map_err(|error| format!("Failed to encode PNG payload: {error}"))?;
        }

        Ok(output)
    })
    .await
    .map_err(|error| format!("Native PNG encode task failed: {error}"))??;

    send_raw_payload(&payload_channel, encoded_png, "native scanner PNG encode")
}
