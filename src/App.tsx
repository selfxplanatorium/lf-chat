import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { useConversations } from './hooks/useConversations';
import { useSettings } from './hooks/useSettings';
import { useAuth } from './hooks/useAuth';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { SidePanel } from './components/SidePanel';
import { AssistantThread } from './components/AssistantThread';
import { AccessGuard } from './components/AccessGuard';
import { AuthPage } from './components/AuthPage';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { ChatSkeleton, SidebarSkeleton } from './components/Skeletons';
import { PanelLeftClose, PanelLeftOpen, Menu, X, Plus, LogOut, WifiOff } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { cn } from './lib/utils';
import { useI18n } from './i18n';

import { WebhookDialog } from './components/WebhookDialog';
import type { SettingsSection } from './components/settings/SettingsPage';

// Settings is one full-screen page now, and it drags in JSZip for backup
// export, so it stays a separate chunk. Prefetching it on idle keeps the first
// open instant anyway — that lag was the reason the old panel was eager.
const importSettingsPage = () => import('./components/settings/SettingsPage');
const SettingsPage = React.lazy(() => importSettingsPage().then(m => ({ default: m.SettingsPage })));
// react-joyride only ever renders on a user's first run; no reason to ship it
// to everyone else.
const GuidedTour = React.lazy(() => import('./components/GuidedTour').then(m => ({ default: m.GuidedTour })));
// Same chunk MessageItem lazy-loads; resolving it here just warms it early.
const importMarkdownContent = () => import('./components/MarkdownContent');
const DESKTOP_SIDEBAR_QUERY = '(min-width: 48rem)';
const MOBILE_DRAWER_TRANSITION = { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const };
const APP_VIEWPORT_STYLE: React.CSSProperties = {
  height: 'var(--app-viewport-height, 100dvh)',
};

function useDesktopSidebarLayout() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(DESKTOP_SIDEBAR_QUERY).matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_SIDEBAR_QUERY);
    const syncLayout = () => setIsDesktop(mediaQuery.matches);

    syncLayout();
    mediaQuery.addEventListener('change', syncLayout);
    return () => mediaQuery.removeEventListener('change', syncLayout);
  }, []);

  return isDesktop;
}

