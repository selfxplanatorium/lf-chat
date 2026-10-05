import db from '../db';
import { log } from './log';

const SNAPSHOT_INTERVAL_MS = 400;

interface SnapshotState {
  lastFlushTime: number;
  timer: ReturnType<typeof setTimeout> | null;
  pendingMessages: string | null;
}

const snapshots = new Map<string, SnapshotState>();

function flushConversation(conversationId: string): void {
  const state = snapshots.get(conversationId);
  if (!state || state.pendingMessages === null) return;

  const messages = state.pendingMessages;
  state.pendingMessages = null;
  state.lastFlushTime = Date.now();

  try {
    db.prepare('UPDATE conversations SET messages = ?, updated_at = ? WHERE id = ?')
      .run(messages, Date.now(), conversationId);
    log({ event: 'snapshot', conversationId, contentLength: messages.length });
  } catch (err: unknown) {
    log({ event: 'snapshot', conversationId, error: err instanceof Error ? err.message : String(err) });
  }
}

export function writeSnapshot(conversationId: string, messagesJson: string, force = false): void {
  let state = snapshots.get(conversationId);
  if (!state) {
    state = { lastFlushTime: 0, timer: null, pendingMessages: null };
    snapshots.set(conversationId, state);
  }

  state.pendingMessages = messagesJson;
  const elapsed = Date.now() - state.lastFlushTime;

  if (force || elapsed >= SNAPSHOT_INTERVAL_MS) {
    flushPendingSnapshot(conversationId);
  } else if (!state.timer) {
    state.timer = setTimeout(() => {
      state!.timer = null;
      flushConversation(conversationId);
    }, SNAPSHOT_INTERVAL_MS - elapsed);
  }
}

// Force any throttled-but-not-yet-written content to disk *now*. Used before a
// generation reads the conversation back (cancel) and as the final step when a
// generation ends, so the last sub-400ms burst of tokens — which lives only in
// pendingMessages behind an armed timer — is never lost.
export function flushPendingSnapshot(conversationId: string): void {
  const state = snapshots.get(conversationId);
  if (!state) return;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  flushConversation(conversationId);
}

export function clearSnapshotState(conversationId: string): void {
  // Flush before discarding: otherwise an armed timer holding the final full
  // message is cancelled and the message is persisted truncated ("first few
  // words" survive, the rest disappears on reload).
  flushPendingSnapshot(conversationId);
  snapshots.delete(conversationId);
}

export function getSnapshotState(conversationId: string): { pendingMessagesLength: number; lastFlushTime: number } | null {
  const state = snapshots.get(conversationId);
  if (!state) return null;
  return {
    pendingMessagesLength: state.pendingMessages?.length ?? 0,
    lastFlushTime: state.lastFlushTime,
  };
}

export function getAllSnapshotStates(): Record<string, { pendingMessagesLength: number; lastFlushTime: number }> {
  const result: ReturnType<typeof getAllSnapshotStates> = {};
  for (const [id, state] of snapshots) {
    result[id] = {
      pendingMessagesLength: state.pendingMessages?.length ?? 0,
      lastFlushTime: state.lastFlushTime,
    };
  }
  return result;
}