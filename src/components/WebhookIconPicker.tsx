import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  getWebhookIcon,
  WEBHOOK_ICON_CATALOG,
  type WebhookIconName,
} from '../lib/webhookIcons';
import { useI18n } from '../i18n';

interface WebhookIconPickerProps {
  value?: string;
  onChange: (icon: WebhookIconName) => void;
  webhookName?: string;
}

/** A compact, keyboard-navigable picker for a webhook's visual identity. */
export const WebhookIconPicker: React.FC<WebhookIconPickerProps> = ({
  value,
  onChange,
  webhookName = 'webhook',
}) => {
  const { t, locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const SelectedIcon = getWebhookIcon(value);
  const selectedIconName = WEBHOOK_ICON_CATALOG.some((entry) => entry.name === value) ? value : 'Webhook';
  const selectedLabel = t(`icons.${selectedIconName}`);

  const filteredIcons = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    if (!normalizedQuery) return WEBHOOK_ICON_CATALOG;
    return WEBHOOK_ICON_CATALOG.filter((entry) =>
      `${entry.name} ${t(`icons.${entry.name}`)}`.toLocaleLowerCase(locale).includes(normalizedQuery),
    );
  }, [locale, query, t]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (icon: WebhookIconName) => {
    onChange(icon);
    setIsOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={t('account.iconPicker.aria.changeIcon', { webhookName })}
        title={t('account.iconPicker.titles.icon', { selectedLabel })}
        className="flex h-11 w-11 items-center justify-center rounded-xl border border-border-light bg-bg-element text-text-primary transition-colors hover:border-text-tertiary hover:bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <SelectedIcon size={20} strokeWidth={1.8} aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={t('account.iconPicker.aria.chooseIcon', { webhookName })}
          className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-border-light bg-bg-surface p-3 shadow-surface"
        >
          <div className="relative mb-3">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('account.iconPicker.placeholders.search')}
              aria-label={t('account.iconPicker.aria.search')}
              className="h-11 w-full rounded-xl border border-border-light bg-bg-base pl-9 pr-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent/15"
            />
          </div>
          <div className="grid max-h-60 grid-cols-6 gap-1 overflow-x-hidden overflow-y-auto pr-0.5" role="group" aria-label={t('account.iconPicker.aria.icons')}>
            {filteredIcons.map(({ name, icon: Icon }) => {
              const isSelected = (value ?? 'Webhook') === name;
              const label = t(`icons.${name}`);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={label}
                  title={label}
                  onClick={() => handleSelect(name as WebhookIconName)}
                  className={cn(
                    'relative flex h-11 min-w-0 w-full items-center justify-center rounded-xl text-text-primary transition-colors hover:bg-bg-element focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    isSelected && 'bg-accent/15',
                  )}
                >
                  <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                  {isSelected && <Check size={10} className="absolute bottom-1 right-1" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          {filteredIcons.length === 0 && <p className="px-2 py-3 text-center text-xs text-text-tertiary">{t('account.iconPicker.messages.noMatchingIcons')}</p>}
        </div>
      )}
    </div>
  );
};
