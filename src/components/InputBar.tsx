import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, ArrowUp, Square } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { useI18n } from '../i18n';

const DRAFT_PREFIX = 'chat-draft-';

interface InputBarProps {
  onSend: (message: string) => Promise<boolean | void> | boolean | void;
  onStop?: () => void;
  isStreaming?: boolean;
  sendWithCtrlEnter?: boolean;
  themeMode?: 'light' | 'dark';
  conversationId?: string | null;
}

export const InputBar: React.FC<InputBarProps> = ({ onSend, onStop, isStreaming, sendWithCtrlEnter = true, themeMode = 'dark', conversationId }) => {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);

  const draftKey = conversationId ? DRAFT_PREFIX + conversationId : null;

  useEffect(() => {
    if (draftKey) {
      const saved = sessionStorage.getItem(draftKey) ?? localStorage.getItem(draftKey);
      if (saved && !sessionStorage.getItem(draftKey)) {
        sessionStorage.setItem(draftKey, saved);
        localStorage.removeItem(draftKey);
      }
      setValue(saved || '');
    } else {
      setValue('');
    }
  }, [draftKey]);

  useEffect(() => {
    if (draftKey && value) {
      sessionStorage.setItem(draftKey, value);
    } else if (draftKey) {
      sessionStorage.removeItem(draftKey);
    }
  }, [value, draftKey]);

  const resetInput = useCallback(() => {
    setValue('');
    if (draftKey) {
      sessionStorage.removeItem(draftKey);
      localStorage.removeItem(draftKey);
    }
  }, [draftKey]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    // Guard against a same-tick double submit (e.g. rapid Enter) and against
    // sending while a request is already in flight but `isStreaming` hasn't
    // flipped true yet (it only does so once the SSE 'started' event arrives).
    if (sendingRef.current || isStreaming) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    sendingRef.current = true;
    setIsSending(true);
    try {
      const result = await onSend(trimmed);
      // A failed send returns `false`; keep the draft so the user can retry
      // instead of silently losing their text. Treat undefined/true as success.
      if (result === false) {
        textareaRef.current?.focus();
        return;
      }
      resetInput();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'inherit';
      }
    } catch {
      // Defensive: never lose the user's text on an unexpected throw.
      textareaRef.current?.focus();
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const isEnter = e.key === 'Enter' && !e.shiftKey;
    const isControlEnter = e.key === 'Enter' && e.ctrlKey;

    if (sendWithCtrlEnter) {
      if (isControlEnter) {
        e.preventDefault();
        handleSubmit();
      }
    } else {
      if (isEnter) {
        e.preventDefault();
        handleSubmit();
      }
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'inherit';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, 200)}px`;
    }
  }, [value]);

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className={cn(
        "p-2 pb-4 flex flex-col gap-2 transition-all duration-300 focus-within:border-accent/40 border border-border-light backdrop-blur-xl rounded-t-3xl",
        themeMode === 'light' ? "bg-white/30" : "bg-black/15"
      )}>
        <div className="px-5 pt-3 pb-1">
          <textarea
            id="chat-input"
            ref={textareaRef}
            rows={1}
            value={value}
            disabled={isStreaming}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={t('legacyChat.messageInput')}
            placeholder={isStreaming ? t('legacyChat.assistantTyping') : t('legacyChat.placeholder')}
            className="w-full bg-transparent border-none focus:ring-0 text-text-primary placeholder:text-text-tertiary px-0 py-0.5 resize-none max-h-[200px] text-base leading-snug outline-none disabled:opacity-50"
          />
        </div>
        
        <div className="flex items-center justify-end px-2 pb-4">
          <div className="flex items-center gap-4">
            {isStreaming ? (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                type="button"
                onClick={onStop}
                aria-label={t('legacyChat.stopGeneration')}
                className={cn(
                  "w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-300",
                  cn("bg-red-500/80 text-white hover:bg-red-500", themeMode === 'dark' && "shadow-md shadow-red-500/10") 
                )}
                title={t('legacyChat.stopGeneration')}
              >
                <Square size={16} strokeWidth={2.5} fill="currentColor" />
              </motion.button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                disabled={!value.trim() || isSending}
                type="submit"
                aria-label={t('legacyChat.sendMessage')}
                className={cn(
                  "w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-300 disabled:opacity-30",
                  value.trim() 
                    ? cn("bg-accent text-white hover:brightness-110", themeMode === 'dark' && "shadow-md shadow-accent/10") 
                    : "bg-bg-element text-text-tertiary"
                )}
              >
                <Send size={18} strokeWidth={2.5} />
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
};
