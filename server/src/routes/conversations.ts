import { Router, Response, Request } from 'express';
import db from '../db';
import { AuthRequest, authMiddleware, verifySseToken } from '../middleware/auth';
import { generationManager } from '../generation/manager';
import { eventBus } from '../generation/eventBus';

const router = Router();

function serializeConversation(c: any, messageLimit?: number, preParsedMessages?: any[]) {
  const allMessages = preParsedMessages || JSON.parse(c.messages);
  const messages = messageLimit ? allMessages.slice(-messageLimit) : allMessages;
  return {
    id: c.id,
    title: c.title,
    isUntitled: !!c.is_untitled,
    messages,
    messageCount: allMessages.length,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    pinned: !!c.pinned,
    parentConversationId: c.parent_conversation_id || undefined,
    streamingStatus: c.streaming_status || null,
    streamingMessageId: c.streaming_message_id || null,
  };
}

router.get('/', authMiddleware, (req: AuthRequest, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 0;
  const offset = parseInt(req.query.offset as string) || 0;

  let query = 'SELECT id, title, is_untitled, json_array_length(messages) as message_count, created_at, updated_at, pinned, parent_conversation_id, streaming_status, streaming_message_id FROM conversations WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC';
  const params: any[] = [req.userId!];

  if (limit > 0) {
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);
  }

  const conversations = db.prepare(query).all(...params) as any[];
  res.json(conversations.map(c => ({
    id: c.id,
    title: c.title,
    isUntitled: !!c.is_untitled,
    messages: [],
    messageCount: c.message_count,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    pinned: !!c.pinned,
    parentConversationId: c.parent_conversation_id || undefined,
    streamingStatus: c.streaming_status || null,
    streamingMessageId: c.streaming_message_id || null,
  })));
});

