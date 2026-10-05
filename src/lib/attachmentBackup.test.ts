import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import type { Message } from '../types';

test('backups include original bytes once, remap restored IDs, and fail on missing bytes or access errors', async (t) => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null },
  });
  t.after(() => Reflect.deleteProperty(globalThis, 'localStorage'));
  const { addBackupAttachments, restoreBackupAttachments } = await import('./attachmentBackup');
  const oldId = '00000000-0000-4000-8000-000000000001',
    newId = '00000000-0000-4000-8000-000000000002';
  const file = { id: oldId, name: 'notes.txt', contentType: 'text/plain', size: 5 };
  const conversation = () => [
    {
      id: 'c',
      messages: [1, 2].map(
        (i) =>
          ({ id: `m${i}`, role: 'user', content: '', timestamp: 1, attachments: [file] }) as Message
      ),
    },
  ];
  let uploads = 0,
    downloads = 0,
    status = 200;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    if (options.method === 'POST') {
      uploads++;
      assert.equal(await (options.body as File).text(), 'HELLO');
      return Response.json({ ...file, id: newId });
    }
    downloads++;
    return status === 200
      ? new Response('HELLO')
      : Response.json({ error: 'Unavailable' }, { status });
  });
  const zip = new JSZip();
  await addBackupAttachments(zip, conversation());
  assert.equal(downloads, 1);
  assert.equal(await zip.file(`attachments/${oldId}`)!.async('string'), 'HELLO');
  status = 404;
  const data = conversation();
  await restoreBackupAttachments(zip, data);
  assert.equal(uploads, 1);
  assert.equal(downloads, 2);
  assert.ok(data[0].messages.every((message) => message.attachments![0].id === newId));
  await assert.rejects(
    restoreBackupAttachments(new JSZip(), conversation()),
    /missing an attachment/
  );
  status = 403;
  await assert.rejects(restoreBackupAttachments(zip, conversation()), /Unavailable/);
  await assert.rejects(restoreBackupAttachments(zip, [{}]), /Invalid conversation backup/);
  assert.equal(uploads, 1);
});
