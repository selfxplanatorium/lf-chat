import type { FileAttachment } from './attachments';
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: number;
  isStopped?: boolean;
  attachments?: FileAttachment[];
}

export type StreamingStatus = 'queued' | 'streaming' | 'completed' | 'failed' | 'interrupted' | 'cancelled' | null;

export interface ConversationRow {
  id: string;
  title: string;
  is_untitled: number;
  messages: string;
  created_at: number;
  updated_at: number;
  pinned: number;
  parent_conversation_id: string | null;
  streaming_status: StreamingStatus;
  streaming_message_id: string | null;
}

export interface ConversationData {
  id: string;
  title: string;
  isUntitled: boolean;
  messages: Message[];
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  parentConversationId?: string;
  streamingStatus: StreamingStatus;
  streamingMessageId: string | null;
}

// A summary query supplies the count without reading message bodies from SQLite.
export function serializeConversation(
  row: Omit<ConversationRow, 'messages'> & { messages?: string; message_count?: number },
  messageLimit?: number,
  parsedMessages?: Message[],
): ConversationData {
  const allMessages = parsedMessages ?? (row.messages ? JSON.parse(row.messages) as Message[] : []);
  return {
    id: row.id,
    title: row.title,
    isUntitled: !!row.is_untitled,
    messages: messageLimit ? allMessages.slice(-messageLimit) : allMessages,
    messageCount: row.message_count ?? allMessages.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinned: !!row.pinned,
    parentConversationId: row.parent_conversation_id || undefined,
    streamingStatus: row.streaming_status || null,
    streamingMessageId: row.streaming_message_id || null,
  };
}
