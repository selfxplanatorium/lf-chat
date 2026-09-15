import crypto from 'crypto';
import db from '../db';
import { log, incrementCounter } from './log';
import { eventBus } from './eventBus';
import { writeSnapshot, clearSnapshotState, flushPendingSnapshot } from './snapshot';
import { runGeneration, RunGenerationParams } from './runner';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: number;
  isStopped?: boolean;
}

const GENERATION_TIMEOUT_MS = parseInt(process.env.GENERATION_TIMEOUT_MS || '600000', 10);

interface RunningGeneration {
  conversationId: string;
  userId: string;
  assistantMessageId: string;
  idempotencyKey: string;
  abort: AbortController;
  startedAt: number;
}

class GenerationManager {
  private active = new Map<string, RunningGeneration>();

  start(
    conversationId: string,
    userId: string,
    userContent: string,
    idempotencyKey: string
  ): { assistantMessageId: string; userMessageId: string | null; alreadyRunning: boolean } {
    const existing = this.active.get(conversationId);
    if (existing) {
      if (existing.idempotencyKey === idempotencyKey) {
        return { assistantMessageId: existing.assistantMessageId, userMessageId: null, alreadyRunning: true };
      }
      throw Object.assign(new Error('Generation in progress'), { statusCode: 409 });
    }

    const settingsRow = db.prepare('SELECT webhooks, active_webhook_id FROM settings WHERE user_id = ?').get(userId) as any;
    if (!settingsRow) {
      throw Object.assign(new Error('Settings not found. Please configure a webhook in Settings.'), { statusCode: 400 });
    }

    const webhooks: { id: string; name: string; url: string }[] = JSON.parse(settingsRow.webhooks);
    const activeWebhook = webhooks.find((w: any) => w.id === settingsRow.active_webhook_id);
    if (!activeWebhook) {
      throw Object.assign(new Error('No active webhook configured. Please set one in Settings.'), { statusCode: 400 });
    }

    const assistantMessageId = crypto.randomUUID();
    const now = Date.now();
    const abort = new AbortController();

    const conv = db.prepare('SELECT messages, title FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId) as any;
    if (!conv) {
      throw Object.assign(new Error('Conversation not found'), { statusCode: 404 });
    }

    const messages: Message[] = JSON.parse(conv.messages);

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userContent,
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
      const derived = plain.trim().slice(0, 30) + (plain.trim().length > 30 ? '...' : '');
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

    const fullConv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any;
    if (fullConv) {
      eventBus.emit(conversationId, {
        type: 'snapshot',
        conversationId,
        conversation: {
          id: fullConv.id,
          title: fullConv.title,
          isUntitled: !!fullConv.is_untitled,
          messages: JSON.parse(fullConv.messages),
          createdAt: fullConv.created_at,
          updatedAt: fullConv.updated_at,
          pinned: !!fullConv.pinned,
          parentConversationId: fullConv.parent_conversation_id || undefined,
          streamingStatus: fullConv.streaming_status,
          streamingMessageId: fullConv.streaming_message_id,
        },
      });
    }

    const timeout = setTimeout(() => {
      if (this.active.get(conversationId) === running) {
        abort.abort();
      }
    }, GENERATION_TIMEOUT_MS);

    const historyBefore = messages.slice(0, messages.length - 2);

    runGeneration({
      conversationId,
      assistantMessageId,
      userMessageContent: userContent,
      history: historyBefore,
      webhookUrl: activeWebhook.url,
      abortSignal: abort.signal,
      callbacks: {
        onSnapshot: (fullContent: string) => {
          const current = db.prepare('SELECT messages FROM conversations WHERE id = ?').get(conversationId) as any;
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
          clearTimeout(timeout);
          this.finish(conversationId, 'completed', assistantMessageId, userId);
        },
        onError: (error: Error) => {
          clearTimeout(timeout);
          this.finish(conversationId, 'failed', assistantMessageId, userId, error.message);
        },
      },
    }).catch(() => {
      clearTimeout(timeout);
      this.finish(conversationId, 'failed', assistantMessageId, userId, 'Internal error');
    });

    return { assistantMessageId, userMessageId: userMessage.id, alreadyRunning: false };
  }

  cancel(conversationId: string, userId: string): boolean {
    const running = this.active.get(conversationId);
    if (!running) return false;

    running.abort.abort();

    // Persist any throttled-but-unwritten tokens before reading the row back, so
    // the stopped message keeps everything generated up to the stop, not just
    // the last flushed snapshot.
    flushPendingSnapshot(conversationId);

    const conv = db.prepare('SELECT messages FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId) as any;
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
    if (!running) return;

    const durationMs = Date.now() - running.startedAt;

    if (status === 'failed') {
      const conv = db.prepare('SELECT messages FROM conversations WHERE id = ?').get(conversationId) as any;
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
    `).run(status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed', Date.now(), conversationId);

    clearSnapshotState(conversationId);
    this.active.delete(conversationId);

    const eventType = status === 'completed' ? 'completed' :
      status === 'cancelled' ? 'cancelled' : 'failed';

    eventBus.emit(conversationId, {
      type: eventType,
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

    if (status === 'completed') incrementCounter('completed');
    if (status === 'failed') incrementCounter('failed');
    if (status === 'cancelled') incrementCounter('cancelled');
  }

  isActive(conversationId: string): boolean {
    return this.active.has(conversationId);
  }

  getActive(conversationId: string): { assistantMessageId: string; idempotencyKey: string; startedAt: number } | null {
    const r = this.active.get(conversationId);
    if (!r) return null;
    return { assistantMessageId: r.assistantMessageId, idempotencyKey: r.idempotencyKey, startedAt: r.startedAt };
  }

  getAllActive(): Record<string, { assistantMessageId: string; idempotencyKey: string; startedAt: number; userId: string }> {
    const result: Record<string, any> = {};
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
