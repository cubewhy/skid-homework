import type { AiChatMessage } from "./chat-types";

export abstract class BaseAiClient {
  protected systemPrompts: string[] = [];
  protected toolPrompts: string[] = [];

  addSystemPrompt(prompt: string) {
    this.systemPrompts?.push(prompt);
  }

  setAvailableTools(prompts: string[]) {
    this.toolPrompts = prompts;
  }

  protected buildSystemPrompt(): string {
    let prompt = this.systemPrompts.join("\n\n");

    if (this.toolPrompts.length > 0) {
      prompt += "\n## Available Tools\n\n";
      prompt += this.toolPrompts.join("\n\n");
    }

    return prompt;
  }

  protected async handleStreamResponse(
    stream: AsyncIterable<{ text?: string }>,
    callback?: (text: string) => void,
  ): Promise<string> {
    let result = "";

    for await (const chunk of stream) {
      const text = chunk.text || "";
      if (text) {
        result += text;
        callback?.(text);
      }
    }

    return result.trim();
  }

  protected logAiQuery(model: string, messages: AiChatMessage[]) {
    console.log(
      `AI Query with ${model}\nSystem prompt:`,
      this.systemPrompts,
      "\nUser query:",
      messages,
    );
  }

  abstract sendMedia(
    media: string,
    mimeType: string,
    prompt?: string,
    model?: string,
    callback?: (text: string) => void,
  ): Promise<string>;

  abstract sendChat(
    messages: AiChatMessage[],
    model?: string,
    callback?: (text: string) => void,
  ): Promise<string>;

  abstract getAvailableModels(): Promise<Array<{ name: string; displayName: string }>>;
}