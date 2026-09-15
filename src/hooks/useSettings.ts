import { useState, useEffect, useCallback, useRef } from 'react';
import { nanoid } from 'nanoid';
import { ThemeMode, ThemePreset } from '../types';
import { useAuth } from './useAuth';
import * as api from '../services/apiClient';

const STORAGE_KEY = 'chat-assistant-settings';

export interface WebhookEntry {
  id: string;
  name: string;
  url: string;
  /** Lucide icon component name used to identify this backend in the UI. */
  icon?: string;
}

const DEFAULT_WEBHOOK_ICON = 'Webhook';

function normalizeWebhooks(value: unknown): WebhookEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((entry, index) => ({
      id: typeof entry.id === 'string' ? entry.id : nanoid(),
      // Only fill genuinely unnamed entries. Existing names, including old
      // localized defaults, are intentionally preserved across language changes.
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : `Webhook ${index + 1}`,
      url: typeof entry.url === 'string' ? entry.url : '',
      icon: typeof entry.icon === 'string' && entry.icon.trim() ? entry.icon : DEFAULT_WEBHOOK_ICON,
    }));
}

/**
 * Settings apply instantly — there is no Save button — so the surface that
 * edits them has to be able to say whether the write landed. `error` carries
 * the server's reason (an invalid webhook URL is the only one users can cause).
 */
export type SettingsSaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface Settings {
  webhooks: WebhookEntry[];
  activeWebhookId: string;
  themeMode: ThemeMode;
  themePreset: ThemePreset;
  themeAuto: boolean;
  sendWithCtrlEnter: boolean;
  confirmDeleteChat: boolean;
  confirmEditMessage: boolean;
  profileName: string;
  profileImage: string;
  hasSeenTour?: boolean;
}

const defaultSettings: Settings = {
  webhooks: [],
  activeWebhookId: '',
  themeMode: 'dark',
  themePreset: 'default',
  themeAuto: false,
  sendWithCtrlEnter: true,
  confirmDeleteChat: true,
  confirmEditMessage: true,
  profileName: 'User',
  profileImage: '',
  hasSeenTour: false,
};

function getSystemTheme(): ThemeMode {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

export function useSettings() {
  const { user, token } = useAuth();
  // Readiness is scoped to the exact authenticated session. A plain boolean
  // survives logout/login in the mounted app and can briefly expose the next
  // account to default settings before its server settings have loaded.
  const [loadedAuthToken, setLoadedAuthToken] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [resolvedTheme, setResolvedTheme] = useState<ThemeMode>(getSystemTheme());
  const [saveState, setSaveState] = useState<SettingsSaveState>('idle');
  const [saveError, setSaveError] = useState('');
  // Distinguishes "the user changed something" from "the server's own settings
  // just arrived". Without it, loading settings would echo them straight back
  // as a PUT and report a save the user never made.
  const hasLocalEditsRef = useRef(false);
  const isReady = Boolean(user && token && loadedAuthToken === token);

useEffect(() => {
    let cancelled = false;
    setLoadedAuthToken(null);
    hasLocalEditsRef.current = false;
    setSaveState('idle');

    if (!user || !token) {
      setSettings(defaultSettings);
      return () => { cancelled = true; };
    }

    api.getSettings().then((data) => {
      if (cancelled) return;
      const merged: Settings = {
        ...defaultSettings,
        ...data,
        webhooks: normalizeWebhooks(data.webhooks),
        themeMode: (data.themeMode as ThemeMode) || defaultSettings.themeMode,
        themePreset: (data.themePreset as ThemePreset) || defaultSettings.themePreset,
      };
      setSettings(merged);
      setLoadedAuthToken(token);

      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    }).catch(() => {
      if (cancelled) return;
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setSettings(prev => ({ ...prev, ...parsed, webhooks: normalizeWebhooks(parsed.webhooks) }));
        } catch {}
      }
      setLoadedAuthToken(token);
    });

    return () => { cancelled = true; };
  }, [user, token]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => {
      if (settings.themeAuto) {
        setResolvedTheme(mq.matches ? 'light' : 'dark');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [settings.themeAuto]);

  useEffect(() => {
    if (settings.themeAuto) {
      setResolvedTheme(getSystemTheme());
    } else {
      setResolvedTheme(settings.themeMode);
    }
  }, [settings.themeAuto, settings.themeMode]);

  const updateSettingsFn = useCallback((partial: Partial<Settings>) => {
    hasLocalEditsRef.current = true;
    setSettings(prev => ({ ...prev, ...partial }));
  }, []);

  useEffect(() => {
    if (!user || !isReady) return;
    const serialized = JSON.stringify(settings);
    localStorage.setItem(STORAGE_KEY, serialized);
    if (!hasLocalEditsRef.current) return;

    // Debounced: with instant-apply settings, typing a webhook URL or a display
    // name would otherwise be one PUT per keystroke. The trailing edge leaves a
    // ~400ms window where a change is only in localStorage — the same window any
    // autosave surface has, and localStorage is the fallback on next load.
    setSaveState('saving');
    const timer = setTimeout(() => {
      api.updateSettings(settings)
        .then(() => { setSaveError(''); setSaveState('saved'); })
        .catch((error: unknown) => {
          setSaveError(error instanceof Error ? error.message : '');
          setSaveState('error');
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [settings, user, isReady]);

  // "Saved" is an event, not a condition: let it decay so the surface isn't
  // permanently annotated with a stale confirmation.
  useEffect(() => {
    if (saveState !== 'saved') return;
    const timer = setTimeout(() => setSaveState('idle'), 2200);
    return () => clearTimeout(timer);
  }, [saveState]);

  return { settings, resolvedTheme, updateSettings: updateSettingsFn, isReady, saveState, saveError };
}
