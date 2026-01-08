import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { AiChatMessage } from "./chat-types";
import { base64ToUtf8 } from "@/utils/encoding";

export type OpenAiModel = {
  name: string;
  displayName: string;
};

const DEFAULT_OPENAI_ROOT = "https://api.openai.com/v1";

function normalizeBaseUrl(baseUrl?: string) {
  const normalized = (baseUrl ?? DEFAULT_OPENAI_ROOT).replace(/\/$/, "");
  return normalized;
}

export class OpenAiClient {
  private client: OpenAI;
  private systemPrompts: string[];

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: normalizeBaseUrl(baseUrl),
      dangerouslyAllowBrowser: true,
    });
    this.systemPrompts = [];
  }

  addSystemPrompt(prompt: string) {
    this.systemPrompts?.push(prompt);
  }

  setAvailableTools(prompts: string[]) {
    const toolsPrompt = prompts.join("\n\n");
    this.addSystemPrompt(`## Available Tools\n${toolsPrompt}`);
    // TODO: join prompt when invoke send* methods
  }

  /**
   * Sends a request with an image (Vision API).
   */
  async sendMedia(
    media: string,
    mimeType: string,
    prompt?: string,
    model = "gpt-4o-mini",
    callback?: (text: string) => void,
    options?: { onlineSearch?: boolean },
  ) {
    const messages: ChatCompletionMessageParam[] = [];

    // 1. Add System Prompt
    if (this.systemPrompts) {
      messages.push({
        role: "system",
        content: this.systemPrompts.join("\n\n"),
      });
    }

    // 2. Build User Content (Text + Image)
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
    } else {
      try {
        const text = base64ToUtf8(media);
        contentParts.push({
          type: "text",
          text: `\n\n[File Content]\n${text}\n\n`,
        });
      } catch (e) {
        console.error("Failed to decode base64 text", e);
      }
    }

    messages.push({
      role: "user",
      content: contentParts,
    });

    return this._executeStream(model, messages, callback, options);
  }

  /**
   * Sends a standard text-only chat request.
   */
  async sendChat(
    messages: AiChatMessage[],
    model = "gpt-4o-mini",
    callback?: (text: string) => void,
    options?: { onlineSearch?: boolean },
  ) {
    const openAiMessages: ChatCompletionMessageParam[] = [];

    // 1. Add System Prompt
    if (this.systemPrompts) {
      messages.push({
        role: "system",
        content: this.systemPrompts.join("\n\n"),
      });
    }

    console.log(
      `AI Query with ${model}\nSystem prompt:`,
      this.systemPrompts,
      "\nUser query:",
      messages,
    );

    // 2. Convert History
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

    return this._executeStream(model, openAiMessages, callback, options);
  }

  /**
   * Internal helper to handle the streaming response from OpenAI.
   */
  private async _executeStream(
    model: string,
    messages: ChatCompletionMessageParam[],
    callback?: (text: string) => void,
    options?: { onlineSearch?: boolean },
  ): Promise<string> {
    const stream = await this.client.chat.completions.create({
      model,
      messages,
      stream: true,
      // SDK types may not yet include web_search; cast to any to allow passthrough.
      tools: options?.onlineSearch
        ? ([{ type: "web_search" }] as unknown as ChatCompletionTool[])
        : undefined,
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
