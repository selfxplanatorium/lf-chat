import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, Check, Download, Loader2, Upload } from 'lucide-react';
import JSZip from 'jszip';
import { Conversation } from '../../types';
import { Settings } from '../../hooks/useSettings';
import { importConversations } from '../../lib/importConversations';
import { addBackupAttachments, restoreBackupAttachments } from '../../lib/attachmentBackup';
import * as api from '../../services/apiClient';
import { useToast } from '../Toast';
import { cn } from '../../lib/utils';
import { useI18n } from '../../i18n';
import {
  buttonClass,
  Group,
  GroupLabel,
  inputClass,
  itemVariants,
  listVariants,
  QUICK,
  SectionHeading,
} from './primitives';

interface DataSectionProps {
  conversations: Conversation[];
  settings: Settings;
  onAccountDeleted: () => void;
}

export const DataSection: React.FC<DataSectionProps> = ({ conversations, settings, onAccountDeleted }) => {
  const { t } = useI18n();
  const { addToast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isWiping, setIsWiping] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState('');
  // Inline rather than a toast for the flows that end in a reload or a sign-out:
  // a toast would be wiped by the navigation before it could be read.
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const listedConversations = await api.getAllConversations();
      // The list endpoint returns metadata only (messages: []); message bodies
      // are loaded lazily per-conversation. Pull the real history for each one,
      // or the backup would contain empty conversations.
      const allConversations = await Promise.all(
        listedConversations.map(async (conv) => {
          const messages = await api.getAllConversationMessages(conv.id);
          return { ...conv, messages };
        })
      );
      const zip = new JSZip();

      await addBackupAttachments(zip, allConversations);

      zip.file('backup.json', JSON.stringify({
        conversations: allConversations,
        settings,
        version: 2,
        exportedAt: new Date().toISOString(),
      }, null, 2));

      // Also write a readable folder of Markdown transcripts for convenience.
      const conversationsFolder = zip.folder('conversations');
      allConversations.forEach((conv, index) => {
        const displayTitle = conv.isUntitled ? t('app.newChat') : conv.title;
        const safeTitle = displayTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'new_chat';
        let content = `# ${displayTitle}\n\n`;
        content += conv.messages
          .map(m => `### ${m.role === 'user' ? t('chat.data.user') : t('chat.data.assistant')}\n\n${m.content}`)
          .join('\n\n---\n\n');
        conversationsFolder?.file(`${index + 1}_${safeTitle}.md`, content);
      });

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lf_chat_backup_${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export backup', error);
      addToast('error', t('chat.data.exportError'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setStatus(null);
    try {
      const zip = new JSZip();
      const content = await zip.loadAsync(file);

      const backupFile = content.file('backup.json');
      if (!backupFile) {
        addToast('error', t('chat.data.invalidBackup'));
        setIsImporting(false);
        if (event.target) event.target.value = '';
        return;
      }

      const backupData = JSON.parse(await backupFile.async('string'));

      await restoreBackupAttachments(content, backupData.conversations);
      await importConversations(backupData.conversations);
      if (backupData.settings) await api.updateSettings(backupData.settings);

      setStatus({ kind: 'success', text: t('chat.data.importSuccess') });
      setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      console.error('Failed to import backup', error);
      addToast('error', t('chat.data.importError'));
    } finally {
      setIsImporting(false);
      if (event.target) event.target.value = '';
    }
  };

  const canWipe = wipeConfirmText.trim().toLowerCase() === 'delete';

  const handleWipe = async () => {
    if (!canWipe) return;
    setIsWiping(true);
    try {
      await api.deleteAccount(wipeConfirmText.trim().toUpperCase());
      localStorage.clear();
      setStatus({ kind: 'success', text: t('chat.data.wipeSuccess') });
      setTimeout(onAccountDeleted, 900);
    } catch (error) {
      console.error('Failed to delete account and data from server', error);
      addToast('error', t('chat.data.wipeError'));
      setIsWiping(false);
    }
  };

  return (
    <motion.div variants={listVariants} initial="hidden" animate="shown" className="space-y-8">
      <SectionHeading title={t('account.settings.nav.data')} description={t('account.settings.subtitles.data')} />

      <AnimatePresence>
        {status && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={QUICK}
            role="status"
            className={cn(
              'flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium',
              status.kind === 'success'
                ? 'border-success/30 bg-success/5 text-success'
                : 'border-danger/30 bg-danger/5 text-danger',
            )}
          >
            {status.kind === 'success' ? <Check size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
            {status.text}
          </motion.div>
        )}
      </AnimatePresence>

      <Group>
        <div className="space-y-3 px-4 py-4 sm:px-5">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-text-primary">{t('chat.data.exportBackup')}</h3>
            <p className="max-w-[56ch] text-xs leading-5 text-text-tertiary">{t('chat.data.exportDescription')}</p>
          </div>
          <button type="button" onClick={handleExport} disabled={isExporting} className={cn(buttonClass.secondary, 'w-full sm:w-auto')}>
            {isExporting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
            {isExporting ? t('chat.data.exporting') : t('chat.data.exportZip')}
          </button>
        </div>

        <div className="space-y-3 border-t border-border-light px-4 py-4 sm:px-5">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-text-primary">{t('chat.data.importBackup')}</h3>
            <p className="max-w-[56ch] text-xs leading-5 text-text-tertiary">{t('chat.data.importDescription')}</p>
          </div>
          <div className="relative w-full sm:w-fit">
            <input
              type="file"
              accept=".zip"
              onChange={handleImport}
              disabled={isImporting}
              aria-label={t('chat.data.importFileLabel')}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            />
            <span aria-hidden="true" className={cn(buttonClass.secondary, 'pointer-events-none w-full sm:w-auto', isImporting && 'opacity-50')}>
              {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {isImporting ? t('chat.data.importing') : t('chat.data.importZip')}
            </span>
          </div>
        </div>
      </Group>

      <motion.div variants={itemVariants} className="space-y-3">
        <GroupLabel className="flex items-center gap-1.5 text-danger">
          <AlertTriangle size={13} aria-hidden="true" />
          {t('chat.data.dangerZone')}
        </GroupLabel>
        <div className="space-y-4 rounded-2xl border border-danger/25 bg-danger/[0.04] p-4 sm:p-5">
          <p className="max-w-[62ch] text-xs leading-5 text-text-secondary">
            {t('chat.data.dangerDescription')}
            <strong className="font-medium text-text-primary">{t('chat.data.backupRecommendation')}</strong>
          </p>
          <div className="space-y-2">
            <label htmlFor="wipe-confirm" className="block text-xs text-text-secondary">
              {t('chat.data.typeYes')}{' '}
              <span className="select-all rounded bg-danger/10 px-1 py-0.5 font-mono text-danger">delete</span>{' '}
              {t('chat.data.confirmDeletion')}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="wipe-confirm"
                type="text"
                value={wipeConfirmText}
                onChange={(event) => setWipeConfirmText(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={t('chat.data.wipePlaceholder')}
                className={cn(inputClass, 'sm:max-w-xs')}
              />
              <button type="button" onClick={handleWipe} disabled={!canWipe || isWiping} className={buttonClass.danger}>
                {isWiping && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {isWiping ? t('chat.data.wiping') : t('chat.data.wipeAll')}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
