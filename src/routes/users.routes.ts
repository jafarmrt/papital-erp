import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { eq, desc } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { users, roles } from '../db/schema.js';
import { authenticateToken, invalidateUserAuthCache } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorizePermission, ROLE_CODE_PATTERN } from '../middleware/authorize.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { logActivity, computeAuditDiff } from '../lib/auditLogger.js';
import { NotFoundError, ForbiddenError, BadRequestError, ValidationError } from '../errors/customErrors.js';
import { lockSystemAdminSet, assertAnotherActiveAdmin, SYSTEM_ADMIN_ROLE } from '../services/users/lastAdminGuard.js';
import { uploadBase64ToStorage } from '../lib/storage.js';
import { invalidateRoleCache } from '../lib/memoryCache.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { PERMISSION_CATALOG, PERMISSION_KEYS, isCatalogPermission, missingRequiredPermissions, withRequiredPermissions } from '../lib/permissions/permissionCatalog.js';
import { isSyntheticTestUsername, SYNTHETIC_USERNAME_REFUSED } from '../lib/syntheticUsers.js';

const router = Router();
router.use(authenticateToken); // Protect all user routes

/**
 * حوزه H (TD-299): نقش admin از همه گاردها می‌گذرد؛ پس دادن یا گرفتن آن، و تغییر رمز یا حذف حساب یک مدیر سیستم،
 * فقط کار مدیر سیستم است. دارنده users.manage بدون این قاعده می‌توانست خود یا کاربر تازه‌ای را admin کند
 * یا رمز مدیر را عوض کند و با آن وارد شود.
 */
const ADMIN_ROLE = 'admin';
const ONLY_ADMIN_MANAGES_ADMINS = 'فقط مدیر سیستم می‌تواند نقش «مدیر سیستم» را بدهد یا بگیرد، یا حساب یک مدیر سیستم را تغییر دهد یا حذف کند';

function touchesAdminAccount(actorRole: string | undefined, targetRoles: Array<string | null | undefined>): boolean {
  return actorRole !== ADMIN_ROLE && targetRoles.some(r => r === ADMIN_ROLE);
}