router.post('/', authMiddleware, (req: AuthRequest, res: Response) => {
  const { id, title, isUntitled, messages } = req.body;
  const convId = id || require('crypto').randomUUID();
  const now = Date.now();
  const storedMessages = Array.isArray(messages) ? messages : [];
  const untitled = storedMessages.length === 0 && (isUntitled === true || (!title && isUntitled !== false));
  const storedTitle = untitled ? '' : (title || 'New Conversation');

  if (id) {
    const existing = db.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
    ).get(id, req.userId!);
    if (existing) {
      res.status(409).json({ error: 'Conversation already exists' });
      return;
    }
  }

  db.prepare(`
    INSERT INTO conversations (id, user_id, title, is_untitled, messages, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(convId, req.userId!, storedTitle, untitled ? 1 : 0, JSON.stringify(storedMessages), now, now);

  res.status(201).json({
    id: convId,
    title: storedTitle,
    isUntitled: untitled,
    messages: storedMessages,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    streamingStatus: null,
    streamingMessageId: null,
  });
});

router.delete('/', authMiddleware, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM conversations WHERE user_id = ?').run(req.userId!);
  res.json({ success: true });
});

router.put('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { title, isUntitled, messages, pinned } = req.body;

  const existing = db.prepare(
    'SELECT id, streaming_status FROM conversations WHERE id = ? AND user_id = ?'
  ).get(id, req.userId!) as any;

  if (!existing) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  if (messages !== undefined && existing.streaming_status === 'streaming') {
    res.status(409).json({ error: 'Cannot update messages while generation is in progress' });
    return;
  }

  const now = Date.now();
  const updates: string[] = ['updated_at = ?'];
  const params: any[] = [now];

  if (title !== undefined) {
    updates.push('title = ?');
    params.push(title);
    if (isUntitled === undefined) {
      updates.push('is_untitled = 0');
    }
  }
  if (isUntitled !== undefined) {
    updates.push('is_untitled = ?');
    params.push(isUntitled ? 1 : 0);
  }
  if (messages !== undefined) {
    updates.push('messages = ?');
    params.push(JSON.stringify(messages));
  }
  if (pinned !== undefined) {
    updates.push('pinned = ?');
    params.push(pinned ? 1 : 0);
  }

  params.push(id);
  db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const existing = db.prepare(
    'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
  ).get(id, req.userId!);

  if (!existing) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  res.json({ success: true });
});

router.post('/:id/messages', authMiddleware, (req: AuthRequest, res: Response) => {
  const { id: conversationId } = req.params;
  const { content, idempotencyKey, parentMessageId } = req.body;

  if (!content || typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'Message content is required' });
    return;
  }

  let conv = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, req.userId!) as any;
  if (!conv) {
    // A new-chat draft is local-only until its first message arrives. Let that
    // first message establish the conversation and immediately start the
    // generation, so abandoned drafts never create empty database rows.
    try {
      db.prepare(`
        INSERT INTO conversations (id, user_id, title, is_untitled, messages, created_at, updated_at)
        VALUES (?, ?, '', 1, '[]', ?, ?)
      `).run(conversationId, req.userId!, Date.now(), Date.now());
      conv = { id: conversationId };
    } catch {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
  }

  const key = idempotencyKey || require('crypto').randomUUID();

  try {
    const { assistantMessageId, userMessageId, alreadyRunning } = generationManager.start(
      conversationId,
      req.userId!,
      content.trim(),
      key
    );

    res.status(alreadyRunning ? 200 : 201).json({
      userMessageId,
      assistantMessageId,
      alreadyRunning,
    });
  } catch (err: any) {
    if (err.statusCode) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.post('/:id/cancel', authMiddleware, (req: AuthRequest, res: Response) => {
  const { id: conversationId } = req.params;

  const conv = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, req.userId!) as any;
  if (!conv) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  const cancelled = generationManager.cancel(conversationId, req.userId!);
  res.json({ success: true, cancelled });
});

router.post('/:id/retry', authMiddleware, (req: AuthRequest, res: Response) => {
  const { id: conversationId } = req.params;
  const { messageId } = req.body;

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, req.userId!) as any;
  if (!conv) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  if (conv.streaming_status === 'streaming') {
    res.status(409).json({ error: 'Generation in progress' });
    return;
  }

  const messages: any[] = JSON.parse(conv.messages);

  // When a messageId is provided, find the user message that precedes it; the
  // retry captures that moment in the conversation regardless of what came after.
  // When omitted, fall back to the last user message (legacy behaviour).
  let targetUserMessageIndex = -1;

  if (messageId) {
    const msgIndex = messages.findIndex((m: any) => m.id === messageId);
    if (msgIndex === -1) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    const targetMessage = messages[msgIndex];
    if (targetMessage.role === 'user') {
      targetUserMessageIndex = msgIndex;
    } else {
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          targetUserMessageIndex = i;
          break;
        }
      }
    }
  } else {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        targetUserMessageIndex = i;
        break;
      }
    }
  }

  if (targetUserMessageIndex === -1) {
    res.status(400).json({ error: 'No user message to retry from' });
    return;
  }

  const targetUserMessage = messages[targetUserMessageIndex];
  // Drop the target user message and everything after it; manager.start re-appends
  // the user message before regenerating, so keeping it here would duplicate it.
  const truncatedMessages = messages.slice(0, targetUserMessageIndex);

  db.prepare('UPDATE conversations SET messages = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(truncatedMessages), Date.now(), conversationId);

  const key = require('crypto').randomUUID();

  try {
    const { assistantMessageId } = generationManager.start(
      conversationId,
      req.userId!,
      targetUserMessage.content,
      key
    );
    res.json({ assistantMessageId });
  } catch (err: any) {
    // Restore the original history so a failed start doesn't lose messages.
    db.prepare('UPDATE conversations SET messages = ? WHERE id = ?').run(conv.messages, conversationId);
    if (err.statusCode) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.post('/:id/edit', authMiddleware, (req: AuthRequest, res: Response) => {
  const { id: conversationId } = req.params;
  const { messageId, content } = req.body;

  if (!messageId || !content || typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'messageId and content are required' });
    return;
  }

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, req.userId!) as any;
  if (!conv) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  if (conv.streaming_status === 'streaming') {
    res.status(409).json({ error: 'Generation in progress' });
    return;
  }

  const messages: any[] = JSON.parse(conv.messages);
  const messageIndex = messages.findIndex((m: any) => m.id === messageId);

  if (messageIndex === -1) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }

  const targetMessage = messages[messageIndex];
  const now = Date.now();

  // manager.start re-appends the user message (and a fresh assistant message)
  // before generating, so save the history WITHOUT it — otherwise the user
  // message gets duplicated. Regenerate from the edited user message, or, when
  // editing an assistant message, from the user message that precedes it.
  let history: any[];
  let regenContent: string;
  if (targetMessage.role === 'user') {
    history = messages.slice(0, messageIndex);
    regenContent = content.trim();
  } else {
    let lastUserIdx = -1;
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) {
      res.status(400).json({ error: 'No user message before this assistant message' });
      return;
    }
    history = messages.slice(0, lastUserIdx);
    regenContent = messages[lastUserIdx].content;
  }

  // Title is owned by manager.start (derives it from the first user message,
  // otherwise preserves the existing one), so it isn't set here.
  db.prepare('UPDATE conversations SET messages = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(history), now, conversationId);

  const key = require('crypto').randomUUID();

  try {
    const { assistantMessageId } = generationManager.start(
      conversationId,
      req.userId!,
      regenContent,
      key
    );
    res.json({ assistantMessageId });
  } catch (err: any) {
    // Restore the original messages so a failed edit doesn't lose history.
    db.prepare('UPDATE conversations SET messages = ? WHERE id = ?').run(conv.messages, conversationId);
    if (err.statusCode) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.post('/:id/branch', authMiddleware, (req: AuthRequest, res: Response) => {
  const { id: sourceId } = req.params;
  const { messageId, content } = req.body;

  if (!messageId) {
    res.status(400).json({ error: 'messageId is required' });
    return;
  }

  // An edited branch message is optional, but when supplied it must be a
  // non-empty string. Keeping this validation separate from messageId means
  // omitted content retains the legacy branch behaviour.
  if (content !== undefined && (typeof content !== 'string' || !content.trim())) {
    res.status(400).json({ error: 'content must be a non-empty string' });
    return;
  }

  const sourceConv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(sourceId, req.userId!) as any;
  if (!sourceConv) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  const messages: any[] = JSON.parse(sourceConv.messages);
  const messageIndex = messages.findIndex((m: any) => m.id === messageId);

  if (messageIndex === -1) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }

  const targetMessage = messages[messageIndex];
  const isUserTarget = targetMessage.role === 'user';
  // Exclude the target user message from stored history when it will be
  // regenerated — start() re-appends it, so including it here would duplicate it.
  const branchedMessages = JSON.parse(JSON.stringify(messages.slice(0, isUserTarget ? messageIndex : messageIndex + 1)));
  const newConvId = require('crypto').randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO conversations (id, user_id, title, is_untitled, messages, created_at, updated_at, pinned, parent_conversation_id)
    VALUES (?, ?, ?, 0, ?, ?, ?, 0, ?)
  `).run(newConvId, req.userId!, sourceConv.title, JSON.stringify(branchedMessages), now, now, sourceId);

  if (isUserTarget) {
    const key = require('crypto').randomUUID();

    try {
      const { assistantMessageId } = generationManager.start(
        newConvId,
        req.userId!,
        content !== undefined ? content.trim() : targetMessage.content,
        key
      );
      // start() overwrites the DB row — re-read the canonical messages so the
      // client receives the exact post-start state (history + user turn +
      // assistant placeholder) with no duplicate.
      const fresh = db.prepare('SELECT messages FROM conversations WHERE id = ?').get(newConvId) as any;
      res.status(201).json({
        id: newConvId,
        title: sourceConv.title,
        isUntitled: false,
        messages: JSON.parse(fresh.messages),
        createdAt: now,
        updatedAt: now,
        pinned: false,
        parentConversationId: sourceId,
        streamingStatus: 'streaming',
        streamingMessageId: assistantMessageId,
      });
    } catch (err: any) {
      if (err.statusCode) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  } else {
    res.status(201).json({
      id: newConvId,
      title: sourceConv.title,
      isUntitled: false,
      messages: branchedMessages,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      parentConversationId: sourceId,
      streamingStatus: null,
      streamingMessageId: null,
    });
  }
});

