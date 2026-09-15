export type ThemeMode = 'light' | 'dark';
export type ThemePreset = 'default' | 'cream' | 'sky' | 'midnight' | 'forest';
export type StreamingStatus = 'queued' | 'streaming' | 'completed' | 'failed' | 'interrupted' | 'cancelled' | null;

export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: number;
  isStopped?: boolean;
};

export type Conversation = {
  id: string;
  title: string;
  isUntitled: boolean;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  parentConversationId?: string;
  pinned?: boolean;
  streamingStatus: StreamingStatus;
  streamingMessageId: string | null;
  messageCount?: number;
};

export type StreamingState = {
  conversationId: string;
  messageId: string;
  buffer: string;
};
