import crypto from 'node:crypto';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import db from '../db';

export interface FileAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
}
export interface StoredAttachment extends FileAttachment {
  data: Buffer;
  text: string;
}
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
const MAX_TEXT_CHARS = 200_000;
const officeTypes: Record<string, string> = {
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  epub: 'application/epub+zip',
};
const imageTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};
const textExtensions = new Set(
  'txt md markdown csv tsv json jsonl yaml yml xml html htm css js jsx ts tsx py rb rs go java c h cpp hpp cs php sh bash zsh sql toml ini log tex r vue svelte svg rst ipynb mjs cjs conf config properties diff patch eml'.split(
    ' '
  )
);
const unsupportedBinaryExtensions = new Set(
  'mp3 wav flac ogg opus aac m4a wma aiff aif mid midi amr ape mp2 ac3 oga weba mp4 mov m4v webm avi mkv wmv flv mpeg mpg 3gp 3g2 ogv vob m2ts zip rar 7z tar gz bz2 xz zst tgz iso dmg exe dll so ppt pages numbers tiff tif bmp heic heif avif ico icns psd'.split(
    ' '
  )
);
export const attachmentError = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

// Only metadata lives in conversation snapshots; file bytes stay in owner-scoped storage.
db.exec(`CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL,
  data BLOB NOT NULL, extracted_text TEXT NOT NULL, created_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS attachments_user ON attachments(user_id);`);

export function metadata(file: StoredAttachment): FileAttachment {
  return { id: file.id, name: file.name, contentType: file.contentType, size: file.size };
}
export function getAttachment(id: string, userId: string): StoredAttachment {
  const row = db
    .prepare(
      'SELECT id, name, content_type AS contentType, size, data, extracted_text AS text FROM attachments WHERE id = ? AND user_id = ?'
    )
    .get(id, userId) as StoredAttachment | undefined;
  if (!row) throw attachmentError('Attachment not found', 404);
  return row;
}
export function resolveAttachments(ids: unknown, userId: string): StoredAttachment[] {
  if (ids === undefined) return [];
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_ATTACHMENTS ||
    ids.some((id) => typeof id !== 'string') ||
    new Set(ids).size !== ids.length
  )
    throw attachmentError('Up to 5 different files are allowed');
  const files = ids.map((id) => getAttachment(id, userId));
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_FILE_BYTES)
    throw attachmentError('Attachments must total 10 MB or less');
  return files;
}

export function classifyFile(
  name: string,
  data: Buffer
): { contentType: string; extension: string; text?: string } {
  if (!data.length || data.length > MAX_FILE_BYTES)
    throw attachmentError('Files must be between 1 byte and 10 MB');
  const extension = name.split('.').at(-1)?.toLowerCase() || '';
  const type = imageTypes[extension] || officeTypes[extension];
  if (type) {
    const valid =
      type === 'image/png'
        ? data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : type === 'image/jpeg'
          ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
          : type === 'image/gif'
            ? /^GIF8[79]a/.test(data.subarray(0, 6).toString())
            : type === 'image/webp'
              ? data.subarray(0, 4).toString() === 'RIFF' &&
                data.subarray(8, 12).toString() === 'WEBP'
              : extension === 'doc' || extension === 'xls'
                ? data.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))
                : extension === 'pdf'
                  ? data.subarray(0, 1024).includes(Buffer.from('%PDF-'))
                  : extension === 'rtf'
                    ? data.subarray(0, 5).toString() === '{\\rtf'
                    : data[0] === 0x50 && data[1] === 0x4b;
    if (!valid) throw attachmentError('File contents do not match the file type');
    if (data[0] === 0x50 && data[1] === 0x4b) validateZipSize(data);
    return { contentType: type, extension };
  }
  if (unsupportedBinaryExtensions.has(extension)) throw attachmentError('Unsupported file type');
  let text: string;
  try {
    const encoding =
      data[0] === 0xff && data[1] === 0xfe
        ? 'utf-16le'
        : data[0] === 0xfe && data[1] === 0xff
          ? 'utf-16be'
          : 'utf-8';
    text = new TextDecoder(encoding, { fatal: true }).decode(data);
  } catch {
    throw attachmentError(
      textExtensions.has(extension) ? 'Text files must use UTF-8' : 'Unsupported file type'
    );
  }
  if (/[\x00-\x08\x0e-\x1f\x7f]/.test(text)) throw attachmentError('Unsupported file type');
  if (text.length > MAX_TEXT_CHARS) throw attachmentError('Document exceeds 200,000 characters');
  return { contentType: 'text/plain', extension, text };
}

