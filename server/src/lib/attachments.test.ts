import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('attachments extract documents, reject unsafe inputs, and enforce ownership and references', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'chat-attachments-'));
  process.env.DATA_DIR = directory;
  process.env.JWT_SECRET = 'attachment-test-fixture-only';
  process.env.APP_URL = 'http://127.0.0.1';
  const db = (await import('../db')).default;
  const {
    storeAttachment,
    getAttachment,
    resolveAttachments,
    classifyFile,
    attachmentInUse,
    cleanupAttachments,
  } = await import('./attachments');
  const wordpressUsers = (db.pragma('table_info(users)') as { name: string }[]).some(
    (column) => column.name === 'wp_user_id'
  );
  const seedUser = (id: string, wordpressId: number) => {
    if (wordpressUsers)
      db.prepare(
        'INSERT INTO users (id, wp_user_id, email, name, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, wordpressId, `${id}@example.test`, id, Date.now(), Date.now());
    else
      db.prepare(
        'INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, `${id}@example.test`, '', id, Date.now());
  };
  try {
    seedUser('owner', 1);
    const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', name));
    for (const [name, expected] of [
      ['note.txt', 'kumquat'],
      ['paper.pdf', '123.45'],
      ['letter.docx', 'sunflowers'],
      ['data.xlsx', '42'],
      ['text.rtf', 'otter'],
      ['table.csv', 'apples'],
      ['legacy.doc', 'Unicode'],
      ['legacy.xls', '42'],
      ['macros.xlsm', 'Oranges'],
      ['slides.pptx', 'dahlias'],
      ['letter.odt', 'badger'],
      ['data.ods', '17'],
      ['slides.odp', 'fox'],
      ['book.epub', 'violet'],
    ]) {
      const file = await storeAttachment('owner', name, fixture(name));
      assert.match(getAttachment(file.id, 'owner').text, new RegExp(expected));
      assert.throws(() => getAttachment(file.id, 'other'), /not found/);
    }
    const longName = await storeAttachment('owner', 'x'.repeat(230) + '.txt', Buffer.from('LONG'));
    assert.ok(longName.name.length <= 200 && longName.name.endsWith('.txt'));
    assert.equal(classifyFile('unicode.txt', Buffer.from('\ufeffGrüße', 'utf16le')).text, 'Grüße');
    assert.equal(
      classifyFile('app.swift', Buffer.from('print(\"hello\")')).text,
      'print(\"hello\")'
    );
    assert.equal(classifyFile('Dockerfile', Buffer.from('FROM node:22')).text, 'FROM node:22');
    assert.throws(() => classifyFile('unknown.bin', Buffer.from([0, 1, 2])), /Unsupported/);
    const image = await storeAttachment('owner', 'color.png', fixture('color.png'));
    assert.equal(getAttachment(image.id, 'owner').contentType, 'image/png');
    assert.throws(() => classifyFile('movie.mp4', Buffer.from('video')), /Unsupported/);
    assert.throws(() => classifyFile('sound.mp3', Buffer.from('audio')), /Unsupported/);
    assert.throws(() => classifyFile('fake.pdf', Buffer.from('not a PDF')), /contents/);
    assert.throws(() => classifyFile('empty.txt', Buffer.alloc(0)), /1 byte/);
    assert.throws(() => classifyFile('huge.txt', Buffer.alloc(10 * 1024 * 1024 + 1)), /10 MB/);
    assert.throws(() => classifyFile('binary.txt', Buffer.from([255])), /UTF-8/);
    assert.throws(() => resolveAttachments(Array(6).fill(image.id), 'owner'), /5 different/);
    assert.throws(() => resolveAttachments([image.id, image.id], 'owner'), /5 different/);
    assert.throws(() => resolveAttachments([image.id], 'other'), /not found/);
    await assert.rejects(
      storeAttachment('owner', 'broken.pdf', Buffer.from('%PDF-1.4 broken')),
      /Could not read/
    );
    const message = {
      id: 'm',
      role: 'user',
      content: '',
      timestamp: Date.now(),
      attachments: [image],
    };
    db.prepare(
      'INSERT INTO conversations (id, user_id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('c', 'owner', 'Files', JSON.stringify([message]), Date.now(), Date.now());
    assert.equal(attachmentInUse(image.id, 'owner'), true);
    // Exercise the real HTTP routes using each fork's own authentication mechanism.
    seedUser('other', 2);
    const auth = await import('../middleware/auth');
    const ownerHeaders: Record<string, string> = {},
      otherHeaders: Record<string, string> = {};
    if ('generateToken' in auth) {
      const sign = auth.generateToken as (id: string) => string;
      ownerHeaders.Authorization = `Bearer ${sign('owner')}`;
      otherHeaders.Authorization = `Bearer ${sign('other')}`;
    } else {
      const sessionAuth = auth as unknown as { createSession: (res: unknown, id: string) => void };
      sessionAuth.createSession(
        {
          cookie: (name: string, value: string) => {
            ownerHeaders.Cookie = `${name}=${value}`;
          },
        },
        'owner'
      );
      sessionAuth.createSession(
        {
          cookie: (name: string, value: string) => {
            otherHeaders.Cookie = `${name}=${value}`;
          },
        },
        'other'
      );
    }
    const express = (await import('express')).default;
    const app = express();
    app.use('/files', (await import('../routes/attachments')).default);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/files`;
    try {
      assert.equal((await fetch(base, { method: 'POST', body: 'HELLO' })).status, 401);
      const uploaded = await fetch(base, {
        method: 'POST',
        headers: {
          ...ownerHeaders,
          'Content-Type': 'application/octet-stream',
          'X-File-Name': 'http.txt',
        },
        body: 'HTTP_CONTENT',
      });
      assert.equal(uploaded.status, 201);
      const file = (await uploaded.json()) as { id: string };
      const download = await fetch(`${base}/${file.id}`, { headers: ownerHeaders });
      assert.equal(await download.text(), 'HTTP_CONTENT');
      assert.equal(download.headers.get('Cache-Control'), 'private, no-store');
      assert.equal((await fetch(`${base}/${file.id}`, { headers: otherHeaders })).status, 404);
      assert.equal(
        (await fetch(`${base}/${image.id}`, { method: 'DELETE', headers: ownerHeaders })).status,
        409
      );
      assert.equal(
        (await fetch(`${base}/${file.id}`, { method: 'DELETE', headers: otherHeaders })).status,
        200
      );
      assert.equal(
        (await fetch(`${base}/${file.id}`, { headers: ownerHeaders })).status,
        200,
        'another user cannot remove the file'
      );
      assert.equal(
        (await fetch(`${base}/${file.id}`, { method: 'DELETE', headers: ownerHeaders })).status,
        200
      );
      assert.equal((await fetch(`${base}/${file.id}`, { headers: ownerHeaders })).status, 404);
      assert.equal(
        (
          await fetch(base, {
            method: 'POST',
            headers: {
              ...ownerHeaders,
              'Content-Type': 'application/octet-stream',
              'X-File-Name': 'big.txt',
            },
            body: Buffer.alloc(10 * 1024 * 1024 + 1),
          })
        ).status,
        413
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    cleanupAttachments('owner', 0);
    assert.equal(getAttachment(image.id, 'owner').name, 'color.png');
    db.prepare('DELETE FROM conversations WHERE id = ?').run('c');
    cleanupAttachments('owner', 0);
    assert.throws(() => getAttachment(image.id, 'owner'), /not found/);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
