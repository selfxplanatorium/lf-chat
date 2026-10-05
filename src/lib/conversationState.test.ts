import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStreamEvent } from './conversationState';
import type { Conversation, Message } from '../types';

const message = (id: string, content = id): Message => ({ id, content, role: 'assistant', timestamp: 1 });
const conversation: Conversation = {
  id: 'c', title: 'Title', isUntitled: false, messages: ['a', 'b', 'c', 'd'].map(id => message(id)),
  createdAt: 1, updatedAt: 1, streamingStatus: 'streaming', streamingMessageId: 'd',
};

test('snapshots preserve paginated history and reconcile retry truncation', () => {
  const snapshot = { ...conversation, messages: [message('c'), message('d', 'latest')], messageCount: 4 };
  const merged = applyStreamEvent(conversation, { type: 'snapshot', conversationId: 'c', conversation: snapshot }, new Set());
  assert.deepEqual(merged.messages.map(message => message.id), ['a', 'b', 'c', 'd']);
  assert.equal(merged.messages.at(-1)?.content, 'latest');
  const truncated = applyStreamEvent(merged, { type: 'snapshot', conversationId: 'c', conversation: {
    ...snapshot, messages: [message('a'), message('retry')], messageCount: 2,
  } }, new Set());
  assert.deepEqual(truncated.messages.map(message => message.id), ['a', 'retry']);
});

test('stopped messages stay stopped on reconnect and late deltas', () => {
  const stopped = new Set(['d']);
  const snapshot = applyStreamEvent(conversation, { type: 'snapshot', conversationId: 'c', conversation }, stopped);
  assert.equal(snapshot.streamingStatus, null);
  assert.equal(snapshot.messages.at(-1)?.isStopped, true);
  assert.equal(applyStreamEvent(snapshot, { type: 'delta', conversationId: 'c', messageId: 'd', content: 'late' }, stopped), snapshot);
});

test('shorter deltas do not truncate text, and failures show the server reason', () => {
  const full = applyStreamEvent(conversation, { type: 'delta', conversationId: 'c', messageId: 'd', content: 'full response' }, new Set());
  const shorter = applyStreamEvent(full, { type: 'delta', conversationId: 'c', messageId: 'd', content: 'full' }, new Set());
  assert.equal(shorter.messages.at(-1)?.content, 'full response');
  const failed = applyStreamEvent(shorter, { type: 'failed', conversationId: 'c', messageId: 'd', error: 'Webhook failed' }, new Set());
  assert.equal(failed.messages.at(-1)?.role, 'error');
  assert.equal(failed.messages.at(-1)?.content, 'Webhook failed');
  assert.equal(failed.streamingMessageId, null);
});

test('paginated retry snapshots discard obsolete newer messages, retaining only history before the tail', () => {
  const local = { ...conversation, messages: ['a', 'b', 'c', 'old-d', 'old-e', 'old-f'].map(id => message(id)) };
  const snapshot = { ...conversation, messages: [message('c'), message('retry')], messageCount: 4 };
  const merged = applyStreamEvent(local, { type: 'snapshot', conversationId: 'c', conversation: snapshot }, new Set());
  assert.deepEqual(merged.messages.map(message => message.id), ['a', 'b', 'c', 'retry']);
});
