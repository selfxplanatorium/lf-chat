import React from 'react';
import { Message } from '../types';
import { cn } from '../lib/utils';
import { AlertCircle, Copy, Check, Pencil, X, GitBranch, RotateCcw, Square, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useI18n } from '../i18n';

// react-markdown + katex + the Prism grammars are ~900 kB and nothing on the
// first screen needs them, so they live in their own chunk. Warmed on idle
// below so the plain-text fallback is effectively never seen.
const importMarkdownContent = () => import('./MarkdownContent');
const MarkdownContent = React.lazy(importMarkdownContent);

interface MessageItemProps {
  message: Message;
  onEdit?: (content: string) => void;
  onBranch?: () => void;
  onBranchEdit?: (content: string) => void;
  onRetry?: () => void;
  subsequentMessageCount?: number;
  disabled?: boolean;
  sendWithCtrlEnter?: boolean;
  themeMode?: 'light' | 'dark';
  confirmEditMessage?: boolean;
  isInterrupted?: boolean;
}

const MessageItemBody: React.FC<MessageItemProps> = ({ 
  message, 
  onEdit, 
  onBranch, 
  onBranchEdit,
  onRetry,
  subsequentMessageCount = 0,
  disabled, 
  sendWithCtrlEnter = true, 
  themeMode = 'dark', 
  confirmEditMessage = true,
  isInterrupted = false,
}) => {
  const { t } = useI18n();
  const isUser = message.role === 'user';
  const isError = message.role === 'error';
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(message.content);
  const [copied, setCopied] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const footerRef = React.useRef<HTMLDivElement>(null);
  // Keep the toolbar with the end of the message by default. For a long
  // message, its bottom can be below the viewport while the message itself is
  // still being read, so mirror the actions above it until the footer is back
  // in view.
  const [bottomOffscreen, setBottomOffscreen] = React.useState(false);

  React.useEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const rootBottom = entry.rootBounds?.bottom ?? window.innerHeight;
        setBottomOffscreen(!entry.isIntersecting && entry.boundingClientRect.top >= rootBottom);
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [disabled, isEditing]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = message.content;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch {
        document.body.removeChild(textarea);
        return;
      }
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasChangedEdit = !!editValue.trim() && editValue.trim() !== message.content.trim();

  const handleSave = () => {
    if (!hasChangedEdit) {
      setIsEditing(false);
      return;
    }

    if (onBranchEdit) {
      onBranchEdit(editValue.trim());
    } else {
      onEdit?.(editValue.trim());
    }
    setShowConfirm(false);
    setIsEditing(false);
  };

  const handleReplace = () => {
    if (!hasChangedEdit || !onEdit) return;
    if (confirmEditMessage && subsequentMessageCount > 0) {
      setShowConfirm(true);
      return;
    }
    onEdit(editValue.trim());
    setIsEditing(false);
  };

  const confirmReplace = () => {
    if (onEdit) {
      onEdit(editValue.trim());
    }
    setShowConfirm(false);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(message.content);
    setIsEditing(false);
    setShowConfirm(false);
  };

  const copyIcon = (
    <AnimatePresence mode="wait">
      {copied ? (
        <motion.div
          key="check"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          className="flex items-center gap-1 text-success"
        >
          <Check size={12} strokeWidth={3} />
          <span className="text-xs font-medium">{t('chat.message.copied')}</span>
        </motion.div>
      ) : (
        <motion.div
          key="copy"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
        >
          <Copy size={12} />
        </motion.div>
      )}
    </AnimatePresence>
  );

  // Shared action buttons, rendered at the bottom and — when the bottom has
  // scrolled below the viewport — mirrored above the message. On desktop the
  // toolbar stays quiet until the pointer or keyboard gets near the message;
  // mobile keeps it persistent because there is no hover target.
  const renderActions = () => {
    if (isEditing || disabled) return null;
    const btn = "flex h-9 w-9 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-bg-element hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
    return (
      <div className="flex items-center gap-1">
        <button onClick={handleCopy} className={btn} title={t('chat.message.copyMessage')} aria-label={t('chat.message.copyMessage')}>
          {copyIcon}
        </button>
        {isUser && (
          <button onClick={() => setIsEditing(true)} className={btn} title={t('chat.message.editMessage')} aria-label={t('chat.message.editMessage')}>
            <Pencil size={12} />
          </button>
        )}
        {!isUser && onRetry && (
          <button onClick={onRetry} className={btn} title={t('chat.message.retryResponse')} aria-label={t('chat.message.retryResponse')}>
            <RotateCcw size={12} />
          </button>
        )}
        {onBranch && (
          <button onClick={onBranch} className={btn} title={t('chat.message.branchFromHere')} aria-label={t('chat.message.branchConversation')}>
            <GitBranch size={12} />
          </button>
        )}
      </div>
    );
  };

  return (
    <motion.div
      role="article"
      aria-label={isUser ? t('chat.message.yourMessage') : isError ? t('chat.message.errorMessage') : t('chat.message.assistantMessage')}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative flex w-full flex-col gap-2 group/msg",
        isUser ? "items-end" : "items-start"
      )}
    >
      <div className={cn(
        "relative overflow-hidden transition-all duration-300 min-w-0 max-w-full",
        isUser
          ? cn(
              "max-w-[90%] bg-bg-element text-text-primary text-left rounded-2xl rounded-tr-md px-4 py-3 break-words",
              isEditing ? "block w-full" : "inline-block" // ponytail: full conversation width in edit; the textarea's w-full is useless inside an inline-block shrink-wrap
            )
          : "w-full text-text-primary py-1 break-words"
      )}>
          {isEditing ? (
            <div className="space-y-4">
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    handleCancel();
                    return;
                  }

                  if (showConfirm) {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      confirmReplace();
                    }
                    return;
                  }

                  const isEnter = e.key === 'Enter' && !e.shiftKey;
                  const isControlEnter = e.key === 'Enter' && e.ctrlKey;

                  if (sendWithCtrlEnter) {
                    if (isControlEnter) {
                      e.preventDefault();
                      handleSave();
                    }
                  } else {
                    if (isEnter) {
                      e.preventDefault();
                      handleSave();
                    }
                  }
                }}
                className="w-full bg-transparent border-none focus:ring-0 p-0 text-text-primary resize-none min-h-[120px] font-sans text-base outline-none scrollbar-hide"
                autoFocus
                aria-label={t('chat.message.editMessage')}
                placeholder={t('chat.message.revisePlaceholder')}
              />
              <div className="flex justify-end gap-2 pt-3 border-t border-border-light/10">
                {showConfirm ? (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex flex-col sm:flex-row items-center gap-3 w-full"
                  >
                    <div className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2 text-xs leading-5 text-danger flex-1">
                      <AlertCircle size={14} />
                      <span>{t('chat.message.replaceWarning', { count: subsequentMessageCount, messageWord: subsequentMessageCount === 1 ? t('chat.message.message') : t('chat.message.messages') })}</span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => setShowConfirm(false)}
                        className="min-h-10 rounded-xl px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-element hover:text-text-primary"
                      >
                        {t('chat.message.cancel')}
                      </button>
                      <button
                        onClick={confirmReplace}
                        className="min-h-10 rounded-xl bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-110"
                      >
                        {t('chat.message.replaceThread')}
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <>
                    <button
                      onClick={handleCancel}
                      className="flex min-h-10 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-element hover:text-text-primary"
                    >
                      <X size={14} />
                      {t('chat.message.cancel')}
                    </button>
                    {onEdit && subsequentMessageCount > 0 && (
                      <button
                        onClick={handleReplace}
                        disabled={!hasChangedEdit}
                        className="min-h-10 rounded-xl px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                      >
                        {t('chat.message.replaceThread')}
                      </button>
                    )}
                    <button
                      onClick={handleSave}
                      disabled={!hasChangedEdit}
                      className="flex min-h-10 items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-110 disabled:opacity-40"
                    >
                      {onBranchEdit ? <GitBranch size={14} /> : <Check size={14} />}
                      {onBranchEdit ? t('chat.message.branchWithEdit') : t('chat.message.saveEdit')}
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="relative">
              {isError && (
                <div role="alert" className="flex items-center gap-2 text-danger mb-4 p-3 rounded-xl bg-danger/5 font-medium text-sm">
                  <AlertCircle size={18} />
                  <span>{t('chat.message.responseError')}</span>
                </div>
              )}
              <div className={cn(
                "markdown-content",
                isError && "text-danger"
              )}>
                <React.Suspense fallback={<div className="whitespace-pre-wrap">{message.content}</div>}>
                  <MarkdownContent
                    content={message.content}
                    messageId={message.id}
                    themeMode={themeMode}
                  />
                </React.Suspense>
                
                {isError && message.content?.toLowerCase().includes('error in input stream') && (
                  <div className="mt-6 p-4 rounded-xl border border-accent/30 bg-bg-element/50 text-sm font-sans flex flex-col gap-3">
                    <div className="flex items-center gap-2 font-bold text-text-primary">
                      <AlertCircle size={16} className="text-accent" />
                      <span>{t('chat.message.connectionClosed')}</span>
                    </div>
                    <p className="text-text-secondary">
                      {t('chat.message.proxyHelp')}
                    </p>
                    <div className="bg-bg-surface p-3 rounded-lg border border-border-light text-xs font-mono text-text-primary">
                      # Example Nginx timeout settings:<br/>
                      <span className="text-accent">proxy_read_timeout 300;</span><br/>
                      <span className="text-accent">proxy_connect_timeout 300;</span><br/>
                      <span className="text-accent">proxy_send_timeout 300;</span>
                    </div>
                    <div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText("proxy_read_timeout 300;\nproxy_connect_timeout 300;\nproxy_send_timeout 300;");
                        }}
                        className="px-4 py-2 bg-accent/10 hover:bg-accent/20 text-accent transition-all rounded-lg text-xs font-bold flex items-center gap-2 mt-1 w-max border border-accent/20"
                      >
                        <Copy size={14} />
                        {t('chat.message.copyNginx')}
                      </button>
                    </div>
                  </div>
                )}

                {message.isStopped && (
                  <div className="mt-4 py-2.5 px-4 rounded-xl border border-border-light bg-bg-element/50 flex items-center gap-2 text-text-secondary text-sm font-medium w-max">
                    <Square size={14} fill="currentColor" className="opacity-70" />
                    <span>{t('chat.message.responseStopped')}</span>
                  </div>
                )}

                {isInterrupted && (
                  <div className="mt-4 space-y-3">
                    <div className="py-2.5 px-4 rounded-xl border border-warning/30 bg-warning/5 flex items-center gap-2 text-text-secondary text-sm font-medium w-max">
                      <AlertTriangle size={14} className="text-warning" />
                      <span>{t('chat.message.interrupted')}</span>
                    </div>
                    {onRetry && (
                      <button
                        onClick={onRetry}
                        className="flex min-h-10 items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-110"
                      >
                        <RotateCcw size={14} />
                        {t('chat.message.retry')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {!isEditing && !disabled && (
          <div
            ref={footerRef}
            className={cn(
              "flex w-full items-center transition-opacity duration-150",
              isUser ? "justify-end" : "justify-start",
              "md:opacity-0 md:group-hover/msg:opacity-100 md:group-focus-within/msg:opacity-100"
            )}
          >
            {renderActions()}
          </div>
        )}

        <AnimatePresence>
          {bottomOffscreen && !isEditing && !disabled && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.15 }}
              // Absolutely positioned in the inter-message gap so toggling it does
              // not change the message's box height and shove neighbours around.
              className={cn(
                "absolute bottom-full mb-2 z-10 transition-opacity duration-150",
                isUser ? "right-0" : "left-0",
                "md:opacity-0 md:group-hover/msg:opacity-100 md:group-focus-within/msg:opacity-100"
              )}
            >
              {renderActions()}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
);
  };

export const MessageItem = React.memo(MessageItemBody);