const updateProfileSchema = z.object({
  body: z.object({
    full_name: z.string().optional(),
    avatar: z.string().optional(),
    current_password: z.string().optional(),
    new_password: z.string().min(8, 'کلمه عبور جدید باید حداقل ۸ کاراکتر باشد').optional().or(z.literal(''))
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

// v9.0.82 (TD-880): کاتالوگ مجوز در فایل مشترک سرور و مرورگر است؛ این بازصادر برای مصرف‌کنندگان قدیمی می‌ماند
export { PERMISSION_CATALOG };

/**
 * حوزه H (TD-304): مجوز تازه نقش فقط از کاتالوگ است (نه «*» و نه کلید ناشناخته). کلیدی که نقش از پیش داشت
 * با ویرایش نقش حذف نمی‌شود و ذخیره را رد نمی‌کند.
 */
function unknownNewPermissions(requested: string[], existing: string[] = []): string[] {
  return requested.filter(p => !isCatalogPermission(p) && !existing.includes(p));
}

const UNKNOWN_PERMISSIONS_ERROR = (keys: string[]) => `مجوز ناشناخته: ${keys.join('، ')}`;

// Get current user's active permissions array
router.get('/users/my-permissions', asyncHandler(async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'غیر مجاز' });

    if (user.role === 'admin') {
      return res.json({ role: 'admin', permissions: [...PERMISSION_KEYS], isAdmin: true });
    }

    const [roleRecord] = await orm.select().from(roles).where(eq(roles.code, user.role));
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
      if (avatar.startsWith('data:image')) {
        const avatarPath = await uploadBase64ToStorage(avatar);
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
      description: `بروزرسانی اطلاعات پروفایل شخصی ${passwordChanged ? 'و تغییر کلمه عبور' : ''}`,
      details: {
        userId,
        username: u.username,
        fullName: updatedUser.fullName,
        passwordChanged,
        avatarUpdated: Boolean(avatar)
      }
    });

    const { password: _, ...userInfo } = updatedUser;
    res.json({
      success: true,
      user: {
        ...userInfo,
        full_name: updatedUser.fullName,
        avatar_url: updatedUser.avatarUrl || ''
      }
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
    res.json(allRoles);
  } catch (err) {
    throw err;
  }
}));

router.post('/roles', authorizePermission('roles.manage'), validate(createRoleSchema), asyncHandler(async (req, res) => {
  try {
    const { name, code, description, permissions } = req.body;
    const requested: string[] = Array.isArray(permissions) ? permissions : [];
    const unknownKeys = unknownNewPermissions(requested);
    if (unknownKeys.length > 0) {
      return res.status(400).json({ error: UNKNOWN_PERMISSIONS_ERROR(unknownKeys) });
    }
    // v9.0.82 (TD-880): هر مجوز با نیازهایش ذخیره می‌شود (مثلاً «ویرایش فاکتورها» با «مشاهده فاکتورها»)
    const addedByRequirement = missingRequiredPermissions(requested);

    const slugCode = code.trim().toLowerCase().replace(/\s+/g, '_');
    // v7.0.51 (audit P2-10): کد نقش نقطه ندارد تا با کلید مجوز (مثل customers.manage) اشتباه گرفته نشود
    if (!ROLE_CODE_PATTERN.test(slugCode)) {
      return res.status(400).json({ error: 'کد نقش فقط می‌تواند حروف کوچک انگلیسی، عدد، خط تیره و زیرخط داشته باشد (نقطه مخصوص نام مجوزهاست)' });
    }

    // Check code uniqueness
    const existing = await orm.select().from(roles).where(eq(roles.code, slugCode));
    if (existing.length > 0) {
      return res.status(400).json({ error: 'نقشی با این کد انگلیسی قبلاً وجود دارد' });
    }

    const [newRole] = await orm.insert(roles).values({
      name,
      code: slugCode,
      description: description || '',
      permissions: withRequiredPermissions(requested),
      isSystem: 0
    }).returning();

    await logActivity({
      req,
      action: 'CREATE',
      entity: 'نقش و دسترسی',
      entityId: newRole.id,
      description: `ایجاد نقش جدید "${name}" با کد "${slugCode}" (${(newRole.permissions as any[])?.length || 0} مجوز)`,
      details: {
        after: {
          id: newRole.id,
          name: newRole.name,
          code: newRole.code,
          description: newRole.description,
          permissions: newRole.permissions
        },
        addedByRequirement
      }
    });

    invalidateRoleCache(slugCode);

    res.json(newRole);
  } catch (err) {
    throw err;
  }
}));

router.put('/roles/:id', authorizePermission('roles.manage'), validate(updateRoleSchema), asyncHandler(async (req, res) => {
  try {
    const roleId = Number(req.params.id);
    const { name, description, permissions } = req.body;

    const [targetRole] = await orm.select().from(roles).where(eq(roles.id, roleId));
    if (!targetRole) {
      return res.status(404).json({ error: 'نقش یافت نشد' });
    }

    const prevPermissions: string[] = (targetRole.permissions as string[]) || [];
    const requested: string[] = Array.isArray(permissions) ? permissions : prevPermissions;
    const unknownKeys = unknownNewPermissions(requested, prevPermissions);
    if (unknownKeys.length > 0) {
      return res.status(400).json({ error: UNKNOWN_PERMISSIONS_ERROR(unknownKeys) });
    }
    // v9.0.82 (TD-880): فهرست تازه با نیازهایش ذخیره می‌شود؛ ویرایش بی فهرست مجوز، فهرست قبلی را دست نمی‌زند
    const addedByRequirement = Array.isArray(permissions) ? missingRequiredPermissions(requested) : [];
    const newPermissions: string[] = Array.isArray(permissions) ? withRequiredPermissions(requested) : prevPermissions;

    const addedPermissions = newPermissions.filter(p => !prevPermissions.includes(p));
    const removedPermissions = prevPermissions.filter(p => !newPermissions.includes(p));

    const updateData: Partial<typeof roles.$inferInsert> = {
      name: name || targetRole.name,
      description: description !== undefined ? description : targetRole.description,
      permissions: newPermissions
    };

    await orm.update(roles).set(updateData).where(eq(roles.id, roleId));
    invalidateRoleCache(targetRole.code);

    await logActivity({
      req,
      action: 'UPDATE',
      entity: 'نقش و دسترسی',
      entityId: roleId,
      description: `ویرایش مجوزها و اطلاعات نقش "${updateData.name}" (${addedPermissions.length} افزوده، ${removedPermissions.length} حذف شده)`,
      details: {
        roleId,
        roleName: updateData.name,
        roleCode: targetRole.code,
        beforePermissions: prevPermissions,
        afterPermissions: newPermissions,
        addedPermissions,
        removedPermissions,
        addedByRequirement
      }
    });

    res.json({ success: true });
  } catch (err) {
    throw err;
  }
}));

router.delete('/roles/:id', authorizePermission('roles.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const roleId = Number(req.params.id);
    const [targetRole] = await orm.select().from(roles).where(eq(roles.id, roleId));
    if (!targetRole) {
      return res.status(404).json({ error: 'نقش یافت نشد' });
    }

    if (targetRole.isSystem === 1 || targetRole.code === 'admin') {
      return res.status(400).json({ error: 'نقش‌های پایه و سیستمی قابل حذف نیستند' });
    }

    // Check if any user is currently assigned this role
    const assignedUsers = await orm.select().from(users).where(eq(users.role, targetRole.code));
    if (assignedUsers.length > 0) {
      return res.status(400).json({ error: `این نقش به ${assignedUsers.length} کاربر تخصیص یافته است و ابتدا باید نقش کاربران تغییر یابد` });
    }

    await orm.delete(roles).where(eq(roles.id, roleId));
    invalidateRoleCache(targetRole.code);

    await logActivity({
      req,
      action: 'DELETE',
      entity: 'نقش و دسترسی',
      entityId: roleId,
      description: `حذف نقش "${targetRole.name}" (کد: ${targetRole.code})`,
      details: {
        before: targetRole,
        deletedAt: new Date().toISOString()
      }
    });

    res.json({ success: true });
  } catch (err) {
    throw err;
  }
}));

