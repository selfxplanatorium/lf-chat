import React from 'react';
import { motion } from 'motion/react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Settings } from '../../hooks/useSettings';
import { ThemeMode, ThemePreset } from '../../types';
import { cn } from '../../lib/utils';
import { useI18n, type Locale } from '../../i18n';
import { focusRing, Group, GroupLabel, listVariants, Row, SectionHeading } from './primitives';

/**
 * Preset swatches show a miniature of the theme — ground, panel, accent — rather
 * than a single colour dot. The three tokens are what actually changes between
 * presets, so the preview is information, not decoration. Values mirror
 * index.css; they are duplicated here because the presets are not applied to
 * the document while previewed, so they cannot be read from computed style.
 */
const PRESETS: Record<ThemeMode, { id: ThemePreset; base: string; surface: string; accent: string }[]> = {
  light: [
    { id: 'default', base: '#F7F7F8', surface: '#FFFFFF', accent: '#A81A40' },
    { id: 'cream', base: '#F9F7F2', surface: '#FFFDF9', accent: '#8B5E3C' },
    { id: 'sky', base: '#F0F4F8', surface: '#FFFFFF', accent: '#2D5A82' },
  ],
  dark: [
    { id: 'default', base: '#101011', surface: '#18181A', accent: '#F43F5E' },
    { id: 'midnight', base: '#05070A', surface: '#0E1217', accent: '#60A5FA' },
    { id: 'forest', base: '#0A0C0B', surface: '#121815', accent: '#34D399' },
  ],
};

const LANGUAGES: { id: Locale; key: string }[] = [
  { id: 'en', key: 'common.english' },
  { id: 'de', key: 'common.german' },
  { id: 'it', key: 'common.italian' },
];

interface AppearanceSectionProps {
  settings: Settings;
  onSave: (partial: Partial<Settings>) => void;
  resolvedTheme: ThemeMode;
}

/** Segmented control: one visible selection that slides between options. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  layoutId,
}: {
  value: T;
  options: { id: T; label: string; icon?: React.ReactNode }[];
  onChange: (id: T) => void;
  label: string;
  layoutId: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-0.5 rounded-xl bg-bg-element/70 p-1">
      {options.map((option) => {
        const isSelected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.id)}
            className={cn(
              'relative flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors',
              focusRing,
              isSelected ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary',
            )}
          >
            {isSelected && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.8 }}
                className="absolute inset-0 rounded-lg bg-bg-surface shadow-sm"
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {option.icon}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const AppearanceSection: React.FC<AppearanceSectionProps> = ({ settings, onSave, resolvedTheme }) => {
  const { t, locale, setLocale } = useI18n();
  const mode: 'light' | 'dark' | 'system' = settings.themeAuto ? 'system' : settings.themeMode;
  const presets = PRESETS[resolvedTheme];

  return (
    <motion.div variants={listVariants} initial="hidden" animate="shown" className="space-y-8">
      <SectionHeading
        title={t('account.settings.nav.appearance')}
        description={t('account.settings.subtitles.appearance')}
      />

      <Group>
        <Row
          label={t('account.settings.appearance.mode')}
          description={t('account.settings.appearance.modeDescription')}
          control={
            <Segmented
              layoutId="settings-theme-mode"
              label={t('account.settings.appearance.mode')}
              value={mode}
              onChange={(next) =>
                onSave(next === 'system' ? { themeAuto: true } : { themeAuto: false, themeMode: next })
              }
              options={[
                { id: 'light', label: t('account.settings.appearance.light'), icon: <Sun size={13} aria-hidden="true" /> },
                { id: 'dark', label: t('account.settings.appearance.dark'), icon: <Moon size={13} aria-hidden="true" /> },
                { id: 'system', label: t('account.settings.appearance.system'), icon: <Monitor size={13} aria-hidden="true" /> },
              ]}
            />
          }
        />

        <Row label={t('account.settings.sections.themePreset')} description={t('account.settings.appearance.presetDescription')}>
          <div role="radiogroup" aria-label={t('account.settings.sections.themePreset')} className="grid grid-cols-3 gap-2">
            {presets.map((preset) => {
              const isSelected = settings.themePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => onSave({ themePreset: preset.id })}
                  className={cn(
                    'group relative flex flex-col items-center gap-2 rounded-xl border p-2.5 transition-colors',
                    focusRing,
                    isSelected ? 'border-accent bg-accent/[0.06]' : 'border-border-light hover:border-text-tertiary/60',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-12 w-full items-center gap-1 overflow-hidden rounded-lg border border-black/10 p-1.5"
                    style={{ backgroundColor: preset.base }}
                  >
                    <span className="h-full w-1/3 rounded" style={{ backgroundColor: preset.surface }} />
                    <span className="h-1.5 w-4 rounded-full" style={{ backgroundColor: preset.accent }} />
                  </span>
                  <span className={cn('truncate text-xs font-medium', isSelected ? 'text-accent' : 'text-text-tertiary group-hover:text-text-secondary')}>
                    {t(`account.settings.presets.${preset.id}`)}
                  </span>
                </button>
              );
            })}
          </div>
        </Row>
      </Group>

      <div className="space-y-3">
        <GroupLabel>{t('common.language')}</GroupLabel>
        <Group>
          <Row
            label={t('account.settings.appearance.language')}
            description={t('account.settings.appearance.languageDescription')}
            control={
              <Segmented
                layoutId="settings-language"
                label={t('common.languages')}
                value={locale}
                onChange={(next) => setLocale(next)}
                options={LANGUAGES.map((language) => ({ id: language.id, label: t(language.key) }))}
              />
            }
          />
        </Group>
      </div>
    </motion.div>
  );
};
