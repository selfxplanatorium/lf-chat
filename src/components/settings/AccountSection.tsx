import React, { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, Camera, CheckCircle, Crown, LogOut, Trash2, User as UserIcon } from 'lucide-react';
import { Settings } from '../../hooks/useSettings';
import type { User } from '../../hooks/useAuth';
import { cn } from '../../lib/utils';
import { translateApiError, useI18n } from '../../i18n';
import { changePassword as apiChangePassword, setAuthToken } from '../../services/apiClient';
import {
  buttonClass,
  focusRing,
  Group,
  GroupLabel,
  inputClass,
  itemVariants,
  listVariants,
  Pill,
  QUICK,
  Row,
  SectionHeading,
} from './primitives';

/** A data-URL avatar rides inside the settings row on every write, so it has a
 *  ceiling. 1MB of source file is roughly 1.4MB base64 — comfortably under the
 *  server's body limit and still far more than an avatar needs. */
const MAX_AVATAR_BYTES = 1024 * 1024;

interface AccountSectionProps {
  settings: Settings;
  onSave: (partial: Partial<Settings>) => void;
  user: User | null;
  onLogout: () => void;
}

export const AccountSection: React.FC<AccountSectionProps> = ({ settings, onSave, user, onLogout }) => {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState('');

  // Password change is deliberately *not* part of instant apply: it hits its own
  // endpoint, needs the current password, and revokes every other session. That
  // is an action, and actions keep their button.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const handleChangePassword = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword || !newPassword) return;
    if (newPassword.length < 8) {
      setPasswordError(t('account.profile.password.minLength'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('account.profile.password.mismatch'));
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError(t('account.profile.password.sameAsCurrent'));
      return;
    }

    setIsChangingPassword(true);
    try {
      // The server bumps token_version, so this tab's token dies with all the
      // others. Install the replacement immediately or the next request 401s.
      const { token } = await apiChangePassword(currentPassword, newPassword);
      setAuthToken(token);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccess(t('account.profile.password.success'));
    } catch (err) {
      setPasswordError(
        err instanceof Error ? translateApiError(err.message, t) : t('account.profile.password.failed'),
      );
    } finally {
      setIsChangingPassword(false);
    }
  }, [currentPassword, newPassword, confirmPassword, t]);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError(t('account.profile.errors.imageTooLarge'));
      event.target.value = '';
      return;
    }
    setAvatarError('');
    const reader = new FileReader();
    reader.onloadend = () => onSave({ profileImage: reader.result as string });
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  return (
    <motion.div variants={listVariants} initial="hidden" animate="shown" className="space-y-8">
      <SectionHeading title={t('account.settings.nav.account')} description={t('account.settings.subtitles.account')} />

      <Group>
        <div className="flex flex-col gap-5 px-4 py-5 sm:flex-row sm:items-center sm:px-5">
          <div className="group relative shrink-0 self-start">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-border-light bg-bg-base">
              {settings.profileImage ? (
                <img
                  src={settings.profileImage}
                  alt={t('account.profile.aria.profileImage')}
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <UserIcon size={30} className="text-text-tertiary" aria-hidden="true" />
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-bg-surface bg-accent text-white transition-transform hover:brightness-110 active:scale-90',
                focusRing,
              )}
              title={t('account.profile.aria.changePhoto')}
              aria-label={t('account.profile.aria.changePhoto')}
            >
              <Camera size={15} aria-hidden="true" />
            </button>
            <AnimatePresence>
              {settings.profileImage && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={QUICK}
                  onClick={() => onSave({ profileImage: '' })}
                  className={cn(
                    'absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg-surface bg-danger text-white hover:brightness-110 active:scale-90',
                    focusRing,
                  )}
                  title={t('account.profile.aria.removePhoto')}
                  aria-label={t('account.profile.aria.removePhoto')}
                >
                  <Trash2 size={12} aria-hidden="true" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

          <div className="min-w-0 flex-1 space-y-2">
            <label htmlFor="profile-name" className="block text-sm font-medium text-text-primary">
              {t('account.profile.labels.displayName')}
            </label>
            <input
              id="profile-name"
              type="text"
              value={settings.profileName || ''}
              onChange={(event) => onSave({ profileName: event.target.value })}
              placeholder={t('account.profile.placeholders.name')}
              maxLength={20}
              className={inputClass}
            />
            <p className="text-xs leading-5 text-text-tertiary">{t('account.settings.descriptions.displayName')}</p>
            {avatarError && (
              <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
                <AlertCircle size={12} aria-hidden="true" className="shrink-0" />
                {avatarError}
              </p>
            )}
          </div>
        </div>

        <Row
          className="border-t"
          label={t('account.settings.labels.email')}
          description={t('account.settings.descriptions.email')}
          control={<span className="text-sm text-text-secondary">{user?.email}</span>}
        />
        <Row
          label={t('account.settings.server.role')}
          description={t('account.settings.server.roleDescription')}
          control={
            user?.isAdmin ? (
              <Pill tone="accent">
                <Crown size={12} aria-hidden="true" />
                {t('account.settings.labels.admin')}
              </Pill>
            ) : (
              <Pill>
                <UserIcon size={12} aria-hidden="true" />
                {t('account.settings.labels.user')}
              </Pill>
            )
          }
        />
      </Group>

      <motion.div variants={itemVariants} className="space-y-3">
        <GroupLabel>{t('account.profile.password.title')}</GroupLabel>
        <form onSubmit={handleChangePassword} className="space-y-3 rounded-2xl border border-border-light bg-bg-surface p-4 sm:p-5">
          <p className="text-xs leading-5 text-text-tertiary">{t('account.profile.password.description')}</p>
          {/* Password managers need a username field to know which credential
              this form updates. */}
          <input type="text" name="username" autoComplete="username" value={user?.email || ''} readOnly hidden />
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder={t('account.profile.password.current')}
              aria-label={t('account.profile.password.current')}
              maxLength={128}
              className={cn(inputClass, 'sm:col-span-2')}
            />
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder={t('account.profile.password.new')}
              aria-label={t('account.profile.password.new')}
              maxLength={128}
              className={inputClass}
            />
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder={t('account.profile.password.confirm')}
              aria-label={t('account.profile.password.confirm')}
              maxLength={128}
              className={inputClass}
            />
          </div>

          <AnimatePresence mode="wait">
            {(passwordError || passwordSuccess) && (
              <motion.p
                key={passwordError || passwordSuccess}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={QUICK}
                role={passwordError ? 'alert' : 'status'}
                className={cn('flex items-center gap-1.5 text-xs', passwordError ? 'text-danger' : 'text-success')}
              >
                {passwordError ? (
                  <AlertCircle size={12} aria-hidden="true" className="shrink-0" />
                ) : (
                  <CheckCircle size={12} aria-hidden="true" className="shrink-0" />
                )}
                {passwordError || passwordSuccess}
              </motion.p>
            )}
          </AnimatePresence>

          <button
            type="submit"
            disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword}
            className={cn(buttonClass.secondary, 'w-full sm:w-auto')}
          >
            {isChangingPassword ? t('account.profile.password.saving') : t('account.profile.password.action')}
          </button>
        </form>
      </motion.div>

      <motion.div variants={itemVariants}>
        <button type="button" onClick={onLogout} className={cn(buttonClass.secondary, 'w-full text-danger hover:border-danger/40 hover:bg-danger/10 hover:text-danger sm:w-auto')}>
          <LogOut size={16} aria-hidden="true" />
          {t('account.settings.actions.signOut')}
        </button>
      </motion.div>
    </motion.div>
  );
};
