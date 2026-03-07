import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { AiChatMessage } from "./chat-types";
import { BaseAiClient } from "./base-client";
import { base64Decoder } from "@/utils/encoding";
import { toast } from "sonner";
import i18n from "@/i18n";
import type { AiFile } from "@/store/ai-store";
import { NonRetryableError } from "./errors";

export type OpenAiModel = {
  name: string;
  displayName: string;
};

export interface ResponseInputTextContent {
  type: "input_text";
  text: string;
}

export interface ResponseInputImageContent {
  type: "input_image";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

export interface ResponseInputFileContent {
  type: "input_file";
  filename?: string;
  file_data: string;
}

export type ResponseApiContentPart =
  | ResponseInputTextContent
  | ResponseInputImageContent
  | ResponseInputFileContent;

export interface ResponseApiMessage {
  role: "system" | "user" | "assistant";
  content: string | ResponseApiContentPart[];
}

const DEFAULT_OPENAI_ROOT = "https://api.openai.com/v1";

function normalizeBaseUrl(baseUrl?: string) {
  return (baseUrl ?? DEFAULT_OPENAI_ROOT).replace(/\/$/, "");
}

export class OpenAiClient extends BaseAiClient {
  private client: OpenAI;
  private useResponsesApi: boolean;
  private webSearchToolType?: string;

  constructor(
    apiKey: string,
    baseUrl?: string,
    useResponsesApi = true,
    webSearchToolType?: string
  ) {
    super();
    // Preserve legacy behavior for existing sources that may pass `undefined`
    // while keeping `true` as the default for new callers.
    this.useResponsesApi = useResponsesApi ?? false;
    this.webSearchToolType = webSearchToolType;
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
    file: AiFile,
    prompt?: string,
    model = "gpt-5.2",
    callback?: (text: string) => void,
    options?: { onlineSearch?: boolean }
  ) {
    if (!this.useResponsesApi) {
      if (options?.onlineSearch) {
        toast.error(
          i18n.t("ai-client.openai.requires-responses-api-online-search", {
            ns: "commons",
          })
        );
        throw new NonRetryableError(
          "Online search requires Responses API to be enabled."
        );
      }
      if (file.mimeType === "application/pdf") {
        toast.error(
          i18n.t("ai-client.openai.requires-responses-api-pdf", {
            ns: "commons",
          })
        );
        throw new NonRetryableError(
          "PDF processing requires Responses API to be enabled."
        );
      }
      return this._sendMediaLegacy(file, prompt, model, callback);
    }

    return this._sendMediaResponsesApi(file, prompt, model, callback, options);
  }

