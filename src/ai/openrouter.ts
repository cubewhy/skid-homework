import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { AiChatMessage } from "./chat-types";
import { base64ToUtf8 } from "@/utils/encoding";

export type OpenRouterModel = {
  name: string;
  displayName: string;
};

const DEFAULT_OPENROUTER_ROOT = "https://openrouter.ai/api/v1";

function normalizeBaseUrl(baseUrl?: string) {
  return (baseUrl ?? DEFAULT_OPENROUTER_ROOT).replace(/\/$/, "");
}

interface OpenRouterUrlCitation {
  url: string;
  title: string;
  content?: string;
  start_index: number;
  end_index: number;
}

interface OpenRouterAnnotation {
  type: "url_citation";
  url_citation: OpenRouterUrlCitation;
}

export class OpenRouterClient {
  private client: OpenAI;
  private systemPrompts: string[];

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: normalizeBaseUrl(baseUrl),
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'HTTP-Referer': 'https://skidhw.serina.in', // Optional. Site URL for rankings on openrouter.ai.
        'X-Title': 'Serina-chan Helper', // Optional. Site title for rankings on openrouter.ai.
      }
    });
    this.systemPrompts = [];
  }

  addSystemPrompt(prompt: string) {
    this.systemPrompts?.push(prompt);
  }

  setAvailableTools(prompts: string[]) {
    const toolsPrompt = prompts.join("\n\n");
    this.addSystemPrompt(`## Available Tools\n${toolsPrompt}`);
  }

  /**
   * Sends a request with an image.
   */
  async sendMedia(
    media: string,
    mimeType: string,
    prompt?: string,
    model = "google/gemini-2.0-flash-exp:free",
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
          image_url: {
            url: string;
          };
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
    model = "google/gemini-2.0-flash-exp:free",
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
   * Internal helper to handle the streaming response from OpenRouter.
   */
  private async _executeStream(
    model: string,
    messages: ChatCompletionMessageParam[],
    callback?: (text: string) => void,
    options?: { onlineSearch?: boolean },
  ): Promise<string> {
    // Add plugins for web search if requested
    const extraBody = options?.onlineSearch
      ? { plugins: [{ id: "web" }] }
      : undefined;

    // @ts-ignore
    const stream = await this.client.chat.completions.create({
      model,
      messages,
      stream: true,
      extra_body: extraBody,
    });

    let aggregated = "";
    const citations: OpenRouterUrlCitation[] = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || "";

      // Check for annotations in the chunk (OpenRouter specific)
      // @ts-expect-error OpenRouter specific field
      const annotations = chunk.choices[0]?.message?.annotations as OpenRouterAnnotation[] | undefined;
      
      // Sometimes annotations might come in a different place depending on the stream chunk structure
      // But based on user description, it's in message.annotations. 
      // In streaming, 'message' might not be fully populated in 'delta', but let's check 'chunk' structure.
      // Actually, in streaming, it's usually in the last chunk or a specific chunk.
      // We'll check if 'annotations' exists on the choice or message.
      
      // Note: OpenAI SDK types might not have 'annotations' on 'delta'.
      // We might need to inspect the raw chunk if the SDK filters it out, but usually it passes through unknown fields.
      
      // Let's try to find annotations in the chunk object
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawChunk = chunk as any;
      const chunkAnnotations = rawChunk.choices?.[0]?.message?.annotations || rawChunk.choices?.[0]?.delta?.annotations;

      if (chunkAnnotations && Array.isArray(chunkAnnotations)) {
         chunkAnnotations.forEach((ann: OpenRouterAnnotation) => {
             if (ann.type === 'url_citation') {
                 citations.push(ann.url_citation);
             }
         });
      }

      if (delta) {
        aggregated += delta;
        callback?.(delta);
      }
    }

    // Format citations if any
    if (citations.length > 0) {
        const formattedCitations = this.formatCitations(citations);
        aggregated += `\n\n${formattedCitations}`;
        callback?.(`\n\n${formattedCitations}`);
    }

    return aggregated.trim();
  }

  private formatCitations(citations: OpenRouterUrlCitation[]): string {
      // Deduplicate citations based on URL
      const uniqueCitations = new Map<string, OpenRouterUrlCitation>();
      citations.forEach(c => {
          if (!uniqueCitations.has(c.url)) {
              uniqueCitations.set(c.url, c);
          }
      });

      const lines = Array.from(uniqueCitations.values()).map((c, idx) => {
          const title = c.title || "Web Result";
          return `\\#${idx + 1} - [${title}](${c.url})`;
      });

      return `### ONLINE_SEARCH\n${lines.join("\n")}`;
  }

  async getAvailableModels(): Promise<OpenRouterModel[]> {
    const response = await this.client.models.list();

    return response.data.map((model) => ({
      name: model.id,
      displayName: model.id, // OpenRouter models usually have good IDs, or we could use model.name if available
    }));
  }
}
