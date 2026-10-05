import { getAttachment, metadata, resolveAttachments } from '../lib/attachments';
import crypto from 'crypto';
import db from '../db';
import { log, incrementCounter } from './log';
import { eventBus } from './eventBus';
import { writeSnapshot, clearSnapshotState, flushPendingSnapshot } from './snapshot';
import { runGeneration } from './runner';
import { serializeConversation, type ConversationRow, type Message } from '../lib/conversation';
export type { Message } from '../lib/conversation';

const GENERATION_TIMEOUT_MS = parseInt(process.env.GENERATION_TIMEOUT_MS || '600000', 10);

interface RunningGeneration {
  conversationId: string;
  userId: string;
  assistantMessageId: string;
  idempotencyKey: string;
  abort: AbortController;
  startedAt: number;
  timeout?: ReturnType<typeof setTimeout>;
}

class GenerationManager {
  private active = new Map<string, RunningGeneration>();

  start(
    conversationId: string,
    userId: string,
    userContent: string,
    idempotencyKey: string,
    attachmentIds?: string[]
  ): { assistantMessageId: string; userMessageId: string | null; alreadyRunning: boolean } {
    const existing = this.active.get(conversationId);
    if (existing) {
      if (existing.idempotencyKey === idempotencyKey) {
        return { assistantMessageId: existing.assistantMessageId, userMessageId: null, alreadyRunning: true };
      }
      throw Object.assign(new Error('Generation in progress'), { statusCode: 409 });
    }

    const settingsRow = db.prepare('SELECT webhooks, active_webhook_id FROM settings WHERE user_id = ?').get(userId) as { webhooks: string; active_webhook_id: string } | undefined;
    if (!settingsRow) {
      throw Object.assign(new Error('Settings not found. Please configure a webhook in Settings.'), { statusCode: 400 });
    }

    const webhooks: { id: string; name: string; url: string }[] = JSON.parse(settingsRow.webhooks);
    const activeWebhook = webhooks.find((w) => w.id === settingsRow.active_webhook_id);
    if (!activeWebhook) {
      throw Object.assign(new Error('No active webhook configured. Please set one in Settings.'), { statusCode: 400 });
    }

    const assistantMessageId = crypto.randomUUID();
    const now = Date.now();
    const abort = new AbortController();

    const conv = db.prepare('SELECT messages, title FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId) as Pick<ConversationRow, 'messages' | 'title'> | undefined;
    if (!conv) {
      throw Object.assign(new Error('Conversation not found'), { statusCode: 404 });
    }

    const messages: Message[] = JSON.parse(conv.messages);

    const attachments = resolveAttachments(attachmentIds, userId);
    const historyFileIds = new Set(messages.flatMap(message => (message.attachments ?? []).map(file => file.id)));
    const historyAttachments = [...historyFileIds].map(id => getAttachment(id, userId));
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userContent,
      ...(attachments.length ? { attachments: attachments.map(metadata) } : {}),
      timestamp: now,
    };
    messages.push(userMessage);

    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: now,
    };
    messages.push(assistantMessage);

