import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
process.env.STREAM_STALL_TIMEOUT_MS = '100';

const run = async () => {
  const snapshots: string[] = [];
  const errors: string[] = [];
  let completed = 0;
  const abort = new AbortController();
  const { runGeneration } = await import('./runner');
  await runGeneration({
    conversationId: 'c', assistantMessageId: 'a', webhookUrl: 'https://8.8.8.8/webhook',
    userMessageContent: 'Hi', history: [], abortSignal: abort.signal,
    callbacks: { onSnapshot: content => snapshots.push(content), onError: error => errors.push(error.message), onComplete: () => completed++ },
  });
  return { snapshots, errors, completed };
};

test('runner decodes split UTF-8 and pretty JSON responses', async t => {
  const bytes = new TextEncoder().encode('{\n"output":"Grüße 🌍"\n}');
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'application/json' } }));
  const result = await run();
  assert.deepEqual(result.errors, []);
  assert.equal(result.completed, 1);
  assert.equal(result.snapshots.at(-1), 'Grüße 🌍');
});

test('runner decodes n8n JSON event streams under the application/json header', async t => {
  const bytes = new TextEncoder().encode(
    '{"type":"begin","metadata":{"nodeName":"AI Agent"}}\n' +
    '{"type":"item","content":"Grüße 🌍"}\n' +
    '{"type":"end","metadata":{"nodeName":"AI Agent"}}\n',
  );
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
  const result = await run();
  assert.deepEqual(result.errors, []);
  assert.equal(result.completed, 1);
  assert.equal(result.snapshots.at(-1), 'Grüße 🌍');
});

test('runner reports HTTP errors and cancels a broken response body', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Backend unavailable' }, { status: 503 }));
  assert.deepEqual((await run()).errors, ['Backend unavailable']);
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(5_000_001))); },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'text/event-stream' } }));
  assert.match((await run()).errors[0], /maximum allowed size/);
  assert.equal(cancelled, true);
  t.mock.method(globalThis, 'fetch', async () => new Response('{broken JSON', { headers: { 'Content-Type': 'application/json' } }));
  assert.match((await run()).errors[0], /Invalid JSON/);
});

test('a stalled response is cancelled and reports an error once', async t => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  const result = await run();
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Stream stalled/);
  assert.equal(result.completed, 0);
  assert.equal(cancelled, true);
});


test('runner sends documents and images as multipart, retains file context in later turns', async t => {
  const doc = { id: 'doc', name: 'report.txt', contentType: 'text/plain', size: 6, data: Buffer.from('REPORT'), text: 'REPORT' };
  const imageBytes = readFileSync(path.join(__dirname, '../lib/fixtures/color.png'));
  const image = { id: 'image', name: 'photo.png', contentType: 'image/png', size: imageBytes.length, data: imageBytes, text: '' };
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    assert.ok(options.body instanceof FormData);
    assert.equal(new Headers(options.headers).has('Content-Type'), false, 'fetch must generate the multipart boundary');
    const form = options.body as FormData;
    if (requests++ === 0) {
      assert.match(String(form.get('message')), /REPORT/);
      assert.equal((form.get('file0') as File).name, 'report.txt');
      assert.deepEqual(Buffer.from(await (form.get('file1') as File).arrayBuffer()), imageBytes);
    } else {
      assert.match(String(form.get('history')), /REPORT/);
      assert.equal((form.get('file0') as File).name, 'photo.png');
      assert.equal(form.get('file1'), null, 'historical documents use extracted text rather than reuploading bytes');
    }
    return new Response('{"type":"item","content":"OK"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
  });
  const { runGeneration } = await import('./runner');
  const base = { conversationId: 'c', assistantMessageId: 'a', webhookUrl: 'https://8.8.8.8/webhook', userMessageContent: 'Read it', abortSignal: new AbortController().signal, callbacks: { onSnapshot: () => {}, onComplete: () => {}, onError: (error: Error) => { throw error; } } };
  await runGeneration({ ...base, history: [], attachments: [doc, image] });
  await runGeneration({ ...base, history: [{ id: 'u', role: 'user', content: 'Earlier', timestamp: 1, attachments: [doc, image] }], historyAttachments: [doc, image] });
  assert.equal(requests, 2);
});

test('runner bounds current and historical image inputs while retaining original files', async t => {
  const { MAX_MODEL_IMAGE_BYTES } = await import('../lib/webhookFile');
  const bytes = await sharp(randomBytes(1254 * 1254 * 3), { raw: { width: 1254, height: 1254, channels: 3 } }).png().toBuffer();
  assert.ok(bytes.length > 3 * 1024 * 1024);
  const image = { id: 'large', name: 'large.png', contentType: 'image/png', size: bytes.length, data: bytes, text: '' };
  const original = Buffer.from(bytes);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    requests++;
    const form = options.body as FormData;
    const sent = form.get('file0') as File;
    assert.equal(sent.type, 'image/jpeg');
    assert.equal(sent.name, 'large.jpg');
    assert.ok(sent.size <= MAX_MODEL_IMAGE_BYTES);
    assert.equal(form.get('file1'), null, 'current/historical references are deduplicated');
    const metadata = await sharp(Buffer.from(await sent.arrayBuffer())).metadata();
    assert.ok(metadata.width! <= 2048 && metadata.height! <= 2048);
    return new Response('{"type":"item","content":"OK"}\n', { headers: { 'Content-Type': 'application/json' } });
  });
  const { runGeneration } = await import('./runner');
  const base = { conversationId: 'c', assistantMessageId: 'a', webhookUrl: 'https://8.8.8.8/webhook', userMessageContent: 'Describe it', abortSignal: new AbortController().signal, callbacks: { onSnapshot: () => {}, onComplete: () => {}, onError: (error: Error) => { throw error; } } };
  await runGeneration({ ...base, history: [], attachments: [image] });
  await runGeneration({ ...base, history: [{ id: 'u', role: 'user', content: 'Earlier', timestamp: 1, attachments: [image] }], attachments: [image], historyAttachments: [image] });
  assert.equal(requests, 2);
  assert.deepEqual(image.data, original);
  assert.equal(image.name, 'large.png');
  assert.equal(image.contentType, 'image/png');
  assert.equal(image.size, original.length);
});
