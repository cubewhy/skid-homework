import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { AiChatMessage } from "./chat-types";
import { BaseAiClient } from "./base-client";
import { base64Decoder } from "@/utils/encoding";

export type OpenAiModel = {
  name: string;
  displayName: string;
};

const DEFAULT_OPENAI_ROOT = "https://api.openai.com/v1";

function normalizeBaseUrl(baseUrl?: string) {
  const normalized = (baseUrl ?? DEFAULT_OPENAI_ROOT).replace(/\/$/, "");
  return normalized;
}

export class OpenAiClient extends BaseAiClient {
  private client: OpenAI;

  constructor(apiKey: string, baseUrl?: string) {
    super();
    this.client = new OpenAI({
      apiKey,
      baseURL: normalizeBaseUrl(baseUrl),
      dangerouslyAllowBrowser: true,
    });
  }

  /**
   * Sends a request with an image (Vision API).
   */
  async sendMedia(
    media: string,
    mimeType: string,
    prompt?: string,
    // replacing with gpt-5.2 as the default model since GPT-4o and older models are retiring.
    // see https://openai.com/index/retiring-gpt-4o-and-older-models/
    model = "gpt-5.2",
    callback?: (text: string) => void,
  ) {
    const messages: ChatCompletionMessageParam[] = [];

    if (this.systemPrompts.length > 0) {
      const systemPrompt = this.buildSystemPrompt();
      messages.push({
        role: "system",
        content: systemPrompt,
      });
    }

    const contentParts: Array<
      | { type: "text"; text: string }
      | {
          type: "image_url";
          image_url: { url: string; detail?: "auto" | "low" | "high" };
        }
    > = [];

    if (prompt) {
      contentParts.push({
        type: "text",
        text: prompt,
      });
    }

    if (mimeType.startsWith("image/")) {
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${media}`,
          detail: "auto",
        },
      });
    } else if (mimeType === "application/pdf") {
      console.error("PDF media type is not directly supported for completion API.");
    } else {
      try {
        let charset = "utf-8";
        const charsetMatch = mimeType.match(/charset=([^;]+)/i);
        if (charsetMatch && charsetMatch[1]) {
          charset = charsetMatch[1].trim();
        }
        let text: string;
        try {
          text = await base64Decoder(media, charset);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (err) {
          // Fallback to utf-8 if the specified charset is not supported by TextDecoder
          text = await base64Decoder(media, "utf-8");
        }
        contentParts.push({
          type: "text",
          text: `\n\n[File Content]\n${text}\n\n`,
        });
      } catch (e) {
        throw new Error("Failed to decode base64 text: " + (e instanceof Error ? e.message : String(e)));
      }
    }

    messages.push({
      role: "user",
      content: contentParts,
    });

    return this._executeStream(model, messages, callback);
  }

  /**
   * Sends a standard text-only chat request.
   */
  async sendChat(
    messages: AiChatMessage[],
    model = "gpt-5.2",
    callback?: (text: string) => void,
  ) {
    const openAiMessages: ChatCompletionMessageParam[] = [];

    if (this.systemPrompts.length > 0) {
      const systemPrompt = this.buildSystemPrompt();
      openAiMessages.push({
        role: "system",
        content: systemPrompt,
      });
    }

    this.logAiQuery(model, messages);

    for (const message of messages) {
      const trimmed = message.content?.trim();
      if (!trimmed) continue;

      const role =
        message.role === "assistant"
          ? "assistant"
          : message.role === "system"
            ? "system"
            : "user";

      openAiMessages.push({
        role: role,
        content: trimmed,
      });
    }

    return this._executeStream(model, openAiMessages, callback);
  }

  /**
   * Internal helper to handle the streaming response from OpenAI.
   */
  private async _executeStream(
    model: string,
    messages: ChatCompletionMessageParam[],
    callback?: (text: string) => void,
  ): Promise<string> {
    const stream = await this.client.chat.completions.create({
      model,
      messages,
      stream: true,
    });

    let aggregated = "";

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || "";
      if (delta) {
        aggregated += delta;
        callback?.(delta);
      }
    }

    return aggregated.trim();
  }

  async getAvailableModels(): Promise<OpenAiModel[]> {
    const response = await this.client.models.list();

    return response.data.map((model) => ({
      name: model.id,
      displayName: model.id,
    }));
  }
}