  private async _sendMediaLegacy(
    file: AiFile,
    prompt?: string,
    model = "gpt-5.2",
    callback?: (text: string) => void
  ) {
    const { data: media, mimeType, name } = file;
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
        } catch {
          text = await base64Decoder(media, "utf-8");
        }
        contentParts.push({
          type: "text",
          text: `\n\n[File Content: ${name}]\n${text}\n\n`,
        });
      } catch (e) {
        throw new Error(
          "Failed to decode base64 text: " +
            (e instanceof Error ? e.message : String(e))
        );
      }
    }

    messages.push({
      role: "user",
      content: contentParts,
    });

    return this._executeStream(model, messages, callback);
  }

  private async _sendMediaResponsesApi(
    file: AiFile,
    prompt?: string,
    model = "gpt-5.2",
    callback?: (text: string) => void,
    options?: { onlineSearch?: boolean }
  ) {
    const { data: media, mimeType, name } = file;
    const messages: ResponseApiMessage[] = [];

    if (this.systemPrompts.length > 0) {
      messages.push({
        role: "system",
        content: this.buildSystemPrompt(),
      });
    }

    const contentParts: ResponseApiContentPart[] = [];

    if (prompt) {
      contentParts.push({
        type: "input_text",
        text: prompt,
      });
    }

    if (mimeType.startsWith("image/")) {
      contentParts.push({
        type: "input_image",
        image_url: {
          url: `data:${mimeType};base64,${media}`,
        },
      });
    } else {
      contentParts.push({
        type: "input_file",
        filename: name,
        file_data: media,
      });
    }

    messages.push({
      role: "user",
      content: contentParts,
    });

    return this._executeResponsesStream(model, messages, callback, options);
  }

  /**
   * Sends a standard text-only chat request.
   */
  async sendChat(
    messages: AiChatMessage[],
    model = "gpt-5.2",
    callback?: (text: string) => void,
    options?: { onlineSearch?: boolean }
  ) {
    if (!this.useResponsesApi && options?.onlineSearch) {
      toast.error(
        i18n.t("ai-client.openai.requires-responses-api-online-search", {
          ns: "commons",
        })
      );
      throw new NonRetryableError(
        "Online search requires Responses API to be enabled."
      );
    }

    if (this.useResponsesApi) {
      return this._sendChatResponsesApi(messages, model, callback, options);
    }
    return this._sendChatLegacy(messages, model, callback);
  }

  private async _sendChatLegacy(
    messages: AiChatMessage[],
    model: string,
    callback?: (text: string) => void
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

  private async _sendChatResponsesApi(
    messages: AiChatMessage[],
    model: string,
    callback?: (text: string) => void,
    options?: { onlineSearch?: boolean }
  ) {
    const openAiMessages: ResponseApiMessage[] = [];

    if (this.systemPrompts.length > 0) {
      const systemPrompt = this.buildSystemPrompt();
      openAiMessages.push({
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }],
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
        content: [{ type: "input_text", text: trimmed }],
      });
    }

    return this._executeResponsesStream(
      model,
      openAiMessages,
      callback,
      options
    );
  }

  private async _executeStream(
    model: string,
    messages: ChatCompletionMessageParam[],
    callback?: (text: string) => void
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

  private getWebSearchToolType(model: string): string {
    if (this.webSearchToolType) {
      return this.webSearchToolType;
    }
    // if webSearchToolType is not explicitly set, determine based on model name
    // For older models, the tool type is "web_search_preview". For newer ones it's "web_search".
    // This is based on observed behavior and may need to be updated as OpenAI releases new models.
    return model.includes("4.1") || model.includes("4o")
      ? "web_search_preview"
      : "web_search";
  }

  /**
   * Streaming helper using the Responses API to support web search.
   */
  private async _executeResponsesStream(
    model: string,
    messages: ResponseApiMessage[],
    callback?: (text: string) => void,
    options?: { onlineSearch?: boolean }
  ): Promise<string> {
    const toolType = this.getWebSearchToolType(model);

    const toolsUsed = options?.onlineSearch ? [{ type: toolType }] : undefined;
    let stream: AsyncIterable<{ type: string; delta?: string }>;

    try {
      const responsesApi = (
        this.client as unknown as {
          responses: {
            create: (
              opts: unknown
            ) => Promise<AsyncIterable<{ type: string; delta?: string }>>;
          };
        }
      ).responses;
      stream = await responsesApi.create({
        model,
        tools: toolsUsed,
        stream: true,
        input: messages,
      });
    } catch (err) {
      const message = (err as Error)?.message ?? "";
      const notSupported =
        message.includes("not supported") ||
        message.includes("web search options not supported") ||
        message.includes("Web search options not supported");
      if (options?.onlineSearch && notSupported) {
        console.warn(
          `Web search not supported for model ${model}; retrying Responses API without search tools.`
        );
        toast.warning(
          i18n.t("ai-client.openai.web-search-not-supported", {
            ns: "commons",
            model,
          })
        );
        return this._executeResponsesStream(model, messages, callback, {
          onlineSearch: false,
        });
      }
      throw err;
    }
    let aggregated = "";

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        const delta = event.delta;

        if (delta) {
          aggregated += delta;
          callback?.(delta);
        }
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