router.get('/:id/messages', authMiddleware, (req: AuthRequest, res: Response) => {
  const { id: conversationId } = req.params;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;

  const conv = db.prepare('SELECT messages FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, req.userId!) as any;

  if (!conv) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  const allMessages: any[] = JSON.parse(conv.messages);
  const page = allMessages.slice(offset, offset + limit);
  res.json({ messages: page, total: allMessages.length });
});

router.get('/:id/events', (req: Request, res: Response) => {
  const { id: conversationId } = req.params;
  const token = req.query.token as string;
  const messageLimit = parseInt(req.query.messageLimit as string) || 0;

  if (!token) {
    res.status(401).json({ error: 'Authentication required. Pass ?token= in the query string.' });
    return;
  }

  const decoded = verifySseToken(token);
  if (!decoded) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, decoded.userId) as any;
  if (!conv) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.write(': connected\n\n');

  const allMessages: any[] = JSON.parse(conv.messages);
  const snapshotMessageCount = allMessages.length;

  const snapshotData = {
    type: 'snapshot',
    conversationId,
    messageCount: snapshotMessageCount,
    conversation: serializeConversation(conv, messageLimit || undefined, allMessages),
  };
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshotData)}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);

  const unsubscribe = eventBus.subscribe(conversationId, (event) => {
    try {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {
      unsubscribe();
      clearInterval(heartbeat);
    }
  });

  res.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });

  res.on('error', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });
});

export default router;
