import { v4 as uuidv4 } from "uuid";
import Dexie, { type Table } from "dexie";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatThreadRecord {
  id: string;
  title: string;
  sourceId: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown> | null;
}

export interface ChatMessageRecord {
  id: string;
  chatId: string;
  role: ChatRole;
  content: string;
  error: boolean;
  createdAt: number;
}

class ChatDatabase extends Dexie {
  threads!: Table<ChatThreadRecord, string>;
  messages!: Table<ChatMessageRecord, string>;

  constructor() {
    super("skid-homework-chat-db");

    this.version(1).stores({
      threads: "id, updatedAt, createdAt",
      messages: "id, chatId, createdAt, [chatId+createdAt]",
    });
  }
}

export const chatDb = new ChatDatabase();

export const createId = () => {
  return uuidv4();
};
