import React, { useCallback } from 'react';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ThreadPrimitive,
  AuiIf,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { ArrowDown, ArrowUp, Check, ChevronDown, LoaderCircle, Maximize2, Minimize2, Plus, Square } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Conversation, Message } from '../types';
import type { WebhookEntry } from '../hooks/useSettings';
import { getWebhookIcon } from '../lib/webhookIcons';
import { cn } from '../lib/utils';
import { MessageItem } from './MessageItem';
import { MessageListSkeleton } from './Skeletons';
import { useI18n } from '../i18n';
import { ExpandableComposer } from './ExpandableComposer';
import { ComposerFiles, AttachFileButton, useFileDrop } from './ComposerFiles';
import { createAttachmentAdapter, attachmentErrorKey } from '../lib/attachmentAdapter';

interface AssistantThreadProps {
  conversation: Conversation | null;
  isStreaming: boolean;
  onSend: (message: string, attachmentIds?: string[]) => Promise<boolean | void> | boolean | void;
  onStop: () => void;
  onEditMessage: (messageId: string, content: string) => void;
  onBranchMessage?: (messageId: string) => void;
  onBranchEditedMessage?: (messageId: string, content: string) => void;
  onRetryMessage?: (messageId: string) => void;
  webhooks?: WebhookEntry[];
  activeWebhookId?: string;
  onActiveWebhookChange?: (webhookId: string) => void;
  onCreateWebhook?: () => void;
  sendWithCtrlEnter?: boolean;
  themeMode?: 'light' | 'dark';
  confirmEditMessage?: boolean;
  onLoadMoreMessages?: () => void;
  hasMoreMessages?: boolean;
  isLoadingMessages?: boolean;
}

const convertMessage = (message: Message): ThreadMessageLike => ({
  id: message.id,
  role: message.role === 'user' ? 'user' : 'assistant',
  content: [{ type: 'text', text: message.content }],
  createdAt: new Date(message.timestamp),
  attachments: message.attachments?.map(file => ({ ...file, type: file.contentType.startsWith('image/') ? 'image' as const : 'document' as const, status: { type: 'complete' as const }, content: [] })),
});

interface ThreadComposerProps {
  activeWebhook?: WebhookEntry;
  activeWebhookId: string;
  isStreaming: boolean;
  onActiveWebhookChange?: (webhookId: string) => void;
  onCreateWebhook?: () => void;
  sendWithCtrlEnter: boolean;
  webhooks: WebhookEntry[];
}

interface WebhookMenuProps {
  activeWebhook?: WebhookEntry;
  activeWebhookId: string;
  disabled: boolean;
  onChange?: (webhookId: string) => void;
  onCreate?: () => void;
  webhooks: WebhookEntry[];
}

