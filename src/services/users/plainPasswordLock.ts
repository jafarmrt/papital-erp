import { asc, eq, notLike, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { users } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { startsWithLikePattern } from '../../lib/sqlLike.js';
import { isBcryptHash } from '../auth/loginSecurity.service.js';

/**
 * v9.0.429 (TD-617, B01-37, decision t4 «الف»): a stored password that is not a bcrypt hash never logs in
 * (`verifyPasswordConstantWork`), but until v9.0.428 every boot turned it into a working bcrypt hash of that very string:
 * a leaked plain password, a lock marker such as `!locked` and a foreign hash (`$argon2id$…`) all became passwords, for
 * deleted users too, with no reset and no audit row. The boot no longer touches passwords; this one-off pass (run by
 * `npm run users:lock-plain-passwords`, a preview unless `apply`) replaces each such value with a lock marker that no
 * password matches, so the plain text leaves the database, requires a password reset, ends the user's sessions (token
 * version) and writes one audit row per user. The system admin then gives the user a temporary password.
 */

/** Stored instead of a non-bcrypt value; never a bcrypt hash, so no password matches it */
export const PLAIN_PASSWORD_LOCK_MARKER = '!locked:non-bcrypt-password';

export const PLAIN_PASSWORD_LOCK_AUDIT_ENTITY = 'کاربران سیستم';

export type NonBcryptPasswordKind = 'empty' | 'plain_text' | 'foreign_hash' | 'lock_marker';

export interface NonBcryptPasswordUser {
  id: number;
  username: string;
  deleted: boolean;
  kind: NonBcryptPasswordKind;
}

export interface PlainPasswordLockResult {
  applied: boolean;
  users: NonBcryptPasswordUser[];
  locked: number;
}

/** What kind of non-bcrypt value is stored; the value itself is never reported */
export function nonBcryptPasswordKind(value: string | null | undefined): NonBcryptPasswordKind {
  const v = String(value ?? '');
  if (v.trim() === '') return 'empty';
  if (v.startsWith('!') || v.startsWith('*')) return 'lock_marker';
  if (v.startsWith('$')) return 'foreign_hash';
  return 'plain_text';
}

const KIND_LABELS: Readonly<Record<NonBcryptPasswordKind, string>> = {
  empty: 'رمز تهی',
  plain_text: 'رمز متن ساده',
  foreign_hash: 'درهم‌سازی ناشناخته',
  lock_marker: 'نشانه قفل قدیمی',
};

export async function lockNonBcryptPasswords(options: { apply?: boolean } = {}): Promise<PlainPasswordLockResult> {
  const apply = options.apply === true;
  return orm.transaction(async tx => {
    // every user, deleted ones too (their plain text is still a secret at rest), except the ones this pass already locked
    const rows = await tx.select({ id: users.id, username: users.username, password: users.password, isDeleted: users.isDeleted })
      .from(users)
      .where(notLike(users.password, startsWithLikePattern(PLAIN_PASSWORD_LOCK_MARKER)))
      .orderBy(asc(users.id))
      .for('update');
    const found: NonBcryptPasswordUser[] = rows
      .filter(r => !isBcryptHash(r.password))
      .map(r => ({ id: r.id, username: r.username, deleted: Number(r.isDeleted) === 1, kind: nonBcryptPasswordKind(r.password) }));
    if (!apply) return { applied: false, users: found, locked: 0 };

    for (const u of found) {
      await tx.update(users).set({
        password: PLAIN_PASSWORD_LOCK_MARKER,
        mustResetPassword: 1,
        tokenVersion: sql`COALESCE(${users.tokenVersion}, 0) + 1`,
      }).where(eq(users.id, u.id));
      await logActivity({
        tx,
        action: 'UPDATE',
        entity: PLAIN_PASSWORD_LOCK_AUDIT_ENTITY,
        entityId: u.id,
        description: `رمز ذخیره‌شده کاربر «${u.username}» درهم‌سازی امن نبود (${KIND_LABELS[u.kind]})؛ قفل شد و تا مدیر رمز موقت تازه‌ای ندهد ورود ممکن نیست`,
        details: {
          lockedNonBcryptPassword: true,
          storedValueKind: u.kind,
          userDeleted: u.deleted,
          mustResetPassword: true,
          sessionsEnded: true,
        },
      });
    }
    return { applied: true, users: found, locked: found.length };
  });
}
