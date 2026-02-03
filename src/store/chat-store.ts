import { create } from "zustand";
import {
  chatDb,
  createId,
  type ChatMessageRecord,
  type ChatRole,
  type ChatThreadRecord,
} from "../db/chat-db";

type MessageInput = {
  id?: string;
  role: ChatRole;
  content: string;
  createdAt?: number;
};

type CreateChatInput = {
  title: string;
  sourceId: string;
  model: string;
  metadata?: Record<string, unknown> | null;
  initialMessages?: MessageInput[];
};

interface ChatState {
  threads: ChatThreadRecord[];
  messages: Record<string, ChatMessageRecord[]>;
  isHydrated: boolean;
  loadThreads: () => Promise<void>;
  loadMessages: (chatId: string) => Promise<ChatMessageRecord[]>;
  createChat: (input: CreateChatInput) => Promise<string>;
  appendMessage: (
    chatId: string,
    input: MessageInput,
  ) => Promise<ChatMessageRecord>;
  updateMessage: (
    chatId: string,
    messageId: string,
    updates: Partial<Omit<ChatMessageRecord, "id" | "chatId">>,
  ) => Promise<ChatMessageRecord | null>;
  updateThread: (
    chatId: string,
    updates: Partial<
      Pick<
        ChatThreadRecord,
        "title" | "sourceId" | "model" | "metadata" | "updatedAt"
      >
    >,
  ) => Promise<void>;
  renameChat: (chatId: string, title: string) => Promise<void>;
  deleteChat: (chatId: string) => Promise<void>;
  clearAllChats: () => Promise<void>;
  searchChats: (query: string) => Promise<string[]>;
}

const sortThreadsByUpdated = (threads: ChatThreadRecord[]) =>
  [...threads].sort((a, b) => b.updatedAt - a.updatedAt);

const mergeMessage = (
  stateMessages: Record<string, ChatMessageRecord[]>,
  chatId: string,
  message: ChatMessageRecord,
) => {
  const existing = stateMessages[chatId] ?? [];
  const nextMessages = [
    ...existing.filter((m) => m.id !== message.id),
    message,
  ];
  nextMessages.sort((a, b) => a.createdAt - b.createdAt);
  return {
    ...stateMessages,
    [chatId]: nextMessages,
  };
};

