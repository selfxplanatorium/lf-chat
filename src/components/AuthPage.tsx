import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../hooks/useAuth';
import { forgotPassword as apiForgotPassword, verifyEmail as apiVerifyEmail, verifyResetCode as apiVerifyResetCode, resetPassword as apiResetPassword, resendCode as apiResendCode, register as apiRegister, getAuthFlags } from '../services/apiClient';
import { Mail, Lock, User, ArrowRight, AlertCircle, CheckCircle, Eye, EyeOff, ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import { translateApiError, useI18n } from '../i18n';
import { AuthBackdrop } from './AuthBackdrop';

type AuthView = 'login' | 'register' | 'verify' | 'forgot' | 'forgot_code' | 'reset';

const AUTH_FIELD_IDS = {
  loginEmail: 'auth-login-email',
  loginPassword: 'auth-login-password',
  registerName: 'auth-register-name',
  registerEmail: 'auth-register-email',
  registerPassword: 'auth-register-password',
  registerConfirmPassword: 'auth-register-confirm-password',
  verificationCode: 'auth-verification-code',
  forgotEmail: 'auth-forgot-email',
  resetCode: 'auth-reset-code',
  newPassword: 'auth-new-password',
} as const;

export function AuthPage() {
  const { t } = useI18n();
  const { login, setUserFromToken } = useAuth();
  const [view, setView] = useState<AuthView>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [allowSignups, setAllowSignups] = useState(true);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const errorMessage = (error: unknown, fallbackKey: string) =>
    error instanceof Error ? translateApiError(error.message, t) : t(fallbackKey);

  // Fetch public auth flags (signup toggle) once on mount so the login page can
  // hide the "Create an account" affordance when the server has disabled
  // registration. Defaults to true on fetch failure so local dev isn't broken.
  useEffect(() => {
    let cancelled = false;
    getAuthFlags().then((flags) => {
      if (!cancelled) setAllowSignups(flags.allowSignups);
    });
    return () => { cancelled = true; };
  }, []);

  // If registration is disabled server-side, don't let the register view be
  // reached (e.g. via the back button) — bounce to login with a notice.
  useEffect(() => {
    if (!allowSignups && view === 'register') {
      setView('login');
      setError(t('account.auth.errors.registrationDisabled'));
    }
  }, [allowSignups, view, t]);

  useEffect(() => {
    if ((view === 'verify' || view === 'forgot_code') && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [view]);

  const clearForm = () => {
    setError('');
    setSuccess('');
    setPassword('');
    setConfirmPassword('');
    setNewPassword('');
    setName('');
    setVerificationCode('');
    setResetCode('');
    setResetEmail('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError(t('account.auth.errors.fillAllFields'));
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError(t('account.auth.errors.invalidEmail'));
      return;
    }
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err: any) {
      if (err.message?.needsVerification || err.message?.includes('verify your email')) {
        setView('verify');
        setSuccess(t('account.auth.messages.verificationCodeSent'));
      } else {
        setError(errorMessage(err, 'account.auth.errors.loginFailed'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError(t('account.auth.errors.fillAllFields'));
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError(t('account.auth.errors.invalidEmail'));
      return;
    }
    if (password.length < 8) {
      setError(t('account.auth.errors.passwordMinLength'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('account.auth.errors.passwordMismatch'));
      return;
    }
    setIsSubmitting(true);
    try {
      // apiRegister throws on any non-2xx, so reaching here means the account
      // exists and a code was issued — always advance to the verify view in-app
      // (no full-page submit/reload) rather than bouncing back to login.
      await apiRegister(email.trim(), password, name.trim() || undefined);
      setView('verify');
      setSuccess(t('account.auth.messages.verificationCodeSent'));
    } catch (err: any) {
      setError(errorMessage(err, 'account.auth.errors.registrationFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!verificationCode.trim()) {
      setError(t('account.auth.errors.enterVerificationCode'));
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await apiVerifyEmail(email.trim(), verificationCode.trim());
      setUserFromToken(result.token, result.user);
    } catch (err: any) {
      // 409 means the address was already verified. The server deliberately
      // refuses to hand out a session here (a code is not proof of identity for
      // an account that no longer needs verifying), so send the user to the
      // password form rather than showing a dead-end error.
      if (err?.status === 409) {
        setView('login');
        setPassword('');
        setVerificationCode('');
        setSuccess(t('account.auth.messages.alreadyVerified'));
        return;
      }
      setError(errorMessage(err, 'account.auth.errors.verificationFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      await apiResendCode(email.trim(), 'email_verification');
      setSuccess(t('account.auth.messages.newVerificationCodeSent'));
      setVerificationCode('');
    } catch (err: any) {
      setError(errorMessage(err, 'account.auth.errors.resendCodeFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!email.trim()) {
      setError(t('account.auth.errors.enterEmail'));
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await apiForgotPassword(email.trim());
      if (result.email) {
        setResetEmail(result.email);
      } else {
        setResetEmail(email.trim());
      }
      setView('forgot_code');
      setSuccess(t('account.auth.messages.resetCodeSent'));
    } catch (err: any) {
      setError(errorMessage(err, 'account.auth.errors.requestFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!resetCode.trim()) {
      setError(t('account.auth.errors.enterResetCode'));
      return;
    }
    setIsSubmitting(true);
    try {
      await apiVerifyResetCode(resetEmail, resetCode.trim());
      setView('reset');
      setSuccess('');
      setNewPassword('');
    } catch (err: any) {
      setError(errorMessage(err, 'account.auth.errors.invalidCode'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendResetCode = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      await apiResendCode(resetEmail, 'password_reset');
      setSuccess(t('account.auth.messages.newResetCodeSent'));
      setResetCode('');
    } catch (err: any) {
      setError(errorMessage(err, 'account.auth.errors.resendCodeFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!newPassword || newPassword.length < 8) {
      setError(t('account.auth.errors.passwordMinLength'));
      return;
    }
    setIsSubmitting(true);
    try {
      await apiResetPassword(resetEmail, resetCode, newPassword);
      setSuccess(t('account.auth.messages.passwordResetSuccess'));
    } catch (err: any) {
      setError(errorMessage(err, 'account.auth.errors.resetFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    // overflow-y-auto, not overflow-hidden: the wordmark adds height above the
    // card, and the tallest view (register) would otherwise be unreachable on a
    // short viewport. min-h-full on the inner column keeps it centred when it
    // fits and lets it scroll when it does not.
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-bg-base">
      <AuthBackdrop />

      <div className="relative z-10 flex min-h-full flex-col items-center justify-center p-4 pb-[12vh]">
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          // The column is centred, so a larger bottom gap is what raises the
          // wordmark on screen; pb on the column biases the whole stack upward.
          className="mb-14 select-none text-center font-wordmark text-6xl leading-none text-text-primary sm:mb-16 sm:text-7xl md:text-8xl"
          style={{
            // Two stacked shadows: a tight one to seat the letters against the
            // orbs, and a wide diffuse one so the mark reads as lit rather than
            // outlined.
            textShadow: '0 0 18px rgba(244,63,94,0.35), 0 0 64px rgba(244,63,94,0.22)',
          }}
        >
          LF-CHAT
        </motion.h1>

        <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 w-full max-w-md px-2 sm:px-4"
        >
          <div className="flex flex-col items-center text-center mb-7">
            <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center mb-3 text-accent">
              {view === 'login' ? <Lock size={20} /> : view === 'register' ? <User size={20} /> : view === 'verify' ? <ShieldCheck size={20} /> : <Mail size={20} />}
            </div>
            <h2 className="text-2xl font-display font-semibold tracking-[-0.02em] mb-2">
              {view === 'login' ? (
                t('account.auth.titles.welcomeBack')
              ) : view === 'register' ? (
                t('account.auth.titles.createAccount')
              ) : view === 'verify' ? (
                t('account.auth.titles.verifyEmail')
              ) : view === 'forgot' ? (
                t('account.auth.titles.resetPassword')
              ) : view === 'forgot_code' ? (
                t('account.auth.titles.enterResetCode')
              ) : (
                t('account.auth.titles.chooseNewPassword')
              )}
            </h2>
            <p className="text-text-secondary text-sm">
              {view === 'login' && t('account.auth.subtitles.signInToChats')}
              {view === 'register' && t('account.auth.subtitles.createAccountToChat')}
              {view === 'verify' && t('account.auth.subtitles.codeSentTo', { email })}
              {view === 'forgot' && t('account.auth.subtitles.emailForResetCode')}
              {view === 'forgot_code' && t('account.auth.subtitles.codeSentTo', { email: resetEmail })}
              {view === 'reset' && t('account.auth.subtitles.enterNewPassword')}
            </p>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
              className="flex items-start gap-2 text-danger text-sm mb-4 px-1"
            >
              <AlertCircle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}

          {success && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="flex items-start gap-2 text-success text-sm mb-4 px-1"
            >
              <CheckCircle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>{success}</span>
            </motion.div>
          )}

          {view === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor={AUTH_FIELD_IDS.loginEmail} className="text-sm font-medium text-text-secondary px-1">{t('account.auth.fields.email')}</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    id={AUTH_FIELD_IDS.loginEmail}
                    autoComplete="username"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('account.auth.placeholders.email')}
                    maxLength={320}
                    className="w-full bg-bg-surface/60 backdrop-blur-md border border-border-light focus:border-accent rounded-xl pl-11 pr-4 py-3 outline-none transition-all placeholder:text-text-muted"
                    autoFocus
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor={AUTH_FIELD_IDS.loginPassword} className="text-sm font-medium text-text-secondary px-1">{t('account.auth.fields.password')}</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    id={AUTH_FIELD_IDS.loginPassword}
                    autoComplete="current-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('account.auth.placeholders.password')}
                    maxLength={128}
                    className="w-full bg-bg-surface/60 backdrop-blur-md border border-border-light focus:border-accent rounded-xl pl-11 pr-11 py-3 outline-none transition-all placeholder:text-text-muted"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t('account.auth.aria.hidePassword') : t('account.auth.aria.showPassword')}
                    aria-pressed={showPassword}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full group bg-text-primary text-bg-base hover:bg-accent hover:text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? t('account.auth.actions.signingIn') : t('account.auth.actions.signIn')}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
              <div className="flex items-center justify-between pt-2">
                {allowSignups ? (
                  <button
                    type="button"
                    onClick={() => { setView('register'); clearForm(); }}
                    className="text-xs text-text-tertiary hover:text-accent transition-colors"
                  >
                    {t('account.auth.actions.createAccount')}
                  </button>
                ) : (
                  <span className="text-xs text-text-muted" title={t('account.auth.aria.registrationDisabled')}>
                    {t('account.auth.messages.registrationDisabled')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => { setView('forgot'); clearForm(); }}
                  className="text-xs text-text-tertiary hover:text-accent transition-colors"
                >
                  {t('account.auth.actions.forgotPassword')}
                </button>
              </div>
            </form>
          )}

          {view === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor={AUTH_FIELD_IDS.registerName} className="text-sm font-medium text-text-secondary px-1">{t('account.auth.fields.nameOptional')}</label>
                <div className="relative">
                  <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    id={AUTH_FIELD_IDS.registerName}
                    autoComplete="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('account.auth.placeholders.yourName')}
                    maxLength={100}
                    className="w-full bg-bg-surface/60 backdrop-blur-md border border-border-light focus:border-accent rounded-xl pl-11 pr-4 py-3 outline-none transition-all placeholder:text-text-muted"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor={AUTH_FIELD_IDS.registerEmail} className="text-sm font-medium text-text-secondary px-1">{t('account.auth.fields.email')}</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    id={AUTH_FIELD_IDS.registerEmail}
                    autoComplete="username"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('account.auth.placeholders.email')}
                    maxLength={320}
                    className="w-full bg-bg-surface/60 backdrop-blur-md border border-border-light focus:border-accent rounded-xl pl-11 pr-4 py-3 outline-none transition-all placeholder:text-text-muted"
                    autoFocus
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor={AUTH_FIELD_IDS.registerPassword} className="text-sm font-medium text-text-secondary px-1">{t('account.auth.fields.password')}</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    id={AUTH_FIELD_IDS.registerPassword}
                    autoComplete="new-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('account.auth.placeholders.passwordMinLength')}
                    maxLength={128}
                    className="w-full bg-bg-surface/60 backdrop-blur-md border border-border-light focus:border-accent rounded-xl pl-11 pr-11 py-3 outline-none transition-all placeholder:text-text-muted"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t('account.auth.aria.hidePassword') : t('account.auth.aria.showPassword')}
                    aria-pressed={showPassword}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor={AUTH_FIELD_IDS.registerConfirmPassword} className="text-sm font-medium text-text-secondary px-1">{t('account.auth.fields.confirmPassword')}</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    id={AUTH_FIELD_IDS.registerConfirmPassword}
                    autoComplete="new-password"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t('account.auth.placeholders.repeatPassword')}
                    maxLength={128}
                    className="w-full bg-bg-surface/60 backdrop-blur-md border border-border-light focus:border-accent rounded-xl pl-11 pr-4 py-3 outline-none transition-all placeholder:text-text-muted"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full group bg-text-primary text-bg-base hover:bg-accent hover:text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? t('account.auth.actions.creatingAccount') : t('account.auth.actions.createAccount')}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => { setView('login'); clearForm(); }}
                  className="text-xs text-text-tertiary hover:text-accent transition-colors"
                >
                  {t('account.auth.actions.alreadyHaveAccount')}
                </button>
              </div>
            </form>
          )}

          {view === 'verify' && (
            <form onSubmit={handleVerifyEmail} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor={AUTH_FIELD_IDS.verificationCode} className="text-sm font-medium text-text-secondary px-1">
                  {t('account.auth.fields.verificationCode')}
                </label>
                <input
                  id={AUTH_FIELD_IDS.verificationCode}
                  autoComplete="one-time-code"
                  inputMode="text"
                  ref={codeInputRef}
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.toUpperCase().slice(0, 6))}
                  placeholder={t('account.auth.placeholders.verificationCode')}
                  className="w-full bg-bg-surface/60 backdrop-blur-md border border-border-light focus:border-accent rounded-xl px-4 py-3 outline-none transition-all placeholder:text-text-muted text-center text-2xl font-bold tracking-[0.3em] uppercase"
                  maxLength={6}
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting || verificationCode.length !== 6}
                className="w-full group bg-text-primary text-bg-base hover:bg-accent hover:text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? t('account.auth.actions.verifying') : t('account.auth.actions.verifyEmail')}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={isSubmitting}
                  className="text-xs text-text-tertiary hover:text-accent transition-colors disabled:opacity-50"
                >
                  {t('account.auth.actions.resendCode')}
                </button>
                <button
                  type="button"
                  onClick={() => { setView('login'); clearForm(); }}
                  className="text-xs text-text-tertiary hover:text-accent transition-colors inline-flex items-center gap-1"
                >
                  <ArrowLeft size={12} /> {t('account.auth.actions.backToSignIn')}
                </button>
              </div>
            </form>
          )}

          {view === 'forgot' && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor={AUTH_FIELD_IDS.forgotEmail} className="text-sm font-medium text-text-secondary px-1">{t('account.auth.fields.email')}</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    id={AUTH_FIELD_IDS.forgotEmail}
                    autoComplete="username"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('account.auth.placeholders.email')}
                    maxLength={320}
                    className="w-full bg-bg-surface/60 backdrop-blur-md border border-border-light focus:border-accent rounded-xl pl-11 pr-4 py-3 outline-none transition-all placeholder:text-text-muted"
                    autoFocus
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full group bg-text-primary text-bg-base hover:bg-accent hover:text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? t('account.auth.actions.sending') : t('account.auth.actions.sendResetCode')}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => { setView('login'); clearForm(); }}
                  className="text-xs text-text-tertiary hover:text-accent transition-colors inline-flex items-center gap-1"
                >
                  <ArrowLeft size={12} /> {t('account.auth.actions.backToSignIn')}
                </button>
              </div>
            </form>
          )}

          {view === 'forgot_code' && (
            <form onSubmit={handleVerifyResetCode} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor={AUTH_FIELD_IDS.resetCode} className="text-sm font-medium text-text-secondary px-1">
                  {t('account.auth.fields.resetCode')}
                </label>
                <input
                  id={AUTH_FIELD_IDS.resetCode}
                  autoComplete="one-time-code"
                  inputMode="text"
                  ref={codeInputRef}
                  type="text"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.toUpperCase().slice(0, 6))}
                  placeholder={t('account.auth.placeholders.resetCode')}
                  className="w-full bg-bg-surface/60 backdrop-blur-md border border-border-light focus:border-accent rounded-xl px-4 py-3 outline-none transition-all placeholder:text-text-muted text-center text-2xl font-bold tracking-[0.3em] uppercase"
                  maxLength={6}
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting || resetCode.length !== 6}
                className="w-full group bg-text-primary text-bg-base hover:bg-accent hover:text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? t('account.auth.actions.verifying') : t('account.auth.actions.verifyCode')}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleResendResetCode}
                  disabled={isSubmitting}
                  className="text-xs text-text-tertiary hover:text-accent transition-colors disabled:opacity-50"
                >
                  {t('account.auth.actions.resendCode')}
                </button>
                <button
                  type="button"
                  onClick={() => { setView('login'); clearForm(); }}
                  className="text-xs text-text-tertiary hover:text-accent transition-colors inline-flex items-center gap-1"
                >
                  <ArrowLeft size={12} /> {t('account.auth.actions.backToSignIn')}
                </button>
              </div>
            </form>
          )}

          {view === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor={AUTH_FIELD_IDS.newPassword} className="text-sm font-medium text-text-secondary px-1">{t('account.auth.fields.newPassword')}</label>
                <div className="relative">
                  <KeyRound size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    id={AUTH_FIELD_IDS.newPassword}
                    autoComplete="new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t('account.auth.placeholders.passwordMinLength')}
                    maxLength={128}
                    className="w-full bg-bg-surface/60 backdrop-blur-md border border-border-light focus:border-accent rounded-xl pl-11 pr-11 py-3 outline-none transition-all placeholder:text-text-muted"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    aria-label={showNewPassword ? t('account.auth.aria.hideNewPassword') : t('account.auth.aria.showNewPassword')}
                    aria-pressed={showNewPassword}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full group bg-text-primary text-bg-base hover:bg-accent hover:text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? t('account.auth.actions.resetting') : t('account.auth.actions.resetPassword')}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => { setView('login'); clearForm(); }}
                  className="text-xs text-text-tertiary hover:text-accent transition-colors inline-flex items-center gap-1"
                >
                  <ArrowLeft size={12} /> {t('account.auth.actions.backToSignIn')}
                </button>
              </div>
            </form>
          )}
        </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
