import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_LOCALE,
  DEFAULT_LOCALE_STORAGE_KEY,
  detectBrowserLocale,
  normalizeLocale,
  readStoredLocale,
  writeStoredLocale,
} from './locale';
import { defaultResources, mergeResources } from './resources';
import { translate, type TFunction } from './translate';
import type { Locale, LocaleResource, LocaleResources, TranslationParams } from './types';

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction;
  supportedLocales: readonly Locale[];
  resources: Readonly<Record<Locale, LocaleResource>>;
}

export interface I18nProviderProps {
  children: ReactNode;
  /** A controlled locale. Omit to let the provider manage locale state. */
  locale?: Locale;
  /** Used only when no valid stored preference exists. */
  defaultLocale?: Locale;
  /** Feature resources are deep-merged over the shipped locale resources. */
  resources?: LocaleResources;
  /** Set to null to opt out of persistence. */
  storageKey?: string | null;
  /** Useful for tests and non-browser hosts. */
  storage?: Storage;
  onLocaleChange?: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export const I18nProvider = ({
  children,
  locale: controlledLocale,
  defaultLocale,
  resources,
  storageKey = DEFAULT_LOCALE_STORAGE_KEY,
  storage,
  onLocaleChange,
}: I18nProviderProps) => {
  const [internalLocale, setInternalLocale] = useState<Locale>(() => {
    const stored = storageKey === null ? undefined : readStoredLocale(storageKey, storage);
    return stored ?? normalizeLocale(defaultLocale) ?? detectBrowserLocale();
  });

  const locale = normalizeLocale(controlledLocale) ?? internalLocale;
  const mergedResources = useMemo(
    () => mergeResources(resources ?? {}),
    [resources],
  );

  const setLocale = useCallback(
    (nextLocale: Locale) => {
      const next = normalizeLocale(nextLocale);
      if (!next) return;

      setInternalLocale(next);
      if (storageKey !== null) writeStoredLocale(next, storageKey, storage);
      onLocaleChange?.(next);
    },
    [onLocaleChange, storage, storageKey],
  );

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  // Keep an unmanaged provider in sync when another tab changes the preference.
  useEffect(() => {
    if (storageKey === null || typeof window === 'undefined') return undefined;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      setInternalLocale(normalizeLocale(event.newValue) ?? detectBrowserLocale());
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [storageKey]);

  // Follow a browser/OS language change until the user explicitly chooses and
  // persists a locale in Settings.
  useEffect(() => {
    if (typeof window === 'undefined' || (storageKey !== null && readStoredLocale(storageKey, storage))) return undefined;
    const handleLanguageChange = () => setInternalLocale(detectBrowserLocale());
    window.addEventListener('languagechange', handleLanguageChange);
    return () => window.removeEventListener('languagechange', handleLanguageChange);
  }, [storage, storageKey]);

  const t = useCallback(
    (key: string, params?: TranslationParams) => {
      const translated = translate(mergedResources[locale], locale, key, params);
      // A partially translated feature should gracefully fall back to English.
      return translated === key && locale !== DEFAULT_LOCALE
        ? translate(mergedResources[DEFAULT_LOCALE], DEFAULT_LOCALE, key, params)
        : translated;
    },
    [locale, mergedResources],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      supportedLocales: ['en', 'de', 'it'],
      resources: mergedResources,
    }),
    [locale, mergedResources, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextValue => {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within an I18nProvider');
  return context;
};

export { I18nContext };

// Keep this import available to consumers who only need the shipped map.
export { defaultResources };
