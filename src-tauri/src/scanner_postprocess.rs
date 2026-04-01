use std::io::Cursor;
use std::time::Instant;

use image::codecs::png::PngEncoder;
use image::imageops::{rotate180, rotate270, rotate90};
use image::{ColorType, DynamicImage, GrayImage, ImageEncoder, Luma, Rgba, RgbaImage};
use imageproc::contrast::otsu_level;
use imageproc::filter::gaussian_blur_f32;
use imageproc::geometric_transformations::{warp_into, Interpolation, Projection};
use serde::{Deserialize, Serialize};
use tauri::{
    command,
    ipc::{Channel, InvokeResponseBody},
};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScannerPoint {
    x: f32,
    y: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerPostProcessRequest {
    source_bytes: Vec<u8>,
    document_points: Option<Vec<ScannerPoint>>,
    output_rotation: u16,
    image_enhancement: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerPostProcessResponse {
    processing_ms: f64,
    decode_ms: f64,
    perspective_ms: Option<f64>,
    enhance_ms: Option<f64>,
    rotate_ms: Option<f64>,
    encode_ms: f64,
    input_width: u32,
    input_height: u32,
    output_width: u32,
    output_height: u32,
    encoded_mime_type: &'static str,
}

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
pub async fn tauri_scanner_postprocess_image(
    request: ScannerPostProcessRequest,
    payload_channel: Channel<InvokeResponseBody>,
) -> Result<ScannerPostProcessResponse, String> {
    let (response, encoded_png) = tauri::async_runtime::spawn_blocking(move || {
        process_image_request(request)
    })
    .await
    .map_err(|error| format!("Native scanner post-process task failed: {error}"))??;

    send_raw_payload(
        &payload_channel,
        encoded_png,
        "native scanner post-process result",
    )?;
    Ok(response)
}

fn process_image_request(
    request: ScannerPostProcessRequest,
) -> Result<(ScannerPostProcessResponse, Vec<u8>), String> {
    let started_at = Instant::now();
    let decode_started_at = Instant::now();
    let decoded = image::load_from_memory(&request.source_bytes)
        .map_err(|error| format!("Failed to decode source image: {error}"))?;
    let decode_ms = decode_started_at.elapsed().as_secs_f64() * 1000.0;

    let mut current = decoded.into_rgba8();
    let input_width = current.width();
    let input_height = current.height();
    let mut perspective_ms = None;
    let mut enhance_ms = None;
    let mut rotate_ms = None;

    if let Some(points) = normalize_document_points(request.document_points.as_deref())? {
        let perspective_started_at = Instant::now();
        current = warp_document_to_rect(&current, &points)?;
        perspective_ms = Some(perspective_started_at.elapsed().as_secs_f64() * 1000.0);
    }

    if request.image_enhancement {
        let enhance_started_at = Instant::now();
        current = enhance_document_image(&current);
        enhance_ms = Some(enhance_started_at.elapsed().as_secs_f64() * 1000.0);
    }

    if request.output_rotation != 0 {
        let rotate_started_at = Instant::now();
        current = rotate_image(current, request.output_rotation)?;
        rotate_ms = Some(rotate_started_at.elapsed().as_secs_f64() * 1000.0);
    }

    let encode_started_at = Instant::now();
    let encoded_png = encode_png(&current)?;
    let encode_ms = encode_started_at.elapsed().as_secs_f64() * 1000.0;

    let response = ScannerPostProcessResponse {
        processing_ms: started_at.elapsed().as_secs_f64() * 1000.0,
        decode_ms,
        perspective_ms,
        enhance_ms,
        rotate_ms,
        encode_ms,
        input_width,
        input_height,
        output_width: current.width(),
        output_height: current.height(),
        encoded_mime_type: "image/png",
    };

    Ok((response, encoded_png))
}

fn normalize_document_points(
    points: Option<&[ScannerPoint]>,
) -> Result<Option<[ScannerPoint; 4]>, String> {
    let Some(points) = points else {
        return Ok(None);
    };

    if points.len() != 4 {
        return Err(format!(
            "Perspective transform requires exactly 4 points, got {}.",
            points.len()
        ));
    }

    let mut ordered = *<&[ScannerPoint; 4]>::try_from(points)
        .map_err(|_| "Failed to normalize document points.".to_string())?;
    ordered = order_points(ordered);
    Ok(Some(ordered))
}

fn order_points(points: [ScannerPoint; 4]) -> [ScannerPoint; 4] {
    let mut sums = [0.0f32; 4];
    let mut diffs = [0.0f32; 4];

    for (index, point) in points.iter().enumerate() {
        sums[index] = point.x + point.y;
        diffs[index] = point.y - point.x;
    }

    [
        points[index_of_min(&sums)],
        points[index_of_min(&diffs)],
        points[index_of_max(&sums)],
        points[index_of_max(&diffs)],
    ]
}

fn index_of_min(values: &[f32; 4]) -> usize {
    let mut best_index = 0usize;
    for index in 1..values.len() {
        if values[index] < values[best_index] {
            best_index = index;
        }
    }
    best_index
}

fn index_of_max(values: &[f32; 4]) -> usize {
    let mut best_index = 0usize;
    for index in 1..values.len() {
        if values[index] > values[best_index] {
            best_index = index;
        }
    }
    best_index
}

fn warp_document_to_rect(
    source: &RgbaImage,
    points: &[ScannerPoint; 4],
) -> Result<RgbaImage, String> {
    let [tl, tr, br, bl] = points;
    let width_top = point_distance(*tl, *tr);
    let width_bottom = point_distance(*bl, *br);
    let max_width = width_top.max(width_bottom).round().max(1.0) as u32;

    let height_left = point_distance(*tl, *bl);
    let height_right = point_distance(*tr, *br);
    let max_height = height_left.max(height_right).round().max(1.0) as u32;

    let from = [
        (tl.x, tl.y),
        (tr.x, tr.y),
        (br.x, br.y),
        (bl.x, bl.y),
    ];
    let to = [
        (0.0f32, 0.0f32),
        (max_width.saturating_sub(1) as f32, 0.0f32),
        (
            max_width.saturating_sub(1) as f32,
            max_height.saturating_sub(1) as f32,
        ),
        (0.0f32, max_height.saturating_sub(1) as f32),
    ];

    let projection = Projection::from_control_points(from, to)
        .ok_or_else(|| "Failed to build perspective projection from document points.".to_string())?;

    let mut output = RgbaImage::new(max_width, max_height);
    warp_into(
        source,
        &projection,
        Interpolation::Bilinear,
        Rgba([255, 255, 255, 255]),
        &mut output,
    );
    Ok(output)
}

fn point_distance(a: ScannerPoint, b: ScannerPoint) -> f32 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    (dx * dx + dy * dy).sqrt()
}

fn enhance_document_image(source: &RgbaImage) -> RgbaImage {
    let gray = DynamicImage::ImageRgba8(source.clone()).into_luma8();
    let background_sigma = compute_background_sigma(source.width(), source.height());
    let background = gaussian_blur_f32(&gray, background_sigma);
    let flattened = flatten_background(&gray, &background);
    let denoised = gaussian_blur_f32(&flattened, 0.8);
    let normalized = normalize_gray(&denoised);
    let threshold = otsu_level(&normalized);
    let binary = threshold_to_binary(&normalized, threshold);

    let selected = if is_reasonable_binary_candidate(&binary) {
        binary
    } else {
        normalized
    };

    gray_to_rgba(&selected)
}

fn compute_background_sigma(width: u32, height: u32) -> f32 {
    let shortest_side = width.min(height) as f32;
    (shortest_side * 0.04).clamp(3.0, 18.0)
}

fn flatten_background(
    gray: &GrayImage,
    background: &GrayImage,
) -> GrayImage {
    let mut output = GrayImage::new(gray.width(), gray.height());

    for y in 0..gray.height() {
        for x in 0..gray.width() {
            let luminance = gray.get_pixel(x, y).0[0] as f32;
            let blurred = (background.get_pixel(x, y).0[0] as f32).max(1.0);
            let value = ((luminance / blurred) * 255.0).clamp(0.0, 255.0) as u8;
            output.put_pixel(x, y, Luma([value]));
        }
    }

    output
}

fn normalize_gray(input: &GrayImage) -> GrayImage {
    let mut min_value = u8::MAX;
    let mut max_value = u8::MIN;

    for pixel in input.pixels() {
        let value = pixel.0[0];
        if value < min_value {
            min_value = value;
        }
        if value > max_value {
            max_value = value;
        }
    }

    let range = (max_value.saturating_sub(min_value)).max(1) as f32;
    let mut output = GrayImage::new(input.width(), input.height());

    for (x, y, pixel) in input.enumerate_pixels() {
        let normalized = (((pixel.0[0].saturating_sub(min_value)) as f32) * 255.0 / range)
            .clamp(0.0, 255.0) as u8;
        output.put_pixel(x, y, Luma([normalized]));
    }

    output
}

fn threshold_to_binary(input: &GrayImage, threshold: u8) -> GrayImage {
    let mut output = GrayImage::new(input.width(), input.height());

    for (x, y, pixel) in input.enumerate_pixels() {
        let value = if pixel.0[0] > threshold { 255 } else { 0 };
        output.put_pixel(x, y, Luma([value]));
    }

    output
}

fn is_reasonable_binary_candidate(binary: &GrayImage) -> bool {
    let total_pixels = (binary.width() as u64 * binary.height() as u64).max(1) as f64;
    let white_pixels = binary.pixels().filter(|pixel| pixel.0[0] > 127).count() as f64;
    let white_ratio = white_pixels / total_pixels;
    let black_ratio = 1.0 - white_ratio;

    white_ratio >= 0.45 && white_ratio <= 0.995 && black_ratio >= 0.005
}

fn gray_to_rgba(source: &GrayImage) -> RgbaImage {
    let mut output = RgbaImage::new(source.width(), source.height());

    for (x, y, pixel) in source.enumerate_pixels() {
        let value = pixel.0[0];
        output.put_pixel(x, y, Rgba([value, value, value, 255]));
    }

    output
}

fn rotate_image(image: RgbaImage, rotation: u16) -> Result<RgbaImage, String> {
    match rotation {
        0 => Ok(image),
        90 => Ok(rotate90(&image)),
        180 => Ok(rotate180(&image)),
        270 => Ok(rotate270(&image)),
        other => Err(format!("Unsupported output rotation: {other}")),
    }
}

fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut cursor = Cursor::new(Vec::new());
    let encoder = PngEncoder::new(&mut cursor);
    encoder
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ColorType::Rgba8.into(),
        )
        .map_err(|error| format!("Failed to encode PNG payload: {error}"))?;
    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    #[test]
    fn orders_points_into_tl_tr_br_bl() {
        let ordered = order_points([
            ScannerPoint { x: 90.0, y: 10.0 },
            ScannerPoint { x: 10.0, y: 90.0 },
            ScannerPoint { x: 10.0, y: 10.0 },
            ScannerPoint { x: 90.0, y: 90.0 },
        ]);

        assert_eq!(ordered[0].x, 10.0);
        assert_eq!(ordered[0].y, 10.0);
        assert_eq!(ordered[1].x, 90.0);
        assert_eq!(ordered[1].y, 10.0);
        assert_eq!(ordered[2].x, 90.0);
        assert_eq!(ordered[2].y, 90.0);
        assert_eq!(ordered[3].x, 10.0);
        assert_eq!(ordered[3].y, 90.0);
    }

    #[test]
    fn rotates_rgba_images_orthogonally() {
        let mut image = RgbaImage::new(2, 3);
        image.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
        image.put_pixel(1, 0, Rgba([0, 255, 0, 255]));
        image.put_pixel(0, 2, Rgba([0, 0, 255, 255]));

        let rotated = rotate_image(image, 90).expect("rotation should succeed");
        assert_eq!(rotated.width(), 3);
        assert_eq!(rotated.height(), 2);
        assert_eq!(rotated.get_pixel(2, 0).0, [255, 0, 0, 255]);
    }

    #[test]
    fn encodes_processed_image_as_png() {
        let mut image = RgbaImage::new(32, 32);
        for y in 0..32 {
            for x in 0..32 {
                let value = if x < 16 { 24 } else { 232 };
                image.put_pixel(x, y, Rgba([value, value, value, 255]));
            }
        }

        let enhanced = enhance_document_image(&image);
        let encoded = encode_png(&enhanced).expect("png encoding should succeed");
        assert!(encoded.starts_with(&[0x89, b'P', b'N', b'G']));
    }

    #[test]
    fn processes_encoded_source_bytes_end_to_end() {
        let mut image = RgbaImage::new(40, 24);
        for y in 0..24 {
            for x in 0..40 {
                let pixel = if x < 20 {
                    Rgba([32, 32, 32, 255])
                } else {
                    Rgba([224, 224, 224, 255])
                };
                image.put_pixel(x, y, pixel);
            }
        }

        let source_bytes = encode_png(&image).expect("source png encoding should succeed");
        let (response, encoded) = process_image_request(ScannerPostProcessRequest {
            source_bytes,
            document_points: Some(vec![
                ScannerPoint { x: 4.0, y: 2.0 },
                ScannerPoint { x: 35.0, y: 2.0 },
                ScannerPoint { x: 35.0, y: 21.0 },
                ScannerPoint { x: 4.0, y: 21.0 },
            ]),
            output_rotation: 90,
            image_enhancement: true,
        })
        .expect("post-process request should succeed");

        assert!(encoded.starts_with(&[0x89, b'P', b'N', b'G']));
        assert_eq!(response.input_width, 40);
        assert_eq!(response.input_height, 24);
        assert_eq!(response.output_width, 19);
        assert_eq!(response.output_height, 31);
        assert!(response.perspective_ms.is_some());
        assert!(response.enhance_ms.is_some());
        assert!(response.rotate_ms.is_some());
    }
}