// Check declared ZIP expansion before allocating Office XML/image entries.
function validateZipSize(data: Buffer): void {
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65557); end--)
    if (data.readUInt32LE(end) === 0x06054b50) break;
  if (end < 0 || data.readUInt32LE(end) !== 0x06054b50)
    throw attachmentError('Could not read this document; it may be damaged or password-protected');
  const count = data.readUInt16LE(end + 10);
  let position = data.readUInt32LE(end + 16),
    expanded = 0;
  if (count > 10000) throw attachmentError('Document is too complex');
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || data.readUInt32LE(position) !== 0x02014b50)
      throw attachmentError('File contents do not match the file type');
    expanded += data.readUInt32LE(position + 24);
    if (expanded > 50 * 1024 * 1024) throw attachmentError('Document expands beyond 50 MB');
    position +=
      46 +
      data.readUInt16LE(position + 28) +
      data.readUInt16LE(position + 30) +
      data.readUInt16LE(position + 32);
  }
}

// Isolate synchronous PDF/XML/ZIP parsing so a malformed upload cannot block chat.
const parserCode = `
const { parentPort, workerData } = require('node:worker_threads');
const { parseOffice } = require(workerData.parser);
(async () => {
  if (workerData.extension === 'doc') {
    const WordExtractor = require(workerData.wordParser);
    const doc = await new WordExtractor().extract(Buffer.from(workerData.data));
    const text = [doc.getBody(), doc.getFootnotes(), doc.getEndnotes(), doc.getHeaders(), doc.getAnnotations(), doc.getTextboxes()].join('\\n').trim();
    if (!text || text.length > 200000) throw new Error(text ? 'Document exceeds 200,000 characters' : 'Document has no readable text; scanned PDFs need OCR');
    parentPort.postMessage({ text }); return;
  }
  if (workerData.extension === 'xls' || workerData.extension === 'xlsm') {
    const XLSX = require(workerData.sheetParser);
    const workbook = XLSX.read(Buffer.from(workerData.data), { type: 'buffer', cellHTML: false, cellFormula: false });
    const text = workbook.SheetNames.map(name => name + '\\n' + XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join('\\n').trim();
    if (!text || text.length > 200000) throw new Error(text ? 'Document exceeds 200,000 characters' : 'Document has no readable text; scanned PDFs need OCR');
    parentPort.postMessage({ text }); return;
  }
  let ast = await parseOffice(Buffer.from(workerData.data), {
    fileType: workerData.extension, extractAttachments: false, ocr: false,
    pdfParserConfig: { separateProcess: false, maxTimeMs: 10000 },
  });
  let result = await ast.to('text', { includeImages: false });
  if (!String(result.value).trim() && workerData.extension === 'pdf') {
    ast = await parseOffice(Buffer.from(workerData.data), { fileType: 'pdf', extractAttachments: true, ocr: false, pdfParserConfig: { separateProcess: false, maxTimeMs: 10000 } });
    const images = ast.attachments.filter(image => image.type === 'image');
    if (!images.length) throw new Error('Document has no readable text; scanned PDFs need OCR');
    if (images.length > 20) throw new Error('Scanned PDFs are limited to 20 pages');
    require('node:fs').mkdirSync(workerData.ocrCache, { recursive: true });
    const { createWorker } = require(workerData.ocrParser);
    const ocr = await createWorker('eng+deu+ita', 1, { cachePath: workerData.ocrCache, logger: () => {} });
    const text = [];
    try { for (const image of images) text.push((await ocr.recognize(Buffer.from(image.data, 'base64'))).data.text); }
    finally { await ocr.terminate(); }
    result = { value: text.join('\\n') };
  }
  const text = String(result.value).trim();
  if (!text) throw new Error('Document has no readable text; scanned PDFs need OCR');
  if (text.length > 200000) throw new Error('Document exceeds 200,000 characters');
  parentPort.postMessage({ text });
})().catch(error => parentPort.postMessage({ error: error.message === 'Scanned PDFs are limited to 20 pages' || error.message === 'Document exceeds 200,000 characters' || error.message === 'Document has no readable text; scanned PDFs need OCR' ? error.message : 'Could not read this document; it may be damaged or password-protected' }));
`;
export async function extractDocument(data: Buffer, extension: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(parserCode, {
      eval: true,
      workerData: {
        data,
        extension,
        parser: require.resolve('officeparser'),
        wordParser: require.resolve('word-extractor'),
        sheetParser: require.resolve('xlsx'),
        ocrParser: require.resolve('tesseract.js'),
        ocrCache: path.join(process.env.DATA_DIR || path.join(__dirname, '../../data'), 'ocr'),
      },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
      stdout: true,
      stderr: true,
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(attachmentError('Document processing timed out'));
    }, 60_000);
    worker.once('message', (result: { text?: string; error?: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (result.error) reject(attachmentError(result.error));
      else resolve(result.text!);
    });
    worker.once('error', () => {
      clearTimeout(timer);
      reject(
        attachmentError('Could not read this document; it may be damaged or password-protected')
      );
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(attachmentError('Document processing failed'));
    });
  });
}

