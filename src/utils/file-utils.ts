export function generateTextFilename(content: string): string {
  const now = new Date();
  const timeString = now.toTimeString().split(" ")[0].replace(/:/g, ""); // HHmmss
  const preview = content
    .trim()
    .slice(0, 10)
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
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
