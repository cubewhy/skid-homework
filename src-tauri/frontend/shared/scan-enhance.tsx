export const ENHANCE_SCAN_PROTOCOL = "skidhw";
export const ENHANCE_SCAN_HOST = "localhost";
export const ENHANCE_SCAN_PATH = "/enhance_scan";
export const ENHANCE_SCAN_ENDPOINT =
  `${ENHANCE_SCAN_PROTOCOL}://${ENHANCE_SCAN_HOST}${ENHANCE_SCAN_PATH}`;

export function ImagePostProcessLoader(): React.JSX.Element | null {
  return null;
}

/**
 * Enhance a scan image via the native Tauri image-processing protocol.
 *
 * The returned `url` is a blob URL created by `URL.createObjectURL`.
 * Callers MUST revoke it with `URL.revokeObjectURL()` once the URL is no
 * longer needed to avoid memory leaks.
 */
export async function processImage(
  file: File,
): Promise<{file: File; url: string}> {
  const response = await fetch(ENHANCE_SCAN_ENDPOINT, {
    method: "POST",
    body: file,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const message = detail.trim() || `Image enhancement failed (${response.status}).`;
    throw new Error(message);
  }

  const bytes = await response.arrayBuffer();
  const enhancedFile = new File([bytes], `enhanced_${file.name}.png`, {
    type: "image/png",
  });

  return {
    file: enhancedFile,
    url: URL.createObjectURL(enhancedFile),
  };
}
