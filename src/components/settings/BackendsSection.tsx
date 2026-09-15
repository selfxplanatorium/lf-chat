import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, Check, Plus, Trash2, Webhook } from 'lucide-react';
import { nanoid } from 'nanoid';
import { Settings, WebhookEntry } from '../../hooks/useSettings';
import { cn } from '../../lib/utils';
import { useI18n } from '../../i18n';
import { WebhookIconPicker } from '../WebhookIconPicker';
import {
  buttonClass,
  focusRing,
  Group,
  inputClass,
  itemVariants,
  listVariants,
  QUICK,
  SectionHeading,
} from './primitives';

interface BackendsSectionProps {
  settings: Settings;
  onSave: (partial: Partial<Settings>) => void;
}

const looksLikeUrl = (url: string) => /^https?:\/\/\S+$/i.test(url.trim());

export const BackendsSection: React.FC<BackendsSectionProps> = ({ settings, onSave }) => {
  const { t } = useI18n();
  // Removal is the one destructive edit on an instant-apply page: the URL is
  // gone the moment it lands. It confirms in place rather than in a dialog —
  // the row being removed is the thing the user needs to see.
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  const patchWebhook = (id: string, patch: Partial<WebhookEntry>) => {
    onSave({ webhooks: settings.webhooks.map((webhook) => (webhook.id === id ? { ...webhook, ...patch } : webhook)) });
  };

  const removeWebhook = (id: string) => {
    const remaining = settings.webhooks.filter((webhook) => webhook.id !== id);
    onSave({
      webhooks: remaining,
      activeWebhookId: settings.activeWebhookId === id ? (remaining[0]?.id || '') : settings.activeWebhookId,
    });
    setPendingRemoval(null);
  };

  const addWebhook = () => {
    const webhook: WebhookEntry = {
      id: nanoid(),
      name: t('account.settings.defaults.webhookNumber', { number: settings.webhooks.length + 1 }),
      url: '',
      icon: 'Webhook',
    };
    onSave({
      webhooks: [...settings.webhooks, webhook],
      activeWebhookId: settings.activeWebhookId || webhook.id,
    });
  };

  return (
    <motion.div variants={listVariants} initial="hidden" animate="shown" className="space-y-8">
      <SectionHeading
        title={t('account.settings.nav.backends')}
        description={t('account.settings.descriptions.webhooks')}
      />

      {settings.webhooks.length === 0 ? (
        <Group>
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-bg-element text-text-tertiary">
              <Webhook size={20} aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium text-text-primary">{t('account.settings.webhooks.emptyTitle')}</p>
              <p className="max-w-[42ch] text-xs leading-5 text-text-tertiary">
                {t('account.settings.webhooks.emptyDescription')}
              </p>
            </div>
            <button type="button" onClick={addWebhook} className={cn(buttonClass.primary, 'mt-1')}>
              <Plus size={16} aria-hidden="true" />
              {t('account.settings.actions.addWebhook')}
            </button>
          </div>
        </Group>
      ) : (
        <motion.div variants={itemVariants} className="space-y-3">
          <div role="radiogroup" aria-label={t('account.settings.webhooks.activeGroup')} className="space-y-3">
            <AnimatePresence initial={false} mode="popLayout">
              {settings.webhooks.map((webhook) => {
                const isActive = settings.activeWebhookId === webhook.id;
                const displayName = webhook.name || t('account.settings.defaults.unnamedWebhook');
                const urlInvalid = webhook.url.trim().length > 0 && !looksLikeUrl(webhook.url);
                const isRemoving = pendingRemoval === webhook.id;

                return (
                  <motion.div
                    key={webhook.id}
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className={cn(
                      'rounded-2xl border bg-bg-surface p-3 transition-colors sm:p-4',
                      isActive ? 'border-accent/30 bg-accent/[0.04]' : 'border-border-light',
                    )}
                  >
                    <div className="flex items-center gap-2 sm:gap-3">
                      <WebhookIconPicker
                        value={webhook.icon}
                        webhookName={displayName}
                        onChange={(icon) => patchWebhook(webhook.id, { icon })}
                      />
                      <input
                        type="text"
                        value={webhook.name}
                        onChange={(event) => patchWebhook(webhook.id, { name: event.target.value })}
                        aria-label={t('account.settings.aria.webhookName')}
                        maxLength={80}
                        className={cn(
                          'min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-medium text-text-primary outline-none transition-colors hover:border-border-light focus:border-accent/60 focus:bg-bg-base',
                          focusRing,
                        )}
                      />

                      <AnimatePresence mode="wait" initial={false}>
                        {isRemoving ? (
                          <motion.div
                            key="confirm"
                            initial={{ opacity: 0, x: 8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 8 }}
                            transition={QUICK}
                            className="flex shrink-0 items-center gap-1.5"
                          >
                            <span className="hidden text-xs text-text-secondary sm:inline">
                              {t('account.settings.webhooks.confirmRemove')}
                            </span>
                            <button
                              type="button"
                              onClick={() => setPendingRemoval(null)}
                              className={cn(
                                'flex min-h-9 items-center rounded-lg px-2.5 text-xs font-medium text-text-secondary hover:bg-bg-element hover:text-text-primary',
                                focusRing,
                              )}
                            >
                              {t('account.settings.actions.cancel')}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeWebhook(webhook.id)}
                              className={cn(
                                'flex min-h-9 items-center rounded-lg bg-danger px-2.5 text-xs font-medium text-white hover:brightness-110',
                                focusRing,
                              )}
                            >
                              {t('account.settings.actions.remove')}
                            </button>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="actions"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={QUICK}
                            className="flex shrink-0 items-center gap-1"
                          >
                            <button
                              type="button"
                              role="radio"
                              aria-checked={isActive}
                              aria-label={t('account.settings.aria.useWebhook', { name: displayName })}
                              onClick={() => onSave({ activeWebhookId: webhook.id })}
                              className={cn(
                                'flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors',
                                focusRing,
                                isActive
                                  ? 'bg-accent/10 text-accent'
                                  : 'text-text-tertiary hover:bg-bg-element hover:text-text-secondary',
                              )}
                            >
                              <span
                                aria-hidden="true"
                                className={cn(
                                  'flex h-4 w-4 items-center justify-center rounded-full border',
                                  isActive ? 'border-accent bg-accent text-white' : 'border-text-tertiary',
                                )}
                              >
                                {isActive && <Check size={10} strokeWidth={3.5} />}
                              </span>
                              {isActive ? t('account.settings.labels.active') : t('account.settings.actions.setActive')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingRemoval(webhook.id)}
                              aria-label={t('account.settings.aria.deleteWebhook', { name: displayName })}
                              className={cn(
                                'flex h-9 w-9 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-danger/10 hover:text-danger',
                                focusRing,
                              )}
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <div className="mt-2.5 space-y-1.5">
                      <input
                        type="url"
                        inputMode="url"
                        spellCheck={false}
                        value={webhook.url}
                        onChange={(event) => patchWebhook(webhook.id, { url: event.target.value })}
                        placeholder={t('account.settings.placeholders.webhookUrl')}
                        aria-label={t('account.settings.aria.webhookUrl', { name: displayName })}
                        aria-invalid={urlInvalid}
                        className={cn(
                          inputClass,
                          'min-h-10 font-mono text-xs',
                          urlInvalid && 'border-danger/50 focus:border-danger focus:ring-danger/15',
                        )}
                      />
                      <AnimatePresence>
                        {urlInvalid && (
                          <motion.p
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={QUICK}
                            role="alert"
                            className="flex items-center gap-1.5 overflow-hidden text-xs text-danger"
                          >
                            <AlertCircle size={12} aria-hidden="true" className="shrink-0" />
                            {t('account.settings.webhooks.invalidUrl')}
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          <button
            type="button"
            onClick={addWebhook}
            className={cn(
              'flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border-light text-sm font-medium text-text-secondary transition-colors hover:border-accent/50 hover:bg-accent/[0.04] hover:text-text-primary',
              focusRing,
            )}
          >
            <Plus size={16} aria-hidden="true" />
            {t('account.settings.actions.addWebhook')}
          </button>
        </motion.div>
      )}
    </motion.div>
  );
};
