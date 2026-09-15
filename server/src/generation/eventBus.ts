import { Response } from 'express';

export type GenerationEventType =
  | 'started'
  | 'delta'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'snapshot';

export interface GenerationEvent {
  type: GenerationEventType;
  conversationId: string;
  messageId?: string;
  content?: string;
  createdAt?: number;
  error?: string;
  conversation?: any;
}

type Subscriber = (event: GenerationEvent) => void;

class EventBus {
  private subscribers = new Map<string, Set<Subscriber>>();

  subscribe(conversationId: string, subscriber: Subscriber): () => void {
    if (!this.subscribers.has(conversationId)) {
      this.subscribers.set(conversationId, new Set());
    }
    this.subscribers.get(conversationId)!.add(subscriber);

    return () => {
      const set = this.subscribers.get(conversationId);
      if (set) {
        set.delete(subscriber);
        if (set.size === 0) {
          this.subscribers.delete(conversationId);
        }
      }
    };
  }

  emit(conversationId: string, event: GenerationEvent): void {
    const set = this.subscribers.get(conversationId);
    if (set) {
      for (const sub of set) {
        try {
          sub(event);
        } catch {
          set.delete(sub);
        }
      }
    }
  }

  subscriberCount(conversationId: string): number {
    return this.subscribers.get(conversationId)?.size ?? 0;
  }

  getAllSubscriberCounts(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [id, set] of this.subscribers) {
      result[id] = set.size;
    }
    return result;
  }

  activeConversationIds(): string[] {
    return Array.from(this.subscribers.keys());
  }
}

export const eventBus = new EventBus();