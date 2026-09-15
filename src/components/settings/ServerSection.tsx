import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ShieldCheck, ShieldOff } from 'lucide-react';
import type { User } from '../../hooks/useAuth';
import { useI18n } from '../../i18n';
import { getAuthFlags, setAuthFlags } from '../../services/apiClient';
import { Group, listVariants, Pill, Row, SectionHeading, Toggle } from './primitives';

interface ServerSectionProps {
  user: User | null;
}

export const ServerSection: React.FC<ServerSectionProps> = ({ user }) => {
  const { t } = useI18n();
  const [allowSignups, setAllowSignups] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Server-wide registration flag. ALLOW_SIGNUPS seeds it; an admin can flip it
  // here and the server persists the override. Non-admins see the current state
  // read-only — knowing whether signups are open is not sensitive, changing it is.
  useEffect(() => {
    let cancelled = false;
    getAuthFlags().then((flags) => {
      if (!cancelled) setAllowSignups(flags.allowSignups);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Optimistic: a switch that waits for a round-trip reads as a broken toggle.
  // Roll back and surface the reason if the write fails.
  const handleToggleSignups = useCallback(async () => {
    if (allowSignups === null || isSaving) return;
    const next = !allowSignups;
    setAllowSignups(next);
    setError('');
    setIsSaving(true);
    try {
      const result = await setAuthFlags(next);
      setAllowSignups(result.allowSignups);
    } catch {
      setAllowSignups(!next);
      setError(t('account.settings.server.registrationSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  }, [allowSignups, isSaving, t]);

  const isAdmin = Boolean(user?.isAdmin);

  return (
    <motion.div variants={listVariants} initial="hidden" animate="shown" className="space-y-8">
      <SectionHeading title={t('account.settings.nav.server')} description={t('account.settings.subtitles.server')} />

      <Group>
        <Row
          label={t('account.settings.server.registration')}
          description={
            isAdmin
              ? t('account.settings.server.registrationAdminDescription')
              : t('account.settings.server.registrationDescription')
          }
          control={
            isAdmin && allowSignups !== null ? (
              <Toggle
                checked={allowSignups}
                onChange={handleToggleSignups}
                label={t('account.settings.server.registration')}
                disabled={isSaving}
              />
            ) : allowSignups === null ? (
              <Pill>{t('account.settings.labels.checking')}</Pill>
            ) : allowSignups ? (
              <Pill tone="success">
                <ShieldCheck size={12} aria-hidden="true" />
                {t('account.settings.labels.enabled')}
              </Pill>
            ) : (
              <Pill>
                <ShieldOff size={12} aria-hidden="true" />
                {t('account.settings.labels.disabled')}
              </Pill>
            )
          }
        >
          {error && (
            <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
              <AlertCircle size={12} aria-hidden="true" />
              {error}
            </p>
          )}
        </Row>

        <Row
          label={t('account.settings.server.adminAccess')}
          description={
            <>
              {t('account.settings.server.roleDescription')}{' '}
              <code className="rounded bg-bg-element px-1 py-0.5 font-mono text-[11px] text-text-secondary">
                npm run promote-admin -- &lt;email&gt;
              </code>
            </>
          }
        />
      </Group>
    </motion.div>
  );
};
