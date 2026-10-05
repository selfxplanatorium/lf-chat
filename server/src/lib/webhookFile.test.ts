import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { MAX_MODEL_IMAGE_BYTES, prepareWebhookFile } from './webhookFile';

test('small supported images and documents retain their original bytes', async () => {
  const source = sharp({ create: { width: 200, height: 100, channels: 3, background: '#ff0000' } });
  for (const format of ['png', 'jpeg', 'webp', 'gif'] as const) {
    const data = await source.clone().toFormat(format).toBuffer();
    const file = { id: format, name: `image.${format}`, contentType: `image/${format}`, size: data.length, data, text: '' };
    assert.equal(await prepareWebhookFile(file), file);
  }
  const doc = { id: 'text', name: 'report.txt', contentType: 'text/plain', size: 6, data: Buffer.from('REPORT'), text: 'REPORT' };
  assert.equal(await prepareWebhookFile(doc), doc);
});

test('large images produce bounded JPEG inputs without modifying originals', async () => {
  const data = await sharp(randomBytes(1600 * 1600 * 3), { raw: { width: 1600, height: 1600, channels: 3 } }).png().toBuffer();
  const original = Buffer.from(data);
  const file = { id: 'large', name: 'screenshot.png', contentType: 'image/png', size: data.length, data, text: '' };
  const prepared = await prepareWebhookFile(file);
  assert.equal(prepared.contentType, 'image/jpeg');
  assert.equal(prepared.name, 'screenshot.jpg');
  assert.ok(prepared.data.length <= MAX_MODEL_IMAGE_BYTES);
  assert.equal(prepared.size, prepared.data.length);
  const metadata = await sharp(prepared.data).metadata();
  assert.ok(metadata.width! <= 2048 && metadata.height! <= 2048);
  assert.deepEqual(file.data, original);
  assert.equal(file.size, original.length);
});

test('image preparation respects orientation and bounds oversized dimensions', async () => {
  const data = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#0000ff' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const prepared = await prepareWebhookFile({ id: 'rotated', name: 'rotated.jpg', contentType: 'image/jpeg', size: data.length, data, text: '' });
  const metadata = await sharp(prepared.data).metadata();
  assert.equal(metadata.height, 2048);
  assert.ok(metadata.width! < metadata.height!);
  assert.equal(metadata.orientation, undefined);
});

test('damaged images and images beyond the pixel limit fail before reaching the model', async () => {
  const bytes = await sharp({ create: { width: 7000, height: 6000, channels: 3, background: '#ffffff' } }).png().toBuffer();
  for (const data of [Buffer.from('broken image'), bytes]) {
    await assert.rejects(prepareWebhookFile({ id: 'bad', name: 'bad.png', contentType: 'image/png', size: data.length, data, text: '' }), /Could not prepare image/);
  }
});
