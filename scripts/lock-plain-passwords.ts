import 'dotenv/config';
import { pool } from '../src/db/drizzle.js';
import { lockNonBcryptPasswords } from '../src/services/users/plainPasswordLock.js';

/**
 * v9.0.429 (TD-617, decision t4 «الف»): one-off lock of stored passwords that are not bcrypt hashes (empty, plain text,
 * a foreign hash or an old lock marker). The boot no longer converts them into working passwords.
 *   npm run users:lock-plain-passwords             <- preview: lists the users, changes nothing
 *   npm run users:lock-plain-passwords -- --apply  <- locks them: reset required, sessions ended, one audit row each
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const r = await lockNonBcryptPasswords({ apply });
  console.log(apply
    ? 'Locking stored passwords that are not bcrypt hashes'
    : 'Preview (nothing changed); to lock them run: npm run users:lock-plain-passwords -- --apply');
  console.log(`  users with a non-bcrypt password: ${r.users.length}${apply ? `, locked now: ${r.locked}` : ''}`);
  for (const u of r.users) {
    console.log(`  - user ${u.id} (${u.username})${u.deleted ? ' [deleted]' : ''}: ${u.kind}`);
  }
  if (apply && r.locked > 0) {
    console.log('  Each locked user needs a new temporary password from the system admin (users page) before signing in.');
  }
}

main()
  .catch((err) => {
    console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
