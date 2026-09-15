import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'lf-chat.db');

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'User',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme_mode TEXT NOT NULL DEFAULT 'dark',
    theme_preset TEXT NOT NULL DEFAULT 'default',
    send_with_ctrl_enter INTEGER NOT NULL DEFAULT 1,
    confirm_delete_chat INTEGER NOT NULL DEFAULT 1,
    confirm_edit_message INTEGER NOT NULL DEFAULT 1,
    profile_name TEXT NOT NULL DEFAULT 'User',
    profile_image TEXT NOT NULL DEFAULT '',
    has_seen_tour INTEGER NOT NULL DEFAULT 0,
    webhooks TEXT NOT NULL DEFAULT '[]',
    active_webhook_id TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New Conversation',
    is_untitled INTEGER NOT NULL DEFAULT 0,
    messages TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    parent_conversation_id TEXT
  );

  CREATE TABLE IF NOT EXISTS verification_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
  CREATE INDEX IF NOT EXISTS idx_verification_codes_code ON verification_codes(code);
`);

try {
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already exists
}

try {
  db.exec('ALTER TABLE settings ADD COLUMN theme_auto INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already exists
}

try {
  db.exec('ALTER TABLE conversations ADD COLUMN streaming_message_id TEXT');
} catch {
  // column already exists
}

try {
  db.exec('ALTER TABLE conversations ADD COLUMN streaming_status TEXT');
} catch {
  // column already exists
}

try {
  db.exec('ALTER TABLE conversations ADD COLUMN streaming_started_at INTEGER');
} catch {
  // column already exists
}

try {
  db.exec('ALTER TABLE conversations ADD COLUMN streaming_idempotency_key TEXT');
} catch {
  // column already exists
}

let addedUntitledColumn = false;
try {
  db.exec('ALTER TABLE conversations ADD COLUMN is_untitled INTEGER NOT NULL DEFAULT 0');
  addedUntitledColumn = true;
} catch {
  // column already exists
}

// Earlier clients persisted their localized draft label as the real title.
// Convert only known placeholders on empty conversations; user-authored titles
// and every conversation with content remain untouched.
if (addedUntitledColumn) {
  db.prepare(`
    UPDATE conversations
    SET is_untitled = 1, title = ''
    WHERE json_array_length(messages) = 0
      AND lower(title) IN ('new conversation', 'new chat', 'neuer chat', 'nuova chat', 'nuova conversazione')
  `).run();
}

try {
  db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already exists
}

try {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already exists
}

// Enforce "at most one admin" via a partial unique index. Any INSERT/UPDATE
// that would create a second is_admin=1 row throws SQLITE_CONSTRAINT_UNIQUE.
// Single-admin is sufficient for an internal/self-hosted tool; the CLI tool
// (promote-admin) can flip roles back and forth. Loosen this index if a future
// feature requires multiple concurrent admins.
try {
  db.exec('CREATE UNIQUE INDEX idx_users_single_admin ON users(is_admin) WHERE is_admin = 1');
} catch {
  // index already exists
}

export default db;
