export function uint8ToBase64(uint8Array: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(new Blob([uint8Array as unknown as BlobPart]));
  });
}

export async function base64Decoder(base64: string, encoding: string = "utf-8") {
  const response = await fetch(`data:application/octet-stream;base64,${base64}`);
  const buffer = await response.arrayBuffer();
  return new TextDecoder(encoding).decode(buffer);
}
