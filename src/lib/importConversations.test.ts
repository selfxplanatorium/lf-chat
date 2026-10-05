import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Message } from '../types';

const message = (id: string): Message => ({ id, role: 'user', content: id, timestamp: 1 });

test('backup import uses complete server history, deduplicates and propagates write failures', async t => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  t.after(() => { Reflect.deleteProperty(globalThis, 'localStorage'); });
  const { importConversations } = await import('./importConversations');
  const saved = Array.from({ length: 25 }, (_, index) => message(String(index)));
  const writes: { messages: Message[]; title: string }[] = [];
  let failWrites = false;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    if (options.method === 'PUT') {
      if (failWrites) return Response.json({ error: 'Generation in progress' }, { status: 409 });
      writes.push(JSON.parse(options.body as string));
      return Response.json({ success: true });
    }
    if (url.includes('/messages?')) return Response.json({ messages: saved, total: saved.length });
    return Response.json([{ id: 'existing', title: 'Server title', isUntitled: false, messages: [], messageCount: saved.length }]);
  });
  await importConversations([{ id: 'existing', title: 'Backup', messages: [message('24'), message('added'), message('added')] }]);
  assert.deepEqual(writes[0].messages.map(message => message.id), [...saved.map(message => message.id), 'added']);
  assert.equal(writes[0].title, 'Backup');
  failWrites = true;
  await assert.rejects(importConversations([{ id: 'existing', messages: [message('another')] }]), /Generation in progress/);
  await assert.rejects(importConversations([{ id: 'invalid', messages: [{}] }]), /Invalid conversation backup/);
});

test('a create conflict merges with server history instead of replacing it', async t => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  t.after(() => { Reflect.deleteProperty(globalThis, 'localStorage'); });
  const { importConversations } = await import('./importConversations');
  let lists = 0;
  let written: Message[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    if (options.method === 'POST') return Response.json({ error: 'Conversation already exists' }, { status: 409 });
    if (options.method === 'PUT') {
      written = JSON.parse(options.body as string).messages;
      return Response.json({ success: true });
    }
    if (url.includes('/messages?')) return Response.json({ messages: [message('server')], total: 1 });
    return Response.json(lists++ === 0 ? [] : [{ id: 'c', title: 'Title', isUntitled: false, messages: [] }]);
  });
  await importConversations([{ id: 'c', messages: [message('backup')] }]);
  assert.deepEqual(written.map(message => message.id), ['server', 'backup']);
});