export default function App() {
  const { t } = useI18n();
  const prefersReducedMotion = useReducedMotion();
  const { isAuthenticated, isLoading: authLoading, logout, user } = useAuth();
  const {
    conversations,
    sidebarConversations,
    activeConversation,
    activeConversationId,
    setActiveConversationId,
    createConversation,
    deleteConversation,
    renameConversation,
    pinConversation,
    prefetchConversation,
    sendMessage,
    editMessage,
    branchConversation,
    retryMessage,
    stopResponse,
    isStreaming,
    isCurrentEmpty,
    isLoaded: conversationsLoaded,
    hasMore,
    isLoadingMore,
    loadMore,
    isLoadingMessages,
    hasMoreMessages,
    loadMoreMessages
  } = useConversations();

  const { settings, resolvedTheme, updateSettings, isReady, saveState, saveError } = useSettings();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme-mode', resolvedTheme);
    document.documentElement.setAttribute('data-theme-preset', settings.themePreset);

    // Keep the mobile browser chrome in step with the active theme. Reading the
    // resolved custom property rather than hardcoding a colour means every
    // preset (and any future one) stays correct with no extra table to update.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-base').trim();
      if (bg) meta.setAttribute('content', bg);
    }
  }, [resolvedTheme, settings.themePreset]);

  // Connectivity. A dropped connection kills the SSE stream silently, so without
  // this the UI just stops mid-reply with no explanation. navigator.onLine is
  // coarse (it reports link state, not reachability) but it catches the case
  // that actually happens: laptop sleeps, wifi drops, tunnel on a train.
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  // The tab title is how a user finds this app again among twenty others, so it
  // carries the conversation they are actually in. While a reply streams in a
  // backgrounded tab, a marker says so — that generation can take minutes, and
  // switching back repeatedly to check is the thing worth removing.
  useEffect(() => {
    const title = activeConversation?.isUntitled ? '' : activeConversation?.title?.trim();
    const streaming = isStreaming;
    document.title = title
      ? `${streaming ? '● ' : ''}${title} — LF CHAT`
      : `${streaming ? '● ' : ''}LF CHAT`;
  }, [activeConversation?.title, activeConversation?.isUntitled, isStreaming]);

  // Warm the lazy chunks (settings + JSZip; markdown + katex + Prism) on idle so
  // their first use is instant too. They are split off the critical path for
  // LCP, not because they're rarely needed.
  useEffect(() => {
    const warm = () => { importSettingsPage(); importMarkdownContent(); };
    const ric = (window as any).requestIdleCallback;
    const id = ric ? ric(warm) : setTimeout(warm, 300);
    return () => {
      const cic = (window as any).cancelIdleCallback;
      if (ric && cic) cic(id); else clearTimeout(id);
    };
  }, []);

  const toggleTheme = () => {
    const newTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme-mode', newTheme);
    document.documentElement.setAttribute('data-theme-preset', 'default');

    if (settings.themeAuto) {
      updateSettings({ themeAuto: false, themeMode: newTheme, themePreset: 'default' });
    } else {
      updateSettings({ themeMode: newTheme, themePreset: 'default' });
    }
  };

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // One surface, one piece of state: `null` is closed, otherwise the section
  // the user asked for. Everything that used to be its own dialog (profile,
  // data management, language, theme) is a section of it.
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [isWebhookDialogOpen, setIsWebhookDialogOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [threadSearchFocusRequest, setThreadSearchFocusRequest] = useState(0);
  const isDesktopSidebarLayout = useDesktopSidebarLayout();
  const isSidebarVisible = isDesktopSidebarLayout ? isSidebarOpen : isMobileMenuOpen;
  const mobileDrawerTransition = prefersReducedMotion ? { duration: 0 } : MOBILE_DRAWER_TRANSITION;

  const toggleSidebar = useCallback(() => {
    if (isDesktopSidebarLayout) {
      setIsSidebarOpen((isOpen) => !isOpen);
    } else {
      setIsMobileMenuOpen((isOpen) => !isOpen);
    }
  }, [isDesktopSidebarLayout]);

  useEffect(() => {
    if (isDesktopSidebarLayout) setIsMobileMenuOpen(false);
  }, [isDesktopSidebarLayout]);

  const focusChatInput = useCallback(() => {
    const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    if (input) {
      input.focus();
    }
  }, []);

  const focusThreadSearch = useCallback(() => {
    if (isDesktopSidebarLayout) setIsSidebarOpen(true);
    else setIsMobileMenuOpen(true);
    setThreadSearchFocusRequest((request) => request + 1);
  }, [isDesktopSidebarLayout]);

  const openSettings = useCallback((section: SettingsSection = 'account') => setSettingsSection(section), []);
  const toggleSettings = useCallback(() => setSettingsSection((current) => (current ? null : 'account')), []);

  const isAnyModalOpen = settingsSection !== null || isShortcutsOpen;

  useKeyboardShortcuts({
    conversations: sidebarConversations,
    activeConversationId,
    setActiveConversationId,
    createConversation,
    setIsSidebarOpen,
    toggleSidebar,
    toggleSettings,
    setIsShortcutsOpen,
    focusThreadSearch,
    focusChatInput,
    isAnyModalOpen
  });

  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    setShowTour(
      isReady &&
      conversationsLoaded &&
      settings.webhooks.length > 0 &&
      !settings.hasSeenTour
    );
  }, [isReady, conversationsLoaded, settings.webhooks.length, settings.hasSeenTour]);

  const isLoaded = isReady && conversationsLoaded;

  if (authLoading) {
    return (
      <div style={APP_VIEWPORT_STYLE} className="flex items-center justify-center bg-bg-base text-text-primary" role="status" aria-live="polite">
        <div className="flex items-center gap-3 text-sm text-text-secondary">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
          {t('app.loading')}
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  // Wait for settings to load before rendering the main layout.
  // This prevents the webhook setup screen from flashing briefly
  // with stale defaults while the real settings are being fetched.
  if (!isReady) {
    return (
      <div style={APP_VIEWPORT_STYLE} className="flex bg-bg-base text-text-primary overflow-hidden font-sans">
        <div className="hidden md:block">
          <SidebarSkeleton />
        </div>
        <ChatSkeleton />
      </div>
    );
  }

  return (
    <div style={APP_VIEWPORT_STYLE} className="flex bg-bg-base text-text-primary overflow-hidden font-sans">
      {/* Persistent, not a toast: being offline is a state the user stays in,
          not an event that happened once. */}
      <AnimatePresence>
        {isOffline && (
          <motion.div
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
            transition={{ duration: 0.2 }}
            role="status"
            aria-live="polite"
            className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-danger px-4 py-2 text-xs font-medium text-white"
          >
            <WifiOff size={13} aria-hidden="true" className="shrink-0" />
            {t('app.errors.offline')}
          </motion.div>
        )}
      </AnimatePresence>

      <AccessGuard
        onWebhookSaved={(webhook) => updateSettings({
          webhooks: [webhook],
          activeWebhookId: webhook.id
        })}
        hasWebhooks={settings.webhooks.length > 0}
        themeMode={resolvedTheme}
      />

      {/* Reached from the composer's backend picker, so a new backend can be
          added without a detour through Settings. A backend created this way is
          made active immediately — the user opened the picker to choose what
          sends the next message, so that is what they are asking for. */}
      <WebhookDialog
        isOpen={isWebhookDialogOpen}
        onClose={() => setIsWebhookDialogOpen(false)}
        onCreate={(webhook) => updateSettings({
          webhooks: [...settings.webhooks, webhook],
          activeWebhookId: webhook.id,
        })}
        webhookCount={settings.webhooks.length}
      />

      {showTour && (
        <Suspense fallback={null}>
        <GuidedTour
          run={true}
          onFinish={() => {
            setShowTour(false);
            updateSettings({ hasSeenTour: true });
          }}
          themeMode={resolvedTheme}
        />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <AnimatePresence>
          {settingsSection && (
            <SettingsPage
              section={settingsSection}
              onSectionChange={setSettingsSection}
              onClose={() => setSettingsSection(null)}
              settings={settings}
              onSave={updateSettings}
              resolvedTheme={resolvedTheme}
              saveState={saveState}
              saveError={saveError}
              user={user}
              conversations={conversations}
              onLogout={logout}
              onOpenShortcuts={() => setIsShortcutsOpen(true)}
              isShortcutsOpen={isShortcutsOpen}
            />
          )}
        </AnimatePresence>
      </Suspense>

      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
        themeMode={resolvedTheme}
        sendWithCtrlEnter={settings.sendWithCtrlEnter}
      />

      <motion.div
        animate={{ x: !isDesktopSidebarLayout && isMobileMenuOpen ? 280 : 0 }}
        transition={mobileDrawerTransition}
        className="fixed left-3 top-3 z-[55] flex items-center gap-1 group md:left-4 md:top-4"
      >
        <button
          id="sidebar-toggle-btn"
          onClick={toggleSidebar}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl border border-border-light bg-bg-surface text-text-secondary shadow-sm transition-colors hover:bg-bg-element hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            !isSidebarVisible
              ? "text-text-primary"
              : "text-text-secondary hover:text-text-primary"
          )}
          title={isSidebarVisible ? t('app.hideSidebarShortcut') : t('app.openSidebarShortcut')}
          aria-label={isSidebarVisible ? t('app.hideSidebar') : t('app.showSidebar')}
        >
          {isDesktopSidebarLayout
            ? (isSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />)
            : (
              <span className="relative flex h-[18px] w-[18px] items-center justify-center">
                <AnimatePresence initial={false}>
                  <motion.span
                    key={isMobileMenuOpen ? 'close' : 'open'}
                    initial={{ opacity: 0, rotate: -45, scale: 0.75 }}
                    animate={{ opacity: 1, rotate: 0, scale: 1 }}
                    exit={{ opacity: 0, rotate: 45, scale: 0.75 }}
                    transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    {isMobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
                  </motion.span>
                </AnimatePresence>
              </span>
            )}
        </button>

        <AnimatePresence>
          {!isSidebarVisible && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex items-center gap-1"
            >
              <div className="w-px h-4 bg-border-light mx-1 hidden md:block" />
              <button
                onClick={() => createConversation()}
                disabled={isCurrentEmpty}
                className="hidden md:flex p-2 text-text-secondary hover:text-text-primary hover:bg-bg-element bg-bg-surface/80 backdrop-blur-md border border-border-light rounded-lg shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-50"
                title={t('app.newChatShortcut')}
                aria-label={t('app.newChat')}
              >
                <Plus size={18} />
              </button>
              <button
                onClick={logout}
                className="hidden md:flex p-2 text-text-secondary hover:text-danger hover:bg-danger/10 bg-bg-surface/80 backdrop-blur-md border border-border-light rounded-lg shadow-sm transition-all"
                title={t('app.signOut')}
                aria-label={t('app.signOut')}
              >
                <LogOut size={18} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="hidden md:block">
        <SidePanel
          conversations={sidebarConversations}
          activeId={activeConversationId}
          onSelect={(id) => setActiveConversationId(id)}
          onHover={prefetchConversation}
          onNew={createConversation}
          onDelete={deleteConversation}
          onRename={renameConversation}
          onPin={pinConversation}
          onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
          isOpen={isSidebarOpen}
          onOpenSettings={openSettings}
          onOpenShortcuts={() => setIsShortcutsOpen(true)}
          profileName={settings.profileName}
          profileImage={settings.profileImage}
          disableNew={isCurrentEmpty}
          themeMode={resolvedTheme}
          onToggleTheme={toggleTheme}
          confirmDeleteChat={settings.confirmDeleteChat}
          onLogout={logout}
          isLoaded={isLoaded}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMore}
          searchFocusRequest={threadSearchFocusRequest}
        />
      </div>

      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={mobileDrawerTransition}
              className="fixed inset-y-0 left-0 w-[280px] z-50 md:hidden"
            >
              <SidePanel
                conversations={sidebarConversations}
                activeId={activeConversationId}
                onHover={prefetchConversation}
                onSelect={(id) => {
                  setActiveConversationId(id);
                  setIsMobileMenuOpen(false);
                }}
                onNew={() => {
                  createConversation();
                  setIsMobileMenuOpen(false);
                }}
                onDelete={deleteConversation}
                onRename={renameConversation}
                onPin={pinConversation}
                onToggle={() => {}}
                isOpen={true}
                onOpenSettings={(section) => {
                  openSettings(section);
                  setIsMobileMenuOpen(false);
                }}
                onOpenShortcuts={() => {
                  setIsShortcutsOpen(true);
                  setIsMobileMenuOpen(false);
                }}
                profileName={settings.profileName}
                profileImage={settings.profileImage}
                disableNew={isCurrentEmpty}
                themeMode={resolvedTheme}
                onToggleTheme={toggleTheme}
                confirmDeleteChat={settings.confirmDeleteChat}
                onLogout={logout}
                isLoaded={isLoaded}
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
                onLoadMore={loadMore}
                searchFocusRequest={threadSearchFocusRequest}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <main className="flex-1 flex flex-col relative h-full min-h-0 min-w-0 overflow-hidden">
        {!isLoaded ? (
          <ChatSkeleton />
        ) : (
          <AssistantThread
            conversation={activeConversation}
            isStreaming={isStreaming}
            onSend={(text, attachmentIds) => sendMessage(text, attachmentIds)}
            onStop={() => stopResponse()}
            onEditMessage={(msgId, content) => editMessage(activeConversationId!, msgId, content)}
            onBranchMessage={(msgId) => branchConversation(activeConversationId!, msgId)}
            onBranchEditedMessage={(msgId, content) => branchConversation(activeConversationId!, msgId, content)}
            onRetryMessage={(messageId) => retryMessage(activeConversationId!, messageId)}
            webhooks={settings.webhooks}
            activeWebhookId={settings.activeWebhookId}
            onActiveWebhookChange={(webhookId) => updateSettings({ activeWebhookId: webhookId })}
            onCreateWebhook={() => setIsWebhookDialogOpen(true)}
            sendWithCtrlEnter={settings.sendWithCtrlEnter}
            themeMode={resolvedTheme}
            confirmEditMessage={settings.confirmEditMessage}
            onLoadMoreMessages={() => activeConversationId && loadMoreMessages(activeConversationId)}
            hasMoreMessages={hasMoreMessages}
            isLoadingMessages={isLoadingMessages}
          />
        )}
      </main>
    </div>
  );
}
