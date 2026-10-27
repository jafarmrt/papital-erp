import type { Request } from 'express';
import bcrypt from 'bcryptjs';
import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { users, roles, userMessengerLinks } from '../../db/schema.js';
import { logActivity, computeAuditDiff } from '../../lib/auditLogger.js';
import { NotFoundError, ForbiddenError, BadRequestError, ValidationError, ConflictError } from '../../errors/customErrors.js';
import { invalidateUserAuthCache } from '../../middleware/auth.js';
import { isDataUrl, uploadBase64ToStorage } from '../../lib/storage.js';
import { AVATAR_INVALID_MESSAGE, isStoredAvatarPath } from '../../lib/users/profileFields.js';
import { isSyntheticTestUsername, SYNTHETIC_USERNAME_REFUSED } from '../../lib/syntheticUsers.js';
import { USERNAME_OF_DELETED_USER, deletedUsernameMessage } from '../../lib/users/userRestore.js';
import { USERNAME_FORMAT_INVALID, usernameFormatError, usernameKey } from '../../lib/users/usernameRules.js';
import { allowPreviousTokenVersion, refuseTokenGrace } from '../auth/tokenVersionGrace.js';
import { passwordChangeLockMinutes, passwordChangeLockedError, recordPasswordChangeFailure, resetPasswordChangeFailures, verifyPasswordConstantWork } from '../auth/loginSecurity.service.js';
import { lockSystemAdminSet, assertAnotherActiveAdmin, SYSTEM_ADMIN_ROLE } from './lastAdminGuard.js';
import { assertAssignableRole, assertManageableAccount, assertNotOwnAccountRole, grantorPermissions } from './grantBoundary.js';

type Tx = Parameters<Parameters<typeof orm.transaction>[0]>[0];
export type UserRow = typeof users.$inferSelect;

const USER_ENTITY = 'کاربران سیستم';
const USER_NOT_FOUND = 'کاربر یافت نشد';
const ROLE_INVALID = 'نقش انتخاب‌شده در سامانه معتبر نیست';
const USERNAME_TAKEN = 'نام کاربری تکراری است';
const USERNAME_HELD_BY_LIVE_USER = 'USERNAME_HELD_BY_LIVE_USER';

/**
 * حوزه H (TD-299): نقش admin از همه گاردها می‌گذرد؛ پس دادن یا گرفتن آن، و تغییر رمز یا حذف حساب یک مدیر سیستم،
 * فقط کار مدیر سیستم است. دارنده users.manage بدون این قاعده می‌توانست خود یا کاربر تازه‌ای را admin کند
 * یا رمز مدیر را عوض کند و با آن وارد شود.
 */
const ONLY_ADMIN_MANAGES_ADMINS = 'فقط مدیر سیستم می‌تواند نقش «مدیر سیستم» را بدهد یا بگیرد، یا حساب یک مدیر سیستم را تغییر دهد یا حذف کند';

function assertMayTouchAdminAccounts(actorRole: string | undefined, targetRoles: Array<string | null | undefined>): void {
  if (actorRole !== SYSTEM_ADMIN_ROLE && targetRoles.some(r => r === SYSTEM_ADMIN_ROLE)) {
    throw new ForbiddenError(ONLY_ADMIN_MANAGES_ADMINS);
  }
}

async function assertRoleDefined(db: Tx | typeof orm, role: string): Promise<void> {
  if (role === SYSTEM_ADMIN_ROLE) return;
  const [roleRecord] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, role)).limit(1);
  if (!roleRecord) throw new BadRequestError(ROLE_INVALID);
}

const USERNAME_KEY_INDEX = 'uq_users_username_key';

/** A unique violation; with `constraint`, only a violation of that constraint (never another unique key) */
function isUniqueViolation(err: unknown, constraint?: string): boolean {
  type PgError = { code?: string; message?: string; constraint?: string };
  const e = err as (PgError & { cause?: PgError }) | null;
  const code = e?.cause?.code || e?.code;
  const text = `${e?.message ?? ''} ${e?.cause?.message ?? ''}`;
  const unique = code === '23505' || /unique constraint|UNIQUE|duplicate key/.test(text);
  if (!unique || !constraint) return unique;
  return (e?.cause?.constraint || e?.constraint) === constraint || text.includes(`"${constraint}"`);
}

const hashPassword = async (password: string) => bcrypt.hash(password, await bcrypt.genSalt(10));

export interface ProfileInput { full_name?: string; avatar?: string; current_password?: string; new_password?: string }

