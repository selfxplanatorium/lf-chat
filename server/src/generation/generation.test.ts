import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConversationRow, Message } from '../lib/conversation';

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

test('generation persists completion/cancellation/failure and releases timed-out runs', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'lfchat-generation-'));
  process.env.DATA_DIR = directory;
  process.env.GENERATION_TIMEOUT_MS = '500';
  process.env.STREAM_STALL_TIMEOUT_MS = '1000';
  const { default: db } = await import('../db');
  const { generationManager: manager } = await import('./manager');
  const { writeSnapshot, clearSnapshotState, getSnapshotState } = await import('./snapshot');
  const { eventBus } = await import('./eventBus');
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

  db.prepare("INSERT INTO users (id, email, password_hash, name, created_at) VALUES ('u', 'u@example.test', '', 'User', 1)").run();
  db.prepare("INSERT INTO settings (user_id, webhooks, active_webhook_id) VALUES ('u', ?, 'w')")
    .run(JSON.stringify([{ id: 'w', name: 'Test', url: 'https://8.8.8.8/webhook' }]));
  const create = (id: string) => db.prepare("INSERT INTO conversations (id, user_id, title, messages, created_at, updated_at) VALUES (?, 'u', 'Title', '[]', 1, 1)").run(id);
  const row = (id: string) => db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow;
  const messages = (id: string): Message[] => JSON.parse(row(id).messages);
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const bodies: unknown[] = [];
  t.mock.method(globalThis, 'fetch', (_url: string, options: RequestInit) => {
    bodies.push(JSON.parse(options.body as string));
    return Promise.resolve(new Response(new ReadableStream({ start(controller) { streams.push(controller); } }), {
      headers: { 'Content-Type': 'text/event-stream' },
    }));
  });
  const encoder = new TextEncoder();

  create('complete');
  const first = manager.start('complete', 'u', 'Hello', 'key');
  assert.equal(manager.start('complete', 'u', 'Hello', 'key').alreadyRunning, true);
  assert.throws(() => manager.start('complete', 'u', 'Again', 'other'), /Generation in progress/);
  await tick();
  streams[0].enqueue(encoder.encode('data: {"output":"First "}\n\n'));
  await tick(60);
  streams[0].enqueue(encoder.encode('data: {"output":"final"}'));
  streams[0].close();
  await tick();
  assert.equal(manager.isActive('complete'), false);
  assert.equal(row('complete').streaming_status, 'completed');
  assert.equal(messages('complete').at(-1)?.content, 'First final');
  assert.equal(messages('complete').at(-1)?.id, first.assistantMessageId);
  assert.equal(getSnapshotState('complete'), null);
  assert.deepEqual(bodies[0], { message: 'Hello', history: '', stream: true });

  create('cancel');
  manager.start('cancel', 'u', 'Stop', 'cancel-key');
  await tick(60);
  streams[1].enqueue(encoder.encode('data: {"output":"partial"}\n\n'));
  await tick();
  assert.equal(manager.cancel('cancel', 'wrong-user'), false);
  assert.equal(manager.cancel('cancel', 'u'), true);
  assert.equal(messages('cancel').at(-1)?.content, 'partial');
  assert.equal(messages('cancel').at(-1)?.isStopped, true);
  assert.equal(row('cancel').streaming_status, 'cancelled');
  manager.start('cancel', 'u', 'New run', 'replacement');
  await tick();
  streams[1].enqueue(encoder.encode('data: {"output":"late old text"}\n\n'));
  streams[1].close();
  await tick();
  assert.equal(manager.isActive('cancel'), true, 'late old transport cannot end the replacement');
  streams[2].enqueue(encoder.encode('data: {"text":"replacement"}\n\n'));
  streams[2].close();
  await tick();
  assert.equal(messages('cancel').at(-1)?.content, 'replacement');
  assert.equal(row('cancel').streaming_status, 'completed');

  create('failure');
  manager.start('failure', 'u', 'Fail', 'failure-key');
  await tick();
  streams[3].error(new Error('Upstream failed'));
  await tick();
  assert.equal(row('failure').streaming_status, 'failed');
  assert.equal(messages('failure').at(-1)?.role, 'error');
  assert.equal(messages('failure').at(-1)?.content, 'Upstream failed');

  create('timeout');
  manager.start('timeout', 'u', 'Wait', 'timeout-key');
  await tick(550);
  assert.equal(manager.isActive('timeout'), false);
  assert.equal(messages('timeout').at(-1)?.content, 'Generation timed out');
  streams[4].close();
  await tick();

  create('snapshot');
  writeSnapshot('snapshot', JSON.stringify([{ id: 'm', role: 'assistant', content: 'first', timestamp: 1 }]));
  writeSnapshot('snapshot', JSON.stringify([{ id: 'm', role: 'assistant', content: 'last buffered tokens', timestamp: 1 }]));
  clearSnapshotState('snapshot');
  assert.equal(messages('snapshot')[0].content, 'last buffered tokens');
  assert.equal(getSnapshotState('snapshot'), null);
  create('early-cancel');
  manager.start('early-cancel', 'u', 'Stop before tokens', 'early-key');
  await tick();
  assert.equal(manager.cancel('early-cancel', 'u'), true);
  assert.equal(messages('early-cancel').at(-1)?.isStopped, true);
  assert.equal(messages('early-cancel').at(-1)?.content, '');
  streams[5].close();
  await tick();
  assert.deepEqual(eventBus.getAllSubscriberCounts(), {});
});
