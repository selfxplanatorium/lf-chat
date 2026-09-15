import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { nanoid } from 'nanoid';
import { Conversation, Message, StreamingStatus } from '../types';
import * as api from '../services/apiClient';
import { streamClient, StreamEvent } from '../services/streamClient';
import { useAuth } from './useAuth';
import { useToast } from '../components/Toast';
import { translateApiError, useI18n } from '../i18n';
import { ACTIVE_ID_KEY, activeIdToStore, pickRestoredConversation } from '../lib/restoreActiveConversation';

const PAGE_SIZE = 50;
const MESSAGE_PAGE_SIZE = 12;
const AUTO_LOAD_BATCHES = 3;

function deriveStreamingStatus(conv: Conversation): StreamingStatus {
  if (conv.streamingStatus === 'interrupted') return 'interrupted';
  if (conv.streamingStatus === 'failed') return 'failed';
  if (conv.streamingStatus === 'streaming' || conv.streamingStatus === 'queued') return 'streaming';
  return null;
}

export function useConversations() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { t } = useI18n();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [draftConversation, setDraftConversation] = useState<Conversation | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const conversationsRef = useRef<Conversation[]>([]);
  const hasMoreRef = useRef(true);
  const activeConversationIdRef = useRef(activeConversationId);
  const draftConversationRef = useRef<Conversation | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const tRef = useRef(t);
  // Assistant message ids the user has locally stopped. n8n keeps streaming
  // after a cancel, so we ignore any further stream events for these ids to
  // stop them resurrecting the "streaming" state. A new send/retry gets a fresh
  // id, so it streams normally.
  const stoppedMessageIdsRef = useRef<Set<string>>(new Set());
  // Conversations whose messages have been fetched this session, so a switch (or
  // a hover prefetch) into them is instant from cache and never re-fetches.
  const loadedMsgIdsRef = useRef<Set<string>>(new Set());

  // Translation changes are presentation state, not a reason to reload chat
  // data. Keep the latest translator available to async error handlers without
  // making the initial conversation fetch depend on `t`'s changing identity.
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const fetchConversations = useCallback(async (loadMore = false) => {
    if (!user) return;
    try {
      const offset = loadMore ? conversationsRef.current.length : 0;
      const data = await api.getConversations(PAGE_SIZE, offset);

      if (data.length < PAGE_SIZE) {
        hasMoreRef.current = false;
      } else {
        hasMoreRef.current = true;
      }
      setHasMore(hasMoreRef.current);

      const normalized = data.map((c: api.ConversationData): Conversation => ({
        id: c.id,
        title: c.title,
        isUntitled: Boolean(c.isUntitled),
        messages: c.messages || [],
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        pinned: c.pinned,
        parentConversationId: c.parentConversationId,
        streamingStatus: (c.streamingStatus as StreamingStatus) || null,
        streamingMessageId: c.streamingMessageId || null,
        messageCount: c.messageCount,
      }));

      if (loadMore) {
        setConversations(prev => {
          const existingIds = new Set(prev.map(c => c.id));
          const newItems = normalized.filter(c => !existingIds.has(c.id));
          conversationsRef.current = [...prev, ...newItems];
          return conversationsRef.current;
        });
      } else {
        setConversations(normalized);
        conversationsRef.current = normalized;
      }
    } catch {
      if (!loadMore) {
        addToast('error', tRef.current('errors.loadConversations'));
      }
    }
  }, [user, addToast]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMoreRef.current) return;
    setIsLoadingMore(true);
    await fetchConversations(true);
    setIsLoadingMore(false);
  }, [fetchConversations, isLoadingMore]);

  useEffect(() => {
    if (!user) {
      draftConversationRef.current = null;
      setDraftConversation(null);
      setIsLoaded(true);
      return;
    }
    draftConversationRef.current = null;
    setDraftConversation(null);
    setIsLoaded(false);
    hasMoreRef.current = true;
    conversationsRef.current = [];
    fetchConversations(false).then(() => {
      setIsLoaded(true);
    }).catch(() => {
      setIsLoaded(true);
    });
  }, [user, fetchConversations]);


  useEffect(() => {
    // Never clear the key. Removing it made "on an empty thread" and "never
    // opened anything" look identical on the next load, so reloading from a new
    // chat silently threw you back into the most recent conversation.
    if (!activeConversationId) return;
    // Compared against the loaded list rather than the draft id — see
    // activeIdToStore. `conversations` (state, not the ref) is deliberate: the
    // auth effect empties the ref mid-flight, and reading that would briefly
    // make a perfectly good conversation look unreopenable.
    localStorage.setItem(
      ACTIVE_ID_KEY,
      activeIdToStore(activeConversationId, conversations.map(conversation => conversation.id)),
    );
  }, [activeConversationId, conversations]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (!activeConversationId || !user || draftConversation?.id === activeConversationId) return;

    unsubscribeRef.current = streamClient.subscribe(activeConversationId, (event: StreamEvent) => {

      if (event.type === 'snapshot' && event.conversation) {
        const snap = event.conversation;
        const msgCount = event.messageCount ?? snap.messageCount ?? snap.messages.length;

        function update(list: Conversation[]) {
          const idx = list.findIndex(c => c.id === snap.id);
          if (idx === -1) return list;
          const next = list.slice();
          const existing = list[idx];

          // The snapshot is the authoritative tail (its last N messages). Keep
          // any locally-loaded OLDER messages that sit before that tail
          // (paginated history), but drop anything the server no longer has —
          // e.g. after an edit/retry truncation — by capping kept history to the
          // server's reported total. Matching by id avoids duplicating messages
          // that the REST fast-load already placed in the same window.
          const snapIds = new Set(snap.messages.map(m => m.id));
          const olderLocal = existing.messages.filter(m => !snapIds.has(m.id));
          const maxOlder = Math.max(0, msgCount - snap.messages.length);
          const keptOlder = olderLocal.slice(Math.max(0, olderLocal.length - maxOlder));
          // If the server still reports this generation as streaming but the
          // user already stopped it locally, keep it stopped (n8n ignores the
          // cancel and would otherwise resurrect the streaming UI on reconnect).
          const isLocallyStopped = !!snap.streamingMessageId && stoppedMessageIdsRef.current.has(snap.streamingMessageId);
          const mergedMessages = (isLocallyStopped
            ? [...keptOlder, ...snap.messages.map(m => m.id === snap.streamingMessageId ? { ...m, isStopped: true } : m)]
            : [...keptOlder, ...snap.messages]);

          next[idx] = {
            ...existing,
            messages: mergedMessages,
            messageCount: msgCount,
            title: snap.title,
            isUntitled: Boolean(snap.isUntitled),
            updatedAt: snap.updatedAt,
            streamingStatus: isLocallyStopped ? null : ((snap.streamingStatus as StreamingStatus) || null),
            streamingMessageId: isLocallyStopped ? null : (snap.streamingMessageId || null),
            pinned: snap.pinned,
            parentConversationId: snap.parentConversationId,
          };
          return next;
        }

        setConversations(prev => update(prev));
        conversationsRef.current = update(conversationsRef.current);
        return;
      }

      if (event.messageId && stoppedMessageIdsRef.current.has(event.messageId)) return;

      if (event.type === 'delta' && event.messageId && event.content !== undefined) {
        const update = (prev: Conversation[]): Conversation[] => prev.map(c => {
          if (c.id !== event.conversationId) return c;
          return {
            ...c,
            messages: c.messages.map(m =>
              m.id === event.messageId
                ? { ...m, content: (!m.content || event.content!.length >= m.content.length) ? event.content! : m.content }
                : m
            ),
            updatedAt: Date.now(),
            streamingStatus: 'streaming' as const,
            streamingMessageId: event.messageId,
          };
        });
        setConversations(update);
        conversationsRef.current = update(conversationsRef.current);
        return;
      }

      if (event.type === 'completed') {
        const update = (prev: Conversation[]): Conversation[] => prev.map(c => {
          if (c.id === event.conversationId) {
            return { ...c, streamingStatus: null, streamingMessageId: null, updatedAt: Date.now() };
          }
          return c;
        });
        setConversations(update);
        conversationsRef.current = update(conversationsRef.current);
        return;
      }

      if (event.type === 'failed') {
        const update = (prev: Conversation[]): Conversation[] => prev.map(c => {
          if (c.id === event.conversationId) {
            return {
              ...c,
              streamingStatus: 'failed' as const,
              streamingMessageId: null,
              updatedAt: Date.now(),
              messages: c.messages.map(m =>
                m.id === event.messageId ? { ...m, role: 'error' as const } : m
              ),
            };
          }
          return c;
        });
        setConversations(update);
        conversationsRef.current = update(conversationsRef.current);
        return;
      }

      if (event.type === 'cancelled') {
        const update = (prev: Conversation[]): Conversation[] => prev.map(c => {
          if (c.id === event.conversationId) {
            return {
              ...c,
              streamingStatus: null,
              streamingMessageId: null,
              updatedAt: Date.now(),
              messages: c.messages.map(m =>
                m.id === event.messageId ? { ...m, isStopped: true } : m
              ),
            };
          }
          return c;
        });
        setConversations(update);
        conversationsRef.current = update(conversationsRef.current);
        return;
      }
    }, { messageLimit: MESSAGE_PAGE_SIZE });

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [activeConversationId, user, draftConversation?.id]);

  const syncConversation = useCallback((convId: string, data: { title?: string; messages?: Message[]; pinned?: boolean }) => {
    api.updateConversation(convId, data as any).catch(() => { });
  }, []);

  const loadMoreMessages = useCallback(async (convId: string) => {
    const conv = conversationsRef.current.find(c => c.id === convId);
    if (!conv || isLoadingMessages) return;

    const totalCount = conv.messageCount ?? conv.messages.length;
    if (conv.messages.length >= totalCount) return;

    setIsLoadingMessages(true);
    try {
      const olderCount = totalCount - conv.messages.length;
      const fetchLimit = Math.min(MESSAGE_PAGE_SIZE, olderCount);
      const fetchOffset = Math.max(0, totalCount - conv.messages.length - fetchLimit);
      const result = await api.getConversationMessages(convId, fetchLimit, fetchOffset);

      const newMessages = result.messages as Message[];
      if (newMessages.length === 0) return;

      setConversations(prev => prev.map(c => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: [...newMessages, ...c.messages],
          messageCount: result.total,
        };
      }));
      conversationsRef.current = conversationsRef.current.map(c => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: [...newMessages, ...c.messages],
          messageCount: result.total,
        };
      });
    } catch {
      addToast('error', t('errors.loadEarlierMessages'));
    } finally {
      setIsLoadingMessages(false);
    }
  }, [isLoadingMessages, addToast, t]);

  // Load a conversation's most-recent messages directly via REST instead of
  // waiting for the SSE snapshot. This is what makes switching feel instant and
  // lets us prefetch on hover. Idempotent and safe to call repeatedly.
  const ensureMessagesLoaded = useCallback(async (convId: string) => {
    if (!convId) return;
    const conv = conversationsRef.current.find(c => c.id === convId);
    if (!conv) return;

    const total = conv.messageCount ?? conv.messages.length;
    // A non-empty server summary with no local messages is never fully loaded,
    // even if a stale cache marker says otherwise. This invariant prevents the
    // thread skeleton from becoming permanent after any summary-only refresh.
    if (loadedMsgIdsRef.current.has(convId) && !(total > 0 && conv.messages.length === 0)) return;
    if (total === 0 || conv.messages.length >= total) {
      loadedMsgIdsRef.current.add(convId);
      return;
    }

    loadedMsgIdsRef.current.add(convId); // mark early so hover+click don't double-fetch
    try {
      const limit = MESSAGE_PAGE_SIZE;
      const offset = Math.max(0, total - limit);
      const result = await api.getConversationMessages(convId, limit, offset);
      // Only fill if the SSE snapshot hasn't already populated this conversation,
      // so we never clobber live streaming content with a static fetch.
      const apply = (c: Conversation): Conversation =>
        c.id === convId && c.messages.length === 0
          ? { ...c, messages: result.messages as Message[], messageCount: result.total }
          : c;
      setConversations(prev => prev.map(apply));
      conversationsRef.current = conversationsRef.current.map(apply);
    } catch {
      loadedMsgIdsRef.current.delete(convId); // allow a retry on next switch/hover
    }
  }, []);

  const activeConversation = conversations.find(c => c.id === activeConversationId)
    || (draftConversation?.id === activeConversationId ? draftConversation : null);

  useEffect(() => {
    if (activeConversationId && user) ensureMessagesLoaded(activeConversationId);
  }, [
    activeConversationId,
    activeConversation?.messageCount,
    activeConversation?.messages.length,
    user,
    ensureMessagesLoaded,
  ]);

  const isCurrentEmpty = activeConversation
    ? (activeConversation.messageCount ?? activeConversation.messages.length) === 0
    : false;
  const hasAnyEmptyConversation = conversations.some(
    conversation => (conversation.messageCount ?? conversation.messages.length) === 0
  );

  const hasMoreMessages = activeConversation
    ? (activeConversation.messageCount ?? activeConversation.messages.length) > activeConversation.messages.length
    : false;

  const autoLoadCountRef = useRef(0);
  const prevAutoConvRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeConversationId || !activeConversation) return;
    if (!hasMoreMessages || isLoadingMessages) return;
    if (activeConversation.messages.length === 0) return;

    if (prevAutoConvRef.current !== activeConversationId) {
      autoLoadCountRef.current = 0;
      prevAutoConvRef.current = activeConversationId;
    }

    if (autoLoadCountRef.current >= AUTO_LOAD_BATCHES) return;

    const timer = setTimeout(() => {
      autoLoadCountRef.current += 1;
      loadMoreMessages(activeConversationId);
    }, 200);
    return () => clearTimeout(timer);
  }, [activeConversationId, activeConversation?.messages?.length, hasMoreMessages, isLoadingMessages]);

  const createConversation = useCallback(() => {
    const existingDraft = draftConversationRef.current;
    if (existingDraft) {
      activeConversationIdRef.current = existingDraft.id;
      setActiveConversationId(existingDraft.id);
      return existingDraft;
    }

    // All creation entry points share this content-based guard. A summary with
    // unloaded messages has a positive messageCount and is not mistaken for an
    // empty draft; localized or user-edited titles never affect the decision.
    const activeConversation = conversationsRef.current.find(
      conversation => conversation.id === activeConversationIdRef.current
    );
    if (
      activeConversation &&
      (activeConversation.messageCount ?? activeConversation.messages.length) === 0
    ) {
      return activeConversation;
    }

    const newConv: Conversation = {
      id: nanoid(),
      title: '',
      isUntitled: true,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      streamingStatus: null,
      streamingMessageId: null,
    };
    draftConversationRef.current = newConv;
    setDraftConversation(newConv);
    activeConversationIdRef.current = newConv.id;
    setActiveConversationId(newConv.id);
    return newConv;
  }, []);

  // Declared after createConversation because it calls it on the restore path.
  useEffect(() => {
    // `user` matters: the auth effect flips isLoaded true once before the user
    // resolves, and restoring then would build a draft against an empty list
    // that the same effect immediately wipes.
    if (!user || !isLoaded || activeConversationId) return;
    const choice = pickRestoredConversation(
      localStorage.getItem(ACTIVE_ID_KEY),
      conversationsRef.current.map(conversation => conversation.id),
    );
    // A stored draft becomes a fresh local draft: same visible state, and it
    // keeps isCurrentEmpty/disableNew correct, which a bare null id would not.
    if (choice.kind === 'draft') createConversation();
    else if (choice.kind === 'conversation') setActiveConversationId(choice.id);
  }, [user, isLoaded, activeConversationId, createConversation]);

  const deleteConversation = useCallback((id: string) => {
    const conv = conversationsRef.current.find(c => c.id === id);
    if (!conv) return;

    streamClient.close(id);
    setConversations(prev => prev.filter(c => c.id !== id));
    conversationsRef.current = conversationsRef.current.filter(c => c.id !== id);
    const wasActive = activeConversationId === id;
    if (wasActive) {
      setActiveConversationId(null);
    }
    api.deleteConversation(id).catch(() => {
      setConversations(prev => {
        if (prev.some(c => c.id === id)) return prev;
        return [...prev, conv];
      });
      conversationsRef.current = [...conversationsRef.current, conv];
      if (wasActive) {
        setActiveConversationId(id);
      }
    });
  }, [activeConversationId]);

  const renameConversation = useCallback((id: string, newTitle: string) => {
    const previousConversation = conversations.find(c => c.id === id);
    setConversations(prev => prev.map(c =>
      c.id === id ? { ...c, title: newTitle, isUntitled: false, updatedAt: Date.now() } : c
    ));
    api.updateConversation(id, { title: newTitle }).catch(() => {
      if (previousConversation) {
        setConversations(prev => prev.map(c =>
          c.id === id
            ? { ...c, title: previousConversation.title, isUntitled: previousConversation.isUntitled }
            : c
        ));
      }
    });
  }, [conversations]);

  const pinConversation = useCallback((id: string, pinned: boolean) => {
    const prevPinned = conversations.find(c => c.id === id)?.pinned;
    setConversations(prev => prev.map(c =>
      c.id === id ? { ...c, pinned, updatedAt: Date.now() } : c
    ));
    api.updateConversation(id, { pinned }).catch(() => {
      setConversations(prev => prev.map(c =>
        c.id === id ? { ...c, pinned: prevPinned } : c
      ));
    });
  }, [conversations]);

  const sendMessage = useCallback(async (content: string): Promise<boolean> => {
    let convId = activeConversationIdRef.current;

    if (!convId) {
      const newConv = createConversation();
      convId = newConv.id;
    }

    const draft = draftConversationRef.current;
    const isDraft = draft?.id === convId;

    const idempotencyKey = nanoid();

    try {
      await api.sendMessage(convId, content, idempotencyKey);

      if (isDraft && draft) {
        const persistedConversation: Conversation = {
          ...draft,
          streamingStatus: 'streaming',
        };
        draftConversationRef.current = null;
        setDraftConversation(null);
        setConversations(prev => [persistedConversation, ...prev.filter(c => c.id !== convId)]);
        conversationsRef.current = [persistedConversation, ...conversationsRef.current.filter(c => c.id !== convId)];
      }

      const plain = content
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/_(.+?)_/g, '$1')
        .replace(/~~(.+?)~~/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^>\s+/gm, '')
        .replace(/^[-*+]\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '');
      const newTitle = plain.length > 30 ? plain.slice(0, 30) + '...' : plain;
      setConversations(prev => prev.map(c => {
        if (c.id !== convId || c.messages.length > 0) return c;
        return { ...c, title: newTitle, isUntitled: false };
      }));
      conversationsRef.current = conversationsRef.current.map(c => {
        if (c.id !== convId || c.messages.length > 0) return c;
        return { ...c, title: newTitle, isUntitled: false };
      });
      return true;
    } catch (err: any) {
      addToast('error', err?.message ? translateApiError(err.message, t) : t('errors.sendMessage'));
      return false;
    }
  }, [createConversation, addToast, t]);

  const editMessage = useCallback(async (conversationId: string, messageId: string, newContent: string) => {
    try {
      await api.editMessage(conversationId, messageId, newContent);
      // The open SSE subscription receives a fresh snapshot (the generation
      // manager emits one on start); the id-aware merge reconciles the
      // truncation in place. No teardown — that caused a welcome-screen flash.
    } catch (err: any) {
      addToast('error', err?.message ? translateApiError(err.message, t) : t('errors.editMessage'));
    }
  }, [addToast, t]);

  const branchConversation = useCallback(async (conversationId: string, messageId: string, content?: string) => {
    try {
      const result = await api.branchConversation(conversationId, messageId, content);
      const newConv: Conversation = {
        id: result.id,
        title: result.title,
        isUntitled: Boolean(result.isUntitled),
        messages: result.messages || [],
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        pinned: false,
        parentConversationId: result.parentConversationId,
        streamingStatus: (result.streamingStatus as StreamingStatus) || null,
        streamingMessageId: result.streamingMessageId || null,
      };

      setConversations(prev => [newConv, ...prev]);
      conversationsRef.current = [newConv, ...conversationsRef.current];
      setActiveConversationId(newConv.id);
    } catch (err: any) {
      addToast('error', err?.message ? translateApiError(err.message, t) : t('errors.branchConversation'));
    }
  }, [addToast, t]);

  const retryMessage = useCallback(async (conversationId: string, messageId?: string) => {
    try {
      await api.retryGeneration(conversationId, messageId);
      // Same as edit: rely on the live snapshot + id-aware merge rather than
      // tearing the stream down and flashing the welcome screen.
    } catch (err: any) {
      addToast('error', err?.message ? translateApiError(err.message, t) : t('errors.retry'));
    }
  }, [addToast, t]);

  const stopResponse = useCallback((convId?: string) => {
    const id = (typeof convId === 'string' ? convId : null) ?? activeConversationIdRef.current;
    if (!id) return;

    const stoppingConv = conversationsRef.current.find(c => c.id === id);
    if (stoppingConv?.streamingMessageId) {
      stoppedMessageIdsRef.current.add(stoppingConv.streamingMessageId);
    }

    setConversations(prev => prev.map(c => {
      if (c.id !== id || c.streamingStatus !== 'streaming') return c;
      return {
        ...c,
        streamingStatus: null,
        streamingMessageId: null,
        messages: c.messages.map(m =>
          m.id === c.streamingMessageId ? { ...m, isStopped: true } : m
        ),
      };
    }));

    api.cancelGeneration(id).catch((err) => {
      addToast('error', err?.message ? translateApiError(err.message, t) : t('errors.stopGeneration'));
    });
  }, [addToast, t]);

  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [conversations]);

  const sidebarConversations = sortedConversations.filter(c => {
    return c.id !== draftConversation?.id;
  });

  const activeStreamingState = activeConversationId && activeConversation
    ? (activeConversation.streamingStatus === 'streaming' ? {
      conversationId: activeConversation.id,
      messageId: activeConversation.streamingMessageId || '',
      buffer: '',
    } : null)
    : null;

  return {
    conversations: sortedConversations,
    sidebarConversations,
    activeConversation,
    activeConversationId,
    setActiveConversationId,
    createConversation,
    deleteConversation,
    renameConversation,
    pinConversation,
    prefetchConversation: ensureMessagesLoaded,
    sendMessage,
    editMessage,
    branchConversation,
    retryMessage,
    stopResponse,
    streamingStates: {} as Record<string, any>,
    activeStreamingState,
    isCurrentEmpty,
    hasAnyEmptyConversation,
    isLoaded,
    hasMore,
    isLoadingMore,
    loadMore,
    isLoadingMessages,
    hasMoreMessages,
    loadMoreMessages,
  };
}
