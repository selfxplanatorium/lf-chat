import type { LocaleResource } from '../types';

export const it = {
  common: {
    appName: 'LF Chat',
    language: 'Lingua',
    languages: 'Lingue',
    english: 'Inglese',
    german: 'Tedesco',
    italian: 'Italiano',
    loading: 'Caricamento…',
    cancel: 'Annulla',
    close: 'Chiudi',
    save: 'Salva',
    items: {
      one: '{{count}} elemento',
      other: '{{count}} elementi',
    },
    errors: {
      authenticationRequired: 'Autenticazione richiesta',
      invalidOrExpiredToken: 'Token non valido o scaduto',
      adminOnly: 'Solo amministratori',
      conversationNotFound: 'Conversazione non trovata',
      messageNotFound: 'Messaggio non trovato',
      generationInProgress: 'Generazione già in corso',
      settingsNotFound: 'Impostazioni non trovate. Configura un webhook nelle impostazioni.',
      noActiveWebhook: 'Nessun webhook attivo configurato. Configurane uno nelle impostazioni.',
      messageContentRequired: 'Il contenuto del messaggio è obbligatorio',
      emailPasswordRequired: 'Email e password sono obbligatorie',
      invalidEmailOrPassword: 'Email o password non validi',
      invalidOrExpiredVerificationCode: 'Codice di verifica non valido o scaduto',
      invalidOrExpiredCode: 'Codice non valido o scaduto',
      internalServer: 'Errore interno del server',
    },
  },
} satisfies LocaleResource;

export default it;