/**
 * v10.0.207 (series 10 phase 3, L5 E7 part 3; part of TD-960): the profile, user create, edit, restore and delete
 * writes live here, each in one transaction with its audit row written with the same `tx`. Before, users.routes.ts
 * wrote the profile, a new user and a delete on the pool and logged the audit row after the commit.
 */
export async function updateOwnProfile(req: Request, userId: number, input: ProfileInput): Promise<{ user: UserRow; passwordChanged: boolean }> {
  refuseTokenGrace(req);
  const [u] = await orm.select().from(users).where(eq(users.id, userId));
  if (!u) throw new NotFoundError(USER_NOT_FOUND);

  const updateData: Partial<typeof users.$inferInsert> = {};
  if (input.full_name !== undefined) updateData.fullName = (input.full_name || '').trim();

  if (input.avatar) {
    if (isDataUrl(input.avatar)) {
      const avatarPath = await uploadBase64ToStorage(input.avatar);
      if (!isStoredAvatarPath(avatarPath)) throw new BadRequestError(AVATAR_INVALID_MESSAGE);
      updateData.avatarUrl = avatarPath;
    } else if (input.avatar !== u.avatarUrl) {
      // v11 phase 6.2 (X16): a stored path is only the user's own picture kept as it is; before, any image under
      // /uploads (another user's picture, a product image) could be named as one's avatar
      throw new BadRequestError(AVATAR_INVALID_MESSAGE);
    }
  }

  let passwordChanged = false;
  if (input.new_password) {
    if (!input.current_password) {
      throw new BadRequestError('جهت تغییر رمز عبور، وارد کردن رمز عبور فعلی الزامی است');
    }
    // v10.0.191 (TD-961): wrong current passwords lock the change progressively, like the login pair
    const lockedFor = passwordChangeLockMinutes(userId);
    if (lockedFor !== null) throw passwordChangeLockedError(lockedFor);
    const isMatch = await verifyPasswordConstantWork(input.current_password, u.password);
    if (!isMatch) {
      const lockMinutes = recordPasswordChangeFailure(userId);
      if (lockMinutes > 0) throw passwordChangeLockedError(lockMinutes);
      throw new BadRequestError('رمز عبور فعلی اشتباه است');
    }
    resetPasswordChangeFailures(userId);
    updateData.password = await hashPassword(input.new_password);
    updateData.mustResetPassword = 0;
    // V3.0.6 (BUG-08): با تغییر کلمه عبور، تمام sessionهای قبلی (توکن‌های صادرشده)
    // باطل می‌شوند تا توکن‌های سرقت‌شده پس از تغییر رمز نیز بی‌اعتبار باشند.
    updateData.tokenVersion = (u.tokenVersion || 0) + 1;
    passwordChanged = true;
  }

  const updatedUser = await orm.transaction(async (tx) => {
    if (Object.keys(updateData).length > 0) {
      await tx.update(users).set(updateData).where(eq(users.id, userId));
    }
    const [row] = await tx.select().from(users).where(eq(users.id, userId));
    await logActivity({
      req,
      tx,
      action: 'UPDATE',
      entity: 'پروفایل کاربر',
      entityId: userId,
      description: `به‌روزرسانی اطلاعات نمایه شخصی ${passwordChanged ? 'و تغییر رمز عبور' : ''}`,
      details: {
        userId,
        username: u.username,
        fullName: row.fullName,
        passwordChanged,
        avatarUpdated: updateData.avatarUrl !== undefined
      }
    });
    return row;
  });
  // 10.3 package 5: this device's requests sent just before the change still carry its previous token (after commit)
  if (passwordChanged) allowPreviousTokenVersion(req.user, u.tokenVersion || 0, updateData.tokenVersion ?? 0);
  if (Object.keys(updateData).length > 0) invalidateUserAuthCache(userId);
  return { user: updatedUser, passwordChanged };
}

export interface UserCreateInput { username: string; password: string; full_name?: string; role: string }

