import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { nanoid } from 'nanoid';
import { Conversation } from '../types';
import * as api from '../services/apiClient';
import { streamClient, StreamEvent } from '../services/streamClient';
import { useAuth } from './useAuth';
import { useToast } from '../components/Toast';
import { translateApiError, useI18n } from '../i18n';
import { applyStreamEvent, normalizeConversation } from '../lib/conversationState';
import { ACTIVE_ID_KEY, activeIdToStore, pickRestoredConversation } from '../lib/restoreActiveConversation';

const PAGE_SIZE = 50;
const MESSAGE_PAGE_SIZE = 12;
const AUTO_LOAD_BATCHES = 3;

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
  // Async handlers read this same value; every mutation updates both together.
  const updateConversations = useCallback((update: Conversation[] | ((previous: Conversation[]) => Conversation[])) => {
    const next = typeof update === 'function' ? update(conversationsRef.current) : update;
    conversationsRef.current = next;
    setConversations(next);
  }, []);
  const sessionRef = useRef(0);
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

  const reportError = useCallback((error: unknown, fallbackKey: string) => {
    const translate = tRef.current;
    addToast('error', error instanceof Error ? translateApiError(error.message, translate) : translate(fallbackKey));
  }, [addToast]);

  const fetchConversations = useCallback(async (loadMore = false) => {
    if (!user) return;
    const session = sessionRef.current;
    try {
      const offset = loadMore ? conversationsRef.current.length : 0;
      const data = await api.getConversations(PAGE_SIZE, offset);
      if (session !== sessionRef.current) return;

      if (data.length < PAGE_SIZE) {
        hasMoreRef.current = false;
      } else {
        hasMoreRef.current = true;
      }
      setHasMore(hasMoreRef.current);

      const normalized = data.map(normalizeConversation);

      if (loadMore) {
        updateConversations(prev => {
          const existingIds = new Set(prev.map(c => c.id));
          const newItems = normalized.filter(c => !existingIds.has(c.id));
          return [...prev, ...newItems];
        });
      } else {
        updateConversations(normalized);
      }
    } catch {
      if (!loadMore && session === sessionRef.current) {
        addToast('error', tRef.current('errors.loadConversations'));
      }
    }
  }, [user, addToast]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMoreRef.current) return;
    const session = sessionRef.current;
    setIsLoadingMore(true);
    await fetchConversations(true);
    if (session === sessionRef.current) setIsLoadingMore(false);
  }, [fetchConversations, isLoadingMore]);

  useEffect(() => {
    const session = ++sessionRef.current;
    setIsLoadingMessages(false);
    setIsLoadingMore(false);
    if (!user) {
      draftConversationRef.current = null;
      setDraftConversation(null);
      updateConversations([]);
      setActiveConversationId(null);
      setIsLoaded(true);
      return;
    }
    draftConversationRef.current = null;
    setDraftConversation(null);
    setIsLoaded(false);
    hasMoreRef.current = true;
    updateConversations([]);
    loadedMsgIdsRef.current.clear();
    stoppedMessageIdsRef.current.clear();
    setActiveConversationId(null);
    fetchConversations(false).then(() => {
      if (session === sessionRef.current) setIsLoaded(true);
    }).catch(() => {
      if (session === sessionRef.current) setIsLoaded(true);
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
      updateConversations(list => list.map(conversation =>
        applyStreamEvent(conversation, event, stoppedMessageIdsRef.current)
      ));
    }, { messageLimit: MESSAGE_PAGE_SIZE });

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [activeConversationId, user, draftConversation?.id]);

  const loadMoreMessages = useCallback(async (convId: string) => {
    const conv = conversationsRef.current.find(c => c.id === convId);
    if (!conv || isLoadingMessages) return;

    const totalCount = conv.messageCount ?? conv.messages.length;
    if (conv.messages.length >= totalCount) return;

    setIsLoadingMessages(true);
    const session = sessionRef.current;
    try {
      const olderCount = totalCount - conv.messages.length;
      const fetchLimit = Math.min(MESSAGE_PAGE_SIZE, olderCount);
      const fetchOffset = Math.max(0, totalCount - conv.messages.length - fetchLimit);
      const result = await api.getConversationMessages(convId, fetchLimit, fetchOffset);
      if (session !== sessionRef.current) return;

      const newMessages = result.messages;
      if (newMessages.length === 0) return;

      updateConversations(prev => prev.map(c => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: [...newMessages, ...c.messages],
          messageCount: result.total,
        };
      }));
    } catch {
      if (session === sessionRef.current) addToast('error', t('errors.loadEarlierMessages'));
    } finally {
      if (session === sessionRef.current) setIsLoadingMessages(false);
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

    const session = sessionRef.current;
    loadedMsgIdsRef.current.add(convId); // mark early so hover+click don't double-fetch
    try {
      const limit = MESSAGE_PAGE_SIZE;
      const offset = Math.max(0, total - limit);
      const result = await api.getConversationMessages(convId, limit, offset);
      if (session !== sessionRef.current) return;
      // Only fill if the SSE snapshot hasn't already populated this conversation,
      // so we never clobber live streaming content with a static fetch.
      const apply = (c: Conversation): Conversation =>
        c.id === convId && c.messages.length === 0
          ? { ...c, messages: result.messages, messageCount: result.total }
          : c;
      updateConversations(prev => prev.map(apply));
    } catch {
      if (session === sessionRef.current) loadedMsgIdsRef.current.delete(convId); // allow a retry on next switch/hover
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
    const session = sessionRef.current;

    streamClient.close(id);
    updateConversations(prev => prev.filter(c => c.id !== id));
    const wasActive = activeConversationId === id;
    if (wasActive) {
      setActiveConversationId(null);
    }
    api.deleteConversation(id).catch(() => {
      if (session !== sessionRef.current) return;
      updateConversations(prev => {
        if (prev.some(c => c.id === id)) return prev;
        return [...prev, conv];
      });
      if (wasActive) {
        setActiveConversationId(id);
      }
    });
  }, [activeConversationId]);

  const renameConversation = useCallback((id: string, newTitle: string) => {
    const previousConversation = conversations.find(c => c.id === id);
    updateConversations(prev => prev.map(c =>
      c.id === id ? { ...c, title: newTitle, isUntitled: false, updatedAt: Date.now() } : c
    ));
    api.updateConversation(id, { title: newTitle }).catch(() => {
      if (previousConversation) {
        updateConversations(prev => prev.map(c =>
          c.id === id
            ? { ...c, title: previousConversation.title, isUntitled: previousConversation.isUntitled }
            : c
        ));
      }
    });
  }, [conversations]);

  const pinConversation = useCallback((id: string, pinned: boolean) => {
    const prevPinned = conversations.find(c => c.id === id)?.pinned;
    updateConversations(prev => prev.map(c =>
      c.id === id ? { ...c, pinned, updatedAt: Date.now() } : c
    ));
    api.updateConversation(id, { pinned }).catch(() => {
      updateConversations(prev => prev.map(c =>
        c.id === id ? { ...c, pinned: prevPinned } : c
      ));
    });
  }, [conversations]);

  const sendMessage = useCallback(async (content: string, attachmentIds?: string[]): Promise<boolean> => {
    let convId = activeConversationIdRef.current;

    if (!convId) {
      const newConv = createConversation();
      convId = newConv.id;
    }

    const draft = draftConversationRef.current;
    const isDraft = draft?.id === convId;

    const session = sessionRef.current;
    const idempotencyKey = nanoid();

    try {
      await api.sendMessage(convId, content, idempotencyKey, attachmentIds);
      if (session !== sessionRef.current) return false;

      if (isDraft && draft) {
        const persistedConversation: Conversation = {
          ...draft,
          streamingStatus: 'streaming',
        };
        draftConversationRef.current = null;
        setDraftConversation(null);
        updateConversations(prev => [persistedConversation, ...prev.filter(c => c.id !== convId)]);
      }

      return true;
    } catch (err: unknown) {
      reportError(err, 'errors.sendMessage');
      return false;
    }
  }, [createConversation, reportError]);

  const editMessage = useCallback(async (conversationId: string, messageId: string, newContent: string) => {
    try {
      await api.editMessage(conversationId, messageId, newContent);
      // The open SSE subscription receives a fresh snapshot (the generation
      // manager emits one on start); the id-aware merge reconciles the
      // truncation in place. No teardown — that caused a welcome-screen flash.
    } catch (err: unknown) {
      reportError(err, 'errors.editMessage');
    }
  }, [reportError]);

  const branchConversation = useCallback(async (conversationId: string, messageId: string, content?: string) => {
    const session = sessionRef.current;
    try {
      const result = await api.branchConversation(conversationId, messageId, content);
      if (session !== sessionRef.current) return;
      const newConv = normalizeConversation(result);

      updateConversations(prev => [newConv, ...prev]);
      setActiveConversationId(newConv.id);
    } catch (err: unknown) {
      reportError(err, 'errors.branchConversation');
    }
  }, [reportError]);

  const retryMessage = useCallback(async (conversationId: string, messageId?: string) => {
    try {
      await api.retryGeneration(conversationId, messageId);
      // Same as edit: rely on the live snapshot + id-aware merge rather than
      // tearing the stream down and flashing the welcome screen.
    } catch (err: unknown) {
      reportError(err, 'errors.retry');
    }
  }, [reportError]);

  const stopResponse = useCallback((convId?: string) => {
    const id = (typeof convId === 'string' ? convId : null) ?? activeConversationIdRef.current;
    if (!id) return;

    const stoppingConv = conversationsRef.current.find(c => c.id === id);
    if (stoppingConv?.streamingMessageId) {
      stoppedMessageIdsRef.current.add(stoppingConv.streamingMessageId);
    }

    updateConversations(prev => prev.map(c => {
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
      reportError(err, 'errors.stopGeneration');
    });
  }, [reportError]);

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

  const isStreaming = activeConversation?.streamingStatus === 'streaming';

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
    isStreaming,
    isCurrentEmpty,
    isLoaded,
    hasMore,
    isLoadingMore,
    loadMore,
    isLoadingMessages,
    hasMoreMessages,
    loadMoreMessages,
  };
}
