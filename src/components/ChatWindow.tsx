import React, { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { Conversation } from '../types';
import { MessageItem } from './MessageItem';
import { MessageListSkeleton } from './Skeletons';
import { motion } from 'motion/react';
import { useI18n } from '../i18n';

interface ChatWindowProps {
  conversation: Conversation | null;
  isStreaming: boolean;
  onEditMessage: (messageId: string, content: string) => void;
  onBranchMessage?: (messageId: string) => void;
  onRetryMessage?: (messageId: string) => void;
  sendWithCtrlEnter?: boolean;
  themeMode?: 'light' | 'dark';
  confirmEditMessage?: boolean;
  inputBar?: React.ReactNode;
  onLoadMoreMessages?: () => void;
  hasMoreMessages?: boolean;
  isLoadingMessages?: boolean;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  conversation, 
  isStreaming, 
  onEditMessage,
  onBranchMessage,
  onRetryMessage,
  sendWithCtrlEnter = true,
  themeMode = 'dark',
  confirmEditMessage = true,
  inputBar,
  onLoadMoreMessages,
  hasMoreMessages = false,
  isLoadingMessages = false,
}) => {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const userHasScrolledUp = useRef(false);
  const prevLoadingMessages = useRef(false);
  // Distance-from-bottom captured when an older-message load is triggered. It is
  // invariant under prepending, so restoring it after the new messages render
  // keeps the viewport visually anchored instead of jumping.
  const pendingAnchorRef = useRef<number | null>(null);

  // The input bar floats over the scroll area (messages scroll behind its
  // frosted glass), so the scroll content can't see its height. Measure it and
  // reserve that much bottom padding + a gap, so the last bubble can always
  // scroll clear of the bar. A *callback ref* wires the ResizeObserver up
  // exactly when the bar mounts — robust across the empty→populated branch
  // switch, which is where a plain ref left the height stuck at 0. On every
  // resize we also re-pin to the bottom (when already there) so the bar growing
  // *upward* rides the last bubble up instead of covering it.
  const [inputBarHeight, setInputBarHeight] = useState(0);
  const inputBarObserverRef = useRef<ResizeObserver | null>(null);
  // Width of the scroll content (excludes the stable scrollbar gutter) so the
  // floating bar aligns with the message column instead of the gutter.
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const updateWidth = () => setContentWidth(el.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const measureInputBar = useCallback((node: HTMLDivElement | null) => {
    inputBarObserverRef.current?.disconnect();
    if (!node) return;
    const update = () => {
      setInputBarHeight(node.offsetHeight);
      const sc = scrollRef.current;
      if (sc && !userHasScrolledUp.current) sc.scrollTop = sc.scrollHeight;
    };
    update();
    inputBarObserverRef.current = new ResizeObserver(update);
    inputBarObserverRef.current.observe(node);
  }, []);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    userHasScrolledUp.current = !isNearBottom;

    if (scrollTop < 200 && hasMoreMessages && onLoadMoreMessages && !isLoadingMessages) {
      pendingAnchorRef.current = scrollHeight - scrollTop;
      onLoadMoreMessages();
    }
  };

  // Restore the captured distance-from-bottom after older messages prepend, so
  // the user's reading position stays put instead of jumping to the top.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pendingAnchorRef.current != null) {
      el.scrollTop = el.scrollHeight - pendingAnchorRef.current;
      pendingAnchorRef.current = null;
    }
  });

  useEffect(() => {
    userHasScrolledUp.current = false;
  }, [conversation?.id]);

  useEffect(() => {
    if (scrollRef.current && !userHasScrolledUp.current) {
      const el = scrollRef.current;
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
      });
    }
  }, [conversation?.messages, isStreaming]);

  useEffect(() => {
    if (prevLoadingMessages.current && !isLoadingMessages && !userHasScrolledUp.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' });
      });
    }
    prevLoadingMessages.current = isLoadingMessages;
  }, [isLoadingMessages]);

  // A selected conversation whose messages haven't arrived yet (list metadata
  // reports a count, but the message array is still empty) is *loading*, not
  // empty. Showing a skeleton here is what stops the welcome screen from
  // flashing on every first switch into a conversation.
  const isLoadingConversation =
    !!conversation &&
    conversation.messages.length === 0 &&
    (conversation.messageCount ?? 0) > 0;

  if (!conversation || (conversation.messages.length === 0 && !isLoadingConversation)) {
    return (
      <div className="flex-1 min-h-0 flex flex-col min-w-0">
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <p className="text-text-primary max-w-sm text-4xl font-display uppercase tracking-tighter leading-none mb-8">
            LF <span className="text-accent underline decoration-4 underline-offset-8">CHAT</span>
          </p>
        </div>
        {inputBar && (
          <div className="shrink-0 max-w-3xl mx-auto w-full px-4 md:px-8 bg-transparent">
            {inputBar}
          </div>
        )}
      </div>
);
  }

  const isInterrupted = conversation.streamingStatus === 'interrupted';
  const interruptedMessageId = conversation.streamingMessageId;

  return (
    <div className="relative flex-1 min-h-0 min-w-0 flex flex-col">
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto pt-20 [scrollbar-gutter:stable] [overscroll-behavior:contain] [overflow-anchor:none]"
      >
          {isLoadingConversation ? (
            <MessageListSkeleton />
          ) : (
          <div className="max-w-3xl mx-auto w-full px-4 md:px-8 space-y-10"
            style={{ paddingBottom: Math.max(120, inputBarHeight + 40) }}>
              {conversation.messages.map((msg, idx) => {
                const isLast = idx === conversation.messages.length - 1;
                if (isStreaming && msg.role === 'assistant' && !msg.content && isLast) {
                  return null;
                }

                const isInterruptedMessage = isInterrupted && msg.id === interruptedMessageId;

                const isStreamingMessage = isStreaming && msg.role === 'assistant' && isLast;

                return (
                  <MessageItem 
                    key={msg.id} 
                    message={msg} 
                    onEdit={(content) => onEditMessage(msg.id, content)}
                    onBranch={() => onBranchMessage?.(msg.id)}
                    onRetry={onRetryMessage ? () => onRetryMessage(msg.id) : undefined}
                    disabled={isStreamingMessage}
                    sendWithCtrlEnter={sendWithCtrlEnter}
                    themeMode={themeMode}
                    confirmEditMessage={confirmEditMessage}
                    isInterrupted={isInterruptedMessage}
                  />
                );
              })}
            {isStreaming && !conversation.messages[conversation.messages.length - 1]?.content && (
              <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 text-sm text-text-secondary">
                  <span>{t('legacyChat.thinking')}</span>
                  <div className="flex gap-1 items-center h-4">
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0 }} className="h-1 w-1 rounded-full bg-text-tertiary" />
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="h-1 w-1 rounded-full bg-text-tertiary" />
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="h-1 w-1 rounded-full bg-text-tertiary" />
                  </div>
              </motion.div>
            )}
          </div>
          )}
        </div>
      {inputBar && (
        <div ref={measureInputBar} className="absolute bottom-0 z-10 pointer-events-none"
          style={{ left: 0, width: contentWidth ?? '100%' }}>
          <div className="max-w-3xl mx-auto w-full px-4 md:px-8 pointer-events-auto">
            {inputBar}
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-bg-base" />
        </div>
      )}
    </div>
  );
};
