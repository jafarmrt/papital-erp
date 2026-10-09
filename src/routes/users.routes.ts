import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { eq, desc } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { users, roles } from '../db/schema.js';
import { authenticateToken, invalidateUserAuthCache, generateToken, generateCsrfToken, AUTH_COOKIE_NAME, getAuthCookieOptions, shouldExposeTokenInBody } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorizePermission } from '../middleware/authorize.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { logActivity, computeAuditDiff } from '../lib/auditLogger.js';
import { NotFoundError, ForbiddenError, BadRequestError, ValidationError, ConflictError } from '../errors/customErrors.js';
import { lockSystemAdminSet, assertAnotherActiveAdmin, SYSTEM_ADMIN_ROLE } from '../services/users/lastAdminGuard.js';
import { isDataUrl, uploadBase64ToStorage } from '../lib/storage.js';
import { AVATAR_INVALID_MESSAGE, FULL_NAME_MAX_LENGTH, FULL_NAME_TOO_LONG_MESSAGE, isAcceptableAvatar, isStoredAvatarPath } from '../lib/users/profileFields.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { PERMISSION_CATALOG, PERMISSION_KEYS, isSystemAdminRole } from '../lib/permissions/permissionCatalog.js';
import { createRole, deleteRole, updateRole } from '../services/users/roleAdmin.service.js';
import { workflowsRequiringRole } from '../services/workflow/transitionRoles.js';
import {
  assertAssignableRole, assertManageableAccount, assertNotOwnAccountRole, grantorPermissions,
} from '../services/users/grantBoundary.js';
import { isSyntheticTestUsername, SYNTHETIC_USERNAME_REFUSED } from '../lib/syntheticUsers.js';
import { USERNAME_OF_DELETED_USER, deletedUsernameMessage } from '../lib/users/userRestore.js';
import { roleDisplayName } from '../lib/users/roleDisplayName.js';
import { MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE } from '../lib/auth/passwordPolicy.js';

const router = Router();
router.use(authenticateToken); // Protect all user routes

/**
 * حوزه H (TD-299): نقش admin از همه گاردها می‌گذرد؛ پس دادن یا گرفتن آن، و تغییر رمز یا حذف حساب یک مدیر سیستم،
 * فقط کار مدیر سیستم است. دارنده users.manage بدون این قاعده می‌توانست خود یا کاربر تازه‌ای را admin کند
 * یا رمز مدیر را عوض کند و با آن وارد شود.
 */
const ONLY_ADMIN_MANAGES_ADMINS = 'فقط مدیر سیستم می‌تواند نقش «مدیر سیستم» را بدهد یا بگیرد، یا حساب یک مدیر سیستم را تغییر دهد یا حذف کند';

function touchesAdminAccount(actorRole: string | undefined, targetRoles: Array<string | null | undefined>): boolean {
  return actorRole !== SYSTEM_ADMIN_ROLE && targetRoles.some(r => r === SYSTEM_ADMIN_ROLE);
}

const updateProfileSchema = z.object({
  body: z.object({
    // v9.0.222 (TD-533): نام حداکثر ۱۰۰ نویسه؛ تصویر فقط بارگذاری تازه یا مسیر `/uploads` همین سامانه (نه نشانی بیرونی)
    full_name: z.string().trim().max(FULL_NAME_MAX_LENGTH, FULL_NAME_TOO_LONG_MESSAGE).optional(),
    avatar: z.string().refine(isAcceptableAvatar, AVATAR_INVALID_MESSAGE).optional(),
    current_password: z.string().optional(),
    new_password: z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE).optional().or(z.literal(''))
  })
});

const createRoleSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'عنوان نقش الزامی است'),
    code: z.string().min(1, 'کد نقش الزامی است'),
    description: z.string().optional(),
    permissions: z.array(z.string()).optional()
  })
});

const updateRoleSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'عنوان نقش الزامی است').optional(),
    description: z.string().optional(),
    permissions: z.array(z.string()).optional()
  }),
  params: z.object({
    id: numericIdString
  })
});

// v9.0.86 (TD-880): کاتالوگ مجوز در فایل مشترک سرور و مرورگر است؛ این بازصادر برای مصرف‌کنندگان قدیمی می‌ماند
export { PERMISSION_CATALOG };


