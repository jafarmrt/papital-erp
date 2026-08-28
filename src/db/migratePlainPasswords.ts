import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { orm } from './drizzle.js';
import { users } from './schema.js';
import { logger } from '../middleware/logger.js';

/**
 * Startup Migration for Plain-text Passwords (SEC-008).
 * Scans the users table and ensures all passwords are encrypted using bcrypt ($2a$, $2b$, or $2y$).
 * If a user has a plain-text password, it is hashed with bcrypt.
 * If a user has an empty password, mustResetPassword flag is enabled.
 */
export async function migratePlainPasswords(): Promise<{ migrated: number; skipped: number }> {
  try {
    const allUsers = await orm.select().from(users);
    let migrated = 0;
    let skipped = 0;

    for (const u of allUsers) {
      const pwd = u.password;
      if (pwd && (pwd.startsWith('$2a$') || pwd.startsWith('$2b$') || pwd.startsWith('$2y$'))) {
        skipped++;
        continue;
      }

      if (!pwd || pwd.trim() === '') {
        // Password is empty -> flag as needs reset
        await orm.update(users).set({
          password: '',
          mustResetPassword: 1
        }).where(eq(users.id, u.id));
        migrated++;
        logger.info(`[Password Migration] Flagged user ${u.username} (${u.id}) for password reset`);
        continue;
      }

      // Hash plain-text password
      const salt = bcrypt.genSaltSync(10);
      const hashed = bcrypt.hashSync(pwd, salt);
      await orm.update(users).set({ password: hashed }).where(eq(users.id, u.id));
      migrated++;
      logger.info(`[Password Migration] Migrated user ${u.username} (${u.id})`);
    }

    logger.info(`[Password Migration] Completed: ${migrated} users migrated, ${skipped} users already hashed.`);
    return { migrated, skipped };
  } catch (err) {
    logger.error(`[Password Migration] Failed: ${err.message}`);
    return { migrated: 0, skipped: 0 };
  }
}
