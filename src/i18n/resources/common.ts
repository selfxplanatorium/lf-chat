import type { LocaleResource } from '../types';

/**
 * Small, stable keys shared by the shell. Feature-specific keys can be added
 * to each locale module without changing the i18n implementation.
 */
export const common = {
  appName: 'LF Chat',
  language: 'Language',
  languages: 'Languages',
  english: 'English',
  german: 'German',
  italian: 'Italian',
  loading: 'Loading…',
  cancel: 'Cancel',
  close: 'Close',
  save: 'Save',
  items: {
    one: '{{count}} item',
    other: '{{count}} items',
  },
  errors: {
    authenticationRequired: 'Authentication required',
    invalidOrExpiredToken: 'Invalid or expired token',
    adminOnly: 'Admin only',
    conversationNotFound: 'Conversation not found',
    messageNotFound: 'Message not found',
    generationInProgress: 'Generation in progress',
    settingsNotFound: 'Settings not found. Please configure a webhook in Settings.',
    noActiveWebhook: 'No active webhook configured. Please set one in Settings.',
    messageContentRequired: 'Message content is required',
    emailPasswordRequired: 'Email and password are required',
    invalidEmailOrPassword: 'Invalid email or password',
    invalidOrExpiredVerificationCode: 'Invalid or expired verification code',
    invalidOrExpiredCode: 'Invalid or expired code',
    internalServer: 'Internal server error',
  },
} satisfies LocaleResource;
