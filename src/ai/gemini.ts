import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from "@google/genai";
import type { AiChatMessage } from "./chat-types";
import { BaseAiClient } from "./base-client";

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

export class GeminiAi extends BaseAiClient {
  private ai: GoogleGenAI;
  private config: GeminiConfig;

  constructor(key: string, baseUrl?: string, config?: GeminiConfig) {
    super();
    this.ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        baseUrl: baseUrl,
      },
    });

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

  async sendMedia(
    media: string,
    mimeType: string,
    prompt?: string,
    model = "gemini-3-pro-preview",
    callback?: (text: string) => void,
  ) {
    const contents = [];

    if (this.systemPrompts.length > 0) {
      const systemPrompt = this.buildSystemPrompt();
      contents.push({
        role: "user",
        parts: [{ text: systemPrompt }],
      });
    }

    const parts: Array<{ text: string } | { fileData: { mimeType: string; fileUri: string } } | { inlineData: { mimeType: string; data: string } }> = [];
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
          data: media,
        },
      });
    }

    contents.push({
      role: "user",
      parts,
    });

    const response = await this.ai.models.generateContentStream({
      model,
      config: {
        thinkingConfig: { thinkingBudget: this.config.thinkingBudget },
        safetySettings: this.config.safetySettings,
      },
      contents,
    });

    return this.handleStreamResponse(response, callback);
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
    model = "gemini-3-pro-preview",
    callback?: (text: string) => void,
  ) {
    const contents = [];

    if (this.systemPrompts.length > 0) {
      const systemPrompt = this.buildSystemPrompt();
      contents.push({
        role: "user",
        parts: [{ text: systemPrompt }],
      });
    }

    this.logAiQuery(model, messages);

    for (const message of messages) {
      const trimmed = message.content?.trim();
      if (!trimmed) continue;

      const role = message.role === "assistant" ? "model" : "user";

      contents.push({
        role,
        parts: [{ text: trimmed }],
      });
    }

    const response = await this.ai.models.generateContentStream({
      model,
      config: {
        thinkingConfig: { thinkingBudget: this.config.thinkingBudget },
        safetySettings: this.config.safetySettings,
      },
      contents,
    });

    return this.handleStreamResponse(response, callback);
  }
}
