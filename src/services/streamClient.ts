import { apiRequest } from './apiClient';
import { Conversation, Message } from '../types';

export type StreamEventType = 'started' | 'delta' | 'completed' | 'failed' | 'cancelled' | 'snapshot';

export interface StreamEvent {
  type: StreamEventType;
  conversationId: string;
  messageId?: string;
  content?: string;
  createdAt?: number;
  error?: string;
  messageCount?: number;
  conversation?: {
    id: string;
    title: string;
    isUntitled: boolean;
    messages: Message[];
    createdAt: number;
    updatedAt: number;
    pinned?: boolean;
    parentConversationId?: string;
    streamingStatus: string | null;
    streamingMessageId: string | null;
    messageCount?: number;
  };
}

export type StreamEventHandler = (event: StreamEvent) => void;

export interface SubscribeOptions {
  messageLimit?: number;
}

class StreamClient {
  private connections = new Map<string, { es: EventSource; subscribers: Set<StreamEventHandler> }>();

  // Returns a synchronous cancel function. The EventSource is opened after
  // an async SSE-token fetch; the cancel function aborts either the pending
  // fetch or the open connection, whichever is active at call time.
  subscribe(conversationId: string, handler: StreamEventHandler, options?: SubscribeOptions): () => void {
    let cancelled = false;

    const existing = this.connections.get(conversationId);
    if (existing) {
      existing.subscribers.add(handler);
      return () => {
        const current = this.connections.get(conversationId);
        if (!current) return;
        current.subscribers.delete(handler);
        if (current.subscribers.size === 0) {
          current.es.close();
          this.connections.delete(conversationId);
        }
      };
    }

    // Placeholder entry so concurrent subscribe() calls reuse this connection.
    const subscribers: Set<StreamEventHandler> = new Set([handler]);
    // We'll fill in `es` once the token arrives; use a dummy until then.
    const placeholder = { es: null as unknown as EventSource, subscribers };
    this.connections.set(conversationId, placeholder);

    apiRequest<{ token: string }>('/auth/sse-token', { method: 'POST' }).then((data) => {
      if (cancelled) return;

      let url = `/api/conversations/${conversationId}/events?token=${encodeURIComponent(data.token)}`;
      if (options?.messageLimit) {
        url += `&messageLimit=${options.messageLimit}`;
      }
      const es = new EventSource(url);

      // Promote placeholder to real entry.
      placeholder.es = es;

      const dispatch = (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data);
          for (const sub of subscribers) sub(parsed);
        } catch {}
      };

      es.addEventListener('open', () => {
        console.debug('[SSE] connected', { conversationId });
      });
      es.addEventListener('snapshot', dispatch);
      es.addEventListener('started', dispatch);
      es.addEventListener('delta', dispatch);
      es.addEventListener('completed', dispatch);
      es.addEventListener('failed', dispatch);
      es.addEventListener('cancelled', dispatch);

      es.onerror = () => {
        console.debug('[SSE] connection error (auto-reconnecting)', {
          conversationId,
          readyState: es.readyState,
        });
      };
    }).catch(() => {
      // Token fetch failed — remove placeholder so a retry can open a fresh connection.
      if (this.connections.get(conversationId) === placeholder) {
        this.connections.delete(conversationId);
      }
      console.debug('[SSE] failed to obtain SSE token', { conversationId });
    });

    return () => {
      cancelled = true;
      const current = this.connections.get(conversationId);
      if (!current) return;
      current.subscribers.delete(handler);
      if (current.subscribers.size === 0) {
        if (current.es) current.es.close();
        this.connections.delete(conversationId);
      }
    };
  }

  close(conversationId: string): void {
    const entry = this.connections.get(conversationId);
    if (entry) {
      if (entry.es) entry.es.close();
      this.connections.delete(conversationId);
    }
  }
}

export const streamClient = new StreamClient();