// Get current user's active permissions array
router.get('/users/my-permissions', asyncHandler(async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'غیر مجاز' });

    const [roleRecord] = await orm.select().from(roles).where(eq(roles.code, user.role));
    // v9.0.149 (TD-894): مدیر سیستم هم نام ذخیره‌شده نقشش را می‌گیرد تا نوار بالا و نمایه برچسبی از روی کد نسازند.
    if (isSystemAdminRole(user.role)) {
      return res.json({ role: user.role, roleName: roleRecord?.name || 'مدیر سیستم', permissions: [...PERMISSION_KEYS], isAdmin: true });
    }

    if (!roleRecord) {
      return res.json({ role: user.role, roleName: user.role, permissions: [], isAdmin: false });
    }

    res.json({
      role: roleRecord.code,
      roleName: roleRecord.name,
      permissions: Array.isArray(roleRecord.permissions) ? roleRecord.permissions : [],
      isAdmin: false
    });
  } catch (err) {
    throw err;
  }
}));

// Profile endpoints (Any authenticated user can manage their profile)
router.get('/users/profile', asyncHandler(async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'غیر مجاز' });
    const [u] = await orm.select().from(users).where(eq(users.id, userId));
    if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
    const { password: _, ...userInfo } = u;
    res.json({
      ...userInfo,
      full_name: u.fullName,
      avatar_url: u.avatarUrl || ''
    });
  } catch (err) {
    throw err;
  }
}));

router.put('/users/profile', validate(updateProfileSchema), asyncHandler(async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'غیر مجاز' });

    const [u] = await orm.select().from(users).where(eq(users.id, userId));
    if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });

    const { full_name, avatar, current_password, new_password } = req.body;
    const updateData: Partial<typeof users.$inferInsert> = {};

    if (full_name !== undefined) {
      updateData.fullName = (full_name || '').trim();
    }

    if (avatar) {
      if (isDataUrl(avatar)) {
        const avatarPath = await uploadBase64ToStorage(avatar);
        if (!isStoredAvatarPath(avatarPath)) {
          return res.status(400).json({ error: AVATAR_INVALID_MESSAGE });
        }
        updateData.avatarUrl = avatarPath;
      } else {
        updateData.avatarUrl = avatar;
      }
    }

    let passwordChanged = false;
    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ error: 'جهت تغییر کلمه عبور، وارد کردن کلمه عبور فعلی الزامی است' });
      }
      const isBcrypt = u.password && (u.password.startsWith('$2a$') || u.password.startsWith('$2b$') || u.password.startsWith('$2y$'));
      const isMatch = isBcrypt ? await bcrypt.compare(current_password, u.password) : false;
      if (!isMatch) {
        return res.status(400).json({ error: 'کلمه عبور فعلی اشتباه است' });
      }
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(new_password, salt);
      updateData.mustResetPassword = 0;
      // V3.0.6 (BUG-08): با تغییر کلمه عبور، تمام sessionهای قبلی (توکن‌های صادرشده)
      // باطل می‌شوند تا توکن‌های سرقت‌شده پس از تغییر رمز نیز بی‌اعتبار باشند.
      updateData.tokenVersion = (u.tokenVersion || 0) + 1;
      passwordChanged = true;
    }

    if (Object.keys(updateData).length > 0) {
      await orm.update(users).set(updateData).where(eq(users.id, userId));
      invalidateUserAuthCache(userId);
    }

    const [updatedUser] = await orm.select().from(users).where(eq(users.id, userId));

    await logActivity({
      req,
      action: 'UPDATE',
      entity: 'پروفایل کاربر',
      entityId: userId,
      description: `به‌روزرسانی اطلاعات نمایه شخصی ${passwordChanged ? 'و تغییر کلمه عبور' : ''}`,
      details: {
        userId,
        username: u.username,
        fullName: updatedUser.fullName,
        passwordChanged,
        avatarUpdated: Boolean(avatar)
      }
    });

    // v9.0.218 (TD-531): نسخه توکن بالا رفت و نشست‌های دیگر کاربر باطل‌اند؛ همین نشست با توکن تازه ادامه می‌یابد، وگرنه
    // پس از پیام موفقیت، درخواست بعدی ۴۰۱ می‌گرفت
    let session: { token: string; csrfToken: string } | null = null;
    if (passwordChanged) {
      const csrfToken = req.user?.csrfToken || generateCsrfToken();
      const token = generateToken({ id: updatedUser.id, username: updatedUser.username, role: updatedUser.role, csrfToken, tokenVersion: updatedUser.tokenVersion || 0 });
      res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(req));
      session = { token, csrfToken };
    }

    const { password: _, ...userInfo } = updatedUser;
    res.json({
      success: true,
      user: {
        ...userInfo,
        full_name: updatedUser.fullName,
        avatar_url: updatedUser.avatarUrl || '',
        mustResetPassword: Boolean(updatedUser.mustResetPassword),
        must_reset_password: Boolean(updatedUser.mustResetPassword)
      },
      ...(session ? { csrfToken: session.csrfToken, ...(shouldExposeTokenInBody() ? { token: session.token } : {}) } : {})
    });
  } catch (err) {
    throw err;
  }
}));

