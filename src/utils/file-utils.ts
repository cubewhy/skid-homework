export function generateTextFilename(content: string): string {
  const now = new Date();
  const timeString = now.toTimeString().split(" ")[0].replace(/:/g, ""); // HHmmss
  let preview = content
      .trim()
      .slice(0, 10)
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
  if (!preview) {
    preview = "content";
  }
  return `text_${timeString}_${preview}.txt`;
}

export async function readTextFile(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch");
    return await response.text();
  } catch (e) {
    console.error("Failed to read text file:", e);
    return "";
  }
}

export function isTextMimeType(mimeType: string, fileName?: string): boolean {
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return true;
  }
  if (fileName) {
    const lowerName = fileName.toLowerCase();
    return lowerName.endsWith(".md") || lowerName.endsWith(".json") || lowerName.endsWith(".txt");
  }
  return false;
}