export async function storeAttachment(
  userId: string,
  rawName: string,
  data: Buffer,
  requestedId?: string
): Promise<FileAttachment> {
  cleanupAttachments(userId);
  const cleanName =
    rawName
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/[\x00-\x1f\x7f]/g, '') || 'file';
  const suffix = cleanName.includes('.')
    ? cleanName.slice(cleanName.lastIndexOf('.')).slice(-20)
    : '';
  const name =
    cleanName.length > 200 ? cleanName.slice(0, 200 - suffix.length) + suffix : cleanName;
  const file = classifyFile(name, data);
  const text =
    file.text ??
    (file.contentType.startsWith('image/') ? '' : await extractDocument(data, file.extension));
  const id = requestedId ?? crypto.randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw attachmentError('Invalid attachment ID');
  db.transaction(() => {
    const usage = db
      .prepare(
        'SELECT COALESCE(SUM(size + LENGTH(CAST(extracted_text AS BLOB))), 0) AS bytes FROM attachments WHERE user_id = ?'
      )
      .get(userId) as { bytes: number };
    if (usage.bytes + data.length + Buffer.byteLength(text) > 100 * 1024 * 1024)
      throw attachmentError('Attachment storage limit reached', 413);
    db.prepare('INSERT INTO attachments VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      id,
      userId,
      name,
      file.contentType,
      data.length,
      data,
      text,
      Date.now()
    );
  })();
  return { id, name, contentType: file.contentType, size: data.length };
}
export function attachmentInUse(id: string, userId: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM conversations, json_each(conversations.messages) AS message, json_each(message.value, '$.attachments') AS attachment
    WHERE conversations.user_id = ? AND json_extract(attachment.value, '$.id') = ? LIMIT 1`
    )
    .get(userId, id);
}

export function cleanupAttachments(
  userId: string,
  minimumAgeMs = 24 * 60 * 60 * 1000,
  candidates?: string[]
): void {
  const unused = candidates
    ? [...new Set(candidates)].map((id) => ({ id }))
    : (db
        .prepare('SELECT id FROM attachments WHERE user_id = ? AND created_at < ?')
        .all(userId, Date.now() - minimumAgeMs) as { id: string }[]);
  const remove = db.prepare('DELETE FROM attachments WHERE id = ? AND user_id = ?');
  for (const file of unused) if (!attachmentInUse(file.id, userId)) remove.run(file.id, userId);
}

export function messageAttachmentIds(messages: string): string[] {
  return (JSON.parse(messages) as { attachments?: FileAttachment[] }[]).flatMap((message) =>
    (message.attachments ?? []).map((file) => file.id)
  );
}