// Permissions catalog route
router.get('/permissions', authorizePermission(...READ_PERMISSIONS.permissionCatalog), asyncHandler(async (req, res) => {
  res.json(PERMISSION_CATALOG);
}));

// ROLES MANAGEMENT ROUTES
router.get('/roles', authorizePermission(...READ_PERMISSIONS.userDirectory), asyncHandler(async (req, res) => {
  try {
    const allRoles = await orm.select().from(roles).orderBy(roles.id);
    // v9.0.136 (TD-886، قاعده ۳ مدل مجوز): «مدیر سیستم» همیشه همه مجوزها را دارد؛ فهرست آن محاسبه می‌شود، نه خوانده
    res.json(allRoles.map(r => (isSystemAdminRole(r.code) ? { ...r, permissions: [...PERMISSION_KEYS] } : r)));
  } catch (err) {
    throw err;
  }
}));

router.post('/roles', authorizePermission('roles.manage'), validate(createRoleSchema), asyncHandler(async (req, res) => {
  // v10.0.27 (L5 E7): the role and its audit row are written in one transaction by the role service
  const { name, code, description, permissions } = req.body;
  res.json(await createRole(req, { name, code, description, permissions }));
}));

router.put('/roles/:id', authorizePermission('roles.manage'), validate(updateRoleSchema), asyncHandler(async (req, res) => {
  const { name, description, permissions } = req.body;
  await updateRole(req, Number(req.params.id), { name, description, permissions });
  res.json({ success: true });
}));

router.delete('/roles/:id', authorizePermission('roles.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  await deleteRole(req, Number(req.params.id), workflowsRequiringRole);
  res.json({ success: true });
}));

// USERS MANAGEMENT ROUTES
// v9.0.217 (TD-532): همان کمینه مشترک نمایه و راه‌اندازی، نه ۶ نویسه
const userPasswordField = z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE);

const userCreateSchema = z.object({
  body: z.object({
    username: z.string().trim().min(3, 'نام کاربری باید حداقل ۳ کاراکتر باشد'),
    password: userPasswordField,
    full_name: z.string().trim().max(FULL_NAME_MAX_LENGTH, FULL_NAME_TOO_LONG_MESSAGE).optional().default(''),
    role: z.string().trim().min(1, 'انتخاب نقش الزامی است'),
  })
});

const userUpdateSchema = z.object({
  body: z.object({
    password: userPasswordField.optional().or(z.literal('')),
    full_name: z.string().trim().max(FULL_NAME_MAX_LENGTH, FULL_NAME_TOO_LONG_MESSAGE).optional().default(''),
    role: z.string().trim().min(1, 'انتخاب نقش الزامی است'),
  }),
  params: z.object({
    id: numericIdString
  })
});

// v9.0.178 (TD-519، تصمیم ت۲ الف): بازگرداندن کاربر حذف‌شده نقش تازه و رمز موقت می‌خواهد
const userRestoreSchema = z.object({
  body: z.object({
    password: userPasswordField,
    role: z.string().trim().min(1, 'انتخاب نقش الزامی است'),
  }),
  params: z.object({
    id: numericIdString
  })
});

const userParamsSchema = z.object({
  params: z.object({
    id: numericIdString
  })
});

/**
 * v9.0.223 (TD-534، یافته B02-19): فهرست ساده برای انتخابگر اشاره و فهرست‌های نام است و به هر کاربر واردشده می‌رسد؛ پس
 * کد نقش ندارد. نام کاربری برای اشاره (@نام‌کاربری) می‌ماند و به‌جای کد نقش، نام فارسی ذخیره‌شده نقش می‌آید.
 */
router.get('/users/list-simple', asyncHandler(async (req, res) => {
  const allUsers = await orm.select({
    id: users.id,
    username: users.username,
    fullName: users.fullName,
    role: users.role,
    roleName: roles.name,
    avatarUrl: users.avatarUrl
  })
  .from(users)
  .leftJoin(roles, eq(roles.code, users.role))
  .where(eq(users.isDeleted, 0))
  .orderBy(desc(users.id));

  res.json(allUsers.map(u => ({
    id: u.id,
    username: u.username,
    full_name: u.fullName || u.username,
    role_name: roleDisplayName(u.role, u.roleName),
    avatar_url: u.avatarUrl || ''
  })));
}));

