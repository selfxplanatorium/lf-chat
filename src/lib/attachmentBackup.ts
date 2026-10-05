import type JSZip from 'jszip';
import type { FileAttachment, Message } from '../types';
import * as api from '../services/apiClient';
import { validateBackupConversations } from './importConversations';

export async function addBackupAttachments(
  zip: JSZip,
  conversations: { messages: Message[] }[]
): Promise<void> {
  const files = new Map(
    conversations
      .flatMap((conv) => conv.messages.flatMap((message) => message.attachments ?? []))
      .map((file) => [file.id, file])
  );
  for (const file of files.values())
    zip.file(`attachments/${file.id}`, await (await api.getAttachmentBlob(file.id)).arrayBuffer());
}

/** Restore bytes first, then replace references with owner-scoped server metadata. */
export async function restoreBackupAttachments(zip: JSZip, value: unknown): Promise<void> {
  validateBackupConversations(value);
  const restored = new Map<string, FileAttachment>();
  for (const conv of value) {
    for (const message of conv.messages ?? []) {
      if (!message.attachments) continue;
      const files: FileAttachment[] = [];
      for (const file of message.attachments) {
        let stored = restored.get(file.id);
        if (!stored) {
          try {
            await api.getAttachmentBlob(file.id);
            stored = file;
          } catch (error) {
            if (!(error instanceof api.ApiError) || error.status !== 404) throw error;
            const entry = zip.file(`attachments/${file.id}`);
            if (!entry) throw new Error('Backup is missing an attachment');
            stored = await api.uploadAttachment(
              new File([await entry.async('blob')], file.name, { type: file.contentType })
            );
          }
          restored.set(file.id, stored);
        }
        files.push(stored);
      }
      message.attachments = files;
    }
  }
}
