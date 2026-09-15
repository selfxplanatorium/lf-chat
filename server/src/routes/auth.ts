import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import db from '../db';
import { generateToken, generateSseToken, authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { generationManager } from '../generation/manager';

const router = Router();

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A real bcrypt hash to compare against when the account doesn't exist, so the
// not-found path burns the same work as a wrong-password path. Without this,
// non-existent accounts return measurably faster and leak account existence.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('account-enumeration-guard', 10);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  }
  return code;
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_SMTP_HOST,
    port: parseInt(process.env.EMAIL_SMTP_PORT || '465'),
    secure: process.env.EMAIL_SMTP_USE_SSL === 'true',
    auth: {
      user: process.env.EMAIL_SMTP_USER,
      pass: process.env.EMAIL_SMTP_PASSWORD,
    },
  });
}

// In dev, SMTP is usually not configured, so verification/reset codes are never
// delivered — making the app impossible to use. Log the code to the server
// console instead. Gated on EMAIL_SMTP so a real deployment never leaks codes.
function logCodeInDev(email: string, code: string, purpose: string): void {
  if (process.env.EMAIL_SMTP === 'true') return;
  console.log(`\n[DEV] ${purpose} code for ${email}: ${code}\n  (EMAIL_SMTP is not 'true', so no email was sent — use this code to continue.)`);
}

function sendEmail(to: string, subject: string, html: string): void {
  if (process.env.EMAIL_SMTP !== 'true') return;
  getTransporter().sendMail({
    from: process.env.FROM_EMAIL || 'noreply@example.com',
    to,
    subject,
    html,
  }).catch((err: Error) => {
    console.error('Failed to send email:', err);
  });
}

