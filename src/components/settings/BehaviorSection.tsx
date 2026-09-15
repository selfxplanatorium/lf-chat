import React from 'react';
import { motion } from 'motion/react';
import { ChevronRight, Keyboard } from 'lucide-react';
import { Settings } from '../../hooks/useSettings';
import { cn } from '../../lib/utils';
import { useI18n } from '../../i18n';
import { focusRing, Group, GroupLabel, listVariants, SectionHeading, ToggleRow } from './primitives';

interface BehaviorSectionProps {
  settings: Settings;
  onSave: (partial: Partial<Settings>) => void;
  onOpenShortcuts: () => void;
}

export const BehaviorSection: React.FC<BehaviorSectionProps> = ({ settings, onSave, onOpenShortcuts }) => {
  const { t } = useI18n();

  return (
    <motion.div variants={listVariants} initial="hidden" animate="shown" className="space-y-8">
      <SectionHeading
        title={t('account.settings.nav.behavior')}
        description={t('account.settings.subtitles.behavior')}
      />

      <Group>
        {/* Hidden on touch: there is no Ctrl key to send with, and the composer
            ignores the setting there anyway. */}
        <div className="hidden sm:block">
          <ToggleRow
            checked={settings.sendWithCtrlEnter}
            onChange={() => onSave({ sendWithCtrlEnter: !settings.sendWithCtrlEnter })}
            label={t('account.settings.behavior.sendWithCtrlEnter')}
            description={t('account.settings.behavior.sendWithCtrlEnterDescription')}
          />
        </div>
        <ToggleRow
          checked={settings.confirmDeleteChat}
          onChange={() => onSave({ confirmDeleteChat: !settings.confirmDeleteChat })}
          label={t('account.settings.behavior.confirmDelete')}
          description={t('account.settings.behavior.confirmDeleteDescription')}
        />
        <ToggleRow
          checked={settings.confirmEditMessage}
          onChange={() => onSave({ confirmEditMessage: !settings.confirmEditMessage })}
          label={t('account.settings.behavior.confirmEdit')}
          description={t('account.settings.behavior.confirmEditDescription')}
        />
      </Group>

      <div className="hidden space-y-3 md:block">
        <GroupLabel>{t('account.settings.sections.keyboard')}</GroupLabel>
        <Group>
          <button
            type="button"
            onClick={onOpenShortcuts}
            className={cn(
              'group flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-bg-element/40 sm:px-5',
              focusRing,
            )}
          >
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-bg-element text-text-secondary transition-colors group-hover:bg-accent/10 group-hover:text-accent">
                <Keyboard size={16} aria-hidden="true" />
              </span>
              <span className="space-y-0.5">
                <span className="block text-sm font-medium text-text-primary">
                  {t('account.settings.actions.keyboardShortcuts')}
                </span>
                <span className="block text-xs leading-5 text-text-tertiary">
                  {t('account.settings.descriptions.keyboardShortcuts')}
                </span>
              </span>
            </span>
            <ChevronRight
              size={16}
              aria-hidden="true"
              className="shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5"
            />
          </button>
        </Group>
      </div>
    </motion.div>
  );
};
