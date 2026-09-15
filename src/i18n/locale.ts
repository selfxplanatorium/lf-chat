import { SUPPORTED_LOCALES, type Locale } from './types';

export const DEFAULT_LOCALE: Locale = 'en';
export const DEFAULT_LOCALE_STORAGE_KEY = 'lfchat-locale';

const supportedLocaleSet = new Set<string>(SUPPORTED_LOCALES);

/** Convert a browser locale such as `de-DE` or `it_IT` to a shipped locale. */
export const normalizeLocale = (value: string | null | undefined): Locale | undefined => {
  if (!value || typeof value !== 'string') return undefined;

  const language = value.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  return supportedLocaleSet.has(language) ? (language as Locale) : undefined;
};

type BrowserLocaleSource = Pick<Navigator, 'languages' | 'language'>;

const getBrowserLocaleSource = (): BrowserLocaleSource | undefined => {
  if (typeof navigator === 'undefined') return undefined;
  return navigator;
};

/**
 * Pick the first supported language from the browser's ordered language list.
 * The singular `language` value is considered as a final fallback because a
 * few browsers expose it even when `languages` is empty or unavailable.
 */
export const detectBrowserLocale = (
  source: BrowserLocaleSource | readonly string[] | undefined = getBrowserLocaleSource(),
): Locale => {
  const languageList = Array.isArray(source) ? source : undefined;
  const browserSource = languageList ? undefined : (source as BrowserLocaleSource | undefined);
  const languages = languageList ?? browserSource?.languages ?? [];
  const candidates = [...languages];

  if (browserSource?.language) {
    candidates.push(browserSource.language);
  }

  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate);
    if (locale) return locale;
  }

  return DEFAULT_LOCALE;
};

const getStorage = (storage?: Storage): Storage | undefined => {
  if (storage) return storage;
  if (typeof window === 'undefined') return undefined;

  try {
    return window.localStorage;
  } catch {
    // Storage can be unavailable in private browsing or under a strict CSP.
    return undefined;
  }
};

export const readStoredLocale = (
  storageKey = DEFAULT_LOCALE_STORAGE_KEY,
  storage?: Storage,
): Locale | undefined => {
  try {
    return normalizeLocale(getStorage(storage)?.getItem(storageKey));
  } catch {
    return undefined;
  }
};

export const writeStoredLocale = (
  locale: Locale,
  storageKey = DEFAULT_LOCALE_STORAGE_KEY,
  storage?: Storage,
): void => {
  try {
    getStorage(storage)?.setItem(storageKey, locale);
  } catch {
    // Persisting a preference is best effort and must not break the UI.
  }
};

export const removeStoredLocale = (
  storageKey = DEFAULT_LOCALE_STORAGE_KEY,
  storage?: Storage,
): void => {
  try {
    getStorage(storage)?.removeItem(storageKey);
  } catch {
    // See writeStoredLocale: storage is an optional enhancement.
  }
};