function emailHtml(title: string, greeting: string, body: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h1 style="font-size: 24px; font-weight: 900; text-transform: uppercase; letter-spacing: -1px;">
        LF <span style="color: #F43F5E;">CHAT</span>
      </h1>
      <p>${greeting}</p>
      ${body}
      <p style="color: #888; font-size: 14px; margin-top: 24px;">If you didn't request this, you can ignore this email.</p>
    </div>
  `;
}

const loginLimiter = rateLimit({ windowMs: 60000, max: 5, message: { error: 'Too many login attempts. Try again in a minute.' } });
const registerLimiter = rateLimit({ windowMs: 600000, max: 3, message: { error: 'Too many registration attempts. Try again later.' } });
const forgotLimiter = rateLimit({ windowMs: 600000, max: 2, message: { error: 'Too many requests. Try again later.' } });
const codeLimiter = rateLimit({ windowMs: 60000, max: 10, message: { error: 'Too many attempts. Try again in a minute.' } });

// The only purposes a client may request. Without this, `purpose` is free text
// that gets written straight into verification_codes, letting anyone fill the
// table with junk rows that no flow ever reads or expires.
const VALID_PURPOSES = ['email_verification', 'password_reset'] as const;

// /resend-code sends the *same* password-reset email as /forgot-password, so it
// has to draw from the same budget. Routing it through codeLimiter (10/min)
// while /forgot-password allows 2/10min made the stricter limiter pointless and
// turned this route into a password-reset email bomb.
function resendLimiter(req: Request, res: Response, next: NextFunction): void {
  if (req.body?.purpose === 'password_reset') {
    forgotLimiter(req, res, next);
    return;
  }
  codeLimiter(req, res, next);
}

// Per-account brute-force protection. In-memory only — resets on restart and
// does not scale across multiple instances. For multi-instance deployments,
// replace with a shared store (Redis or a login_attempts DB table).
interface AccountAttempt { count: number; lockoutUntil: number; lastSeen: number; }
const accountAttempts = new Map<string, AccountAttempt>();
const ACCOUNT_MAX_FAILURES = 10;
const ACCOUNT_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// Failed logins against *non-existent* accounts are recorded too (deliberately —
// otherwise lockout behaviour would diverge and leak which addresses exist), so
// a flood of random addresses would grow this map forever. Sweeping on write
// bounds it and makes the failure counter a rolling window: a partial count
// older than the lockout period is stale and should not carry forward.
//
// ponytail: O(n) sweep amortised over a size threshold. n stays small because
// loginLimiter caps attempts at 5/min/IP. Swap for a shared store (Redis) if
// this ever runs multi-instance — the counter is per-process either way.
const ACCOUNT_ATTEMPTS_SWEEP_AT = 5000;

function sweepAccountAttempts(now: number): void {
  for (const [key, rec] of accountAttempts) {
    if (rec.lockoutUntil < now && now - rec.lastSeen > ACCOUNT_LOCKOUT_MS) {
      accountAttempts.delete(key);
    }
  }
}

function recordFailedAttempt(emailKey: string): void {
  const now = Date.now();
  if (accountAttempts.size >= ACCOUNT_ATTEMPTS_SWEEP_AT) sweepAccountAttempts(now);

  const prev = accountAttempts.get(emailKey);
  // Drop a stale counter rather than resuming it, so the 10-failure budget is
  // measured over a moving window instead of the process's whole lifetime.
  const rec = prev && (prev.lockoutUntil > now || now - prev.lastSeen <= ACCOUNT_LOCKOUT_MS)
    ? prev
    : { count: 0, lockoutUntil: 0, lastSeen: now };

  rec.count += 1;
  rec.lastSeen = now;
  if (rec.count >= ACCOUNT_MAX_FAILURES) {
    rec.lockoutUntil = now + ACCOUNT_LOCKOUT_MS;
    rec.count = 0;
  }
  accountAttempts.set(emailKey, rec);
}

// Registration gating. ALLOW_SIGNUPS (env) is the *default*; once an admin
// flips the switch in the UI the DB row wins, so the setting survives restarts
// without editing .env on the server. Reading it per-request (rather than at
// boot) is what makes the toggle take effect immediately.
function allowSignups(): boolean {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get('allow_signups') as { value: string } | undefined;
  if (row) return row.value === 'true';
  return process.env.ALLOW_SIGNUPS !== 'false';
}

// Public, unauthenticated flags the login page needs before any user exists.
// Only exposes booleans that are safe to share with anonymous visitors.
router.get('/flags', (_req: Request, res: Response) => {
  res.json({ allowSignups: allowSignups() });
});

// Admin-only write side of the same flag. Gated by requireAdmin, which reads
// the role from the verified token — a non-admin cannot reach this even by
// crafting the request, because authMiddleware re-checks the DB row.
router.put('/flags', authMiddleware, requireAdmin, (req: AuthRequest, res: Response) => {
  const { allowSignups: next } = req.body ?? {};
  if (typeof next !== 'boolean') {
    res.status(400).json({ error: 'allowSignups must be a boolean' });
    return;
  }
  db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('allow_signups', next ? 'true' : 'false');
  res.json({ allowSignups: next });
});

router.post('/register', registerLimiter, async (req: Request, res: Response) => {
  const { email, password, name } = req.body;

  // Gate registration. ALLOW_SIGNUPS defaults to true so a fresh install can
  // bootstrap its first account; set ALLOW_SIGNUPS=false in .env to lock it
  // down when exposing the app publicly. Enforced server-side so a client can't
  // bypass it, and surfaced via GET /flags so the login page can hide the
  // "Create an account" affordance.
  if (!allowSignups()) {
    res.status(403).json({ error: 'New account registration is disabled on this server.' });
    return;
  }

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  if (!emailRegex.test(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const existing = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(email.toLowerCase().trim()) as any;
  if (existing) {
    if (!existing.email_verified) {
      const code = generateCode();
      const expiresAt = Date.now() + 1800000;

      db.prepare('UPDATE verification_codes SET used = 1 WHERE user_id = ? AND purpose = ?').run(existing.id, 'email_verification');
      db.prepare('INSERT INTO verification_codes (id, user_id, code, purpose, expires_at) VALUES (?, ?, ?, ?, ?)').run(
        crypto.randomUUID(), existing.id, code, 'email_verification', expiresAt
      );

      logCodeInDev(email.toLowerCase().trim(), code, 'email_verification');
      sendEmail(email.toLowerCase().trim(), 'Verify your email - LF Chat', emailHtml(
        'Verify your email',
        `Hi ${existing.name || 'there'},`,
        `<p>Your verification code is:</p>
         <div style="font-size: 32px; font-weight: 900; letter-spacing: 8px; text-align: center; padding: 16px; background: #F43F5E; color: white; border-radius: 8px; margin: 16px 0;">${code}</div>
         <p style="color: #888;">This code expires in 30 minutes.</p>`
      ));

      res.json({ message: 'verification_resent', email: email.toLowerCase().trim() });
      return;
    }
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  const id = crypto.randomUUID();
  let passwordHash: string;
  try {
    passwordHash = await bcrypt.hash(password, 10);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  const now = Date.now();
  const displayName = name?.trim() || email.split('@')[0];

  // First-user-becomes-admin: on a fresh install the very first account is
  // promoted to admin so the operator can bootstrap without server-side DB
  // access. The partial unique index `idx_users_single_admin` enforces
  // "at most one admin" — if a concurrent request beat us to the admin slot,
  // the INSERT throws SQLITE_CONSTRAINT_UNIQUE and we fall through to a
  // non-admin insert.
  const adminCount = (db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').get() as { c: number }).c;
  let isAdmin = adminCount === 0 ? 1 : 0;

  try {
    db.prepare('INSERT INTO users (id, email, password_hash, name, created_at, email_verified, is_admin) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
      id, email.toLowerCase().trim(), passwordHash, displayName, now, isAdmin
    );
  } catch (err) {
    // Race: another concurrent registration took the only admin slot. Retry
    // as a non-admin. Anything else is a real error.
    const msg = err instanceof Error ? err.message : String(err);
    if (isAdmin === 1 && /UNIQUE.*idx_users_single_admin/.test(msg)) {
      isAdmin = 0;
      db.prepare('INSERT INTO users (id, email, password_hash, name, created_at, email_verified, is_admin) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
        id, email.toLowerCase().trim(), passwordHash, displayName, now, isAdmin
      );
    } else {
      throw err;
    }
  }

  db.prepare('INSERT INTO settings (user_id, profile_name) VALUES (?, ?)').run(id, displayName);

  const code = generateCode();
  const expiresAt = now + 1800000;

  db.prepare('INSERT INTO verification_codes (id, user_id, code, purpose, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), id, code, 'email_verification', expiresAt
  );

  logCodeInDev(email.toLowerCase().trim(), code, 'email_verification');
  sendEmail(email.toLowerCase().trim(), 'Verify your email - LF Chat', emailHtml(
    'Verify your email',
    `Hi ${displayName},`,
    `<p>Thanks for creating an account. Your verification code is:</p>
     <div style="font-size: 32px; font-weight: 900; letter-spacing: 8px; text-align: center; padding: 16px; background: #F43F5E; color: white; border-radius: 8px; margin: 16px 0;">${code}</div>
     <p style="color: #888;">This code expires in 30 minutes.</p>`
  ));

  res.status(201).json({ message: 'verification_sent', email: email.toLowerCase().trim() });
});

router.post('/verify-email', codeLimiter, (req: Request, res: Response) => {
  const { email, code } = req.body;

  if (!email || !code) {
    res.status(400).json({ error: 'Email and verification code are required' });
    return;
  }

  const user = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(email.toLowerCase().trim()) as any;
  if (!user) {
    // Generic message: a distinct "user not found" would let anyone probe which
    // addresses have accounts, which the login path deliberately hides.
    res.status(400).json({ error: 'Invalid or expired verification code' });
    return;
  }

  // Already-verified accounts must NOT be handed a session here. This endpoint
  // authenticates nothing but possession of a one-time code, so returning a
  // token before the code is checked would make an email address alone
  // sufficient to log in as that user. Tell the client to go to the login form.
  if (user.email_verified) {
    res.status(409).json({ error: 'This email is already verified. Please sign in.', alreadyVerified: true });
    return;
  }

  const verification = db.prepare(
    'SELECT id, expires_at, used FROM verification_codes WHERE user_id = ? AND code = ? AND purpose = ?'
  ).get(user.id, code.toUpperCase(), 'email_verification') as any;

  if (!verification || verification.used || verification.expires_at < Date.now()) {
    res.status(400).json({ error: 'Invalid or expired verification code' });
    return;
  }

  db.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?').run(verification.id);
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(user.id);

  const token = generateToken(user.id);
  const userData = db.prepare('SELECT id, email, name, is_admin FROM users WHERE id = ?').get(user.id) as any;
  res.json({ token, user: { id: userData.id, email: userData.email, name: userData.name, isAdmin: !!userData.is_admin } });
});

router.post('/resend-code', resendLimiter, (req: Request, res: Response) => {
  const { email, purpose } = req.body;

  if (!email || !purpose) {
    res.status(400).json({ error: 'Email and purpose are required' });
    return;
  }

  if (!VALID_PURPOSES.includes(purpose)) {
    res.status(400).json({ error: 'Unknown code purpose' });
    return;
  }

  const user = db.prepare('SELECT id, name, email_verified FROM users WHERE email = ?').get(email.toLowerCase().trim()) as any;
  if (!user) {
    res.json({ message: 'If an account exists, a code has been sent.' });
    return;
  }

  if (purpose === 'email_verification' && user.email_verified) {
    res.json({ message: 'Email is already verified.' });
    return;
  }

  db.prepare('UPDATE verification_codes SET used = 1 WHERE user_id = ? AND purpose = ?').run(user.id, purpose);

  const code = generateCode();
  const expiresAt = Date.now() + 1800000;
  db.prepare('INSERT INTO verification_codes (id, user_id, code, purpose, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), user.id, code, purpose, expiresAt
  );

  logCodeInDev(email.toLowerCase().trim(), code, purpose);
  if (purpose === 'email_verification') {
    sendEmail(email.toLowerCase().trim(), 'Verify your email - LF Chat', emailHtml(
      'Verify your email',
      `Hi ${user.name || 'there'},`,
      `<p>Your new verification code is:</p>
       <div style="font-size: 32px; font-weight: 900; letter-spacing: 8px; text-align: center; padding: 16px; background: #F43F5E; color: white; border-radius: 8px; margin: 16px 0;">${code}</div>
       <p style="color: #888;">This code expires in 30 minutes.</p>`
    ));
  } else if (purpose === 'password_reset') {
    sendEmail(email.toLowerCase().trim(), 'Password Reset - LF Chat', emailHtml(
      'Password Reset',
      `Hi ${user.name || 'there'},`,
      `<p>Your password reset code is:</p>
       <div style="font-size: 32px; font-weight: 900; letter-spacing: 8px; text-align: center; padding: 16px; background: #F43F5E; color: white; border-radius: 8px; margin: 16px 0;">${code}</div>
       <p style="color: #888;">This code expires in 30 minutes.</p>`
    ));
  }

  res.json({ message: 'code_sent' });
});

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const emailKey = (email as string).toLowerCase().trim();

  // Check per-account lockout before DB lookup so locked accounts fail fast and
  // the response is identical whether or not the account exists (prevents
  // account-existence enumeration via timing difference).
  const attempt = accountAttempts.get(emailKey);
  if (attempt) {
    if (attempt.lockoutUntil > Date.now()) {
      res.status(429).json({ error: 'Account temporarily locked due to too many failed login attempts. Try again later.' });
      return;
    }
    // Lockout expired — discard stale record
    accountAttempts.delete(emailKey);
  }

  const user = db.prepare('SELECT id, email, password_hash, name, email_verified, is_admin FROM users WHERE email = ?').get(emailKey) as any;
  if (!user) {
    // Burn an equivalent bcrypt comparison so response timing doesn't reveal
    // that the account is missing. Record the attempt too, so enumeration via
    // lockout divergence is not possible either.
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    recordFailedAttempt(emailKey);
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  let passwordMatch: boolean;
  try {
    passwordMatch = await bcrypt.compare(password, user.password_hash);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (!passwordMatch) {
    recordFailedAttempt(emailKey);
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  // Correct password — clear the failure counter before any further checks so a
  // verified user with the right password never accumulates lockout entries.
  accountAttempts.delete(emailKey);

  if (!user.email_verified) {
    res.status(403).json({ error: 'Please verify your email before logging in.', needsVerification: true, email: user.email });
    return;
  }

  const token = generateToken(user.id);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, isAdmin: !!user.is_admin }
  });
});

router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  const user = db.prepare('SELECT id, email, name, is_admin FROM users WHERE id = ?').get(req.userId!) as any;
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }
  res.json({ user: { id: user.id, email: user.email, name: user.name, isAdmin: !!user.is_admin } });
});

router.delete('/account', authMiddleware, (req: AuthRequest, res: Response) => {
  if (req.body?.confirmation !== 'DELETE') {
    res.status(400).json({ error: 'Account deletion requires explicit confirmation' });
    return;
  }

  const userId = req.userId!;

  // Stop in-flight work before removing its database rows. The abort prevents
  // late webhook callbacks from trying to persist snapshots for a deleted user.
  const activeGenerations = generationManager.getAllActive();
  for (const [conversationId, generation] of Object.entries(activeGenerations)) {
    if (generation.userId === userId) {
      generationManager.cancel(conversationId, userId);
    }
  }

  // settings, conversations, and verification_codes all reference users with
  // ON DELETE CASCADE, so this is the single authoritative account wipe.
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  res.json({ success: true });
});

router.post('/forgot-password', forgotLimiter, (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  const user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email.toLowerCase().trim()) as any;

  if (!user) {
    res.json({ message: 'If an account exists, a code has been sent.' });
    return;
  }

  db.prepare('UPDATE verification_codes SET used = 1 WHERE user_id = ? AND purpose = ?').run(user.id, 'password_reset');

  const code = generateCode();
  const expiresAt = Date.now() + 1800000;

  db.prepare('INSERT INTO verification_codes (id, user_id, code, purpose, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), user.id, code, 'password_reset', expiresAt
  );

  logCodeInDev(user.email, code, 'password_reset');
  sendEmail(user.email, 'Password Reset - LF Chat', emailHtml(
    'Password Reset',
    `Hi ${user.name || 'there'},`,
    `<p>Your password reset code is:</p>
     <div style="font-size: 32px; font-weight: 900; letter-spacing: 8px; text-align: center; padding: 16px; background: #F43F5E; color: white; border-radius: 8px; margin: 16px 0;">${code}</div>
     <p style="color: #888;">This code expires in 30 minutes. Enter this code in the app to reset your password.</p>`
  ));

  res.json({ message: 'code_sent' });
});

router.post('/verify-reset-code', codeLimiter, (req: Request, res: Response) => {
  const { email, code } = req.body;

  if (!email || !code) {
    res.status(400).json({ error: 'Email and code are required' });
    return;
  }

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim()) as any;
  if (!user) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const record = db.prepare(
    'SELECT id, expires_at, used FROM verification_codes WHERE user_id = ? AND code = ? AND purpose = ?'
  ).get(user.id, code.toUpperCase(), 'password_reset') as any;

  if (!record || record.used || record.expires_at < Date.now()) {
    res.status(400).json({ error: 'Invalid or expired code' });
    return;
  }

  res.json({ message: 'code_valid' });
});

router.post('/reset-password', codeLimiter, async (req: Request, res: Response) => {
  const { email, code, password } = req.body;

  if (!email || !code || !password) {
    res.status(400).json({ error: 'Email, code, and new password are required' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim()) as any;
  if (!user) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const record = db.prepare(
    'SELECT id, used, expires_at FROM verification_codes WHERE user_id = ? AND code = ? AND purpose = ?'
  ).get(user.id, code.toUpperCase(), 'password_reset') as any;

  if (!record || record.used || record.expires_at < Date.now()) {
    res.status(400).json({ error: 'Invalid or expired code. Please request a new one.' });
    return;
  }

  let passwordHash: string;
  try {
    passwordHash = await bcrypt.hash(password, 10);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
    // Increment token_version to invalidate all existing sessions (covers Task 3.4).
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(user.id);
    db.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?').run(record.id);
  })();

  res.json({ message: 'Password has been reset successfully.' });
});

// Change password while signed in. Without this the only way to rotate a
// credential is the emailed reset code, which is unavailable entirely when SMTP
// isn't configured — leaving a user who suspects compromise with no way to lock
// an attacker out. Requires the current password, so a stolen token alone
// cannot change it. Bumping token_version invalidates every other session,
// which doubles as "sign out everywhere".
router.post('/change-password', loginLimiter, authMiddleware, async (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body ?? {};

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Current and new password are required' });
    return;
  }

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.userId!) as any;
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  let matches: boolean;
  try {
    matches = await bcrypt.compare(currentPassword, user.password_hash);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (!matches) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  let passwordHash: string;
  try {
    passwordHash = await bcrypt.hash(newPassword, 10);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
    .run(passwordHash, user.id);

  // The caller's own token was just invalidated along with the rest, so hand
  // back a fresh one rather than logging the user out of the tab they're in.
  res.json({ token: generateToken(user.id) });
});

router.post('/sse-token', codeLimiter, authMiddleware, (req: AuthRequest, res: Response) => {
  const token = generateSseToken(req.userId!);
  res.json({ token });
});

export default router;