    // Only derive a title from the FIRST user message. For every later message
    // (and for retry/edit, which re-enter here) keep the existing title —
    // otherwise the UPDATE below silently clobbers a good title back to
    // "New Conversation".
    let newTitle = conv.title;
    if (messages.filter(m => m.role === 'user').length === 1) {
      const plain = userContent
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/_(.+?)_/g, '$1')
        .replace(/~~(.+?)~~/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^>\s+/gm, '')
        .replace(/^[-*+]\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '');
      const titleContent = plain.trim() || attachments.map(file => file.name).join(', ');
      const derived = titleContent.slice(0, 30) + (titleContent.length > 30 ? '...' : '');
      if (derived) newTitle = derived;
    }

    db.prepare(`
      UPDATE conversations SET
        messages = ?,
        title = ?,
        is_untitled = 0,
        streaming_message_id = ?,
        streaming_status = 'streaming',
        streaming_started_at = ?,
        streaming_idempotency_key = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(messages),
      newTitle,
      assistantMessageId,
      now,
      idempotencyKey,
      now,
      conversationId
    );

    const running: RunningGeneration = {
      conversationId,
      userId,
      assistantMessageId,
      idempotencyKey,
      abort,
      startedAt: now,
    };
    this.active.set(conversationId, running);

    incrementCounter('started');
    log({ event: 'start', userId, conversationId, messageId: assistantMessageId });

    eventBus.emit(conversationId, {
      type: 'started',
      conversationId,
      messageId: assistantMessageId,
      createdAt: now,
    });

    const fullConv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as ConversationRow | undefined;
    if (fullConv) {
      eventBus.emit(conversationId, {
        type: 'snapshot',
        conversationId,
        conversation: serializeConversation(fullConv),
      });
    }

    running.timeout = setTimeout(() => {
      if (this.active.get(conversationId) === running) {
        abort.abort();
        this.finish(conversationId, 'failed', assistantMessageId, userId, 'Generation timed out');
      }
    }, GENERATION_TIMEOUT_MS);

    const historyBefore = messages.slice(0, messages.length - 2);

    runGeneration({
      conversationId,
      assistantMessageId,
      userMessageContent: userContent,
      history: historyBefore,
      attachments,
      historyAttachments,
      webhookUrl: activeWebhook.url,
      abortSignal: abort.signal,
      callbacks: {
        onSnapshot: (fullContent: string) => {
          if (this.active.get(conversationId) !== running) return;
          const current = db.prepare('SELECT messages FROM conversations WHERE id = ?').get(conversationId) as Pick<ConversationRow, 'messages'> | undefined;
          if (!current) return;
          const msgs: Message[] = JSON.parse(current.messages);
          const idx = msgs.findIndex(m => m.id === assistantMessageId);
          if (idx !== -1) {
            msgs[idx] = { ...msgs[idx], content: fullContent };
          }
          const json = JSON.stringify(msgs);
          writeSnapshot(conversationId, json);
          eventBus.emit(conversationId, {
            type: 'delta',
            conversationId,
            messageId: assistantMessageId,
            content: fullContent,
          });
        },
        onComplete: () => {
          this.finish(conversationId, 'completed', assistantMessageId, userId);
        },
        onError: (error: Error) => {
          this.finish(conversationId, 'failed', assistantMessageId, userId, error.message);
        },
      },
    }).catch(() => {
      this.finish(conversationId, 'failed', assistantMessageId, userId, 'Internal error');
    });

    return { assistantMessageId, userMessageId: userMessage.id, alreadyRunning: false };
  }

  cancel(conversationId: string, userId: string): boolean {
    const running = this.active.get(conversationId);
    if (!running || running.userId !== userId) return false;

    running.abort.abort();

    // Persist any throttled-but-unwritten tokens before reading the row back, so
    // the stopped message keeps everything generated up to the stop, not just
    // the last flushed snapshot.
    flushPendingSnapshot(conversationId);

    const conv = db.prepare('SELECT messages FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId) as Pick<ConversationRow, 'messages' | 'title'> | undefined;
    if (conv) {
      const msgs: Message[] = JSON.parse(conv.messages);
      const idx = msgs.findIndex(m => m.id === running.assistantMessageId);
      if (idx !== -1) {
        msgs[idx] = { ...msgs[idx], isStopped: true };
      }
      const json = JSON.stringify(msgs);
      writeSnapshot(conversationId, json, true);
    }

    this.finish(conversationId, 'cancelled', running.assistantMessageId, userId);
    return true;
  }

  private finish(
    conversationId: string,
    status: 'completed' | 'failed' | 'cancelled',
    messageId: string,
    userId: string,
    error?: string
  ): void {
    const running = this.active.get(conversationId);
    if (!running || running.assistantMessageId !== messageId) return;

    clearTimeout(running.timeout);
    const durationMs = Date.now() - running.startedAt;

    if (status === 'failed') {
      const conv = db.prepare('SELECT messages FROM conversations WHERE id = ?').get(conversationId) as Pick<ConversationRow, 'messages'> | undefined;
      if (conv) {
        const msgs: Message[] = JSON.parse(conv.messages);
        const idx = msgs.findIndex(m => m.id === messageId);
        if (idx !== -1 && error) {
          msgs[idx] = { ...msgs[idx], role: 'error', content: error };
        }
        const json = JSON.stringify(msgs);
        writeSnapshot(conversationId, json, true);
      }
    }

    // Note: 'completed' deliberately does NOT re-read and re-write here. The
    // final full content already lives in the throttled snapshot's pending
    // buffer; clearSnapshotState() below flushes it. Re-reading the DB row here
    // would pull a stale (mid-stream) snapshot and clobber the pending buffer,
    // truncating the saved message.

    db.prepare(`
      UPDATE conversations SET
        streaming_message_id = NULL,
        streaming_status = ?,
        streaming_started_at = NULL,
        streaming_idempotency_key = NULL,
        updated_at = ?
      WHERE id = ?
    `).run(status, Date.now(), conversationId);

    clearSnapshotState(conversationId);
    this.active.delete(conversationId);

    eventBus.emit(conversationId, {
      type: status,
      conversationId,
      messageId,
      error,
    });

    log({
      event: status === 'completed' ? 'complete' : status === 'cancelled' ? 'cancel' : 'fail',
      userId,
      conversationId,
      messageId,
      durationMs,
      error,
    });

    incrementCounter(status);
  }

  isActive(conversationId: string): boolean {
    return this.active.has(conversationId);
  }

  getAllActive(): Record<string, { assistantMessageId: string; idempotencyKey: string; startedAt: number; userId: string }> {
    const result: ReturnType<GenerationManager['getAllActive']> = {};
    for (const [id, r] of this.active) {
      result[id] = {
        assistantMessageId: r.assistantMessageId,
        idempotencyKey: r.idempotencyKey,
        startedAt: r.startedAt,
        userId: r.userId,
      };
    }
    return result;
  }
}

export const generationManager = new GenerationManager();
