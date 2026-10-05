import type { AttachmentAdapter, PendingAttachment } from '@assistant-ui/react';
import { uploadAttachment, removeAttachment } from '../services/apiClient';
import type { FileAttachment } from '../types';

export function createAttachmentAdapter(errorText: (message: string) => string): AttachmentAdapter {
  const files = new Map<string, FileAttachment>();
  const uploads = new Map<string, AbortController>();
  return {
    accept: '*',
    async *add({ file }) {
      const id = crypto.randomUUID();
      const controller = new AbortController();
      uploads.set(id, controller);
      const attachment: PendingAttachment = {
        id,
        name: file.name,
        file,
        type: file.type.startsWith('image/') ? 'image' : 'document',
        contentType: file.type,
        status: { type: 'running', reason: 'uploading', progress: 0 },
      };
      yield attachment;
      try {
        if (!file.size || file.size > 10 * 1024 * 1024)
          throw new Error('Files must be between 1 byte and 10 MB');
        const stored = await uploadAttachment(file, id, controller.signal);
        files.set(id, stored);
        yield {
          ...attachment,
          name: stored.name,
          type: stored.contentType.startsWith('image/') ? 'image' : 'document',
          contentType: stored.contentType,
          status: { type: 'requires-action', reason: 'composer-send' },
        };
      } catch (error) {
        if (controller.signal.aborted) return;
        yield {
          ...attachment,
          status: {
            type: 'incomplete',
            reason: 'error',
            message: errorText(error instanceof Error ? error.message : 'Could not upload file'),
          },
        };
      } finally {
        uploads.delete(id);
      }
    },
    async remove(attachment) {
      uploads.get(attachment.id)?.abort();
      uploads.delete(attachment.id);
      files.delete(attachment.id);
      // Removing a draft must never delete an attachment already sent in a message.
      await removeAttachment(attachment.id).catch(() => {});
    },
    async send(attachment) {
      const file = files.get(attachment.id);
      if (!file) throw new Error(errorText('Could not upload file'));
      return {
        ...attachment,
        name: file.name,
        contentType: file.contentType,
        status: { type: 'complete' },
        content: [],
      };
    },
  };
}

const errorKeys: Record<string, string> = {
  'Unsupported file type': 'unsupported',
  'Text files must use UTF-8': 'encoding',
  'File contents do not match the file type': 'mismatch',
  'Files must be between 1 byte and 10 MB': 'size',
  'Document exceeds 200,000 characters': 'textLimit',
  'Document processing timed out': 'timeout',
  'Document processing failed': 'damaged',
  'Could not read this document; it may be damaged or password-protected': 'damaged',
  'Document has no readable text; scanned PDFs need OCR': 'unreadable',
  'Scanned PDFs are limited to 20 pages': 'scanLimit',
  'Document expands beyond 50 MB': 'complex',
  'Document is too complex': 'complex',
  'Attachment storage limit reached': 'storage',
  'File processing is busy; try again shortly': 'busy',
  'Too many uploads; try again shortly': 'busy',
};
export function attachmentErrorKey(message: string): string {
  return errorKeys[message]
    ? `chat.attachments.errors.${errorKeys[message]}`
    : 'chat.attachments.failed';
}
