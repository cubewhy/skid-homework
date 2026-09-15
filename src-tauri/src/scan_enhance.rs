use std::io::Cursor;

use image::{GrayImage, ImageReader, Luma};
use imageproc::contrast::otsu_level;
use imageproc::filter::gaussian_blur_f32;
use tauri::http::{header, Method, Request, Response, StatusCode};
use thiserror::Error;

pub const ENHANCE_SCAN_PATH: &str = "/enhance_scan";

const MAX_IMAGE_BYTES: usize = 100 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 50_000_000;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ScanEnhanceError {
    #[error("Image enhancement request body is empty.")]
    EmptyInput,
    #[error("Image enhancement request body is not a supported image.")]
    InvalidImage,
    #[error("Image enhancement input is too large.")]
    InputTooLarge,
    #[error("Image enhancement failed.")]
    ProcessingFailed,
    #[error("Image enhancement failed to encode PNG output.")]
    PngEncodeFailed,
    #[error("Image enhancement ran out of memory.")]
    OutOfMemory,
}

impl ScanEnhanceError {
    fn status_code(&self) -> StatusCode {
        match self {
            Self::EmptyInput | Self::InvalidImage | Self::InputTooLarge => StatusCode::BAD_REQUEST,
            Self::ProcessingFailed | Self::PngEncodeFailed | Self::OutOfMemory => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        }
    }
}

pub fn enhance_scan(source_bytes: &[u8]) -> Result<Vec<u8>, ScanEnhanceError> {
    let decoded = decode_image_with_limits(source_bytes)?;
    let grayscale = decoded.to_luma8();
    let background_sigma = compute_background_sigma(grayscale.width(), grayscale.height());
    let background = gaussian_blur_f32(&grayscale, background_sigma);
    let flattened = flatten_background(&grayscale, &background);
    let denoised = gaussian_blur_f32(&flattened, 0.8);
    let normalized = normalize_gray(&denoised);
    let threshold = otsu_level(&normalized);
    let binary = threshold_to_binary(&normalized, threshold);

    encode_png_grayscale(&binary)
}

fn decode_image_with_limits(bytes: &[u8]) -> Result<image::DynamicImage, ScanEnhanceError> {
    if bytes.is_empty() {
        return Err(ScanEnhanceError::EmptyInput);
    }

    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(ScanEnhanceError::InputTooLarge);
    }

    if let Ok(reader) = ImageReader::new(Cursor::new(bytes)).with_guessed_format() {
        if let Ok((width, height)) = reader.into_dimensions() {
            validate_pixel_count(width, height)?;
        }
    }

    let decoded = image::load_from_memory(bytes).map_err(|_| ScanEnhanceError::InvalidImage)?;
    validate_pixel_count(decoded.width(), decoded.height())?;
    Ok(decoded)
}

fn validate_pixel_count(width: u32, height: u32) -> Result<(), ScanEnhanceError> {
    let pixels = u64::from(width) * u64::from(height);
    if pixels == 0 || pixels > MAX_IMAGE_PIXELS {
        return Err(ScanEnhanceError::InputTooLarge);
    }
    Ok(())
}

fn compute_background_sigma(width: u32, height: u32) -> f32 {
    let shortest_side = width.min(height) as f32;
    (shortest_side * 0.08).clamp(5.0, 80.0)
}

fn flatten_background(grayscale: &GrayImage, background: &GrayImage) -> GrayImage {
    let mut output = GrayImage::new(grayscale.width(), grayscale.height());

    for y in 0..grayscale.height() {
        for x in 0..grayscale.width() {
            let luminance = grayscale.get_pixel(x, y).0[0] as f32;
            let background_luminance = (background.get_pixel(x, y).0[0] as f32).max(1.0);
            let value = ((luminance / background_luminance) * 255.0).clamp(0.0, 255.0) as u8;
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
        min_value = min_value.min(value);
        max_value = max_value.max(value);
    }

    let range = max_value.saturating_sub(min_value).max(1) as f32;
    let mut output = GrayImage::new(input.width(), input.height());

    for (x, y, pixel) in input.enumerate_pixels() {
        let normalized =
            (((pixel.0[0].saturating_sub(min_value)) as f32) * 255.0 / range).round() as u8;
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

fn encode_png_grayscale(image: &GrayImage) -> Result<Vec<u8>, ScanEnhanceError> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, image.width(), image.height());
        encoder.set_color(png::ColorType::Grayscale);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|_| ScanEnhanceError::PngEncodeFailed)?;
        writer
            .write_image_data(image.as_raw())
            .map_err(|_| ScanEnhanceError::PngEncodeFailed)?;
    }
    Ok(bytes)
}

pub fn handle_protocol(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.uri().path() != ENHANCE_SCAN_PATH {
        return text_response(StatusCode::NOT_FOUND, "Not found.");
    }

    if request.method() != Method::POST {
        return text_response(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed.");
    }

    match enhance_scan(request.body()) {
        Ok(bytes) => binary_response(StatusCode::OK, "image/png", bytes),
        Err(error) => text_response(error.status_code(), &error.to_string()),
    }
}

fn binary_response(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .body(body)
        .expect("valid scan enhancement binary response")
}

fn text_response(status: StatusCode, body: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(body.as_bytes().to_vec())
        .expect("valid scan enhancement text response")
}
