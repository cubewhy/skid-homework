import OpenAI from "openai";
import type {ChatCompletionMessageParam} from "openai/resources/chat/completions";
import type {AiChatMessage} from "./chat-types";
import { base64ToUtf8 } from "@/utils/encoding";

export type OpenAiModel = {
    name: string;
    displayName: string;
};

const DEFAULT_OPENAI_ROOT = "https://api.openai.com/v1";

function normalizeBaseUrl(baseUrl?: string) {
    return (baseUrl ?? DEFAULT_OPENAI_ROOT).replace(/\/$/, "");
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
     * Sends a request with an image.
     */
    async sendMedia(
        media: string,
        mimeType: string,
        prompt?: string,
        model = "gpt-4o",
        callback?: (text: string) => void,
        options?: { onlineSearch?: boolean },
    ) {
        const messages = [];

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
            type: "input_file" | "input_text" | "input_image";
            filename?: string;
            file_data?: string;
            text?: string;
            image_url?: string;
        }
        > = [];

        if (prompt) {
            contentParts.push({
                type: "input_text",
                text: prompt,
            });
        }

        if (mimeType.startsWith("image/")) {
            contentParts.push({
                type: "input_image",
                image_url: `data:${mimeType};base64,${media}`
            });
        } else {
            try {
                const text = base64ToUtf8(media);
                contentParts.push({
                    type: "input_text",
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

        return this._executeResponsesStream(model, messages, callback, options);
    }

    /**
     * Sends a standard text-only chat request.
     */
    async sendChat(
        messages: AiChatMessage[],
        model = "gpt-4o",
        callback?: (text: string) => void
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

    /**
     * Streaming helper using the Responses API to support web search.
     */
    private async _executeResponsesStream(
        model: string,
        messages,
        callback?: (text: string) => void,
        options?: { onlineSearch?: boolean },
    ): Promise<string> {
        // Choose the correct web search tool name for the model family.
        const toolType = model.includes("4.1") || model.includes("4o") ? "web_search_preview" : "web_search";

        const toolsUsed = options?.onlineSearch ? [{type: toolType}] : undefined;
        // The Responses API streams Server-Sent Events; iterate over them.
        let stream: AsyncIterable<unknown>;

        try {
            stream = (await this.client.responses.create({
                model,
                tools: toolsUsed,
                stream: true,
                input: messages
            })) as AsyncIterable<unknown>;
        } catch (err) {
            const message = (err as Error)?.message ?? "";
            // Graceful fallback: if the model rejects web search, retry without it.
            const notSupported =
                message.includes("not supported") ||
                message.includes("web search options not supported") ||
                message.includes("Web search options not supported");
            if (options?.onlineSearch && notSupported) {
                console.warn(
                    `Web search not supported for model ${model}; falling back without search.`,
                );
                return this._executeResponsesStream(model, messages, callback, {
                    onlineSearch: false,
                });
            }
            throw err;
        }
        let aggregated = "";

        // Iterate over the Server-Sent Events
        for await (const event of stream) {
            // type: 'response.output_text.delta'
            // delta: 'text'
            if (event.type === 'response.output_text.delta') {
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