const WebhookMenu: React.FC<WebhookMenuProps> = ({
  activeWebhook,
  activeWebhookId,
  disabled,
  onChange,
  onCreate,
  webhooks,
}) => {
  const { t } = useI18n();
  const prefersReducedMotion = useReducedMotion();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [isOpen, setIsOpen] = React.useState(false);
  const [placement, setPlacement] = React.useState<'up' | 'down'>('up');
  const activeIndex = Math.max(0, webhooks.findIndex((webhook) => webhook.id === activeWebhookId));
  const ActiveWebhookIcon = getWebhookIcon(activeWebhook?.icon);

  const openMenu = React.useCallback((focusIndex = activeIndex) => {
    if (disabled || !webhooks.length) return;

    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const viewport = window.visualViewport;
      const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
      const availableBelow = viewportBottom - rect.bottom;
      // Include the create row in the height estimate, otherwise the menu can be
      // placed downward in a gap that is one row too small and get clipped.
      const menuHeight = Math.min(288, (webhooks.length + (onCreate ? 1 : 0)) * 48 + 16);
      setPlacement(availableBelow >= menuHeight + 12 ? 'down' : 'up');
    }

    setIsOpen(true);
    requestAnimationFrame(() => optionRefs.current[focusIndex]?.focus());
  }, [activeIndex, disabled, onCreate, webhooks.length]);

  const closeMenu = React.useCallback((restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  React.useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [closeMenu, isOpen]);

  React.useEffect(() => {
    if (disabled && isOpen) closeMenu();
  }, [closeMenu, disabled, isOpen]);

  const selectWebhook = (webhookId: string) => {
    onChange?.(webhookId);
    closeMenu(true);
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const index = event.key === 'ArrowUp' ? webhooks.length - 1 : activeIndex;
      openMenu(index);
    }
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      closeMenu(event.key === 'Escape');
      return;
    }

    // The create row sits at the end of the roving-focus cycle, so arrowing past
    // the last backend reaches it instead of dead-ending.
    const focusableCount = webhooks.length + (onCreate ? 1 : 0);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % focusableCount;
    if (event.key === 'ArrowUp') nextIndex = (index - 1 + focusableCount) % focusableCount;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = focusableCount - 1;

    if (nextIndex != null) {
      event.preventDefault();
      optionRefs.current[nextIndex]?.focus();
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || !webhooks.length}
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={t('chat.thread.activeBackend')}
        title={activeWebhook?.url ? t('chat.thread.sentTo', { url: activeWebhook.url }) : t('chat.thread.chooseBackend')}
        className="group flex min-h-9 min-w-0 max-w-52 items-center gap-2 rounded-lg px-2 text-xs font-medium text-text-secondary outline-none transition-colors hover:bg-bg-element hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <ActiveWebhookIcon size={14} aria-hidden="true" className="shrink-0 text-text-primary" />
        <span className="truncate">{activeWebhook?.name || (webhooks.length ? t('chat.thread.unnamedBackend') : t('chat.thread.noBackend'))}</span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="ml-auto flex shrink-0 text-text-tertiary group-hover:text-text-primary"
        >
          <ChevronDown size={13} />
        </motion.span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: placement === 'up' ? 6 : -6, scale: 0.97, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: placement === 'up' ? 4 : -4, scale: 0.98, filter: 'blur(2px)' }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "absolute left-0 z-40 w-[min(18rem,calc(100vw-3rem))] overflow-hidden rounded-xl border border-border-light bg-bg-surface/95 p-1.5 shadow-surface backdrop-blur-xl",
              placement === 'up' ? "bottom-full mb-2 origin-bottom-left" : "top-full mt-2 origin-top-left"
            )}
          >
            <div
              role="listbox"
              aria-label={t('chat.thread.activeBackend')}
              className="webhook-menu-scroll max-h-64 overflow-y-auto overscroll-contain pr-0.5"
            >
              {webhooks.map((webhook, index) => {
                const WebhookIcon = getWebhookIcon(webhook.icon);
                const isSelected = webhook.id === activeWebhookId;

                return (
                  <button
                    key={webhook.id}
                    ref={(node) => { optionRefs.current[index] = node; }}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => selectWebhook(webhook.id)}
                    onKeyDown={(event) => handleOptionKeyDown(event, index)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm outline-none transition-colors focus-visible:bg-bg-element focus-visible:text-text-primary",
                      isSelected ? "bg-bg-element text-text-primary" : "text-text-secondary hover:bg-bg-element/70 hover:text-text-primary"
                    )}
                  >
                    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", isSelected ? "bg-accent/12 text-accent" : "bg-bg-element text-text-secondary")}>
                      <WebhookIcon size={14} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{webhook.name || t('chat.thread.unnamedBackend')}</span>
                    {isSelected && <Check size={15} strokeWidth={2.5} aria-hidden="true" className="shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>

            {onCreate && (
              // pr-0.5 mirrors the scroll container's scrollbar gutter so this
              // row lines up with the options above it rather than sitting 2px
              // wider. The separator is its own hairline — putting a border and
              // padding on the button instead makes it taller than every option.
              <div className="pr-0.5">
                <div className="my-1.5 h-px bg-border-light" aria-hidden="true" />
                <button
                  ref={(node) => { optionRefs.current[webhooks.length] = node; }}
                  type="button"
                  onClick={() => { closeMenu(); onCreate(); }}
                  onKeyDown={(event) => handleOptionKeyDown(event, webhooks.length)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-text-secondary outline-none transition-colors hover:bg-bg-element/70 hover:text-text-primary focus-visible:bg-bg-element focus-visible:text-text-primary"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bg-element text-text-secondary">
                    <Plus size={14} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{t('chat.thread.addBackend')}</span>
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const ThreadComposer: React.FC<ThreadComposerProps> = ({
  activeWebhook,
  activeWebhookId,
  isStreaming,
  onActiveWebhookChange,
  onCreateWebhook,
  sendWithCtrlEnter,
  webhooks,
}) => {
  const { t } = useI18n();

  const fileDrop = useFileDrop();

  return (
    <ExpandableComposer>
      {({ expanded, toggle }) => (
        <>
          <ComposerPrimitive.Root {...fileDrop} className="assistant-composer glass-surface relative w-full rounded-2xl p-2 transition-[border-color,box-shadow] focus-within:border-text-muted/60">
            <button
              type="button"
              onClick={toggle}
              aria-expanded={expanded}
              aria-controls="chat-input"
              aria-label={t(expanded ? 'chat.thread.collapseComposer' : 'chat.thread.expandComposer')}
              title={t(expanded ? 'chat.thread.collapseComposer' : 'chat.thread.expandComposer')}
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-bg-element hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            </button>
            <ComposerFiles />
            <ComposerPrimitive.Input
              addAttachmentOnPaste={false}
              id="chat-input"
              rows={1}
              submitMode={sendWithCtrlEnter ? ('ctrlEnter' as const) : ('enter' as const)}
              placeholder={isStreaming ? t('chat.thread.addToConversation') : t('chat.thread.messagePlaceholder')}
              aria-label={t('chat.thread.messageInput')}
              cancelOnEscape={!expanded}
              className="assistant-composer-input max-h-48 min-h-14 w-full resize-none bg-transparent px-3 py-3 pr-14 text-[15px] leading-6 text-text-primary outline-none placeholder:text-text-tertiary"
            />
            <div className="flex items-center justify-between gap-3 px-2 pb-1">
              <div className="flex min-w-0 items-center gap-2">
                <AttachFileButton />
                <WebhookMenu
                  activeWebhook={activeWebhook}
                  activeWebhookId={activeWebhookId}
                  disabled={isStreaming}
                  onChange={onActiveWebhookChange}
                  onCreate={onCreateWebhook}
                  webhooks={webhooks}
                />
                <span className="hidden text-xs text-text-tertiary md:inline" aria-live="polite">
                  {activeWebhook?.url ? t('chat.thread.usedForNext') : t('chat.thread.configureBackend')}
                </span>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <AuiIf condition={(state) => !state.thread.isRunning}>
                  <ComposerPrimitive.Send className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white transition-[filter,transform] hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:bg-bg-element disabled:text-text-muted" aria-label={t('chat.thread.sendMessage')}>
                    <ArrowUp size={17} strokeWidth={2.5} />
                  </ComposerPrimitive.Send>
                </AuiIf>
                <AuiIf condition={(state) => state.thread.isRunning}>
                  <ComposerPrimitive.Cancel className="flex h-9 w-9 items-center justify-center rounded-xl bg-text-primary text-bg-base transition-transform hover:scale-[1.03] active:scale-95" aria-label={t('chat.thread.stopResponse')}>
                    <Square size={13} fill="currentColor" />
                  </ComposerPrimitive.Cancel>
                </AuiIf>
              </div>
            </div>
          </ComposerPrimitive.Root>
          <div className="mt-2 flex w-full items-center justify-between gap-3 px-1 text-xs text-text-tertiary">
            <span className="hidden sm:inline">{sendWithCtrlEnter ? t('chat.thread.ctrlEnterToSend') : t('chat.thread.enterToSend')}</span>
            <span className="ml-auto">{t('chat.thread.verifyDetails')}</span>
          </div>
        </>
      )}
    </ExpandableComposer>
  );
};

export const AssistantThread: React.FC<AssistantThreadProps> = (props) => {
  const {
    conversation,
    isStreaming,
    onSend,
    onStop,
  } = props;
  const { t } = useI18n();

  const handleNew = useCallback(async (message: AppendMessage) => {
    const text = message.content
      .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();

    const attachmentIds = message.attachments?.map(file => file.id) ?? [];
    if (!text && !attachmentIds.length) return;
    const result = await onSend(text, attachmentIds);
    if (result === false) throw new Error(t('chat.thread.sendError'));

    // Composer text is session-scoped. Once the message is accepted, remove
    // the saved draft so sent prompts cannot accumulate in browser storage.
    if (conversation?.id) {
      sessionStorage.removeItem(`chat-draft-${conversation.id}`);
      // Remove keys written by older builds as well.
      localStorage.removeItem(`chat-draft-${conversation.id}`);
    }
  }, [conversation?.id, onSend, t]);

  const [attachmentsBlocked, setAttachmentsBlocked] = React.useState(false);
  const translateAttachmentError = React.useRef(t);
  translateAttachmentError.current = t;
  // Keep uploaded drafts available when the interface language changes.
  const attachmentAdapter = React.useMemo(() => createAttachmentAdapter(message => translateAttachmentError.current(attachmentErrorKey(message))), []);
  const runtime = useExternalStoreRuntime<Message>({
    adapters: { attachments: attachmentAdapter },
    messages: conversation?.messages ?? [],
    isRunning: isStreaming,
    convertMessage,
    isSendDisabled: attachmentsBlocked || !(props.webhooks?.find((webhook) => webhook.id === props.activeWebhookId)?.url),
    onNew: handleNew,
    onCancel: async () => onStop(),
  });

  React.useEffect(() => {
    const composer = runtime.thread.composer;
    const update = () => setAttachmentsBlocked(composer.getState().attachments.some(file => file.status.type === 'running' || file.status.type === 'incomplete'));
    update(); return composer.subscribe(update);
  }, [runtime]);

  React.useEffect(() => {
    const draftKey = conversation?.id ? `chat-draft-${conversation.id}` : null;
    const composer = runtime.thread.composer;
    const savedDraft = draftKey
      ? sessionStorage.getItem(draftKey) ?? localStorage.getItem(draftKey) ?? ''
      : '';
    if (draftKey && !sessionStorage.getItem(draftKey) && savedDraft) {
      sessionStorage.setItem(draftKey, savedDraft);
      localStorage.removeItem(draftKey);
    }
    void composer.clearAttachments();
    composer.setText(savedDraft);

    return composer.subscribe(() => {
      if (!draftKey) return;
      const text = composer.getState().text;
      if (text) sessionStorage.setItem(draftKey, text);
      else sessionStorage.removeItem(draftKey);
    });
  }, [conversation?.id, runtime]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadSurface {...props} />
    </AssistantRuntimeProvider>
  );
};

/**
 * Empty-thread intro.
 *
 * The composer is meant to start centred and glide down, revealing the heading
 * behind it. Rather than animating two elements against each other (which needs
 * the heading's measured height and drifts across locales and breakpoints), only
 * the heading animates: it expands from zero height, and the section's
 * `justify-center` pushes the composer down by exactly half of that growth. The
 * end state is the untouched layout — the heading's bottom margin lives inside
 * the collapsing wrapper so the gap collapses with it, leaving the composer
 * genuinely centred at the start.
 *
 * Plays every time an empty thread is shown, so it is driven purely by this
 * component mounting. Two things make that reliable: ThreadPrimitive.Empty
 * unmounts its children the moment a thread has messages, and the caller keys
 * this on the conversation id, so switching between empty threads remounts it
 * rather than leaving one instance sitting there already-animated.
 */
const ThreadIntroHeading: React.FC = () => {
  const { t } = useI18n();
  const prefersReducedMotion = useReducedMotion();
  const playIntro = !prefersReducedMotion;
  // Clip only while the height is in flight. Leaving overflow hidden forever
  // would risk shaving tall glyphs off a future heading, and it is not needed to
  // contain the h1's bottom margin — a flex item already establishes a BFC.
  const [isRevealing, setIsRevealing] = React.useState(playIntro);

  return (
    <motion.div
      // `false` renders straight at the animate values — the reduced-motion
      // path, which lands on the finished layout with no movement.
      initial={playIntro ? { height: 0, opacity: 0 } : false}
      animate={{ height: 'auto', opacity: 1 }}
      transition={{
        height: { duration: 0.62, ease: [0.16, 1, 0.3, 1] },
        opacity: { duration: 0.42, delay: 0.16, ease: 'easeOut' },
      }}
      onAnimationComplete={() => setIsRevealing(false)}
      className={isRevealing ? 'overflow-hidden' : undefined}
    >
      <h1 className="mb-8 text-balance text-3xl font-semibold tracking-[-0.03em] text-text-primary md:text-4xl">
        {t('chat.thread.heading')}
      </h1>
    </motion.div>
  );
};

const ThreadSurface: React.FC<AssistantThreadProps> = ({
  conversation,
  isStreaming,
  onSend,
  onEditMessage,
  onBranchMessage,
  onBranchEditedMessage,
  onRetryMessage,
  webhooks = [],
  activeWebhookId = '',
  onActiveWebhookChange,
  onCreateWebhook,
  sendWithCtrlEnter = true,
  themeMode = 'dark',
  confirmEditMessage = true,
  onLoadMoreMessages,
  hasMoreMessages = false,
  isLoadingMessages = false,
}) => {
  const { t } = useI18n();
  const threadDrop = useFileDrop();
  const [composerDockHeight, setComposerDockHeight] = React.useState(0);
  const composerDockObserverRef = React.useRef<ResizeObserver | null>(null);
  const isLoadingConversation = !!conversation
    && conversation.messages.length === 0
    && (conversation.messageCount ?? 0) > 0;
  const activeWebhook = webhooks.find((webhook) => webhook.id === activeWebhookId);

  const measureComposerDock = React.useCallback((dock: HTMLDivElement | null) => {
    composerDockObserverRef.current?.disconnect();
    if (!dock) return;

    const updateHeight = () => setComposerDockHeight(dock.offsetHeight);
    updateHeight();
    composerDockObserverRef.current = new ResizeObserver(updateHeight);
    composerDockObserverRef.current.observe(dock);
  }, []);

  return (
    <ThreadPrimitive.Root {...threadDrop} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <ThreadPrimitive.Viewport
        className="assistant-thread-viewport flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]"
        autoScroll
      >
        <ThreadPrimitive.Empty>
          {isLoadingConversation ? (
            <div className="mx-auto flex w-full max-w-3xl flex-1 items-center px-5 py-20 md:px-8">
              <MessageListSkeleton />
            </div>
          ) : (
            <section className="mx-auto flex min-h-full w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-20 text-center md:px-8 md:py-24">
              <ThreadIntroHeading key={conversation?.id ?? 'empty'} />
              <div className="w-full text-left">
                <ThreadComposer
                  activeWebhook={activeWebhook}
                  activeWebhookId={activeWebhookId}
                  isStreaming={isStreaming}
                  onActiveWebhookChange={onActiveWebhookChange}
                  onCreateWebhook={onCreateWebhook}
                  sendWithCtrlEnter={sendWithCtrlEnter}
                  webhooks={webhooks}
                />
              </div>
            </section>
          )}
        </ThreadPrimitive.Empty>

        {!isLoadingConversation && !!conversation?.messages.length && (
          <div
            className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-24 md:gap-10 md:px-8"
            style={{ paddingBottom: Math.max(40, composerDockHeight + 24) }}
          >
            {hasMoreMessages && (
              <button
                type="button"
                onClick={onLoadMoreMessages}
                disabled={isLoadingMessages}
                className="mx-auto inline-flex min-h-10 items-center gap-2 rounded-full border border-border-light bg-bg-surface px-4 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
              >
                {isLoadingMessages ? <LoaderCircle className="animate-spin" size={14} /> : <ArrowUp size={14} />}
                {isLoadingMessages ? t('chat.thread.loadingEarlier') : t('chat.thread.loadEarlier')}
              </button>
            )}

            <ThreadPrimitive.Messages>
              {({ message }) => {
                const source = conversation?.messages.find((item) => item.id === message.id);
                if (!source) return null;
                const sourceIndex = conversation?.messages.findIndex((item) => item.id === source.id) ?? -1;
                const isLast = source.id === conversation?.messages.at(-1)?.id;
                return (
                  <MessageItem
                    message={source}
                    onEdit={(content) => onEditMessage(source.id, content)}
                    onBranch={() => onBranchMessage?.(source.id)}
                    onBranchEdit={onBranchEditedMessage ? (content) => onBranchEditedMessage(source.id, content) : undefined}
                    subsequentMessageCount={sourceIndex >= 0 ? conversation.messages.length - sourceIndex - 1 : 0}
                    onRetry={onRetryMessage ? () => onRetryMessage(source.id) : undefined}
                    disabled={isStreaming && isLast}
                    sendWithCtrlEnter={sendWithCtrlEnter}
                    themeMode={themeMode}
                    confirmEditMessage={confirmEditMessage}
                    isInterrupted={conversation?.streamingStatus === 'interrupted' && conversation.streamingMessageId === source.id}
                  />
                );
              }}
            </ThreadPrimitive.Messages>

            {isStreaming && !conversation?.messages.at(-1)?.content && (
              <div className="flex items-center gap-2 text-sm text-text-secondary" role="status" aria-live="polite">
                <span>{t('chat.thread.thinking')}</span>
                <span className="flex gap-1" aria-hidden="true">
                  <span className="h-1 w-1 animate-pulse rounded-full bg-text-tertiary" />
                  <span className="h-1 w-1 animate-pulse rounded-full bg-text-tertiary [animation-delay:150ms]" />
                  <span className="h-1 w-1 animate-pulse rounded-full bg-text-tertiary [animation-delay:300ms]" />
                </span>
              </div>
            )}
          </div>
        )}

      </ThreadPrimitive.Viewport>

      {!isLoadingConversation && !!conversation?.messages.length && (
        <div
          ref={measureComposerDock}
          className="assistant-composer-dock pointer-events-none absolute inset-x-0 bottom-0 z-10 w-full px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-8 md:pb-6"
        >
          <div className="pointer-events-auto relative mx-auto flex w-full max-w-3xl flex-col items-center">
            <ThreadPrimitive.ScrollToBottom className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-border-light bg-bg-surface text-text-secondary shadow-surface transition-all hover:-translate-y-0.5 hover:text-text-primary disabled:pointer-events-none disabled:scale-95 disabled:opacity-0" aria-label={t('chat.thread.scrollToLatest')}>
              <ArrowDown size={16} />
            </ThreadPrimitive.ScrollToBottom>
            <ThreadComposer
              activeWebhook={activeWebhook}
              activeWebhookId={activeWebhookId}
              isStreaming={isStreaming}
              onActiveWebhookChange={onActiveWebhookChange}
              onCreateWebhook={onCreateWebhook}
              sendWithCtrlEnter={sendWithCtrlEnter}
              webhooks={webhooks}
            />
          </div>
        </div>
      )}
    </ThreadPrimitive.Root>
  );
};
