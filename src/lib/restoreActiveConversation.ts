/**
 * Which conversation to open on load.
 *
 * The tension: a new, unsent chat is deliberately local-only — it has no
 * server-side id until its first message — yet "I am sitting on an empty chat"
 * is still a position the user expects a reload to preserve. Storing nothing
 * for that case made it indistinguishable from a first-ever visit, and the
 * fallback for a first visit is "open the newest conversation". So reloading
 * from an empty thread threw the user into an unrelated conversation.
 *
 * A sentinel separates the two. Kept pure and apart from the hook so the
 * branching is testable without React or a browser
 * (`npx tsx src/lib/restoreActiveConversation.test.ts`).
 */

export const ACTIVE_ID_KEY = 'chat-assistant-active-id';

/** Stands in for a draft, which has no id to store. Never collides with a real
 *  conversation id (those are 21-character nanoids). */
export const EMPTY_THREAD_ID = 'empty-thread';

export type RestoreChoice =
  | { kind: 'draft' }
  | { kind: 'conversation'; id: string }
  | { kind: 'none' };

export function pickRestoredConversation(stored: string | null, ids: string[]): RestoreChoice {
  // Checked before the list is consulted: an empty thread is a valid place to
  // land even when the account has no conversations at all.
  if (stored === EMPTY_THREAD_ID) return { kind: 'draft' };
  if (ids.length === 0) return { kind: 'none' };
  if (stored && ids.includes(stored)) return { kind: 'conversation', id: stored };
  // Unknown or absent id — a first visit, or a conversation deleted elsewhere.
  return { kind: 'conversation', id: ids[0] };
}

/**
 * What to persist for the currently open thread.
 *
 * The rule is "store it only if it can be reopened", not "store it unless it is
 * the current draft". Those differ: the auth effect clears draft state when
 * `user` resolves while activeConversationId still points at that draft, so
 * comparing against the draft id let an orphan nanoid reach storage. It is not
 * a real conversation, so the next load fell through to "open the newest" — the
 * reason a second reload escaped the empty thread.
 *
 * Never returns null; clearing the key is what caused the original bug.
 */
export function activeIdToStore(activeId: string, persistedIds: string[]): string {
  return persistedIds.includes(activeId) ? activeId : EMPTY_THREAD_ID;
}
