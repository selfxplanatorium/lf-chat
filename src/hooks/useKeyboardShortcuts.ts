import { useEffect } from 'react';
import { Conversation } from '../types';

const INPUT_FOCUS_IGNORE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']);

interface UseKeyboardShortcutsProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  createConversation: () => void;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSidebar?: () => void;
  toggleSettings: () => void;
  setIsShortcutsOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  focusThreadSearch?: () => void;
  focusChatInput?: () => void;
  isAnyModalOpen?: boolean;
}

export function useKeyboardShortcuts({
  conversations,
  activeConversationId,
  setActiveConversationId,
  createConversation,
  setIsSidebarOpen,
  toggleSidebar,
  toggleSettings,
  setIsShortcutsOpen,
  focusThreadSearch,
  focusChatInput,
  isAnyModalOpen = false,
}: UseKeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      const isInputFocused = INPUT_FOCUS_IGNORE_TAGS.has(tag) || target.isContentEditable;

      if (isAnyModalOpen) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && focusThreadSearch) {
        e.preventDefault();
        focusThreadSearch();
        return;
      }

      if (e.key === 'Escape' && !isInputFocused && !isAnyModalOpen && focusChatInput) {
        e.preventDefault();
        focusChatInput();
        return;
      }

      if (isInputFocused) return;

      // '?' is intentionally optional so existing callers can adopt it
      // without changing their state shape.
      if (e.key === '?' && setIsShortcutsOpen) {
        e.preventDefault();
        setIsShortcutsOpen(true);
        return;
      }

      // Navigation: Alt + ArrowUp/ArrowDown
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (conversations.length === 0) return;
        const currentIndex = conversations.findIndex(c => c.id === activeConversationId);
        const idx = currentIndex === -1 ? 0 : currentIndex;
        if (e.key === 'ArrowUp') {
          const prevIndex = idx > 0 ? idx - 1 : conversations.length - 1;
          if (conversations[prevIndex]) setActiveConversationId(conversations[prevIndex].id);
        } else {
          const nextIndex = idx < conversations.length - 1 ? idx + 1 : 0;
          if (conversations[nextIndex]) setActiveConversationId(conversations[nextIndex].id);
        }
      }

      // Toggle Sidebar: Alt + S
      if (e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (toggleSidebar) toggleSidebar();
        else setIsSidebarOpen(prev => !prev);
      }

      // New Chat: Alt + N
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        createConversation();
      }

      // Settings: Alt + P
      if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        toggleSettings();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [conversations, activeConversationId, setActiveConversationId, createConversation, setIsSidebarOpen, toggleSidebar, toggleSettings, setIsShortcutsOpen, focusThreadSearch, focusChatInput, isAnyModalOpen]);
}
