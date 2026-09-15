import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Keyboard } from 'lucide-react';
import { cn } from '../lib/utils';
import { useI18n } from '../i18n';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  themeMode: 'light' | 'dark';
  sendWithCtrlEnter: boolean;
}

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface';

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
  themeMode,
  sendWithCtrlEnter,
}) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const shortcuts = [
    { key: 'Alt + S', description: t('chat.shortcuts.toggleSidebar') },
    { key: 'Alt + N', description: t('chat.shortcuts.createChat') },
    { key: 'Alt + P', description: t('chat.shortcuts.openSettings') },
    { key: 'Ctrl/⌘ + K', description: t('chat.shortcuts.searchThreads') },
    { key: 'Alt + ↑/↓', description: t('chat.shortcuts.switchConversations') },
    sendWithCtrlEnter
      ? { key: 'Ctrl + Enter', description: t('chat.shortcuts.sendMessage') }
      : { key: 'Enter', description: t('chat.shortcuts.sendMessage') },
    { key: 'Shift + Enter', description: t('chat.shortcuts.lineBreak') },
    { key: '?', description: t('chat.shortcuts.showShortcuts') },
  ];

  useEffect(() => {
    if (!isOpen) {
      const returnTarget = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnTarget) window.requestAnimationFrame(() => returnTarget.focus());
      return;
    }

    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      const returnTarget = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnTarget) window.requestAnimationFrame(() => returnTarget.focus());
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
            className="modal-backdrop fixed inset-0 z-[80]"
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="keyboard-shortcuts-title"
            aria-describedby="keyboard-shortcuts-description"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            className="fixed left-1/2 top-1/2 z-[90] max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-0"
            onClick={event => event.stopPropagation()}
          >
            <div className={cn('modal-surface overflow-hidden rounded-2xl', themeMode === 'dark' && 'shadow-surface')}>
              <div className="flex items-start justify-between gap-4 border-b border-border-light bg-bg-element/20 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-accent"><Keyboard size={20} aria-hidden="true" /></div>
                  <div>
                    <h2 id="keyboard-shortcuts-title" className="text-lg font-semibold text-text-primary">{t('chat.shortcuts.title')}</h2>
                    <p id="keyboard-shortcuts-description" className="mt-1 text-xs text-text-tertiary">{t('chat.shortcuts.description')}</p>
                  </div>
                </div>
                <button ref={closeButtonRef} type="button" onClick={onClose} aria-label={t('chat.shortcuts.closeLabel')} className={cn('flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-text-tertiary hover:bg-bg-element hover:text-text-primary', focusRing)}><X size={20} /></button>
              </div>

              <div className="space-y-4 p-5 sm:p-6">
                <div className="space-y-1">
                  {shortcuts.map((shortcut) => (
                    <div key={shortcut.description} className="flex min-h-11 items-center justify-between gap-4 border-b border-border-light/50 py-2 last:border-0">
                      <span className="text-sm font-medium text-text-secondary">{shortcut.description}</span>
                      <div className="flex shrink-0 items-center gap-1" aria-label={t('chat.shortcuts.shortcutLabel', { key: shortcut.key })}>
                        {shortcut.key.split(' + ').map((part, index, parts) => (
                          <React.Fragment key={part}>
                            <kbd className="min-w-6 rounded border border-border-light bg-bg-base px-1.5 py-1 text-xs font-mono text-text-primary shadow-sm">{part}</kbd>
                            {index < parts.length - 1 && <span className="text-xs text-text-tertiary" aria-hidden="true">+</span>}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <button type="button" onClick={onClose} className={cn('min-h-11 w-full rounded-xl border border-border-light bg-bg-element px-4 text-sm font-medium text-text-primary hover:bg-bg-surface', focusRing)}>{t('chat.shortcuts.close')}</button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
