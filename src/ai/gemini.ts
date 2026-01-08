import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from "@google/genai";
import type { AiChatMessage } from "./chat-types";

export interface GeminiModel {
  name: string;
  displayName: string;
}

export interface GeminiConfig {
  thinkingBudget?: number;
  safetySettings?: Array<{
    category: HarmCategory;
    threshold: HarmBlockThreshold;
  }>;
}

export class GeminiAi {
  private ai: GoogleGenAI;
  private systemPrompts: string[];
  private config: GeminiConfig;

  constructor(key: string, baseUrl?: string, config?: GeminiConfig) {
    this.ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        baseUrl: baseUrl,
      },
    });

    this.systemPrompts = [];

    this.config = {
      thinkingBudget: config?.thinkingBudget ?? -1,
      safetySettings: config?.safetySettings ?? [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    };
  }

  addSystemPrompt(prompt: string) {
    this.systemPrompts?.push(prompt);
  }

  setAvailableTools(prompts: string[]) {
    const toolsPrompt = prompts.join("\n\n");
    this.addSystemPrompt(`## Available Tools\n${toolsPrompt}`);
    // TODO: join prompt when invoke send* methods
  }

  private static formatOnlineSearch(
    groundingChunks: { uri?: string | null; title?: string | null }[],
    queries: string[],
    existingText: string,
  ): string {
    if (!groundingChunks.length) return existingText;
    const hasOnlineSearchSection =
      existingText.includes("### ONLINE_SEARCH");
    const hasIndexedList = /### ONLINE_SEARCH[\s\S]*#\d+\s-/.test(
      existingText,
    );
    if (hasOnlineSearchSection && hasIndexedList) {
      return existingText;
    }

    const unique: Map<string, { uri?: string | null; title?: string | null }> =
      new Map();
    groundingChunks.forEach((c) => {
      const key = c.uri || c.title || Math.random().toString();
      if (!unique.has(key)) unique.set(key, c);
    });

    const lines = Array.from(unique.values()).map((c, idx) => {
      const title = c.title || c.uri || "result";
      const uri = c.uri ?? "";
      const link = uri ? `[${title}](${uri})` : title;
      return `#${idx + 1} - ${link}`;
    });

    const queryLine =
      queries && queries.length
        ? `Queries: ${queries.join(", ")}`
        : undefined;

    const block = [
      "### ONLINE_SEARCH",
      ...lines.map((l) => `${l}`),
      ...(queryLine ? [queryLine] : []),
    ].join("\n");

    return hasOnlineSearchSection
      ? `${existingText.trim()}\n${block}`
      : `${existingText.trim()}\n\n${block}`;
  }

  async sendMedia(
    media: string,
    mimeType: string,
    prompt?: string,
    model = "gemini-2.5-pro",
    callback?: (text: string) => void,
    options?: { onlineSearch?: boolean },
  ) {
    const contents = [];

    if (this.systemPrompts) {
      contents.push({
        role: "user",
        parts: [{ text: this.systemPrompts.join("\n\n") }],
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [];
    if (prompt) {
      parts.push({ text: prompt });
    }

    if (media.startsWith("http")) {
      parts.push({
        fileData: {
          mimeType,
          fileUri: media,
        },
      });
    } else {
      parts.push({
        inlineData: {
          mimeType,
          data: media, // base64
        },
      });
    }

    contents.push({
      role: "user",
      parts,
    });

    const tools = options?.onlineSearch ? [{ googleSearch: {} }] : undefined;

    const groundingChunks: { uri?: string | null; title?: string | null }[] =
      [];
    let webSearchQueries: string[] = [];

    const response = await this.ai.models.generateContentStream({
      model,
      config: {
        thinkingConfig: { thinkingBudget: this.config.thinkingBudget },
        safetySettings: this.config.safetySettings,
        tools,
      },
      contents,
    });

    let result = "";
    for await (const chunk of response) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = chunk;
      const candidate = c.candidates?.[0];
      const gm = candidate?.groundingMetadata;
      if (gm?.groundingChunks) {
        gm.groundingChunks.forEach((gc: any) =>
          groundingChunks.push({
            uri: gc.web?.uri,
            title: gc.web?.title,
          }),
        );
      }
      if (gm?.webSearchQueries) {
        webSearchQueries = gm.webSearchQueries as string[];
      }

      if (chunk.text) {
        result += chunk.text;
        callback?.(chunk.text);
      }
    }
    return GeminiAi.formatOnlineSearch(
      groundingChunks,
      webSearchQueries,
      result,
    );
  }

  async getAvailableModels(): Promise<GeminiModel[]> {
    const models = await this.ai.models.list();
    return models.page.map((it) => ({
      name: it.name!,
      displayName: it.displayName ?? it.name!,
    }));
  }

  async sendChat(
    messages: AiChatMessage[],
    model = "gemini-2.5-pro",
    callback?: (text: string) => void,
    options?: { onlineSearch?: boolean },
  ) {
    const contents = [];

    if (this.systemPrompts) {
      contents.push({
        role: "user",
        parts: [{ text: this.systemPrompts.join("\n\n") }],
      });
    }

    console.log(
      `AI Query with ${model}\nSystem prompt:`,
      this.systemPrompts,
      "\nUser query:",
      messages,
    );

    for (const message of messages) {
      const trimmed = message.content?.trim();
      if (!trimmed) continue;

      const role = message.role === "assistant" ? "model" : "user";

      contents.push({
        role,
        parts: [{ text: trimmed }],
      });
    }

    const tools = options?.onlineSearch ? [{ googleSearch: {} }] : undefined;

    const groundingChunks: { uri?: string | null; title?: string | null }[] =
      [];
    let webSearchQueries: string[] = [];

    const response = await this.ai.models.generateContentStream({
      model,
      config: {
        thinkingConfig: { thinkingBudget: this.config.thinkingBudget },
        safetySettings: this.config.safetySettings,
        tools,
      },
      contents,
    });

    let result = "";
    for await (const chunk of response) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = chunk;
      const candidate = c.candidates?.[0];
      const gm = candidate?.groundingMetadata;
      if (gm?.groundingChunks) {
        gm.groundingChunks.forEach((gc: any) =>
          groundingChunks.push({
            uri: gc.web?.uri,
            title: gc.web?.title,
          }),
        );
      }
      if (gm?.webSearchQueries) {
        webSearchQueries = gm.webSearchQueries as string[];
      }

      if (chunk.text) {
        result += chunk.text;
        callback?.(chunk.text);
      }
    }
    return GeminiAi.formatOnlineSearch(
      groundingChunks,
      webSearchQueries,
      result,
    ).trim();
  }
}
