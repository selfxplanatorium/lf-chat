/** The locales shipped with the application. */
export const SUPPORTED_LOCALES = ['en', 'de', 'it'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export type PluralCategory =
  | 'zero'
  | 'one'
  | 'two'
  | 'few'
  | 'many'
  | 'other';

/**
 * A translation can be a plain string or a map of Intl.PluralRules
 * categories. `other` is the only required plural category.
 */
export type PluralTranslation = Readonly<
  Partial<Record<PluralCategory, string>> & { other: string }
>;

export type TranslationValue = string | PluralTranslation;

/** Resources are intentionally nested so each locale can grow independently. */
export type LocaleResource = {
  readonly [key: string]: TranslationValue | LocaleResource;
};

export type LocaleResources = Partial<Record<Locale, LocaleResource>>;

export type TranslationParam = string | number | boolean | null | undefined;

export type TranslationParams = Readonly<
  Record<string, TranslationParam> & {
    count?: number;
  }
>;