export const useChatStore = create<ChatState>((set) => ({
  threads: [],
  messages: {},
  isHydrated: false,

  loadThreads: async () => {
    const threads = await chatDb.threads
      .orderBy("updatedAt")
      .reverse()
      .toArray();
    set(() => {
      return {
        threads,
        isHydrated: true,
      };
    });
  },

  loadMessages: async (chatId) => {
    const messages = await chatDb.messages
      .where("chatId")
      .equals(chatId)
      .sortBy("createdAt");
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: messages,
      },
    }));
    return messages;
  },

  createChat: async ({ title, sourceId, model, metadata, initialMessages }) => {
    const now = Date.now();
    const chatId = createId();
    const thread: ChatThreadRecord = {
      id: chatId,
      title,
      sourceId,
      model,
      createdAt: now,
      updatedAt: now,
      metadata: metadata ?? null,
    };

    const preparedMessages: ChatMessageRecord[] =
      initialMessages?.map((message) => ({
        id: message.id ?? createId(),
        chatId,
        role: message.role,
        content: message.content,
        error: false,
        createdAt: message.createdAt ?? Date.now(),
      })) ?? [];

    await chatDb.transaction(
      "rw",
      chatDb.threads,
      chatDb.messages,
      async () => {
        await chatDb.threads.add(thread);
        if (preparedMessages.length) {
          await chatDb.messages.bulkAdd(preparedMessages);
        }
      },
    );

    set((state) => ({
      threads: sortThreadsByUpdated([thread, ...state.threads]),
      messages: preparedMessages.length
        ? {
            ...state.messages,
            [chatId]: [...preparedMessages].sort(
              (a, b) => a.createdAt - b.createdAt,
            ),
          }
        : state.messages,
    }));

    return chatId;
  },

  appendMessage: async (chatId, input) => {
    const message: ChatMessageRecord = {
      id: input.id ?? createId(),
      chatId,
      role: input.role,
      content: input.content,
      error: false,
      createdAt: input.createdAt ?? Date.now(),
    };

    await chatDb.transaction(
      "rw",
      chatDb.threads,
      chatDb.messages,
      async () => {
        await chatDb.messages.put(message);
        await chatDb.threads.update(chatId, { updatedAt: message.createdAt });
      },
    );

    set((state) => {
      const nextThreads = sortThreadsByUpdated(
        state.threads.map((thread) =>
          thread.id === chatId
            ? { ...thread, updatedAt: message.createdAt }
            : thread,
        ),
      );
      return {
        threads: nextThreads,
        messages: mergeMessage(state.messages, chatId, message),
      };
    });

    return message;
  },

  updateMessage: async (chatId, messageId, updates) => {
    await chatDb.messages.update(messageId, updates);
    const updated = await chatDb.messages.get(messageId);
    if (!updated) {
      return null;
    }

    if (updates.createdAt) {
      await chatDb.threads.update(chatId, { updatedAt: updates.createdAt });
    }

    set((state) => {
      const nextThreads = updates.createdAt
        ? sortThreadsByUpdated(
            state.threads.map((thread) =>
              thread.id === chatId
                ? {
                    ...thread,
                    updatedAt: updates.createdAt ?? thread.updatedAt,
                  }
                : thread,
            ),
          )
        : state.threads;

      const currentMessages = state.messages[chatId] ?? [];
      const nextMessages = currentMessages.map((message) =>
        message.id === messageId ? updated : message,
      );
      nextMessages.sort((a, b) => a.createdAt - b.createdAt);

      return {
        threads: nextThreads,
        messages: {
          ...state.messages,
          [chatId]: nextMessages,
        },
      };
    });

    return updated;
  },

  updateThread: async (chatId, updates) => {
    await chatDb.threads.update(chatId, updates);
    set((state) => {
      const nextThreads = state.threads.map((thread) =>
        thread.id === chatId ? { ...thread, ...updates } : thread,
      );
      if (Object.prototype.hasOwnProperty.call(updates, "updatedAt")) {
        return {
          threads: sortThreadsByUpdated(nextThreads),
        };
      }
      return {
        threads: nextThreads,
      };
    });
  },

  renameChat: async (chatId, title) => {
    const timestamp = Date.now();
    await chatDb.threads.update(chatId, { title, updatedAt: timestamp });
    set((state) => ({
      threads: sortThreadsByUpdated(
        state.threads.map((thread) =>
          thread.id === chatId
            ? { ...thread, title, updatedAt: timestamp }
            : thread,
        ),
      ),
    }));
  },

  deleteChat: async (chatId) => {
    await chatDb.transaction(
      "rw",
      chatDb.threads,
      chatDb.messages,
      async () => {
        await chatDb.messages.where("chatId").equals(chatId).delete();
        await chatDb.threads.delete(chatId);
      },
    );

    set((state) => {
      const nextThreads = state.threads.filter(
        (thread) => thread.id !== chatId,
      );
      const { ...restMessages } = state.messages;
      return {
        threads: nextThreads,
        messages: restMessages,
      };
    });
  },

  clearAllChats: async () => {
    await chatDb.transaction(
      "rw",
      chatDb.threads,
      chatDb.messages,
      async () => {
        await chatDb.messages.clear();
        await chatDb.threads.clear();
      },
    );

    set({
      threads: [],
      messages: {},
      isHydrated: true,
    });
  },

  searchChats: async (query: string) => {
    if (!query || query.trim().length === 0) return [];
    const lowerQuery = query.toLowerCase();

    // 1. Search in Thread Titles
    const matchingThreadIds = new Set<string>();
    const allThreads = await chatDb.threads.toArray();
    allThreads.forEach((t) => {
      if (t.title.toLowerCase().includes(lowerQuery)) {
        matchingThreadIds.add(t.id);
      }
    });

    // 2. Search in Messages content
    // Note: This filters all messages. For very large DBs, full-text indexing is recommended.
    const matchingMessages = await chatDb.messages
      .filter((m) => m.content.toLowerCase().includes(lowerQuery))
      .toArray();

    matchingMessages.forEach((m) => matchingThreadIds.add(m.chatId));

    return Array.from(matchingThreadIds);
  },
}));
