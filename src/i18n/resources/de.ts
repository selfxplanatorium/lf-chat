import type { LocaleResource } from '../types';

export const de = {
  common: {
    appName: 'LF Chat',
    language: 'Sprache',
    languages: 'Sprachen',
    english: 'Englisch',
    german: 'Deutsch',
    italian: 'Italienisch',
    loading: 'Wird geladen…',
    cancel: 'Abbrechen',
    close: 'Schließen',
    save: 'Speichern',
    items: {
      one: '{{count}} Element',
      other: '{{count}} Elemente',
    },
    errors: {
      authenticationRequired: 'Authentifizierung erforderlich',
      invalidOrExpiredToken: 'Ungültiges oder abgelaufenes Token',
      adminOnly: 'Nur für Administratoren',
      conversationNotFound: 'Unterhaltung nicht gefunden',
      messageNotFound: 'Nachricht nicht gefunden',
      generationInProgress: 'Generierung läuft bereits',
      settingsNotFound: 'Einstellungen nicht gefunden. Bitte konfigurieren Sie einen Webhook in den Einstellungen.',
      noActiveWebhook: 'Kein aktiver Webhook konfiguriert. Bitte legen Sie einen in den Einstellungen fest.',
      messageContentRequired: 'Nachrichteninhalt erforderlich',
      emailPasswordRequired: 'E-Mail und Passwort erforderlich',
      invalidEmailOrPassword: 'Ungültige E-Mail-Adresse oder ungültiges Passwort',
      invalidOrExpiredVerificationCode: 'Ungültiger oder abgelaufener Bestätigungscode',
      invalidOrExpiredCode: 'Ungültiger oder abgelaufener Code',
      internalServer: 'Interner Serverfehler',
    },
  },
} satisfies LocaleResource;

export default de;
