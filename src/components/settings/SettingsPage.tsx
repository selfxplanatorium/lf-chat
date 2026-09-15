import React, { useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArchiveRestore,
  ArrowLeft,
  Check,
  Loader2,
  Palette,
  Server,
  SlidersHorizontal,
  TriangleAlert,
  UserRound,
  Webhook,
} from 'lucide-react';
import { Settings, SettingsSaveState } from '../../hooks/useSettings';
import type { User } from '../../hooks/useAuth';
import { Conversation, ThemeMode } from '../../types';
import { cn } from '../../lib/utils';
import { useI18n } from '../../i18n';
import { EASE, focusRing, QUICK } from './primitives';
import { AccountSection } from './AccountSection';
import { BackendsSection } from './BackendsSection';
import { AppearanceSection } from './AppearanceSection';
import { BehaviorSection } from './BehaviorSection';
import { DataSection } from './DataSection';
import { ServerSection } from './ServerSection';

/*
 * DIRECTION CONTRACT — Settings (Operate)
 *
 * THESIS: Settings is a place you go, not a dialog that interrupts you. It
 * refuses the 448px scroll-modal with a Save button, and the four sibling
 * dialogs (profile, data, shortcuts, language) that hid the rest of the app's
 * configuration in a sidebar popup menu.
 * OWN-WORLD: The chat's own tokens — bg-base ground, bg-surface panels, hairline
 * borders, rose accent reserved for selection and primary action, Golos Text,
 * 10/14px radii. Grouped hairline-divided rows, never a grid of cards; sentence
 * case, never uppercase display type.
 * STORY: Arrive from anywhere, find the setting by the thing it governs, change
 * it, watch it save itself, leave with Esc.
 * FIRST VIEWPORT: A 64px header (back to chat · title · save state) over a
 * 244px section rail and a 680px content column, opening on Account.
 * FORM: Rail + panel, the Operate standard, played straight — familiarity is the
 * feature here. Its one authored moment is the selection: a single pill that
 * travels between rail items while the panel behind it crossfades and its rows
 * cascade in.
 *
 * Tensions worth recording:
 * - Instant apply vs. undo. Every control writes through immediately (the store
 *   debounces the network write), so there is no Save button and no unsaved
 *   state to defend on close. The price is that destructive edits need their own
 *   guard: removing a backend confirms in place, deleting an account still
 *   requires typing a word.
 * - Overlay vs. route. The page covers the app rather than replacing it so the
 *   chat stays mounted and a stream in flight keeps running behind it. That is
 *   why it is a `dialog` with a focus trap, not a route.
 */

export type SettingsSection = 'account' | 'backends' | 'appearance' | 'behavior' | 'data' | 'server';

const SECTIONS: { id: SettingsSection; icon: React.ComponentType<{ size?: number | string; className?: string }> }[] = [
  { id: 'account', icon: UserRound },
  { id: 'backends', icon: Webhook },
  { id: 'appearance', icon: Palette },
  { id: 'behavior', icon: SlidersHorizontal },
  { id: 'data', icon: ArchiveRestore },
  { id: 'server', icon: Server },
];

interface SettingsPageProps {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  settings: Settings;
  onSave: (partial: Partial<Settings>) => void;
  resolvedTheme: ThemeMode;
  saveState: SettingsSaveState;
  saveError: string;
  user: User | null;
  conversations: Conversation[];
  onLogout: () => void;
  onOpenShortcuts: () => void;
  isShortcutsOpen: boolean;
}

const SaveIndicator: React.FC<{ state: SettingsSaveState; error: string }> = ({ state, error }) => {
  const { t } = useI18n();
  if (state === 'idle') return <span className="h-5 w-px" aria-hidden="true" />;

  const content = {
    saving: { icon: <Loader2 size={13} className="animate-spin" aria-hidden="true" />, text: t('account.settings.save.saving'), tone: 'text-text-tertiary' },
    saved: { icon: <Check size={13} aria-hidden="true" />, text: t('account.settings.save.saved'), tone: 'text-success' },
    error: { icon: <TriangleAlert size={13} aria-hidden="true" />, text: error || t('account.settings.save.failed'), tone: 'text-danger' },
  }[state];

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={state}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={QUICK}
        role="status"
        aria-live="polite"
        className={cn('flex max-w-[46vw] items-center gap-1.5 truncate text-xs font-medium', content.tone)}
      >
        {content.icon}
        <span className="truncate">{content.text}</span>
      </motion.span>
    </AnimatePresence>
  );
};

