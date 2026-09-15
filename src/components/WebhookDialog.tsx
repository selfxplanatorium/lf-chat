import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, ArrowRight, Webhook, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import { WebhookEntry } from '../hooks/useSettings';
import { WebhookIconPicker } from './WebhookIconPicker';
import { cn } from '../lib/utils';
import { useI18n } from '../i18n';

/**
 * Backend creation, in two shells around one form.
 *
 * The tension here is that a backend gets created in two very different
 * moments: the first-run gate (AccessGuard), where it is the only thing on
 * screen and the app is unusable until it is done, and the composer's "+",
 * where it is an interruption the user must be able to abandon. Those want
 * opposite shells — an opaque takeover vs. a dismissible modal — but the same
 * fields and, more importantly, the same validation.
 *
 * So the form lives here on its own and each shell wraps it. The URL is a value
 * the *server* later fetches, which makes its validation a boundary check that
 * must not exist in two places and drift apart.
 */

interface WebhookFormProps {
  defaultName: string;
  submitLabel: string;
  onSubmit: (webhook: WebhookEntry) => void;
  autoFocus?: boolean;
}

export const WebhookForm: React.FC<WebhookFormProps> = ({
  defaultName,
  submitLabel,
  onSubmit,
  autoFocus = true,
}) => {
  const { t } = useI18n();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookName, setWebhookName] = useState(defaultName);
  const [webhookIcon, setWebhookIcon] = useState('Webhook');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = webhookName.trim();
    const trimmed = webhookUrl.trim();
    if (!trimmedName) {
      setError(t('account.webhook.errors.nameRequired'));
      return;
    }
    if (trimmedName.length > 80) {
      setError(t('account.webhook.errors.nameTooLong'));
      return;
    }
    if (!trimmed) {
      setError(t('account.webhook.errors.urlRequired'));
      return;
    }
    // Validate it's an http(s) URL the n8n webhook can actually be reached at.
    // `type="url"` native validation is inconsistent across browsers, so enforce
    // here too. The server re-checks (and resolves DNS) before it ever fetches.
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setError(t('account.webhook.errors.urlProtocol'));
        return;
      }
    } catch {
      setError(t('account.webhook.errors.urlInvalid'));
      return;
    }
    onSubmit({
      id: nanoid(),
      name: trimmedName,
      url: trimmed,
      icon: webhookIcon || t('account.webhook.defaults.icon'),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="webhookName" className="text-sm font-medium text-text-secondary px-1">
          {t('account.webhook.fields.name')}
        </label>
        <input
          id="webhookName"
          type="text"
          value={webhookName}
          onChange={(e) => { setWebhookName(e.target.value); setError(''); }}
          placeholder={t('account.webhook.placeholders.name')}
          maxLength={80}
          autoComplete="organization"
          className="min-h-11 w-full rounded-xl border border-border-light bg-bg-base px-4 py-3 text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/15"
          autoFocus={autoFocus}
        />
      </div>

      <div className="space-y-2">
        <span className="block px-1 text-sm font-medium text-text-secondary">{t('account.webhook.fields.icon')}</span>
        <div className="flex items-center gap-3">
          <WebhookIconPicker
            value={webhookIcon}
            onChange={(icon) => { setWebhookIcon(icon); setError(''); }}
            webhookName={webhookName || t('account.webhook.defaults.iconName')}
          />
          <p className="text-xs leading-5 text-text-tertiary">{t('account.webhook.descriptions.chooseIcon')}</p>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="webhookUrl" className="text-sm font-medium text-text-secondary px-1">
          {t('account.webhook.fields.url')}
        </label>
        <input
          id="webhookUrl"
          type="url"
          value={webhookUrl}
          onChange={(e) => { setWebhookUrl(e.target.value); setError(''); }}
          placeholder={t('account.webhook.placeholders.url')}
          maxLength={2048}
          className="min-h-11 w-full rounded-xl border border-border-light bg-bg-base px-4 py-3 text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/15"
        />
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2 text-danger text-sm px-1"
          role="alert"
          aria-live="polite"
        >
          <AlertCircle size={14} />
          <span>{error}</span>
        </motion.div>
      )}

      <button
        type="submit"
        className="group flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-text-primary px-4 py-3 text-sm font-medium text-bg-base transition-[filter,transform] hover:brightness-95 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface"
      >
        {submitLabel}
        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
      </button>
    </form>
  );
};

interface WebhookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (webhook: WebhookEntry) => void;
  webhookCount: number;
}

export const WebhookDialog: React.FC<WebhookDialogProps> = ({
  isOpen,
  onClose,
  onCreate,
  webhookCount,
}) => {
  const { t } = useI18n();
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // The composer's "+" is the only way in, so focus must land back on it —
  // otherwise a keyboard user is dumped at the top of the document after
  // closing.
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      return;
    }
    previouslyFocusedRef.current?.focus();
    previouslyFocusedRef.current = null;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleCreate = useCallback((webhook: WebhookEntry) => {
    onCreate(webhook);
    onClose();
  }, [onCreate, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          className="modal-backdrop fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto p-4 sm:p-6"
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="webhook-dialog-title"
            className="modal-surface relative z-10 my-auto w-full max-w-lg rounded-2xl border border-border-light p-6 sm:p-8"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label={t('account.webhook.aria.close')}
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-bg-element hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X size={16} />
            </button>

            <div className="mb-8">
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-border-light bg-bg-element text-text-primary">
                <Webhook size={20} aria-hidden="true" />
              </div>
              <h2 id="webhook-dialog-title" className="text-2xl font-semibold tracking-[-0.03em] text-text-primary">
                {t('account.webhook.titles.addBackend')}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-text-secondary">
                {t('account.webhook.descriptions.connectFirstBackend')}
              </p>
            </div>

            {/* Matches the naming Settings uses when it adds a row, so the two
                entry points don't produce differently-shaped defaults. */}
            <WebhookForm
              defaultName={`Webhook ${webhookCount + 1}`}
              submitLabel={t('account.webhook.actions.addBackend')}
              onSubmit={handleCreate}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