router.get('/users', authorizePermission(...READ_PERMISSIONS.userDirectory), asyncHandler(async (req, res) => {
  try {
    const allUsers = await orm.select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      avatarUrl: users.avatarUrl
    })
    .from(users)
    .where(eq(users.isDeleted, 0))
    .orderBy(desc(users.id));
    
    const mapped = allUsers.map(u => ({
      id: u.id,
      username: u.username,
      full_name: u.fullName || u.username,
      fullName: u.fullName || u.username,
      role: u.role,
      avatar_url: u.avatarUrl || '',
      avatarUrl: u.avatarUrl || ''
    }));
    res.json(mapped);
  } catch (err) {
    throw err;
  }
}));

router.post('/users', authorizePermission('users.manage'), validate(userCreateSchema), asyncHandler(async (req, res) => {
  try {
    const { username, password, full_name, role } = req.body;
    if (touchesAdminAccount(req.user?.role, [role])) {
      return res.status(403).json({ error: ONLY_ADMIN_MANAGES_ADMINS });
    }
    // v9.0.129 (TD-520، ت۳): کاربر تازه فقط نقشی می‌گیرد که مجوزهایش در مجوزهای سازنده است
    await assertAssignableRole(orm, await grantorPermissions(req.user?.role), role);
    const tUsername = (username || '').trim();
    // v9.0.76 (TD-521): پیشوند کاربران آزمون رد می‌شود؛ چنین کاربری پیش‌تر در فهرست‌ها پنهان می‌ماند
    if (isSyntheticTestUsername(tUsername)) {
      throw new ValidationError(SYNTHETIC_USERNAME_REFUSED);
    }
    const tFullName = (full_name && String(full_name).trim()) ? String(full_name).trim() : tUsername;

    // ۱. بررسی تکراری نبودن نام کاربری در دیتابیس
    const [existingUser] = await orm.select().from(users).where(eq(users.username, tUsername)).limit(1);
    if (existingUser) {
      // v9.0.178 (TD-519، یافته B02-04، تصمیم ت۲ الف): کاربر تازه همیشه شناسه تازه می‌گیرد. پیش‌تر همان ردیف کاربر حذف‌شده
      // با رمز و نقش تازه زنده می‌شد و فرد تازه اعلان‌ها، فیش و اطلاعات بانکی فرد قبلی را می‌دید؛ بازگرداندن همان شخص
      // اقدامی جداست (`POST /users/:id/restore`). پاسخ مستقیم است، چون گرداننده خطا `details` را در تولید نمی‌فرستد.
      if (existingUser.isDeleted === 1) {
        return res.status(409).json({
          error: deletedUsernameMessage(existingUser.fullName || existingUser.username),
          code: USERNAME_OF_DELETED_USER,
          details: { deletedUser: { id: existingUser.id, username: existingUser.username, fullName: existingUser.fullName } },
        });
      }
      return res.status(400).json({ error: 'نام کاربری تکراری است' });
    }

    // ۲. اعتبارسنجی نقش انتخابی
    if (role !== SYSTEM_ADMIN_ROLE) {
      const [roleRecord] = await orm.select().from(roles).where(eq(roles.code, role)).limit(1);
      if (!roleRecord) {
        return res.status(400).json({ error: 'نقش انتخاب‌شده در سیستم معتبر نیست' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // v9.0.219 (TD-523، ت۵ الف): رمزی که مدیر می‌گذارد موقت است و کاربر در نخستین ورود باید آن را عوض کند
    const [info] = await orm.insert(users).values({
      username: tUsername,
      password: hashedPassword,
      fullName: tFullName,
      role: role,
      mustResetPassword: 1,
    }).returning({ id: users.id });

    // V9-2.2: ثبت لاگ ممیزی پیش از ارسال پاسخ — جلوگیری از گم‌شدن رکورد ممیزی و خطای headers-sent
    await logActivity({
      req,
      action: 'CREATE',
      entity: 'کاربران سیستم',
      entityId: info.id,
      description: `تعریف کاربر جدید "${tFullName}" با نام کاربری "${tUsername}" (نقش: ${role})`,
      details: {
        after: {
          id: info.id,
          username: tUsername,
          fullName: tFullName,
          role: role
        },
        mustResetPassword: true,
      }
    });

    res.json({ id: info.id, username: tUsername, full_name: tFullName, role });
  } catch (err: any) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const causeMsg = err?.cause?.message || '';
    const causeCode = err?.cause?.code || err?.code;

    if (
      causeCode === '23505' ||
      errMsg.includes('unique constraint') ||
      errMsg.includes('UNIQUE') ||
      causeMsg.includes('unique constraint') ||
      causeMsg.includes('duplicate key')
    ) {
      return res.status(400).json({ error: 'نام کاربری تکراری است' });
    }
    throw err;
  }
}));

router.put('/users/:id', authorizePermission('users.manage'), validate(userUpdateSchema), asyncHandler(async (req, res) => {
  try {
    const { password, full_name, role } = req.body;
    const targetUserId = Number(req.params.id);
    const passwordChanged = Boolean(password && password.trim());
    const passwordHash = passwordChanged ? await bcrypt.hash(password, await bcrypt.genSalt(10)) : null;

    // v9.0.75 (TD-524): ویرایش زیر قفل مجموعه مدیران و قفل ردیف کاربر؛ آخرین مدیر سیستم از نقش خود بیرون نمی‌رود
    await orm.transaction(async (tx) => {
      await lockSystemAdminSet(tx);
      const [prevUser] = await tx.select().from(users).where(eq(users.id, targetUserId)).for('update');
      if (!prevUser || prevUser.isDeleted === 1) {
        throw new NotFoundError('کاربر یافت نشد');
      }
      if (touchesAdminAccount(req.user?.role, [prevUser.role, role])) {
        throw new ForbiddenError(ONLY_ADMIN_MANAGES_ADMINS);
      }
      // v9.0.129 (TD-520، ت۳): حساب قوی‌تر از ویرایشگر دست نمی‌خورد، نقش حساب خودش عوض نمی‌شود و نقش تازه در مرز
      // مجوزهای اوست
      const grantor = await grantorPermissions(req.user?.role, tx);
      await assertManageableAccount(tx, grantor, prevUser.role);
      if (role && role !== prevUser.role) {
        assertNotOwnAccountRole(req.user, targetUserId);
        await assertAssignableRole(tx, grantor, role);
      }

      // اعتبارسنجی نقش
      if (role && role !== SYSTEM_ADMIN_ROLE) {
        const [roleRecord] = await tx.select().from(roles).where(eq(roles.code, role)).limit(1);
        if (!roleRecord) {
          throw new BadRequestError('نقش انتخاب‌شده در سیستم معتبر نیست');
        }
      }

      const roleChanged = Boolean(role && role !== prevUser.role);
      if (roleChanged && prevUser.role === SYSTEM_ADMIN_ROLE) {
        await assertAnotherActiveAdmin(tx, targetUserId, 'demote');
      }

      const tFullName = (full_name !== undefined && full_name !== null && String(full_name).trim())
        ? String(full_name).trim()
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
        { fullName: tFullName, role: role }
      );

      await logActivity({
        req,
        tx,
        action: 'UPDATE',
        entity: 'کاربران سیستم',
        entityId: targetUserId,
        description: `ویرایش مشخصات کاربر شناسه #${targetUserId} (${prevUser.username})${passwordChanged ? ' (شامل بازنشانی کلمه عبور)' : ''}`,
        details: {
          userId: targetUserId,
          username: prevUser.username,
          before: { fullName: prevUser.fullName, role: prevUser.role },
          after: { fullName: tFullName, role: role },
          changes: diff,
          hasChanges,
          passwordChanged,
          ...(passwordChanged ? { mustResetPassword: updateData.mustResetPassword === 1 } : {})
        }
      });
    });
    invalidateUserAuthCache(targetUserId);

    res.json({ success: true });
  } catch (err: any) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const causeMsg = err?.cause?.message || '';
    const causeCode = err?.cause?.code || err?.code;

    if (
      causeCode === '23505' ||
      errMsg.includes('unique constraint') ||
      errMsg.includes('UNIQUE') ||
      causeMsg.includes('unique constraint')
    ) {
      return res.status(400).json({ error: 'اطلاعات یکتا با حساب کاربری دیگری تداخل دارد' });
    }
    throw err;
  }
}));

/**
 * v9.0.178 (TD-519، یافته B02-04، تصمیم ت۲ الف): بازگرداندن کاربر حذف‌شده، همان شخص با همان شناسه و نام، با نقش تازه و
 * رمز موقت که در ورود بعدی باید عوض شود. قاعده‌های ویرایش کاربر برقرار است: حساب مدیر سیستم فقط با مدیر سیستم،
 * و نقش تازه و حساب در مرز مجوزهای بازگرداننده (TD-520).
 */
router.post('/users/:id/restore', authorizePermission('users.manage'), validate(userRestoreSchema), asyncHandler(async (req, res) => {
  const { password, role } = req.body;
  const targetUserId = Number(req.params.id);
  const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(10));

  const restored = await orm.transaction(async (tx) => {
    await lockSystemAdminSet(tx);
    const [target] = await tx.select().from(users).where(eq(users.id, targetUserId)).for('update');
    if (!target) {
      throw new NotFoundError('کاربر یافت نشد');
    }
    if (target.isDeleted !== 1) {
      throw new ConflictError('این کاربر حذف نشده است و بازگرداندن ندارد.', undefined, 'USER_NOT_DELETED');
    }
    if (touchesAdminAccount(req.user?.role, [target.role, role])) {
      throw new ForbiddenError(ONLY_ADMIN_MANAGES_ADMINS);
    }
    if (isSyntheticTestUsername(target.username)) {
      throw new ValidationError(SYNTHETIC_USERNAME_REFUSED);
    }
    const grantor = await grantorPermissions(req.user?.role, tx);
    await assertManageableAccount(tx, grantor, target.role);
    await assertAssignableRole(tx, grantor, role);
    if (role !== SYSTEM_ADMIN_ROLE) {
      const [roleRecord] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, role)).limit(1);
      if (!roleRecord) {
        throw new BadRequestError('نقش انتخاب‌شده در سیستم معتبر نیست');
      }
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
      entity: 'کاربران سیستم',
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
  });
  invalidateUserAuthCache(targetUserId);

  res.json(restored);
}));

