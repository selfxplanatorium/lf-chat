import express, { Router, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import db from '../db';
import {
  attachmentInUse,
  getAttachment,
  MAX_FILE_BYTES,
  storeAttachment,
} from '../lib/attachments';

const router = Router();
router.use(authMiddleware);
const uploadLimit = rateLimit({
  windowMs: 60_000,
  limit: 100,
  keyGenerator: (req: AuthRequest) => req.userId!,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads; try again shortly' },
});
let processing = 0;
router.post(
  '/',
  uploadLimit,
  express.raw({ type: 'application/octet-stream', limit: MAX_FILE_BYTES }),
  async (req: AuthRequest, res: Response) => {
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: 'Upload a binary file' });
      return;
    }
    if (processing >= 2) {
      res.status(429).json({ error: 'File processing is busy; try again shortly' });
      return;
    }
    processing++;
    try {
      const name = decodeURIComponent(req.get('X-File-Name') || '');
      res
        .status(201)
        .json(await storeAttachment(req.userId!, name, req.body, req.get('X-File-Id')));
    } catch (error) {
      const err = error as Error & { statusCode?: number };
      res.status(err.statusCode || 400).json({ error: err.message || 'Could not upload file' });
    } finally {
      processing--;
    }
  }
);
router.get('/:id', (req: AuthRequest, res: Response) => {
  try {
    const file = getAttachment(req.params.id, req.userId!);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.data);
  } catch {
    res.status(404).json({ error: 'Attachment not found' });
  }
});
router.delete('/:id', (req: AuthRequest, res: Response) => {
  if (attachmentInUse(req.params.id, req.userId!)) {
    res.status(409).json({ error: 'Attachment is part of a message' });
    return;
  }
  db.prepare('DELETE FROM attachments WHERE id = ? AND user_id = ?').run(
    req.params.id,
    req.userId!
  );
  res.json({ success: true });
});
router.use(
  (error: Error & { type?: string }, _req: AuthRequest, res: Response, _next: NextFunction) => {
    res
      .status(error.type === 'entity.too.large' ? 413 : 400)
      .json({
        error:
          error.type === 'entity.too.large'
            ? 'Files must be between 1 byte and 10 MB'
            : 'Could not upload file',
      });
  }
);
export default router;
