import React from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { FileText, ImageIcon, LoaderCircle, Paperclip, X, Download } from 'lucide-react';
import { useI18n } from '../i18n';
import { useToast } from './Toast';
import { downloadAttachment } from '../services/apiClient';
import type { FileAttachment } from '../types';

const MAX_BYTES = 10 * 1024 * 1024;
export function useAddFiles() {
  const aui = useAui();
  const { t } = useI18n();
  const { addToast } = useToast();
  return async (files: File[]) => {
    const existing = aui.composer().getState().attachments;
    const bytes = existing.reduce(
      (sum, item) => sum + ('file' in item ? (item.file?.size ?? 0) : 0),
      0
    );
    if (
      existing.length + files.length > 5 ||
      bytes + files.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES
    ) {
      addToast('error', t('chat.attachments.limit'));
      return;
    }
    for (const file of files) {
      // Another picker/drop batch can arrive while an earlier file is uploading.
      const current = aui.composer().getState().attachments;
      const currentBytes = current.reduce(
        (sum, item) => sum + ('file' in item ? (item.file?.size ?? 0) : 0),
        0
      );
      if (current.length >= 5 || currentBytes + file.size > MAX_BYTES) {
        addToast('error', t('chat.attachments.limit'));
        return;
      }
      await aui.composer().addAttachment(file);
    }
  };
}

export function useFileDrop() {
  const addFiles = useAddFiles();
  return {
    onDragOver(event: React.DragEvent) {
      if (event.dataTransfer.types.includes('Files')) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }
    },
    onDrop(event: React.DragEvent) {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      event.stopPropagation();
      void addFiles(Array.from(event.dataTransfer.files));
    },
  };
}

export function AttachFileButton() {
  const input = React.useRef<HTMLInputElement>(null);
  const addFiles = useAddFiles();
  const { t } = useI18n();
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        aria-label={t('chat.attachments.attach')}
        onChange={(event) => {
          void addFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        aria-label={t('chat.attachments.attach')}
        title={t('chat.attachments.hint')}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-secondary hover:bg-bg-element hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Paperclip size={18} aria-hidden="true" />
      </button>
    </>
  );
}

export function ComposerFiles() {
  const files = useAuiState((state) => state.composer.attachments);
  const aui = useAui();
  const { t } = useI18n();
  if (!files.length) return null;
  return (
    <div className="flex shrink-0 flex-wrap gap-2 px-3 pb-1 pt-2 pr-14" aria-live="polite">
      {files.map((file) => (
        <div
          key={file.id}
          className="flex min-w-0 max-w-full items-center gap-2 rounded-xl bg-bg-element px-3 py-2 text-sm"
        >
          {file.status.type === 'running' ? (
            <LoaderCircle
              size={16}
              className="shrink-0 animate-spin"
              aria-label={t('chat.attachments.uploading')}
            />
          ) : file.type === 'image' ? (
            <ImageIcon size={16} className="shrink-0" />
          ) : (
            <FileText size={16} className="shrink-0" />
          )}
          <div className="min-w-0">
            <div className="max-w-56 truncate" title={file.name}>
              {file.name}
            </div>
            {file.status.type === 'incomplete' && (
              <div role="alert" className="max-w-72 text-xs text-danger">
                {file.status.reason === 'error'
                  ? file.status.message
                  : t('chat.attachments.failed')}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label={t('chat.attachments.remove', { name: file.name })}
            onClick={() => void aui.composer().attachment({ id: file.id }).remove()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function MessageFiles({ files }: { files: FileAttachment[] }) {
  const { t } = useI18n();
  const { addToast } = useToast();
  const [downloading, setDownloading] = React.useState<string | null>(null);
  if (!files.length) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {files.map((file) => (
        <button
          type="button"
          key={file.id}
          disabled={downloading === file.id}
          title={t('chat.attachments.download', { name: file.name })}
          aria-label={t('chat.attachments.download', { name: file.name })}
          onClick={async () => {
            setDownloading(file.id);
            try {
              await downloadAttachment(file);
            } catch {
              addToast('error', t('chat.attachments.downloadError'));
            } finally {
              setDownloading(null);
            }
          }}
          className="flex min-w-0 max-w-full items-center gap-2 rounded-xl bg-bg-element px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent"
        >
          {file.contentType.startsWith('image/') ? (
            <ImageIcon size={18} className="shrink-0" />
          ) : (
            <FileText size={18} className="shrink-0" />
          )}
          <span className="min-w-0">
            <span className="block max-w-56 truncate">{file.name}</span>
            <span className="block text-xs text-text-secondary">
              {Math.max(1, Math.round(file.size / 1024))} KB
            </span>
          </span>
          {downloading === file.id ? (
            <LoaderCircle size={14} className="shrink-0 animate-spin" />
          ) : (
            <Download size={14} className="shrink-0 text-text-secondary" />
          )}
        </button>
      ))}
    </div>
  );
}