// USERS MANAGEMENT ROUTES
const userCreateSchema = z.object({
  body: z.object({
    username: z.string().trim().min(3, 'نام کاربری باید حداقل ۳ کاراکتر باشد'),
    password: z.string().min(6, 'رمز عبور باید حداقل ۶ کاراکتر باشد'),
    full_name: z.string().trim().optional().default(''),
    role: z.string().trim().min(1, 'انتخاب نقش الزامی است'),
  })
});

const userUpdateSchema = z.object({
  body: z.object({
    password: z.string().min(6, 'رمز عبور باید حداقل ۶ کاراکتر باشد').optional().or(z.literal('')),
    full_name: z.string().trim().optional().default(''),
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

router.get('/users/list-simple', asyncHandler(async (req, res) => {
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
      role: u.role,
      avatar_url: u.avatarUrl || ''
    }));
    res.json(mapped);
  } catch (err) {
    throw err;
  }
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
    const tUsername = (username || '').trim();
    // v9.0.76 (TD-521): پیشوند کاربران آزمون رد می‌شود؛ چنین کاربری پیش‌تر در فهرست‌ها پنهان می‌ماند
    if (isSyntheticTestUsername(tUsername)) {
      throw new ValidationError(SYNTHETIC_USERNAME_REFUSED);
    }
    const tFullName = (full_name && String(full_name).trim()) ? String(full_name).trim() : tUsername;

    // ۱. بررسی تکراری نبودن نام کاربری در دیتابیس
    const [existingUser] = await orm.select().from(users).where(eq(users.username, tUsername)).limit(1);
    if (existingUser) {
      if (existingUser.isDeleted === 1) {
        // حساب کاربری قبلاً حذف نرم شده بوده — فعال‌سازی مجدد با مشخصات جدید بدون خطای یکتایی
        // حوزه H (TD-299): نقش همان اعتبارسنجی ساخت کاربر تازه را دارد
        if (role !== ADMIN_ROLE) {
          const [reactivatedRole] = await orm.select().from(roles).where(eq(roles.code, role)).limit(1);
          if (!reactivatedRole) {
            return res.status(400).json({ error: 'نقش انتخاب‌شده در سیستم معتبر نیست' });
          }
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await orm.update(users).set({
          password: hashedPassword,
          fullName: tFullName,
          role: role,
          isDeleted: 0,
          mustResetPassword: 0,
          failedLoginCount: 0,
          lockedUntil: null,
          tokenVersion: (existingUser.tokenVersion || 0) + 1,
        }).where(eq(users.id, existingUser.id));

        invalidateUserAuthCache(existingUser.id);

        await logActivity({
          req,
          action: 'CREATE',
          entity: 'کاربران سیستم',
          entityId: existingUser.id,
          description: `فعال‌سازی و بازتعریف کاربر جدید "${tFullName}" با نام کاربری "${tUsername}" (نقش: ${role})`,
          details: {
            after: {
              id: existingUser.id,
              username: tUsername,
              fullName: tFullName,
              role: role
            }
          }
        });

        return res.json({ id: existingUser.id, username: tUsername, full_name: tFullName, role });
      }
      return res.status(400).json({ error: 'نام کاربری تکراری است' });
    }

    // ۲. اعتبارسنجی نقش انتخابی
    if (role !== 'admin') {
      const [roleRecord] = await orm.select().from(roles).where(eq(roles.code, role)).limit(1);
      if (!roleRecord) {
        return res.status(400).json({ error: 'نقش انتخاب‌شده در سیستم معتبر نیست' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const [info] = await orm.insert(users).values({
      username: tUsername,
      password: hashedPassword,
      fullName: tFullName,
      role: role
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
        }
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
      if (passwordHash) {
        updateData.password = passwordHash;
        updateData.mustResetPassword = 0;
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
          passwordChanged
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

