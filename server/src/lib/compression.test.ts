/**
 * Run: npx tsx server/src/lib/compression.test.ts
 *
 * Guards the one risky part of enabling compression: SSE must still stream
 * incrementally. A regression here doesn't fail loudly — the chat just stops
 * showing tokens until the model finishes.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { compressionMiddleware } from './compression';

const app = express();
app.use(compressionMiddleware);

app.get('/bundle.js', (_req, res) => {
  res.type('application/javascript').send('x'.repeat(50_000));
});

app.get('/events', (_req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.write('data: first\n\n');
  setTimeout(() => { res.write('data: second\n\n'); res.end(); }, 150);
});

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  const asset = await fetch(`${base}/bundle.js`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(asset.headers.get('content-encoding'), 'gzip', 'static assets must be gzipped');

  const sse = await fetch(`${base}/events`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(sse.headers.get('content-encoding'), null, 'SSE must not be compressed');

  // The real regression: the first delta has to arrive before the stream ends.
  const reader = sse.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value!);
  assert.equal(first, 'data: first\n\n', 'first SSE delta must arrive before the response ends');
  await reader.cancel();

  console.log('compression: ok');
  server.close();
});
