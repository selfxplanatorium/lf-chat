import * as api from '../services/apiClient';
import type { Message } from '../types';

const LEGACY_UNTITLED_TITLES = new Set([
  'new conversation', 'new chat', 'neuer chat', 'nuova chat', 'nuova conversazione',
]);

export interface BackupConversation {
  id: string;
  title?: string;
  isUntitled?: boolean;
  messages?: Message[];
}

function isBackupConversation(value: unknown): value is BackupConversation {
  if (!value || typeof value !== 'object') return false;
  const row = value as BackupConversation;
  return typeof row.id === 'string' && !!row.id
    && (row.title === undefined || typeof row.title === 'string')
    && (row.isUntitled === undefined || typeof row.isUntitled === 'boolean')
    && (row.messages === undefined || (Array.isArray(row.messages) && row.messages.every(message =>
      message && typeof message.id === 'string' && typeof message.content === 'string'
      && ['user', 'assistant', 'error'].includes(message.role) && typeof message.timestamp === 'number'
      && (message.attachments === undefined || (Array.isArray(message.attachments) && message.attachments.length <= 5 && message.attachments.every(file =>
        file && typeof file.id === 'string' && /^[0-9a-f-]{36}$/i.test(file.id) && typeof file.name === 'string' && typeof file.contentType === 'string' && typeof file.size === 'number' && file.size > 0 && file.size <= 10 * 1024 * 1024
      )))
    )));
}

export function validateBackupConversations(value: unknown): asserts value is BackupConversation[] {
  if (!Array.isArray(value) || !value.every(isBackupConversation)) throw new Error('Invalid conversation backup');
}

/** Import against complete server histories, never against the UI's loaded tail. */
export async function importConversations(value: unknown): Promise<void> {
  validateBackupConversations(value);
  const existingById = new Map((await api.getAllConversations()).map(conversation => [conversation.id, conversation]));

  for (const backup of value) {
    const messages = backup.messages || [];
    const isUntitled = backup.isUntitled ?? (messages.length === 0
      && LEGACY_UNTITLED_TITLES.has((backup.title || '').toLowerCase()));
    const title = isUntitled ? '' : backup.title || '';
    let existing = existingById.get(backup.id);
    if (!existing) {
      try {
        const created = await api.createConversation({ id: backup.id, title, isUntitled, messages });
        existingById.set(backup.id, created);
        continue;
      } catch (error) {
        if (!(error instanceof api.ApiError) || error.status !== 409) throw error;
        // Another tab may have created it after the list request.
        existing = (await api.getAllConversations()).find(conversation => conversation.id === backup.id);
        if (!existing) throw error;
      }
    }

    const currentMessages = await api.getAllConversationMessages(backup.id);
    const ids = new Set(currentMessages.map(message => message.id));
    const added = messages.filter(message => {
      if (ids.has(message.id)) return false;
      ids.add(message.id);
      return true;
    });
    if (added.length === 0) continue;
    await api.updateConversation(backup.id, {
      messages: [...currentMessages, ...added],
      title: isUntitled ? existing.title : title,
      isUntitled: isUntitled ? existing.isUntitled : false,
    });
  }
}
