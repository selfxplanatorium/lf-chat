import type { Conversation } from '../types';
import type { ConversationData } from '../services/apiClient';
import type { StreamEvent } from '../services/streamClient';

export function normalizeConversation(data: ConversationData): Conversation {
  return {
    ...data,
    isUntitled: Boolean(data.isUntitled),
    messages: data.messages || [],
    streamingStatus: data.streamingStatus || null,
    streamingMessageId: data.streamingMessageId || null,
  };
}

/** Reconcile a server event with the loaded tail and any paginated history. */
export function applyStreamEvent(
  conversation: Conversation,
  event: StreamEvent,
  stoppedMessageIds: ReadonlySet<string>,
  now = Date.now(),
): Conversation {
  if (conversation.id !== event.conversationId) return conversation;
  if (event.type === 'snapshot' && event.conversation) {
    const snapshot = event.conversation;
    const count = event.messageCount ?? snapshot.messageCount ?? snapshot.messages.length;
    const snapshotIds = new Set(snapshot.messages.map(message => message.id));
    const tailStart = conversation.messages.findIndex(message => snapshotIds.has(message.id));
    // Only messages before an overlapping tail are proven older. Unmatched
    // messages after it can be obsolete replies removed by an edit/retry.
    const older = tailStart < 0 ? [] : conversation.messages.slice(0, tailStart);
    const maxOlder = Math.max(0, count - snapshot.messages.length);
    const keptOlder = older.slice(Math.max(0, older.length - maxOlder));
    const stopped = !!snapshot.streamingMessageId && stoppedMessageIds.has(snapshot.streamingMessageId);
    return {
      ...conversation,
      ...normalizeConversation(snapshot),
      messages: [...keptOlder, ...snapshot.messages.map(message =>
        stopped && message.id === snapshot.streamingMessageId ? { ...message, isStopped: true } : message
      )],
      messageCount: count,
      streamingStatus: stopped ? null : snapshot.streamingStatus || null,
      streamingMessageId: stopped ? null : snapshot.streamingMessageId || null,
    };
  }

  if (event.messageId && stoppedMessageIds.has(event.messageId)) return conversation;
  if (event.type === 'delta' && event.messageId && event.content !== undefined) {
    return {
      ...conversation,
      messages: conversation.messages.map(message => message.id === event.messageId
        ? { ...message, content: event.content!.length >= message.content.length ? event.content! : message.content }
        : message),
      updatedAt: now,
      streamingStatus: 'streaming',
      streamingMessageId: event.messageId,
    };
  }

  if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
    return {
      ...conversation,
      streamingStatus: event.type === 'failed' ? 'failed' : null,
      streamingMessageId: null,
      updatedAt: now,
      messages: conversation.messages.map(message => {
        if (message.id !== event.messageId) return message;
        if (event.type === 'failed') return { ...message, role: 'error', content: event.error ?? message.content };
        if (event.type === 'cancelled') return { ...message, isStopped: true };
        return message;
      }),
    };
  }
  return conversation;
}