export const SettingsPage: React.FC<SettingsPageProps> = ({
  section,
  onSectionChange,
  onClose,
  settings,
  onSave,
  resolvedTheme,
  saveState,
  saveError,
  user,
  conversations,
  onLogout,
  onOpenShortcuts,
  isShortcutsOpen,
}) => {
  const { t } = useI18n();
  const pageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // A new section starts at its own top; inheriting the previous section's
  // scroll offset drops the user into the middle of unrelated controls.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [section]);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      pageRef.current?.querySelector<HTMLElement>('[data-settings-initial-focus]')?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // The shortcuts dialog opens on top of this page and owns Esc and Tab
      // while it is up.
      if (isShortcutsOpen) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      // The global shortcut hook stops listening while this page is open, so
      // Alt+P would otherwise only ever open it. Closing it here is what makes
      // the shortcut a toggle.
      if (event.altKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !pageRef.current) return;

      const focusable = Array.from(
        pageRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;

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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isShortcutsOpen]);

  /** Arrow keys move between sections, as a tablist is expected to. */
  const handleTabKeyDown = useCallback((event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1
      : 0;
    let next: SettingsSection | null = null;
    if (step !== 0) {
      const index = SECTIONS.findIndex((entry) => entry.id === section);
      next = SECTIONS[(index + step + SECTIONS.length) % SECTIONS.length].id;
    } else if (event.key === 'Home') {
      next = SECTIONS[0].id;
    } else if (event.key === 'End') {
      next = SECTIONS[SECTIONS.length - 1].id;
    }
    if (!next) return;
    event.preventDefault();
    onSectionChange(next);
    const target = next;
    requestAnimationFrame(() => {
      pageRef.current?.querySelector<HTMLElement>(`[data-section-tab="${target}"]`)?.focus();
    });
  }, [section, onSectionChange]);

  const renderTab = (entry: (typeof SECTIONS)[number], variant: 'rail' | 'strip') => {
    const isSelected = entry.id === section;
    const Icon = entry.icon;
    return (
      <button
        key={`${variant}-${entry.id}`}
        type="button"
        role="tab"
        id={`settings-tab-${variant}-${entry.id}`}
        aria-selected={isSelected}
        aria-controls="settings-panel"
        tabIndex={isSelected ? 0 : -1}
        data-section-tab={variant === 'rail' ? entry.id : undefined}
        data-settings-initial-focus={variant === 'rail' && isSelected ? true : undefined}
        onKeyDown={handleTabKeyDown}
        onClick={() => onSectionChange(entry.id)}
        className={cn(
          'relative flex items-center gap-2.5 whitespace-nowrap rounded-xl text-sm font-medium transition-colors',
          focusRing,
          variant === 'rail' ? 'min-h-11 w-full px-3' : 'min-h-10 shrink-0 px-3',
          isSelected ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary',
        )}
      >
        {isSelected && (
          <motion.span
            layoutId={`settings-nav-${variant}`}
            transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.8 }}
            className="absolute inset-0 rounded-xl bg-bg-element"
          />
        )}
        <span className="relative flex items-center gap-2.5">
          <Icon size={16} className={cn(isSelected ? 'text-accent' : 'text-text-tertiary')} />
          {t(`account.settings.nav.${entry.id}`)}
        </span>
      </button>
    );
  };

  return (
    <motion.div
      ref={pageRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-page-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: EASE }}
      className="fixed inset-0 z-[60] flex flex-col bg-bg-base"
    >
      <motion.header
        initial={{ y: -12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.28, ease: EASE }}
        className="flex h-16 shrink-0 items-center gap-3 border-b border-border-light px-3 sm:px-5"
      >
        <button
          type="button"
          onClick={onClose}
          className={cn(
            'group flex min-h-11 items-center gap-2 rounded-xl px-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-element hover:text-text-primary',
            focusRing,
          )}
        >
          <ArrowLeft size={17} aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5" />
          <span className="hidden sm:inline">{t('account.settings.actions.backToChat')}</span>
          <span className="sr-only sm:hidden">{t('account.settings.actions.backToChat')}</span>
        </button>

        <div className="h-5 w-px bg-border-light" aria-hidden="true" />

        <h1 id="settings-page-title" className="text-base font-semibold tracking-[-0.01em] text-text-primary">
          {t('account.settings.title')}
        </h1>

        <div className="ml-auto flex items-center gap-3">
          <SaveIndicator state={saveState} error={saveError} />
          <kbd className="hidden rounded border border-border-light bg-bg-surface px-1.5 py-1 font-mono text-[11px] text-text-tertiary lg:inline">
            Esc
          </kbd>
        </div>
      </motion.header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          role="tablist"
          aria-orientation="vertical"
          aria-label={t('account.settings.title')}
          className="hidden shrink-0 gap-1 border-r border-border-light p-3 md:flex md:w-[244px] md:flex-col"
        >
          {SECTIONS.map((entry) => renderTab(entry, 'rail'))}
        </nav>

        <div
          role="tablist"
          aria-orientation="horizontal"
          aria-label={t('account.settings.title')}
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border-light px-2 py-2 md:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {SECTIONS.map((entry) => renderTab(entry, 'strip'))}
        </div>

        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto">
          <div
            id="settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-tab-rail-${section}`}
            tabIndex={-1}
            className="mx-auto w-full max-w-[680px] px-4 py-8 pb-24 sm:px-6 sm:py-10"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={section}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                {section === 'account' && (
                  <AccountSection settings={settings} onSave={onSave} user={user} onLogout={onLogout} />
                )}
                {section === 'backends' && <BackendsSection settings={settings} onSave={onSave} />}
                {section === 'appearance' && (
                  <AppearanceSection settings={settings} onSave={onSave} resolvedTheme={resolvedTheme} />
                )}
                {section === 'behavior' && (
                  <BehaviorSection settings={settings} onSave={onSave} onOpenShortcuts={onOpenShortcuts} />
                )}
                {section === 'data' && (
                  <DataSection conversations={conversations} settings={settings} onAccountDeleted={onLogout} />
                )}
                {section === 'server' && <ServerSection user={user} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
