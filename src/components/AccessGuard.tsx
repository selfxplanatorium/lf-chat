import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Webhook } from 'lucide-react';
import { cn } from '../lib/utils';
import { WebhookEntry } from '../hooks/useSettings';
import { WebhookForm } from './WebhookDialog';
import { useI18n } from '../i18n';

interface AccessGuardProps {
  onWebhookSaved: (webhook: WebhookEntry) => void;
  hasWebhooks: boolean;
  themeMode?: 'light' | 'dark';
}

export function AccessGuard({ onWebhookSaved, hasWebhooks, themeMode = 'dark' }: AccessGuardProps) {
  const { t } = useI18n();

  if (hasWebhooks) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-bg-base p-4 sm:p-6">
      <AnimatePresence mode="wait">
          <motion.div
            key="webhook"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "relative z-10 my-auto w-full max-w-lg rounded-2xl border border-border-light bg-bg-surface p-6 sm:p-8",
              themeMode === 'dark' && "shadow-surface"
            )}
          >
            <div className="mb-8">
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-border-light bg-bg-element text-text-primary">
                <Webhook size={20} aria-hidden="true" />
              </div>
              <h1 className="text-2xl font-semibold tracking-[-0.03em] text-text-primary sm:text-3xl">
                {t('account.webhook.titles.connectFirstBackend')}
              </h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-text-secondary">
                {t('account.webhook.descriptions.connectFirstBackend')}
              </p>
            </div>

            <WebhookForm
              defaultName="Webhook 1"
              submitLabel={t('account.webhook.actions.saveContinue')}
              onSubmit={onWebhookSaved}
            />

            <p className="mt-6 text-xs leading-5 text-text-tertiary">
              {t('account.webhook.descriptions.changeLater')}
            </p>
          </motion.div>
      </AnimatePresence>
    </div>
  );
}
