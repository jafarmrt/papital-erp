import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { users, roles } from '../db/schema.js';
import { authenticateToken, generateToken, generateCsrfToken, AUTH_COOKIE_NAME, getAuthCookieOptions, sessionLifetimeOfRole, shouldExposeTokenInBody } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorizePermission } from '../middleware/authorize.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { AVATAR_INVALID_MESSAGE, FULL_NAME_MAX_LENGTH, FULL_NAME_TOO_LONG_MESSAGE, isAcceptableAvatar } from '../lib/users/profileFields.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { PERMISSION_CATALOG, PERMISSION_KEYS, isSystemAdminRole } from '../lib/permissions/permissionCatalog.js';
import { createRole, deleteRole, updateRole } from '../services/users/roleAdmin.service.js';
import { createUser, deleteUser, restoreUser, updateOwnProfile, updateUser } from '../services/users/userAccount.service.js';
import { workflowsRequiringRole } from '../services/workflow/transitionRoles.js';
import { roleDisplayName } from '../lib/users/roleDisplayName.js';
import { MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE } from '../lib/auth/passwordPolicy.js';
import { NotFoundError, UnauthorizedError } from '../errors/customErrors.js';

const router = Router();
router.use(authenticateToken); // Protect all user routes

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
  const user = req.user;
  if (!user) throw new UnauthorizedError('غیر مجاز');

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
}));

// Profile endpoints (Any authenticated user can manage their profile)
router.get('/users/profile', asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError('غیر مجاز');
  const [u] = await orm.select().from(users).where(eq(users.id, userId));
  if (!u) throw new NotFoundError('کاربر یافت نشد', undefined, 'USER_NOT_FOUND');
  const { password: _, ...userInfo } = u;
  res.json({
    ...userInfo,
    full_name: u.fullName,
    avatar_url: u.avatarUrl || ''
  });
}));

router.put('/users/profile', validate(updateProfileSchema), asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError('غیر مجاز');
  const { user: updatedUser, passwordChanged } = await updateOwnProfile(req, userId, req.body);

  // v9.0.218 (TD-531): نسخه توکن بالا رفت و نشست‌های دیگر کاربر باطل‌اند؛ همین نشست با توکن تازه ادامه می‌یابد، وگرنه
  // پس از پیام موفقیت، درخواست بعدی ۴۰۱ می‌گرفت
  let session: { token: string; csrfToken: string } | null = null;
  if (passwordChanged) {
    const csrfToken = req.user?.csrfToken || generateCsrfToken();
    const lifetime = await sessionLifetimeOfRole(updatedUser.role);
    const token = generateToken({ id: updatedUser.id, username: updatedUser.username, role: updatedUser.role ?? '', csrfToken, tokenVersion: updatedUser.tokenVersion || 0 }, lifetime);
    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(req, lifetime));
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
}));

// Permissions catalog route
router.get('/permissions', authorizePermission(...READ_PERMISSIONS.permissionCatalog), asyncHandler(async (req, res) => {
  res.json(PERMISSION_CATALOG);
}));

// ROLES MANAGEMENT ROUTES
router.get('/roles', authorizePermission(...READ_PERMISSIONS.userDirectory), asyncHandler(async (req, res) => {
  const allRoles = await orm.select().from(roles).orderBy(roles.id);
  // v9.0.136 (TD-886، قاعده ۳ مدل مجوز): «مدیر سیستم» همیشه همه مجوزها را دارد؛ فهرست آن محاسبه می‌شود، نه خوانده
  res.json(allRoles.map(r => (isSystemAdminRole(r.code) ? { ...r, permissions: [...PERMISSION_KEYS] } : r)));
}));

router.post('/roles', authorizePermission('roles.manage'), validate(createRoleSchema), asyncHandler(async (req, res) => {
  // v10.0.49 (L5 E7): the role and its audit row are written in one transaction by the role service
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
}));

router.post('/users', authorizePermission('users.manage'), validate(userCreateSchema), asyncHandler(async (req, res) => {
  res.json(await createUser(req, req.body));
}));

router.put('/users/:id', authorizePermission('users.manage'), validate(userUpdateSchema), asyncHandler(async (req, res) => {
  await updateUser(req, Number(req.params.id), req.body);
  res.json({ success: true });
}));

// v9.0.178 (TD-519): بازگرداندن همان کاربر حذف‌شده (`restoreUser`)
router.post('/users/:id/restore', authorizePermission('users.manage'), validate(userRestoreSchema), asyncHandler(async (req, res) => {
  res.json(await restoreUser(req, Number(req.params.id), req.body));
}));

router.delete('/users/:id', authorizePermission('users.manage'), validate(userParamsSchema), asyncHandler(async (req, res) => {
  await deleteUser(req, Number(req.params.id));
  res.json({ success: true });
}));

export default router;