router.delete('/users/:id', authorizePermission('users.manage'), validate(userParamsSchema), asyncHandler(async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);

    // V9-2.2: ممنوعیت حذف حساب خودی
    if (req.user?.id && Number(req.user.id) === targetUserId) {
      return res.status(409).json({ error: 'حذف حساب کاربری خودی مجاز نیست.' });
    }

    let deletedUserInfo: { fullName: string | null; username: string; role: string } | undefined = undefined;

    await orm.transaction(async (tx) => {
      // v9.0.75 (TD-524): همان قفل مجموعه مدیران ویرایش، پیش از قفل ردیف
      await lockSystemAdminSet(tx);
      const [delUser] = await tx.select().from(users).where(eq(users.id, targetUserId)).for('update');
      if (!delUser || delUser.isDeleted === 1) {
        throw new NotFoundError('کاربر یافت نشد');
      }
      if (touchesAdminAccount(req.user?.role, [delUser.role])) {
        throw new ForbiddenError(ONLY_ADMIN_MANAGES_ADMINS);
      }
      // v9.0.129 (TD-520، ت۳): حسابی که نقشش مجوزی بیش از حذف‌کننده دارد حذف نمی‌شود
      await assertManageableAccount(tx, await grantorPermissions(req.user?.role, tx), delUser.role);

      // ممنوعیت حذف آخرین مدیر فعال سیستم (قفل‌شدن سامانه)
      if (delUser.role === SYSTEM_ADMIN_ROLE) {
        await assertAnotherActiveAdmin(tx, targetUserId, 'delete');
      }

      // Soft-Delete + ابطال فوری تمام نشست‌های فعال (افزایش tokenVersion)
      await tx.update(users).set({
        isDeleted: 1,
        tokenVersion: (delUser.tokenVersion || 0) + 1
      }).where(eq(users.id, targetUserId));

      deletedUserInfo = { fullName: delUser.fullName, username: delUser.username, role: delUser.role };
    });

    const finalInfo = deletedUserInfo!;
    await logActivity({
      req,
      action: 'DELETE',
      entity: 'کاربران سیستم',
      entityId: targetUserId,
      description: `حذف کاربر "${finalInfo.fullName || finalInfo.username}" (نام کاربری: ${finalInfo.username}، نقش: ${finalInfo.role})`,
      details: {
        before: {
          id: targetUserId,
          username: finalInfo.username,
          fullName: finalInfo.fullName,
          role: finalInfo.role
        },
        softDeleted: true,
        sessionsRevoked: true,
        deletedAt: new Date().toISOString()
      }
    });

    res.json({ success: true });
  } catch (err) {
    throw err;
  }
}));

export default router;

