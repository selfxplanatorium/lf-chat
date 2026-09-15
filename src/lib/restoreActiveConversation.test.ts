/**
 * Run: npx tsx src/lib/restoreActiveConversation.test.ts
 *
 * Not bundled — Vite only includes what the entry reaches.
 */
import assert from 'node:assert/strict';
import {
  EMPTY_THREAD_ID,
  activeIdToStore,
  pickRestoredConversation,
} from './restoreActiveConversation';

const ids = ['conv-newest', 'conv-older'];

// The regression: reloading while on an empty new chat must stay on an empty
// chat, not fall through to the newest conversation.
assert.deepEqual(pickRestoredConversation(EMPTY_THREAD_ID, ids), { kind: 'draft' });
assert.deepEqual(pickRestoredConversation(EMPTY_THREAD_ID, []), { kind: 'draft' });

// A stored conversation is still restored.
assert.deepEqual(pickRestoredConversation('conv-older', ids), { kind: 'conversation', id: 'conv-older' });

// First visit, or an id that no longer exists, opens the newest conversation.
assert.deepEqual(pickRestoredConversation(null, ids), { kind: 'conversation', id: 'conv-newest' });
assert.deepEqual(pickRestoredConversation('conv-deleted', ids), { kind: 'conversation', id: 'conv-newest' });

// Nothing to open and nothing stored.
assert.deepEqual(pickRestoredConversation(null, []), { kind: 'none' });

// The write side must never produce an empty value — clearing the key is what
// made a draft look like a first visit.
assert.equal(activeIdToStore('conv-older', ids), 'conv-older');
assert.equal(activeIdToStore('draft-1', ids), EMPTY_THREAD_ID);
assert.equal(activeIdToStore('draft-1', []), EMPTY_THREAD_ID);

// The two-reload regression: when the auth effect clears draft state while the
// active id still points at that draft, the orphan id must NOT be stored as if
// it were a reopenable conversation — that is what sent the second reload back
// into the newest chat.
const orphanDraftId = 'V1StGXR8Z5jdHi6BmyT8K';
assert.equal(activeIdToStore(orphanDraftId, ids), EMPTY_THREAD_ID);
assert.deepEqual(
  pickRestoredConversation(activeIdToStore(orphanDraftId, ids), ids),
  { kind: 'draft' },
);

// --- Sequence check: the reported "reload twice" bug ---------------------
//
// Models one page load end to end, including the auth effect that clears draft
// state after `user` resolves while activeConversationId still points at the
// draft. That interleaving is what corrupted storage, so a single-call check
// would not have caught it.
function simulateLoad(stored: string | null, persistedIds: string[]) {
  let activeId: string | null = null;
  let draftId: string | null = null;

  // Restore runs only once the user is known and the list has loaded.
  const choice = pickRestoredConversation(stored, persistedIds);
  if (choice.kind === 'draft') {
    draftId = 'draft-' + Math.random().toString(36).slice(2);
    activeId = draftId;
  } else if (choice.kind === 'conversation') {
    activeId = choice.id;
  }

  // The auth effect wipes draft state while activeId still references it.
  draftId = null;

  const written = activeId ? activeIdToStore(activeId, persistedIds) : stored;
  return { activeId, onEmptyThread: choice.kind === 'draft', written, draftId };
}

// Start: the user was sitting on an empty new chat.
let storage: string | null = EMPTY_THREAD_ID;

const first = simulateLoad(storage, ids);
assert.equal(first.onEmptyThread, true, 'first reload should stay on the empty thread');
storage = first.written;

const second = simulateLoad(storage, ids);
assert.equal(second.onEmptyThread, true, 'second reload should ALSO stay on the empty thread');
storage = second.written;

const third = simulateLoad(storage, ids);
assert.equal(third.onEmptyThread, true, 'and it must not drift on any later reload');

// A real conversation still survives the same interleaving, repeatedly.
storage = 'conv-older';
for (let i = 0; i < 3; i++) {
  const load = simulateLoad(storage, ids);
  assert.equal(load.activeId, 'conv-older', 'a real conversation must reopen every time');
  storage = load.written;
}

console.log('restoreActiveConversation self-check passed');
