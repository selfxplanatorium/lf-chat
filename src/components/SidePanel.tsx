import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArchiveRestore,
  Check,
  Download,
  GitBranch,
  Keyboard,
  Languages,
  Loader2,
  LogOut,
  MessageSquare,
  MoreVertical,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { Conversation, ThemeMode } from '../types';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { exportConversation, ExportFormat } from '../lib/exportUtils';
import { ConversationListSkeleton } from './Skeletons';
import { useI18n, type Locale } from '../i18n';
import type { SettingsSection } from './settings/SettingsPage';

interface SidePanelProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onHover?: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onToggle: () => void;
  isOpen: boolean;
  /** Opens the settings page, optionally on a specific section. */
  onOpenSettings: (section?: SettingsSection) => void;
  profileName: string;
  profileImage: string;
  disableNew?: boolean;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  confirmDeleteChat?: boolean;
  onOpenShortcuts?: () => void;
  onLogout?: () => void;
  isLoaded?: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  searchFocusRequest?: number;
}

type MenuAnchor = { x: number; y: number; id: string };

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-surface';
const menuItemClass = 'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-text-secondary transition-colors hover:bg-bg-element hover:text-text-primary focus-visible:bg-bg-element focus-visible:text-text-primary';

export const SidePanel: React.FC<SidePanelProps> = ({
  conversations,
  activeId,
  onSelect,
  onHover,
  onNew,
  onDelete,
  onRename,
  onPin,
  isOpen,
  onOpenSettings,
  profileName,
  profileImage,
  disableNew,
  themeMode,
  onToggleTheme,
  confirmDeleteChat = true,
  onOpenShortcuts,
  onLogout,
  isLoaded = true,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  searchFocusRequest = 0,
}) => {
  const { t, locale, setLocale } = useI18n();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchCoords = useRef<{ x: number; y: number } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const conversationMenuTriggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const menuReturnFocusRef = useRef<HTMLElement | null>(null);
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const getConversationTitle = (conversation: Conversation) =>
    conversation.isUntitled ? t('chat.sidePanel.newChat') : conversation.title;

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  useEffect(() => {
    if (!searchFocusRequest || !isOpen) return;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [searchFocusRequest, isOpen]);

  // Close popups when focus or the pointer leaves them. The trigger exceptions
  // keep a click from immediately undoing the state change that opened a menu.
  useEffect(() => {
    const handleOutside = (event: MouseEvent | FocusEvent) => {
      const target = event.target as Node | null;
      if (event.type === 'contextmenu' && target instanceof Element && target.closest('[data-conversation-row]')) return;
      if (target && (menuRef.current?.contains(target) || accountMenuRef.current?.contains(target) || accountButtonRef.current?.contains(target))) return;
      if (menuAnchor) setMenuAnchor(null);
      if (accountMenuOpen) setAccountMenuOpen(false);
    };
    window.addEventListener('click', handleOutside);
    window.addEventListener('contextmenu', handleOutside);
    window.addEventListener('focusin', handleOutside);
    return () => {
      window.removeEventListener('click', handleOutside);
      window.removeEventListener('contextmenu', handleOutside);
      window.removeEventListener('focusin', handleOutside);
    };
  }, [menuAnchor, accountMenuOpen]);

  useEffect(() => {
    if (!menuAnchor) return;
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menuAnchor]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const frame = window.requestAnimationFrame(() => {
      accountMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!deletingId) {
      const returnTarget = deleteReturnFocusRef.current;
      deleteReturnFocusRef.current = null;
      if (returnTarget) window.requestAnimationFrame(() => returnTarget.focus());
      return;
    }

    const frame = window.requestAnimationFrame(() => deleteCancelRef.current?.focus());
    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDeletingId(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = deleteDialogRef.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
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
    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleDialogKeyDown);
    };
  }, [deletingId]);

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase(locale);
    if (!query) return conversations;
    return conversations.filter((conversation) => getConversationTitle(conversation).toLocaleLowerCase(locale).includes(query));
  }, [conversations, searchQuery, locale, t]);

  const groupedCategories = useMemo(() => {
    const now = new Date();
    const formatDate = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
    const getAgeCategory = (updatedAt: number) => {
      const date = new Date(updatedAt);
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      // Use the active locale when comparing calendar dates so grouping follows
      // the user's local calendar rather than only elapsed 24-hour periods.
      if (formatDate.format(date) === formatDate.format(now)) return 'today';
      if (diffDays === 0) return 'today';
      if (diffDays === 1) return 'yesterday';
      if (diffDays <= 7) return 'last7Days';
      if (diffDays <= 30) return 'last30Days';
      return 'older';
    };
    const categories: { key: string; items: Conversation[] }[] = [
      { key: 'today', items: [] },
      { key: 'yesterday', items: [] },
      { key: 'last7Days', items: [] },
      { key: 'last30Days', items: [] },
      { key: 'older', items: [] },
    ];
    for (const conv of filteredConversations) {
      const group = categories.find(g => g.key === getAgeCategory(conv.updatedAt));
      if (group) group.items.push(conv);
    }
    return categories.filter(g => g.items.length > 0);
  }, [filteredConversations, locale]);

  const categoryLabel = (category: string) => t(`chat.sidePanel.${category}`);

  const closeContextMenu = (restoreFocus = true) => {
    const returnTarget = menuReturnFocusRef.current;
    menuReturnFocusRef.current = null;
    setMenuAnchor(null);
    if (restoreFocus && returnTarget) window.requestAnimationFrame(() => returnTarget.focus());
  };

  const openContextMenu = (event: React.MouseEvent, id: string, trigger?: HTMLElement | null) => {
    event.preventDefault();
    event.stopPropagation();
    menuReturnFocusRef.current = trigger || conversationMenuTriggers.current[id] || null;
    setAccountMenuOpen(false);
    const triggerRect = trigger?.getBoundingClientRect();
    setMenuAnchor({
      x: event.clientX || triggerRect?.right || 8,
      y: event.clientY || triggerRect?.bottom || 8,
      id,
    });
  };

  const handleContextMenu = (event: React.MouseEvent, id: string) => {
    openContextMenu(event, id);
  };

  const onTouchStart = (event: React.TouchEvent, id: string) => {
    const touch = event.touches[0];
    touchCoords.current = { x: touch.clientX, y: touch.clientY };
    longPressTimer.current = setTimeout(() => {
      if (touchCoords.current) {
        menuReturnFocusRef.current = conversationMenuTriggers.current[id] || null;
        setMenuAnchor({ x: touchCoords.current.x, y: touchCoords.current.y, id });
      }
    }, 600);
  };

  const onTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleRenameSubmit = (id: string) => {
    const trimmed = renamingValue.trim().slice(0, 100);
    if (trimmed) onRename(id, trimmed);
    setRenamingId(null);
  };

  const startRenaming = (id: string, currentTitle: string) => {
    closeContextMenu(false);
    setRenamingId(id);
    setRenamingValue(currentTitle);
  };

  const togglePin = (event: React.MouseEvent, id: string, pinned: boolean | undefined) => {
    event.stopPropagation();
    onPin(id, !pinned);
    closeContextMenu(false);
  };

  const openDeleteConfirmation = (id: string) => {
    if (confirmDeleteChat) {
      deleteReturnFocusRef.current = menuReturnFocusRef.current || conversationMenuTriggers.current[id] || (document.activeElement as HTMLElement);
      closeContextMenu(false);
      setDeletingId(id);
    } else {
      onDelete(id);
      closeContextMenu();
    }
  };

  const closeDeleteDialog = () => setDeletingId(null);

  const confirmDelete = () => {
    if (deletingId) {
      onDelete(deletingId);
      setDeletingId(null);
    }
  };

  const handleExport = (format: ExportFormat) => {
    if (!menuAnchor) return;
    const conversation = conversations.find(c => c.id === menuAnchor.id);
    if (conversation) exportConversation(conversation, format, {
      user: t('export.user'),
      assistant: t('export.assistant'),
      untitled: t('chat.sidePanel.newChat'),
    });
    closeContextMenu();
  };

  const focusMenuItem = (container: HTMLElement | null, current: EventTarget | null, direction: 1 | -1 | 'first' | 'last') => {
    const items = Array.from(container?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []);
    if (!items.length) return;
    if (direction === 'first') { items[0].focus(); return; }
    if (direction === 'last') { items[items.length - 1].focus(); return; }
    const index = Math.max(0, items.indexOf(current as HTMLElement));
    items[(index + direction + items.length) % items.length].focus();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeContextMenu();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusMenuItem(menuRef.current, event.target, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusMenuItem(menuRef.current, event.target, event.key === 'Home' ? 'first' : 'last');
    }
  };

  const closeAccountMenu = (restoreFocus = true) => {
    setAccountMenuOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => accountButtonRef.current?.focus());
  };

  const handleAccountMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAccountMenu();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusMenuItem(accountMenuRef.current, event.target, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusMenuItem(accountMenuRef.current, event.target, event.key === 'Home' ? 'first' : 'last');
    }
  };

  const runAccountAction = (action: () => void, keepOpen = false) => {
    if (!keepOpen) closeAccountMenu(false);
    action();
  };

  // Profile and data management are sections of the settings page now, so these
  // entries deep-link into it rather than opening dialogs of their own.
  const accountMenuActions = [
    { id: 'profile-btn', label: t('chat.sidePanel.profile'), icon: UserIcon, action: () => onOpenSettings('account') },
    { id: 'settings-btn', label: t('chat.sidePanel.settings'), icon: SettingsIcon, action: () => onOpenSettings() },
    { id: 'data-management-btn', label: t('chat.sidePanel.dataManagement'), icon: ArchiveRestore, action: () => onOpenSettings('data') },
    { id: 'theme-toggle-btn', label: t('chat.sidePanel.switchToMode', { mode: t(`chat.sidePanel.${themeMode === 'dark' ? 'light' : 'dark'}`) }), icon: themeMode === 'dark' ? Sun : Moon, action: onToggleTheme, keepOpen: true },
    ...(onOpenShortcuts ? [{ id: 'shortcuts-btn', label: t('chat.sidePanel.keyboardShortcuts'), icon: Keyboard, action: onOpenShortcuts }] : []),
    ...(onLogout ? [{ id: 'logout-btn', label: t('chat.sidePanel.signOut'), icon: LogOut, action: onLogout, danger: true }] : []),
  ];

  return (
    <>
      <motion.div
        initial={false}
        animate={{ width: isOpen ? 288 : 0 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className={cn('bg-bg-surface border-r border-border-light h-full flex flex-col relative overflow-hidden shrink-0', !isOpen && 'border-none')}
      >
        <div className="flex h-full w-72 flex-col gap-4 p-3">
          <div className="flex min-h-10 items-center justify-center px-12">
            <div className="select-none font-wordmark text-lg leading-none tracking-[0.01em] text-text-primary">LF-CHAT</div>
          </div>

          <div>
            <motion.button
              id="new-chat-btn"
              type="button"
              whileHover={disableNew ? {} : { scale: 1.02 }}
              whileTap={disableNew ? {} : { scale: 0.98 }}
              onClick={disableNew ? undefined : () => { setSearchQuery(''); onNew(); }}
              disabled={disableNew}
              className={cn('flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-accent/35 bg-accent/10 text-sm font-medium text-text-primary transition-colors hover:border-accent/55 hover:bg-accent/15', focusRing, disableNew && 'opacity-50 cursor-not-allowed shadow-none grayscale')}
            >
              <Plus size={18} strokeWidth={3} />
              {t('chat.sidePanel.newChat')}
            </motion.button>
          </div>

          <div className="relative">
            <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                if (searchQuery) setSearchQuery('');
                else event.currentTarget.blur();
              }}
              placeholder={t('chat.sidePanel.searchPlaceholder')}
              aria-label={t('chat.sidePanel.searchThreads')}
              className={cn('min-h-11 w-full appearance-none rounded-xl border border-transparent bg-transparent py-2 pl-10 pr-10 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary hover:bg-bg-element/40 focus:border-border-light focus:bg-bg-base [&::-webkit-search-cancel-button]:appearance-none', focusRing)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                aria-label={t('chat.sidePanel.clearSearch')}
                className={cn('absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-text-tertiary hover:text-text-primary', focusRing)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-4">
            {!isLoaded ? <ConversationListSkeleton /> : (
              <>
                {groupedCategories.map(({ key: category, items: categoryConversations }) => (
                  <div key={category}>
                    <div className="px-3 py-2 text-[11px] font-medium text-text-tertiary">{categoryLabel(category)}</div>
                    <AnimatePresence mode="popLayout">
                      {categoryConversations.map((conv) => {
                        const isBranched = Boolean(conv.parentConversationId && conversations.some(c => c.id === conv.parentConversationId));
                        const isActive = activeId === conv.id;
                        const displayTitle = getConversationTitle(conv);
                        return (
                          <motion.div
                            key={conv.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className={cn('group relative flex min-h-11 items-center rounded-xl border border-transparent transition-colors focus-within:bg-bg-element/70', isActive ? 'bg-bg-element text-text-primary' : 'text-text-secondary hover:bg-bg-element/50 hover:text-text-primary')}
                            data-conversation-row="true"
                            onMouseEnter={() => onHover?.(conv.id)}
                            onContextMenu={(event) => handleContextMenu(event, conv.id)}
                            onTouchStart={(event) => onTouchStart(event, conv.id)}
                            onTouchEnd={onTouchEnd}
                            onTouchMove={onTouchEnd}
                          >
                            {renamingId === conv.id ? (
                              <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2" onClick={event => event.stopPropagation()}>
                                <Pencil size={15} className="shrink-0 text-accent" />
                                <input
                                  ref={renameInputRef}
                                  value={renamingValue}
                                  onChange={(event) => setRenamingValue(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') handleRenameSubmit(conv.id);
                                    if (event.key === 'Escape') setRenamingId(null);
                                  }}
                                  onBlur={() => handleRenameSubmit(conv.id)}
                                  maxLength={100}
                                  aria-label={t('chat.sidePanel.renameConversation')}
                                  className={cn('w-full min-w-0 rounded border border-accent bg-bg-base px-1.5 py-1 text-sm font-medium text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/60', focusRing)}
                                />
                                <button type="button" onClick={() => handleRenameSubmit(conv.id)} className={cn('flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-bg-base/50 hover:text-text-primary', focusRing)} aria-label={t('chat.sidePanel.saveConversationName')}><Check size={15} /></button>
                                <button type="button" onClick={() => setRenamingId(null)} className={cn('flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-bg-base/50 hover:text-text-primary', focusRing)} aria-label={t('chat.sidePanel.cancelRenaming')}><X size={15} /></button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onSelect(conv.id)}
                                className={cn('flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left', focusRing)}
                                aria-current={isActive ? 'page' : undefined}
                                aria-label={t('chat.sidePanel.openConversation', { title: displayTitle })}
                              >
                                <div className="relative shrink-0">
                                  <MessageSquare size={15} className={cn(isActive ? 'text-text-primary' : 'text-text-tertiary')} />
                                  {isBranched && <div className="absolute -right-1.5 -top-1.5 rounded-full border border-bg-surface bg-accent p-0.5 text-white shadow-sm"><GitBranch size={8} strokeWidth={4} /></div>}
                                </div>
                                <span className={cn('flex min-w-0 flex-1 items-center gap-2 truncate text-[13px] font-medium', isActive ? 'text-text-primary' : 'text-text-secondary')}>
                                  <span className="truncate">{displayTitle}</span>
                                  {conv.streamingStatus === 'streaming' && <Loader2 size={10} className="shrink-0 animate-spin text-accent" />}
                                  {conv.pinned && <Pin size={10} className="shrink-0 text-accent" />}
                                </span>
                              </button>
                            )}

                            {renamingId !== conv.id && (
                              <div className={cn('flex shrink-0 items-center gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100', isActive && 'opacity-100')}>
                                <button
                                  type="button"
                                  onClick={(event) => togglePin(event, conv.id, conv.pinned)}
                                  className={cn('flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-bg-base/50', focusRing, conv.pinned ? 'text-accent' : 'text-text-tertiary')}
                                  aria-label={conv.pinned ? t('chat.sidePanel.unpinTitle', { title: displayTitle }) : t('chat.sidePanel.pinTitle', { title: displayTitle })}
                                  title={conv.pinned ? t('chat.sidePanel.unpin') : t('chat.sidePanel.pin')}
                                ><Pin size={14} /></button>
                                <button
                                  type="button"
                                  data-conversation-menu-trigger="true"
                                  ref={(element) => { conversationMenuTriggers.current[conv.id] = element; }}
                                  onClick={(event) => openContextMenu(event, conv.id, event.currentTarget)}
                                  className={cn('flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-bg-base/50', focusRing)}
                                  aria-label={t('chat.sidePanel.conversationOptions', { title: displayTitle })}
                                  aria-haspopup="menu"
                                  aria-expanded={menuAnchor?.id === conv.id}
                                  title={t('chat.sidePanel.moreOptions')}
                                ><MoreVertical size={15} /></button>
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                ))}
                {hasMore && <div className="flex justify-center pb-4 pt-2"><button type="button" onClick={onLoadMore} disabled={isLoadingMore} className={cn('min-h-11 rounded-lg px-4 text-xs font-medium text-text-secondary hover:bg-bg-element hover:text-accent disabled:opacity-50', focusRing)}>{isLoadingMore ? <span className="flex items-center gap-2"><Loader2 size={12} className="animate-spin" />{t('chat.sidePanel.loading')}</span> : t('chat.sidePanel.loadMore')}</button></div>}
                {conversations.length === 0 && !activeId && <div className="py-8 text-center"><p className="text-sm font-medium text-text-tertiary">{t('chat.sidePanel.noConversations')}</p><p className="mt-1 text-xs text-text-tertiary">{t('chat.sidePanel.startNewChat')}</p></div>}
                {conversations.length > 0 && filteredConversations.length === 0 && (
                  <div className="px-4 py-8 text-center" role="status">
                    <p className="text-sm font-medium text-text-secondary">{t('chat.sidePanel.noMatchingThreads')}</p>
                    <p className="mt-1 text-xs leading-5 text-text-tertiary">{t('chat.sidePanel.tryDifferentSearch')}</p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="relative -mx-3 -mb-3 border-t border-border-light bg-bg-base/20 p-2">
            <button
              ref={accountButtonRef}
              id="account-menu-btn"
              type="button"
              onClick={(event) => { event.stopPropagation(); setMenuAnchor(null); setAccountMenuOpen(open => !open); }}
              className={cn('flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-text-primary hover:bg-bg-element', focusRing)}
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              aria-label={t('chat.sidePanel.accountMenuFor', { name: profileName || t('chat.sidePanel.yourAccount') })}
            >
              {profileImage ? <img src={profileImage} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" /> : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-element text-text-secondary"><UserIcon size={16} /></span>}
              <span className="min-w-0 flex-1 truncate">{profileName || t('chat.sidePanel.account')}</span>
              <span aria-hidden="true" className={cn('text-text-tertiary transition-transform', accountMenuOpen && 'rotate-180')}>⌃</span>
            </button>
            <AnimatePresence>
              {accountMenuOpen && (
                <motion.div
                  ref={accountMenuRef}
                  role="menu"
                  aria-label={t('chat.sidePanel.accountMenu')}
                  onKeyDown={handleAccountMenuKeyDown}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  className="glass-surface absolute bottom-full left-2 right-2 mb-2 rounded-xl p-1.5 shadow-2xl"
                >
                  <div className="space-y-1">
                    {accountMenuActions.map(({ id, label, icon: Icon, action, danger, keepOpen }) => (
                      <button key={id} id={id} type="button" role="menuitem" tabIndex={0} onClick={() => runAccountAction(action, keepOpen)} className={cn(menuItemClass, focusRing, danger && 'text-danger hover:bg-danger/10 hover:text-danger')}>
                        <Icon size={16} aria-hidden="true" />
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="my-1 border-t border-border-light" role="separator" />
                  <div className="px-2 py-1.5" role="group" aria-label={t('common.languages')}>
                    <div className="mb-1.5 flex items-center gap-2 px-1 text-xs font-medium text-text-tertiary">
                      <Languages size={14} aria-hidden="true" />
                      {t('common.language')}
                    </div>
                    <div className="grid grid-cols-3 gap-1 rounded-lg bg-bg-base/60 p-1">
                      {([
                        ['en', 'EN'],
                        ['de', 'DE'],
                        ['it', 'IT'],
                      ] as const).map(([language, shortLabel]) => (
                        <button
                          key={language}
                          type="button"
                          role="menuitemradio"
                          aria-checked={locale === language}
                          aria-label={t(`common.${language === 'en' ? 'english' : language === 'de' ? 'german' : 'italian'}`)}
                          onClick={() => setLocale(language as Locale)}
                          className={cn(
                            'min-h-9 rounded-md px-2 text-xs font-semibold transition-colors',
                            focusRing,
                            locale === language
                              ? 'bg-accent text-white shadow-sm'
                              : 'text-text-secondary hover:bg-bg-element hover:text-text-primary',
                          )}
                        >
                          {shortLabel}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {menuAnchor && (
          <motion.div
            ref={menuRef}
            role="menu"
            aria-label={t('chat.sidePanel.actionsFor', { title: conversations.find(c => c.id === menuAnchor.id) ? getConversationTitle(conversations.find(c => c.id === menuAnchor.id)!) : t('chat.sidePanel.conversation') })}
            tabIndex={-1}
            onKeyDown={handleMenuKeyDown}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            style={{ position: 'fixed', top: Math.max(8, Math.min(menuAnchor.y, window.innerHeight - 360)), left: Math.max(8, Math.min(menuAnchor.x, window.innerWidth - 240)), zIndex: 1000 }}
            className="glass-surface w-56 rounded-xl p-1.5 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <button type="button" role="menuitem" className={cn(menuItemClass, focusRing)} onClick={() => { const conversation = conversations.find(c => c.id === menuAnchor.id); startRenaming(menuAnchor.id, conversation ? getConversationTitle(conversation) : ''); }}><Pencil size={16} />{t('chat.sidePanel.rename')}</button>
            <button type="button" role="menuitem" className={cn(menuItemClass, focusRing)} onClick={(event) => togglePin(event, menuAnchor.id, conversations.find(c => c.id === menuAnchor.id)?.pinned)}><Pin size={16} />{conversations.find(c => c.id === menuAnchor.id)?.pinned ? t('chat.sidePanel.unpin') : t('chat.sidePanel.pin')}</button>
            <div className="my-1 border-t border-border-light" role="separator" />
            {[
              { label: t('chat.sidePanel.exportText'), format: 'txt' as ExportFormat },
              { label: t('chat.sidePanel.exportMarkdown'), format: 'markdown' as ExportFormat },
              { label: t('chat.sidePanel.exportJson'), format: 'json' as ExportFormat },
            ].map(option => <button key={option.format} type="button" role="menuitem" className={cn(menuItemClass, focusRing)} onClick={() => handleExport(option.format)}><Download size={16} />{option.label}</button>)}
            <div className="my-1 border-t border-border-light" role="separator" />
            <button type="button" role="menuitem" className={cn(menuItemClass, focusRing, 'text-danger hover:bg-danger/10 hover:text-danger')} onClick={() => openDeleteConfirmation(menuAnchor.id)}><Trash2 size={16} />{t('chat.sidePanel.delete')}</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deletingId && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeDeleteDialog} className="modal-backdrop fixed inset-0 z-[100]" />
            <motion.div
              ref={deleteDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-dialog-title"
              aria-describedby="delete-dialog-description"
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="fixed left-1/2 top-1/2 z-[110] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 p-2"
              onClick={event => event.stopPropagation()}
            >
              <div className="modal-surface overflow-hidden rounded-2xl">
                <div className="space-y-4 p-6 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger/20 text-danger"><AlertTriangle size={24} /></div>
                  <div className="space-y-1"><h2 id="delete-dialog-title" className="text-lg font-semibold text-text-primary">{t('chat.sidePanel.deleteChat')}</h2><p id="delete-dialog-description" className="text-sm leading-relaxed text-text-tertiary">{t('chat.sidePanel.deleteDescription')}</p></div>
                  <div className="flex gap-3 pt-2">
                    <button ref={deleteCancelRef} type="button" onClick={closeDeleteDialog} className={cn('min-h-11 flex-1 rounded-xl border border-border-light px-3 text-sm font-medium text-text-secondary hover:bg-bg-element', focusRing)}>{t('chat.sidePanel.cancel')}</button>
                    <button type="button" onClick={confirmDelete} className={cn('min-h-11 flex-1 rounded-xl bg-danger px-3 text-sm font-medium text-white hover:brightness-110', focusRing)}>{t('chat.sidePanel.confirmDelete')}</button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};
