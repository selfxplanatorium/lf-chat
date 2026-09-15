import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
const JWT_SECRET: string = process.env.JWT_SECRET;

export interface AuthRequest extends Request {
  userId?: string;
  isAdmin?: boolean;
}

// JWT payload shape. tokenVersion is included to support server-side revocation.
// isAdmin is the cached role at token-issuance time; authMiddleware falls back
// to a DB lookup when the claim is missing (legacy tokens issued before the
// admin role was added). Once a legacy token makes one request, the next login
// will mint a token with isAdmin embedded and skip the lookup.
//
// Deploy note: adding tokenVersion is a clean break — any pre-existing tokens
// (without this field) will have tokenVersion=undefined, which will never match
// the DB value (0 or higher), so all existing sessions are invalidated on first deploy.
interface JwtPayload {
  userId: string;
  tokenVersion?: number;
  isAdmin?: boolean;
}

export function generateToken(userId: string): string {
  // Pull isAdmin from the same row as tokenVersion — one SELECT per sign, no
  // call-site changes required.
  const row = db.prepare('SELECT token_version, is_admin FROM users WHERE id = ?').get(userId) as { token_version: number; is_admin: number } | undefined;
  const tokenVersion = row?.token_version ?? 0;
  const isAdmin = !!row?.is_admin;
  return jwt.sign({ userId, tokenVersion, isAdmin }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyTokenString(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// Short-lived SSE tokens: 5-minute expiry, scoped to prevent use as main tokens.
// tokenVersion is embedded so revocation (e.g. after password reset) is enforced
// even within the 5-minute window. isAdmin is embedded so SSE-authed endpoints
// can admin-gate without an extra DB hit per event.
export function generateSseToken(userId: string): string {
  const row = db.prepare('SELECT token_version, is_admin FROM users WHERE id = ?').get(userId) as { token_version: number; is_admin: number } | undefined;
  const tokenVersion = row?.token_version ?? 0;
  const isAdmin = !!row?.is_admin;
  return jwt.sign({ userId, scope: 'sse', tokenVersion, isAdmin }, JWT_SECRET, { expiresIn: '5m' });
}

export function verifySseToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; scope?: string; tokenVersion?: number };
    if (decoded.scope !== 'sse') return null;
    // Check token_version against DB to support server-side revocation
    const row = db.prepare('SELECT token_version FROM users WHERE id = ?').get(decoded.userId) as { token_version: number } | undefined;
    if (!row || decoded.tokenVersion !== row.token_version) return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = header.slice(7);
  const decoded = verifyTokenString(token);
  if (!decoded) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Verify tokenVersion against DB to support server-side revocation.
  // Tokens missing tokenVersion (pre-versioning) are rejected — clean break on deploy.
  const row = db.prepare('SELECT token_version, is_admin FROM users WHERE id = ?').get(decoded.userId) as { token_version: number; is_admin: number } | undefined;
  if (!row || decoded.tokenVersion !== row.token_version) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.userId = decoded.userId;

  // Always take the role from the DB row, never from the token claim. The row is
  // already loaded for the token_version check, so this costs nothing — and
  // trusting the claim would leave a demoted admin holding admin rights until
  // their 7-day token expired. The isAdmin claim survives only as a hint for
  // code paths that verify a token without a DB round-trip.
  req.isAdmin = !!row.is_admin;

  next();
}

// Admin gate. Use after authMiddleware on any route that should be restricted
// to the single admin account. No consumers yet — this is scaffolding for
// future admin features (SMTP GUI, user management, audit log, etc.).
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.isAdmin) {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  next();
}
