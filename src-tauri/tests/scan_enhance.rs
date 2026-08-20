use app_lib::scan_enhance::{enhance_scan, handle_protocol, ScanEnhanceError, ENHANCE_SCAN_PATH};
use tauri::http::{header, Method, Request, StatusCode};

const PNG_SIGNATURE: &[u8] = &[0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];

fn sample_png() -> Vec<u8> {
    let width = 32;
    let height = 32;
    let mut pixels = Vec::with_capacity(width * height * 4);

    for y in 0..height {
        for x in 0..width {
            let inside_page = (4..28).contains(&x) && (4..28).contains(&y);
            let value = if inside_page && (x + y) % 7 == 0 {
                24
            } else if inside_page {
                238
            } else {
                164
            };
            pixels.extend_from_slice(&[value, value, value, 255]);
        }
    }

    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().expect("sample png header");
        writer.write_image_data(&pixels).expect("sample png data");
    }
    bytes
}

fn protocol_request(method: Method, path: &str, body: Vec<u8>) -> Request<Vec<u8>> {
    Request::builder()
        .method(method)
        .uri(format!("skidhw://localhost{path}"))
        .body(body)
        .expect("valid protocol request")
}

#[test]
fn enhance_scan_rejects_empty_input() {
    assert_eq!(enhance_scan(&[]), Err(ScanEnhanceError::EmptyInput));
}

#[test]
fn enhance_scan_rejects_invalid_image_bytes() {
    assert_eq!(
        enhance_scan(b"not an image"),
        Err(ScanEnhanceError::InvalidImage)
    );
}

#[test]
fn enhance_scan_returns_png_for_valid_image() {
    let output = enhance_scan(&sample_png()).expect("valid sample should enhance");
    assert!(output.starts_with(PNG_SIGNATURE));

    let decoded = image::load_from_memory(&output).expect("output png should decode");
    assert_eq!(decoded.width(), 32);
    assert_eq!(decoded.height(), 32);
}

#[test]
fn protocol_rejects_wrong_path() {
    let response = handle_protocol(protocol_request(Method::POST, "/wrong", sample_png()));
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[test]
fn protocol_rejects_wrong_method() {
    let response = handle_protocol(protocol_request(
        Method::GET,
        ENHANCE_SCAN_PATH,
        sample_png(),
    ));
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

#[test]
fn protocol_maps_empty_body_to_bad_request() {
    let response = handle_protocol(protocol_request(
        Method::POST,
        ENHANCE_SCAN_PATH,
        Vec::new(),
    ));
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn protocol_maps_invalid_image_to_bad_request() {
    let response = handle_protocol(protocol_request(
        Method::POST,
        ENHANCE_SCAN_PATH,
        b"not an image".to_vec(),
    ));
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn protocol_success_returns_png_response() {
    let response = handle_protocol(protocol_request(
        Method::POST,
        ENHANCE_SCAN_PATH,
        sample_png(),
    ));
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get(header::CONTENT_TYPE).unwrap(),
        "image/png"
    );
    assert!(response.body().starts_with(PNG_SIGNATURE));
}
