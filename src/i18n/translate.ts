import type {
  Locale,
  LocaleResource,
  PluralTranslation,
  TranslationParams,
  TranslationValue,
} from './types';

export type TFunction = (key: string, params?: TranslationParams) => string;

const pluralCategories = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

const isPluralTranslation = (value: unknown): value is PluralTranslation => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.some(([key]) => pluralCategories.has(key)) &&
    typeof (value as Record<string, unknown>).other === 'string';
};

const resolveValue = (
  resource: LocaleResource,
  key: string,
): TranslationValue | undefined => {
  let current: unknown = resource;
  for (const segment of key.split('.')) {
    if (typeof current !== 'object' || current === null || !(segment in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' || isPluralTranslation(current)
    ? current
    : undefined;
};

const interpolate = (template: string, params: TranslationParams | undefined): string => {
  if (!params) return template;

  // Support both `{{name}}` (the preferred form) and `{name}` so feature
  // modules can be migrated incrementally from existing copy.
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}|\{\s*([\w.-]+)\s*\}/g, (match, doubleKey, singleKey) => {
    const value = params[doubleKey ?? singleKey];
    return value === null || value === undefined ? match : String(value);
  });
};

const selectPlural = (
  value: PluralTranslation,
  locale: Locale,
  params: TranslationParams | undefined,
): string => {
  if (typeof params?.count !== 'number' || !Number.isFinite(params.count)) {
    return value.other;
  }

  const category = new Intl.PluralRules(locale).select(params.count);
  return value[category as keyof PluralTranslation] ?? value.other;
};

/** Translate a key from a single locale resource, with key fallback. */
export const translate = (
  resource: LocaleResource,
  locale: Locale,
  key: string,
  params?: TranslationParams,
): string => {
  const value = resolveValue(resource, key);
  if (value === undefined) return key;

  const template = isPluralTranslation(value) ? selectPlural(value, locale, params) : value;
  return interpolate(template, params);
};

export const getResourceValue = (resource: LocaleResource, key: string): TranslationValue | undefined =>
  resolveValue(resource, key);

/**
 * Translate common backend messages while preserving unknown/server-generated
 * messages. Add a stable key here whenever a new API error is introduced.
 */
const API_ERROR_KEYS: Readonly<Record<string, string>> = {
  'Authentication required': 'errors.authenticationRequired',
  'Invalid or expired token': 'errors.invalidOrExpiredToken',
  'Admin only': 'errors.adminOnly',
  'Conversation not found': 'errors.conversationNotFound',
  'Message not found': 'errors.messageNotFound',
  'Generation in progress': 'errors.generationInProgress',
  'Settings not found. Please configure a webhook in Settings.': 'errors.settingsNotFound',
  'No active webhook configured. Please set one in Settings.': 'errors.noActiveWebhook',
  'Message content is required': 'errors.messageContentRequired',
  'Email and password are required': 'errors.emailPasswordRequired',
  'Invalid email or password': 'errors.invalidEmailOrPassword',
  'Invalid or expired verification code': 'errors.invalidOrExpiredVerificationCode',
  'Invalid or expired code': 'errors.invalidOrExpiredCode',
  'Internal server error': 'errors.internalServer',
  'New account registration is disabled on this server.': 'errors.registrationDisabled',
  'Invalid email format': 'errors.invalidEmailFormat',
  'Password must be at least 8 characters': 'errors.passwordMinLength',
  'An account with this email already exists': 'errors.accountExists',
  'Please verify your email before logging in.': 'errors.verificationRequired',
  'User not found': 'errors.userNotFound',
  'Email is required': 'errors.emailRequired',
  'Invalid request': 'errors.invalidRequest',
  'Account temporarily locked due to too many failed login attempts. Try again later.': 'errors.accountLocked',
  'Too many login attempts. Try again in a minute.': 'errors.tooManyLoginAttempts',
  'Too many registration attempts. Try again later.': 'errors.tooManyRegistrationAttempts',
  'Too many requests. Try again later.': 'errors.tooManyRequests',
  'Too many attempts. Try again in a minute.': 'errors.tooManyAttempts',
  'Invalid or expired code. Please request a new one.': 'errors.invalidCodeRequestNew',
  'Email and verification code are required': 'errors.emailVerificationRequired',
  'Email and purpose are required': 'errors.emailPurposeRequired',
  'Email and code are required': 'errors.emailCodeRequired',
  'Email, code, and new password are required': 'errors.emailCodePasswordRequired',
  'Conversation already exists': 'errors.conversationExists',
  'Cannot update messages while generation is in progress': 'errors.cannotUpdateDuringGeneration',
  'No user message to retry from': 'errors.noUserMessageToRetry',
  'No user message before this assistant message': 'errors.noPriorUserMessage',
  'messageId and content are required': 'errors.messageIdContentRequired',
  'messageId is required': 'errors.messageIdRequired',
  'content must be a non-empty string': 'errors.contentNonEmpty',
  'Request failed': 'errors.requestFailed',
};

export const translateApiError = (message: string, t: TFunction): string => {
  const key = API_ERROR_KEYS[message];
  if (!key) return message;

  const translated = t(key);
  return translated === key ? message : translated;
};