export async function createUser(req: Request, input: UserCreateInput): Promise<{ id: number; username: string; full_name: string; role: string }> {
  const { role } = input;
  assertMayTouchAdminAccounts(req.user?.role, [role]);
  // v9.0.129 (TD-520، ت۳): کاربر تازه فقط نقشی می‌گیرد که مجوزهایش در مجوزهای سازنده است
  await assertAssignableRole(orm, await grantorPermissions(req.user?.role), role);
  const tUsername = (input.username || '').trim();
  // v9.0.76 (TD-521): پیشوند کاربران آزمون رد می‌شود؛ چنین کاربری پیش‌تر در فهرست‌ها پنهان می‌ماند
  if (isSyntheticTestUsername(tUsername)) throw new ValidationError(SYNTHETIC_USERNAME_REFUSED);
  // OBS-R1-30 (ت۴۰): a new username is 3 to 50 Latin letters, digits, «.», «_» or «-»; old usernames are left as they are
  const formatError = usernameFormatError(tUsername);
  if (formatError) throw new ValidationError(formatError, undefined, USERNAME_FORMAT_INVALID);
  const tFullName = (input.full_name && String(input.full_name).trim()) ? String(input.full_name).trim() : tUsername;
  const hashedPassword = await hashPassword(input.password);

  try {
    return await orm.transaction(async (tx) => {
      // OBS-R1-30 (ت۴۰): «Ali» and «ali» are one username; a live holder is named before a deleted one (TD-519)
      const [existingUser] = await tx.select().from(users)
        .where(sql`lower(btrim(${users.username})) = ${usernameKey(tUsername)}::text`)
        .orderBy(users.isDeleted, users.id).limit(1);
      if (existingUser) {
        // v9.0.178 (TD-519، یافته B02-04، تصمیم ت۲ الف): کاربر تازه همیشه شناسه تازه می‌گیرد. پیش‌تر همان ردیف کاربر حذف‌شده
        // با رمز و نقش تازه زنده می‌شد و فرد تازه اعلان‌ها، فیش و اطلاعات بانکی فرد قبلی را می‌دید؛ بازگرداندن همان شخص
        // اقدامی جداست (`POST /users/:id/restore`). جزئیات خطای ۴xx در تولید هم فرستاده می‌شود (TD-594).
        if (existingUser.isDeleted === 1) {
          throw new ConflictError(
            deletedUsernameMessage(existingUser.fullName || existingUser.username),
            { deletedUser: { id: existingUser.id, username: existingUser.username, fullName: existingUser.fullName } },
            USERNAME_OF_DELETED_USER,
          );
        }
        throw new BadRequestError(USERNAME_TAKEN);
      }
      await assertRoleDefined(tx, role);

      // v9.0.219 (TD-523، ت۵ الف): رمزی که مدیر می‌گذارد موقت است و کاربر در نخستین ورود باید آن را عوض کند
      const [info] = await tx.insert(users).values({
        username: tUsername,
        password: hashedPassword,
        fullName: tFullName,
        role,
        mustResetPassword: 1,
      }).returning({ id: users.id });

      await logActivity({
        req,
        tx,
        action: 'CREATE',
        entity: USER_ENTITY,
        entityId: info.id,
        description: `تعریف کاربر جدید "${tFullName}" با نام کاربری "${tUsername}" (نقش: ${role})`,
        details: {
          after: { id: info.id, username: tUsername, fullName: tFullName, role },
          mustResetPassword: true,
        }
      });
      return { id: info.id, username: tUsername, full_name: tFullName, role };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new BadRequestError(USERNAME_TAKEN);
    throw err;
  }
}

export interface UserUpdateInput { password?: string; full_name?: string | null; role?: string }

export async function updateUser(req: Request, targetUserId: number, input: UserUpdateInput): Promise<void> {
  const { role } = input;
  const passwordChanged = Boolean(input.password && input.password.trim());
  const passwordHash = passwordChanged ? await hashPassword(input.password as string) : null;

  try {
    // v9.0.75 (TD-524): ویرایش زیر قفل مجموعه مدیران و قفل ردیف کاربر؛ آخرین مدیر سیستم از نقش خود بیرون نمی‌رود
    await orm.transaction(async (tx) => {
      await lockSystemAdminSet(tx);
      const [prevUser] = await tx.select().from(users).where(eq(users.id, targetUserId)).for('update');
      if (!prevUser || prevUser.isDeleted === 1) throw new NotFoundError(USER_NOT_FOUND);
      assertMayTouchAdminAccounts(req.user?.role, [prevUser.role, role]);
      // v9.0.129 (TD-520، ت۳): حساب قوی‌تر از ویرایشگر دست نمی‌خورد، نقش حساب خودش عوض نمی‌شود و نقش تازه در مرز
      // مجوزهای اوست
      const grantor = await grantorPermissions(req.user?.role, tx);
      await assertManageableAccount(tx, grantor, prevUser.role ?? '');
      if (role && role !== prevUser.role) {
        assertNotOwnAccountRole(req.user, targetUserId);
        await assertAssignableRole(tx, grantor, role);
      }
      if (role) await assertRoleDefined(tx, role);

      const roleChanged = Boolean(role && role !== prevUser.role);
      if (roleChanged && prevUser.role === SYSTEM_ADMIN_ROLE) {
        await assertAnotherActiveAdmin(tx, targetUserId, 'demote');
      }

      const tFullName = (input.full_name !== undefined && input.full_name !== null && String(input.full_name).trim())
        ? String(input.full_name).trim()
        : (prevUser.fullName || prevUser.username);

      const updateData: Partial<typeof users.$inferInsert> = { fullName: tFullName, role };
      // v9.0.219 (TD-523، ت۵ الف): رمزی که مدیر برای کاربر دیگری می‌گذارد موقت است (پیش‌تر پرچم را ۰ می‌کرد)؛ رمزی که
      // کسی برای حساب خودش می‌گذارد موقت نیست
      if (passwordHash) {
        updateData.password = passwordHash;
        updateData.mustResetPassword = targetUserId === Number(req.user?.id) ? 0 : 1;
      }
      // V9-2.2: تغییر نقش یا رمز عبور نشست‌های فعال کاربر هدف را باطل می‌کند (tokenVersion)
      if (passwordChanged || roleChanged) {
        updateData.tokenVersion = (prevUser.tokenVersion || 0) + 1;
      }

      await tx.update(users).set(updateData).where(eq(users.id, targetUserId));

      const { diff, hasChanges } = computeAuditDiff(
        { fullName: prevUser.fullName, role: prevUser.role },
        { fullName: tFullName, role }
      );
      await logActivity({
        req,
        tx,
        action: 'UPDATE',
        entity: USER_ENTITY,
        entityId: targetUserId,
        description: `ویرایش مشخصات کاربر شناسه #${targetUserId} (${prevUser.username})${passwordChanged ? ' (شامل بازنشانی رمز عبور)' : ''}`,
        details: {
          userId: targetUserId,
          username: prevUser.username,
          before: { fullName: prevUser.fullName, role: prevUser.role },
          after: { fullName: tFullName, role },
          changes: diff,
          hasChanges,
          passwordChanged,
          ...(passwordChanged ? { mustResetPassword: updateData.mustResetPassword === 1 } : {})
        }
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new BadRequestError('اطلاعات یکتا با حساب کاربری دیگری تداخل دارد');
    throw err;
  }
  invalidateUserAuthCache(targetUserId);
}

/**
 * v9.0.178 (TD-519، یافته B02-04، تصمیم ت۲ الف): بازگرداندن کاربر حذف‌شده، همان شخص با همان شناسه و نام، با نقش تازه و
 * رمز موقت که در ورود بعدی باید عوض شود. قاعده‌های ویرایش کاربر برقرار است: حساب مدیر سیستم فقط با مدیر سیستم،
 * و نقش تازه و حساب در مرز مجوزهای بازگرداننده (TD-520).
 */
export const USERNAME_TAKEN_DURING_RESTORE = 'نام کاربری این کاربر هم‌زمان به کاربر دیگری داده شد؛ این کاربر بازگردانده نمی‌شود.';

export async function restoreUser(req: Request, targetUserId: number, input: { password: string; role: string }): Promise<{ id: number; username: string; full_name: string; role: string }> {
  const { role } = input;
  const passwordHash = await hashPassword(input.password);

  // v10.2.0: a user created meanwhile with this username in another letter case reaches the unique index only at the
  // update; that is the same friendly 409 as a live holder found before it, never a raw database error
  const restored = await orm.transaction(async (tx) => {
    await lockSystemAdminSet(tx);
    const [target] = await tx.select().from(users).where(eq(users.id, targetUserId)).for('update');
    if (!target) throw new NotFoundError(USER_NOT_FOUND);
    if (target.isDeleted !== 1) {
      throw new ConflictError('این کاربر حذف نشده است و بازگرداندن ندارد.', undefined, 'USER_NOT_DELETED');
    }
    assertMayTouchAdminAccounts(req.user?.role, [target.role, role]);
    if (isSyntheticTestUsername(target.username)) throw new ValidationError(SYNTHETIC_USERNAME_REFUSED);
    const grantor = await grantorPermissions(req.user?.role, tx);
    await assertManageableAccount(tx, grantor, target.role ?? '');
    await assertAssignableRole(tx, grantor, role);
    await assertRoleDefined(tx, role);
    // OBS-R1-30 (ت۴۰): a deleted user comes back only when no live user holds its username in another letter case
    const [liveHolder] = await tx.select({ id: users.id, username: users.username, fullName: users.fullName }).from(users)
      .where(and(sql`lower(btrim(${users.username})) = ${usernameKey(target.username)}::text`, eq(users.isDeleted, 0), sql`${users.id} <> ${targetUserId}`))
      .limit(1);
    if (liveHolder) {
      throw new ConflictError(
        `نام کاربری «${target.username}» اکنون با حروف دیگری از آنِ کاربر «${liveHolder.fullName || liveHolder.username}» است؛ این کاربر بازگردانده نمی‌شود.`,
        { liveUser: { id: liveHolder.id, username: liveHolder.username } },
        USERNAME_HELD_BY_LIVE_USER,
      );
    }

    await tx.update(users).set({
      password: passwordHash,
      role,
      isDeleted: 0,
      mustResetPassword: 1,
      failedLoginCount: 0,
      lockedUntil: null,
      tokenVersion: (target.tokenVersion || 0) + 1,
    }).where(eq(users.id, targetUserId));

    const name = target.fullName || target.username;
    await logActivity({
      req,
      tx,
      action: 'UPDATE',
      entity: USER_ENTITY,
      entityId: targetUserId,
      description: `بازگرداندن کاربر حذف‌شده "${name}" (نام کاربری: ${target.username}) با نقش ${role} و رمز موقت`,
      details: {
        userId: targetUserId,
        username: target.username,
        before: { fullName: target.fullName, role: target.role, isDeleted: 1 },
        after: { fullName: target.fullName, role, isDeleted: 0 },
        restored: true,
        mustResetPassword: true,
      }
    });
    return { id: targetUserId, username: target.username, full_name: name, role };
  }).catch((err: unknown) => {
    if (isUniqueViolation(err, USERNAME_KEY_INDEX)) throw new ConflictError(USERNAME_TAKEN_DURING_RESTORE, undefined, USERNAME_HELD_BY_LIVE_USER);
    throw err;
  });
  invalidateUserAuthCache(targetUserId);
  return restored;
}

export async function deleteUser(req: Request, targetUserId: number): Promise<void> {
  // V9-2.2: ممنوعیت حذف حساب خودی
  if (req.user?.id && Number(req.user.id) === targetUserId) {
    throw new ConflictError('حذف حساب کاربری خودی مجاز نیست.');
  }

  await orm.transaction(async (tx) => {
    // v9.0.75 (TD-524): همان قفل مجموعه مدیران ویرایش، پیش از قفل ردیف
    await lockSystemAdminSet(tx);
    const [delUser] = await tx.select().from(users).where(eq(users.id, targetUserId)).for('update');
    if (!delUser || delUser.isDeleted === 1) throw new NotFoundError(USER_NOT_FOUND);
    assertMayTouchAdminAccounts(req.user?.role, [delUser.role]);
    // v9.0.129 (TD-520، ت۳): حسابی که نقشش مجوزی بیش از حذف‌کننده دارد حذف نمی‌شود
    await assertManageableAccount(tx, await grantorPermissions(req.user?.role, tx), delUser.role ?? '');
    // ممنوعیت حذف آخرین مدیر فعال سیستم (قفل‌شدن سامانه)
    if (delUser.role === SYSTEM_ADMIN_ROLE) {
      await assertAnotherActiveAdmin(tx, targetUserId, 'delete');
    }

    // Soft-Delete + ابطال فوری تمام نشست‌های فعال (افزایش tokenVersion)
    await tx.update(users).set({
      isDeleted: 1,
      tokenVersion: (delUser.tokenVersion || 0) + 1
    }).where(eq(users.id, targetUserId));
    // v10.1.41: a deleted user's Bale and Telegram links close with the account, so no notice reaches their chat
    const closedMessengerLinks = await tx.update(userMessengerLinks)
      .set({ isActive: 0, unlinkedAt: sql`now()`, unlinkReason: 'user_deleted' })
      .where(and(eq(userMessengerLinks.userId, targetUserId), eq(userMessengerLinks.isActive, 1)))
      .returning({ id: userMessengerLinks.id });

    await logActivity({
      req,
      tx,
      action: 'DELETE',
      entity: USER_ENTITY,
      entityId: targetUserId,
      description: `حذف کاربر "${delUser.fullName || delUser.username}" (نام کاربری: ${delUser.username}، نقش: ${delUser.role ?? ''})`,
      details: {
        before: { id: targetUserId, username: delUser.username, fullName: delUser.fullName, role: delUser.role ?? '' },
        softDeleted: true,
        sessionsRevoked: true,
        closedMessengerLinkIds: closedMessengerLinks.map(l => l.id),
        deletedAt: new Date().toISOString()
      }
    });
  });
  invalidateUserAuthCache(targetUserId);
}
