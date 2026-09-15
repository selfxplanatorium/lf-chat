// Promote or demote a user to/from the admin role. CLI entry point — does
// not require the server to be running. Reads the same SQLite DB the server
// uses (resolved from DATA_DIR or the default data/lf-chat.db path).
//
// Usage:
//   npm run promote-admin -- user@example.com
//   npm run promote-admin -- user@example.com --demote
//   npm run promote-admin -- user@example.com --yes      # skip confirmation
//   npm run promote-admin -- user@example.com --force    # allow second admin (no-op under single-admin policy)
//
// The tool bumps token_version on role change, which invalidates the user's
// existing JWT — they must log in again to pick up the new role.

import '../load-env';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import readline from 'readline';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../../data');
const DB_PATH = path.join(DATA_DIR, 'lf-chat.db');

function parseArgs(argv: string[]): { email: string | null; demote: boolean; yes: boolean; force: boolean } {
  const positional: string[] = [];
  let demote = false;
  let yes = false;
  let force = false;
  for (const arg of argv.slice(2)) {
    if (arg === '--demote') demote = true;
    else if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--force') force = true;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      printUsage();
      process.exit(2);
    } else {
      positional.push(arg);
    }
  }
  return { email: positional[0] ?? null, demote, yes, force };
}

function printUsage(): void {
  console.log(`Usage: npm run promote-admin -- <email> [--demote] [--yes] [--force]

Arguments:
  <email>              Email of the user to promote/demote.

Options:
  --demote             Demote (remove admin role) instead of promote.
  -y, --yes            Skip the confirmation prompt.
      --force          Allow a second admin even if one already exists.
                        Ignored when --demote is set.
  -h, --help           Show this help.`);
}

async function confirm(question: string): Promise<boolean> {
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function confirmTypedEmail(email: string): Promise<boolean> {
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`Type the email again to confirm: `, (answer) => {
      rl.close();
      resolve(answer.trim() === email);
    });
  });
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  is_admin: number;
  token_version: number;
}

async function main(): Promise<void> {
  const { email, demote, yes, force } = parseArgs(process.argv);

  if (!email) {
    console.error('Error: email argument is required.\n');
    printUsage();
    process.exit(2);
  }

  if (!fs.existsSync(DB_PATH)) {
    console.error(`Error: DB not found at ${DB_PATH}.`);
    console.error('Start the dev server first (npm run dev) so the schema is created,');
    console.error('or set DATA_DIR to the directory containing lf-chat.db.');
    process.exit(1);
  }

  const db = new Database(DB_PATH);

  try {
    const user = db.prepare('SELECT id, email, name, is_admin, token_version FROM users WHERE email = ?').get(email) as UserRow | undefined;
    if (!user) {
      console.error(`Error: no user found with email "${email}".`);
      process.exit(1);
    }

    console.log(`Found user:`);
    console.log(`  ID:            ${user.id}`);
    console.log(`  Email:         ${user.email}`);
    console.log(`  Name:          ${user.name}`);
    console.log(`  Current role:  ${user.is_admin === 1 ? 'admin' : 'user'}`);
    console.log(`  Token version: ${user.token_version}`);

    if (!demote) {
      // PROMOTION
      if (user.is_admin === 1) {
        console.log(`\nNo change: user is already admin.`);
        return;
      }

      const existingAdmin = db.prepare('SELECT id, email FROM users WHERE is_admin = 1 AND id != ?').get(user.id) as { id: string; email: string } | undefined;
      if (existingAdmin && !force) {
        console.error(`\nError: another admin already exists: ${existingAdmin.email} (${existingAdmin.id}).`);
        console.error('Single-admin policy is enforced. Pass --force to override (will transfer the role).');
        process.exit(1);
      }

      console.log(`\nAbout to PROMOTE ${user.email} to admin.`);
      console.log(`  • Their current session will be invalidated (token_version bump).`);
      console.log(`  • They will see the Admin badge on next login.`);

      if (!yes) {
        const ok = await confirm(`Promote ${user.email} to admin?`);
        if (!ok) {
          console.log('Aborted.');
          return;
        }
      }

      // When --force is used and another admin exists, transfer the role: demote
      // the existing admin first (inside a transaction), then promote the target.
      // The single-admin partial unique index would otherwise reject a direct
      // UPDATE on the new admin while the old one is still is_admin=1.
      const transferFrom = existingAdmin && force ? existingAdmin : null;
      if (transferFrom) {
        console.log(`  • Transferring admin role from ${transferFrom.email} (token_version will bump for both accounts).`);
      }

      const promote = db.transaction(() => {
        if (transferFrom) {
          db.prepare('UPDATE users SET is_admin = 0, token_version = token_version + 1 WHERE id = ?').run(transferFrom.id);
        }
        db.prepare('UPDATE users SET is_admin = 1, token_version = token_version + 1 WHERE id = ?').run(user.id);
      });
      try {
        promote();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/UNIQUE.*idx_users_single_admin/.test(msg)) {
          console.error(`\nError: another admin was promoted concurrently. Re-run to retry.`);
          process.exit(1);
        }
        throw err;
      }

      console.log(`\n✓ Promoted. ${user.email} is now admin.`);
      if (transferFrom) {
        console.log(`  ${transferFrom.email} has been demoted to a regular user.`);
      }
      console.log(`  Next step: ask them to log out and back in (or wait for their current session to expire).`);
    } else {
      // DEMOTION
      if (user.is_admin === 0) {
        console.log(`\nNo change: user is already a regular user.`);
        return;
      }

      const adminCount = (db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').get() as { c: number }).c;
      if (adminCount <= 1) {
        console.error(`\nError: refusing to demote the only admin. Promote another user first.`);
        process.exit(1);
      }

      console.log(`\nAbout to DEMOTE ${user.email} from admin.`);
      console.log(`  • Their current session will be invalidated (token_version bump).`);
      console.log(`  • They will lose access to admin-only features on next login.`);

      if (!yes) {
        const ok1 = await confirm(`Demote ${user.email} from admin?`);
        if (!ok1) {
          console.log('Aborted.');
          return;
        }
        const ok2 = await confirmTypedEmail(user.email);
        if (!ok2) {
          console.log('Aborted (email did not match).');
          return;
        }
      }

      db.prepare('UPDATE users SET is_admin = 0, token_version = token_version + 1 WHERE id = ?').run(user.id);

      console.log(`\n✓ Demoted. ${user.email} is now a regular user.`);
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
