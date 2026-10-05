import { apiRequest } from './apiClient';
import type { Conversation } from '../types';

export type StreamEventType = 'started' | 'delta' | 'completed' | 'failed' | 'cancelled' | 'snapshot';

export interface StreamEvent {
  type: StreamEventType;
  conversationId: string;
  messageId?: string;
  content?: string;
  createdAt?: number;
  error?: string;
  messageCount?: number;
  conversation?: Conversation;
}

export type StreamEventHandler = (event: StreamEvent) => void;

export interface SubscribeOptions {
  messageLimit?: number;
}

interface Connection {
  es: EventSource | null;
  subscribers: Set<StreamEventHandler>;
  abort: AbortController;
}

export class StreamClient {
  private connections = new Map<string, Connection>();

  subscribe(conversationId: string, handler: StreamEventHandler, options?: SubscribeOptions): () => void {
    let entry = this.connections.get(conversationId);
    if (!entry) {
      entry = { es: null, subscribers: new Set(), abort: new AbortController() };
      this.connections.set(conversationId, entry);
      void this.open(conversationId, entry, options);
    }
    // Each subscription owns its callback, even if callers reuse a handler.
    const subscriber: StreamEventHandler = event => handler(event);
    entry.subscribers.add(subscriber);
    const connection = entry;
    return () => {
      connection.subscribers.delete(subscriber);
      if (connection.subscribers.size === 0 && this.connections.get(conversationId) === connection) {
        this.close(conversationId);
      }
    };
  }

  private async streamUrl(conversationId: string, signal: AbortSignal, options?: SubscribeOptions): Promise<string> {
    const { token } = await apiRequest<{ token: string }>('/auth/sse-token', { method: 'POST', signal });
    const params = new URLSearchParams({ token });
    if (options?.messageLimit) params.set('messageLimit', String(options.messageLimit));
    return `/api/conversations/${conversationId}/events?${params}`;
  }

  private async open(conversationId: string, entry: Connection, options?: SubscribeOptions): Promise<void> {
    try {
      const url = await this.streamUrl(conversationId, entry.abort.signal, options);
      // A closed/replaced pending subscription must never open a stray stream.
      if (this.connections.get(conversationId) !== entry) return;
      const es = new EventSource(url);
      entry.es = es;
      const dispatch = (event: MessageEvent) => {
        let parsed: StreamEvent;
        try { parsed = JSON.parse(event.data); } catch { return; }
        for (const subscriber of entry.subscribers) {
          try { subscriber(parsed); } catch (error) {
            console.error('[SSE] subscriber failed', error);
          }
        }
      };
      for (const type of ['snapshot', 'started', 'delta', 'completed', 'failed', 'cancelled']) {
        es.addEventListener(type, dispatch);
      }
      es.onerror = () => {
        console.debug('[SSE] connection error (auto-reconnecting)', { conversationId, readyState: es.readyState });
      };
    } catch {
      if (!entry.abort.signal.aborted) console.debug('[SSE] failed to open stream', { conversationId });
      if (this.connections.get(conversationId) === entry) this.close(conversationId);
    }
  }

  close(conversationId: string): void {
    const entry = this.connections.get(conversationId);
    if (!entry) return;
    this.connections.delete(conversationId);
    entry.abort.abort();
    entry.es?.close();
    entry.subscribers.clear();
  }
}

export const streamClient = new StreamClient();
