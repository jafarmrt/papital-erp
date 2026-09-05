import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { eq, desc, ne, and, sql } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { users, roles } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorize, authorizePermission } from '../middleware/authorize.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { logActivity, computeAuditDiff } from '../lib/auditLogger.js';
import { NotFoundError, ConflictError } from '../errors/customErrors.js';
import { uploadBase64ToStorage } from '../lib/storage.js';
import { invalidateRoleCache } from '../lib/memoryCache.js';

const router = Router();
router.use(authenticateToken); // Protect all user routes

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

// System Permissions Definition Catalog
export const PERMISSION_CATALOG = [
  {
    category: 'مدیریت کالا و محصولات',
    permissions: [
      { key: 'products.view', title: 'مشاهده کالاها و موجودی', description: 'دسترسی به لیست کالاها، جزئیات و قیمت‌ها' },
      { key: 'products.create', title: 'تعریف کالای جدید', description: 'امکان اضافه کردن کالا و محصول جدید به انبار' },
      { key: 'products.edit', title: 'ویرایش اطلاعات کالا', description: 'تغییر عنوان، کد، وزن، رنگ و تصویر کالاها' },
      { key: 'products.edit_price', title: 'ویرایش قیمت‌ها', description: 'تغییر قیمت‌های خرید و فروش کالا' },
      { key: 'products.delete', title: 'حذف کالا', description: 'امکان حذف نرم کالا از سیستم' },
    ]
  },
  {
    category: 'انبارداری و جابجایی',
    permissions: [
      { key: 'warehouse.view', title: 'مشاهده انبارها', description: 'مشاهده لیست انبارها و موجودی تفکیکی' },
      { key: 'warehouse.in', title: 'ثبت ورود کالا (رسید)', description: 'افزایش موجودی و ثبت رسیدهای ورودی' },
      { key: 'warehouse.out', title: 'ثبت خروج کالا (حواله)', description: 'کاهش موجودی و ثبت حواله‌های خروجی' },
      { key: 'warehouse.transfer', title: 'جابجایی بین انبارها', description: 'انتقال کالا از یک انبار به انبار دیگر' },
      { key: 'inventory.reconcile', title: 'ممیزی کاردکس و بازسازی انبار', description: 'اجرای بازسازی انبار و تطبیق تراکنش‌ها با لاگ کاردکس' },
    ]
  },
  {
    category: 'اسناد و فاکتورها',
    permissions: [
      { key: 'documents.view', title: 'مشاهده فاکتورها', description: 'مشاهده لیست فاکتورهای فروش و پیش‌فاکتورها' },
      { key: 'documents.create', title: 'صدور فاکتور و پیش‌فاکتور', description: 'ایجاد فاکتور جدید و صدور قبض' },
      { key: 'documents.edit', title: 'ویرایش فاکتورها', description: 'اصلاح اقلام و مشخصات فاکتورهای صادرشده' },
      { key: 'documents.delete', title: 'حذف فاکتور', description: 'حذف فاکتور و برگشت خودکار موجودی کالاها' },
    ]
  },
  {
    category: 'انبارگردانی',
    permissions: [
      { key: 'audit.view', title: 'مشاهده انبارگردانی', description: 'مشاهده دوره‌ها و لاگ‌های انبارگردانی' },
      { key: 'audit.create', title: 'شروع دوره انبارگردانی', description: 'ثبت شمارش واقعی فیزیکی کالاها' },
      { key: 'audit.apply', title: 'اعمال و تسویه مغایرت', description: 'تأیید نهایی و اصلاح خودکار موجودی انبار' },
    ]
  },
  {
    category: 'مدیریت مشتریان',
    permissions: [
      { key: 'customers.view', title: 'مشاهده لیست مشتریان', description: 'مشاهده اطلاعات تماس و سوابق خریداران' },
      { key: 'customers.manage', title: 'مدیریت کامل مشتریان', description: 'افزودن، ویرایش و حذف خریداران' },
    ]
  },
  {
    category: 'کنترل پروژه‌های تولید',
    permissions: [
      { key: 'projects.view', title: 'مشاهده پروژه‌ها و مراحل', description: 'دسترسی به لیست پروژه‌ها، گانت چارت، تخته کانبان و مراحل تولید' },
      { key: 'projects.create', title: 'تعریف پروژه تولید جدید', description: 'ایجاد پروژه، تعیین کد مشتری و کد کالا و مراحل پیش‌فرض' },
      { key: 'projects.edit', title: 'ویرایش پروژه و مراحل تولید', description: 'تغییر وضعیت، پیشرفت، زمان‌بندی، تخصیص پرسنل و منابع هر مرحله' },
      { key: 'projects.delete', title: 'حذف پروژه تولید', description: 'حذف پروژه و مراحل مرتبط با آن' },
    ]
  },
  {
    category: 'جریان‌های کاری و کارتابل تاییدات (Workflow)',
    permissions: [
      { key: 'workflow.view', title: 'مشاهده فرآیندها و کارتابل تاییدات', description: 'دسترسی به کارتابل وظایف، مشاهده وضعیت فرآیندها و سوابق امضاها' },
      { key: 'workflow.execute', title: 'شروع و اجرای فرآیندها', description: 'امکان شروع نمونه فرآیند کاری جدید بر روی اسناد و موجودیت‌ها' },
      { key: 'workflow.approve', title: 'تایید و رد درخواست‌ها در کارتابل', description: 'امکان امضا، تایید یا رد درخواست‌ها در کارتابل و فرآیندهای مجاز' },
      { key: 'workflow.manage', title: 'مدیریت و طراحی جریان‌های کاری', description: 'طراحی گرافیکی فرآیندها، نسخه‌بندی DSL، قوانین Rule Engine و تحلیل SLA' },
      { key: 'workflow.admin', title: 'مدیریت ارشد و همگام‌سازی فرآیندها', description: 'همگام‌سازی الگوهای پیش‌فرض و مدیریت تنظیمات ساختاری فرآیندها' },
    ]
  },
  {
    category: 'گذرگاه رویدادها، صف Outbox و وب‌هوک‌ها',
    permissions: [
      { key: 'events.view', title: 'مشاهده رویدادها و صف Outbox', description: 'مشاهده لاگ رویدادهای دامنه، پیام‌های Outbox و پیام‌های قرنطینه (DLQ)' },
      { key: 'events.manage', title: 'مدیریت قوانین رویدادها و وب‌هوک‌ها', description: 'تعریف اکشن‌های خودکار، تنظیم اشتراک‌های وب‌هوک و Replay پیام‌های DLQ' },
    ]
  },
  {
    category: 'گزارش کار روزانه و اعلان‌ها',
    permissions: [
      { key: 'daily_logs.view', title: 'مشاهده گزارش کارهای روزانه', description: 'مشاهده گزارش کارهای عمومی، منشن‌شده و مجاز' },
      { key: 'daily_logs.create', title: 'ثبت و ویرایش گزارش کار روزانه', description: 'امکان ثبت، ویرایش و حذف گزارش کار روزانه خود' },
      { key: 'daily_logs.manage_all', title: 'مدیریت و نظارت کامل گزارش‌ها', description: 'مشاهده تمامی گزارش کارهای محرمانه و ثبت بازخورد و یادداشت مدیریتی' },
    ]
  },
  {
    category: 'مدیریت ارتباط با مشتریان و فروش (CRM)',
    permissions: [
      { key: 'crm.view', title: 'مشاهده CRM و قیف فروش', description: 'دسترسی به فرصت‌های فروش، قیف کانبان، دفترچه تماس‌ها و پیگیری‌ها' },
      { key: 'crm.manage', title: 'مدیریت پرونده‌ها و تماس‌های CRM', description: 'امکان ثبت، ویرایش، تغییر مراحل فروش و ثبت تماس‌ها و پیگیری‌ها' },
      { key: 'crm.delete', title: 'حذف پرونده‌های فروش', description: 'امکان حذف فرصت‌های فروش و سوابق CRM' },
    ]
  },
  {
    category: 'مدیریت پرسنل و منابع انسانی',
    permissions: [
      { key: 'personnel.view', title: 'مشاهده لیست و پرونده پرسنل', description: 'دسترسی به مشاهده مشخصات فردی، شغلی، حساب‌های بانکی و مهارت‌های پرسنل' },
      { key: 'personnel.manage', title: 'مدیریت کامل پرسنل', description: 'امکان ثبت، ویرایش، قطع همکاری و حذف مشخصات پرسنل' },
    ]
  },
  {
    category: 'دستمرزد و کارهای پرکیسی (Piecework)',
    permissions: [
      { key: 'piecework.view', title: 'مشاهده تعرفه‌ها و گزارش‌های پرکیسی', description: 'مشاهده لیست عناوین کاری، نرخ‌ها، ثبت کارکردها و فیش‌های حقوقی' },
      { key: 'piecework.manage_tasks', title: 'مدیریت عناوین کاری و نرخ‌های پایه', description: 'تعریف و ویرایش کارهای پرکیسی، دسته‌بندی‌ها و نرخ پایه' },
      { key: 'piecework.log', title: 'ثبت و ویرایش کارکرد پرسنل', description: 'ثبت کارکرد روزانه پرسنل و تخصیص به پروژه‌ها' },
      { key: 'piecework.payroll', title: 'محاسبه و صدور فیش حقوقی', description: 'محاسبه کارکرد، کسر مساعده/مساعده و صدور تسویه‌حساب پرکیسی' },
    ]
  },
  {
    category: 'مواد اولیه در انتظار تایید',
    permissions: [
      { key: 'pending_materials.view', title: 'مشاهده درخواست‌های مواد اولیه', description: 'مشاهده پیشنهادها و ثبت مواد اولیه توسط کاربران' },
      { key: 'pending_materials.approve', title: 'تایید و تبدیل به کالا/انبار', description: 'تایید درخواست‌های مواد اولیه و انتقال به انبار اصلی یا رد درخواست' },
    ]
  },
  {
    category: 'حسابداری، اسناد مالی و خزانه‌داری',
    permissions: [
      { key: 'accounting.view', title: 'مشاهده اسناد و دفاتر حسابداری', description: 'دسترسی به اسناد دوبل، دفتر روزنامه، کل، معین و گزارش‌ها' },
      { key: 'accounting.vouchers', title: 'صدور و ویرایش اسناد حسابداری', description: 'امکان ثبت اسناد دوبل مالی، اصلاح و تأیید اسناد' },
      { key: 'accounting.coa', title: 'مدیریت کدینگ حساب‌ها (COA)', description: 'تعریف، ویرایش و حذف حساب‌های گروه، کل، معین و تفصیلی' },
      { key: 'accounting.treasury', title: 'عملیات خزانه‌داری (دریافت و پرداخت)', description: 'ثبت و پیگیری نقدینگی، حساب‌های بانکی، پوز و حواله‌ها' },
      { key: 'accounting.cheques', title: 'مدیریت دفتر چک صیادی', description: 'ثبت چک‌های دریافتی/پرداختی، تغییر وضعیت وصول، برگشت و واگذاری' },
      { key: 'accounting.reports', title: 'مشاهده تراز آزمایشی و صورت‌های مالی', description: 'مشاهده تراز آزمایشی، ترازنامه، صورت سود و زیان و کارت حساب' },
    ]
  },
  {
    category: 'یکپارچه‌سازی فروشگاه آنلاین (WooCommerce)',
    permissions: [
      { key: 'woocommerce.view', title: 'مشاهده وضعیت اتصال و سفارشات ووکامرس', description: 'مشاهده همگام‌سازی محصولات، کدهای SKU و لاگ سفارشات واردشده' },
      { key: 'woocommerce.manage', title: 'تنظیمات API و همگام‌سازی دستی', description: 'تنظیم کلیدهای API ووکامرس، وب‌هوک‌ها و اجرای همگام‌سازی خودکار' },
    ]
  },
  {
    category: 'گزارش‌ها و لاگ فعالیت سیستم (Audit Trail)',
    permissions: [
      { key: 'reports.view', title: 'مشاهده گزارش‌ها و آمار', description: 'دسترسی به نمودارها، گزارش تراکنش‌ها و داشبورد' },
      { key: 'audit_logs.view', title: 'مشاهده دفترچه سوابق تغییرات', description: 'مشاهده لاگ ثبت، ویرایش، حذف و فعالیت‌های تمامی کاربران سیستم' },
    ]
  },
  {
    category: 'مدیریت سیستم و دسترسی‌ها',
    permissions: [
      { key: 'users.manage', title: 'مدیریت کاربران', description: 'تعریف کاربران جدید و تغییر رمز عبور' },
      { key: 'roles.manage', title: 'مدیریت نقش‌ها و ماتریس دسترسی', description: 'تعریف نقش‌های جدید و تنظیم مجوزهای تفکیکی' },
      { key: 'settings.manage', title: 'مدیریت تنظیمات عمومی', description: 'تنظیمات شرکت، لوگو و عیب‌یابی سلامت سرور' },
    ]
  }
];

// Get current user's active permissions array
router.get('/users/my-permissions', async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'غیر مجاز' });

    if (user.role === 'admin') {
      const allPermKeys = PERMISSION_CATALOG.flatMap(c => c.permissions.map(p => p.key));
      return res.json({ role: 'admin', permissions: allPermKeys, isAdmin: true });
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
});

// Profile endpoints (Any authenticated user can manage their profile)
router.get('/users/profile', async (req, res) => {
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
});

router.put('/users/profile', validate(updateProfileSchema), async (req, res) => {
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
      const isMatch = isBcrypt ? bcrypt.compareSync(current_password, u.password) : false;
      if (!isMatch) {
        return res.status(400).json({ error: 'کلمه عبور فعلی اشتباه است' });
      }
      const salt = bcrypt.genSaltSync(10);
      updateData.password = bcrypt.hashSync(new_password, salt);
      updateData.mustResetPassword = 0;
      // V3.0.6 (BUG-08): با تغییر کلمه عبور، تمام sessionهای قبلی (توکن‌های صادرشده)
      // باطل می‌شوند تا توکن‌های سرقت‌شده پس از تغییر رمز نیز بی‌اعتبار باشند.
      updateData.tokenVersion = (u.tokenVersion || 0) + 1;
      passwordChanged = true;
    }

    if (Object.keys(updateData).length > 0) {
      await orm.update(users).set(updateData).where(eq(users.id, userId));
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
});

// Permissions catalog route
router.get('/permissions', async (req, res) => {
  res.json(PERMISSION_CATALOG);
});

// ROLES MANAGEMENT ROUTES
router.get('/roles', async (req, res) => {
  try {
    const allRoles = await orm.select().from(roles).orderBy(roles.id);
    res.json(allRoles);
  } catch (err) {
    throw err;
  }
});

router.post('/roles', authorizePermission('roles.manage'), validate(createRoleSchema), async (req, res) => {
  try {
    const { name, code, description, permissions } = req.body;

    const slugCode = code.trim().toLowerCase().replace(/\s+/g, '_');

    // Check code uniqueness
    const existing = await orm.select().from(roles).where(eq(roles.code, slugCode));
    if (existing.length > 0) {
      return res.status(400).json({ error: 'نقشی با این کد انگلیسی قبلاً وجود دارد' });
    }

    const [newRole] = await orm.insert(roles).values({
      name,
      code: slugCode,
      description: description || '',
      permissions: Array.isArray(permissions) ? permissions : [],
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
        }
      }
    });

    invalidateRoleCache(slugCode);

    res.json(newRole);
  } catch (err) {
    throw err;
  }
});

router.put('/roles/:id', authorizePermission('roles.manage'), validate(updateRoleSchema), async (req, res) => {
  try {
    const roleId = Number(req.params.id);
    const { name, description, permissions } = req.body;

    const [targetRole] = await orm.select().from(roles).where(eq(roles.id, roleId));
    if (!targetRole) {
      return res.status(404).json({ error: 'نقش یافت نشد' });
    }

    const prevPermissions: string[] = (targetRole.permissions as string[]) || [];
    const newPermissions: string[] = Array.isArray(permissions) ? permissions : prevPermissions;

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
        removedPermissions
      }
    });

    res.json({ success: true });
  } catch (err) {
    throw err;
  }
});

router.delete('/roles/:id', authorizePermission('roles.manage'), validate(paramsIdSchema), async (req, res) => {
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
});

// USERS MANAGEMENT ROUTES
const userCreateSchema = z.object({
  body: z.object({
    username: z.string().min(3, 'نام کاربری باید حداقل ۳ کاراکتر باشد'),
    password: z.string().min(6, 'رمز عبور باید حداقل ۶ کاراکتر باشد'),
    full_name: z.string().optional(),
    role: z.string().min(1, 'انتخاب نقش الزامی است'),
  })
});

const userUpdateSchema = z.object({
  body: z.object({
    password: z.string().min(6, 'رمز عبور باید حداقل ۶ کاراکتر باشد').optional().or(z.literal('')),
    full_name: z.string().optional(),
    role: z.string().min(1, 'انتخاب نقش الزامی است'),
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

router.get('/users/list-simple', async (req, res) => {
  try {
    const allUsers = await orm.select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      avatarUrl: users.avatarUrl
    })
    .from(users)
    .where(sql`${users.isDeleted} = 0 AND ${users.username} NOT ILIKE 'testuser_%' AND ${users.username} NOT ILIKE 'test_%' AND ${users.username} NOT ILIKE 'e2e_%'`)
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
});

router.get('/users', async (req, res) => {
  try {
    const allUsers = await orm.select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      avatarUrl: users.avatarUrl
    })
    .from(users)
    .where(sql`${users.isDeleted} = 0 AND ${users.username} NOT ILIKE 'testuser_%' AND ${users.username} NOT ILIKE 'test_%' AND ${users.username} NOT ILIKE 'e2e_%'`)
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
});

router.get('/users/:id', validate(paramsIdSchema), async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);
    const [u] = await orm.select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      avatarUrl: users.avatarUrl
    })
    .from(users)
    .where(eq(users.id, targetUserId));

    if (!u) {
      return res.status(404).json({ error: 'کاربر یافت نشد' });
    }

    res.json({
      id: u.id,
      username: u.username,
      full_name: u.fullName || u.username,
      fullName: u.fullName || u.username,
      role: u.role,
      avatar_url: u.avatarUrl || '',
      avatarUrl: u.avatarUrl || ''
    });
  } catch (err) {
    throw err;
  }
});

router.post('/users', authorizePermission('users.manage'), validate(userCreateSchema), async (req, res) => {
  try {
    const { username, password, full_name, role } = req.body;
    const tUsername = (username || '').trim();
    
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    const [info] = await orm.insert(users).values({
      username: tUsername,
      password: hashedPassword,
      fullName: full_name,
      role: role
    }).returning({ id: users.id });

    // V9-2.2: ثبت لاگ ممیزی پیش از ارسال پاسخ — جلوگیری از گم‌شدن رکورد ممیزی و خطای headers-sent
    await logActivity({
      req,
      action: 'CREATE',
      entity: 'کاربران سیستم',
      entityId: info.id,
      description: `تعریف کاربر جدید "${full_name || tUsername}" با نام کاربری "${tUsername}" (نقش: ${role})`,
      details: {
        after: {
          id: info.id,
          username: tUsername,
          fullName: full_name,
          role: role
        }
      }
    });

    res.json({ id: info.id, username: tUsername, full_name, role });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('unique constraint') || errMsg.includes('UNIQUE')) {
      res.status(400).json({ error: 'نام کاربری تکراری است' });
    } else {
      throw err;
    }
  }
});

router.put('/users/:id', authorizePermission('users.manage'), validate(userUpdateSchema), async (req, res) => {
  try {
    const { password, full_name, role } = req.body;
    const targetUserId = Number(req.params.id);

    const [prevUser] = await orm.select().from(users).where(eq(users.id, targetUserId));
    if (!prevUser || prevUser.isDeleted === 1) {
      return res.status(404).json({ error: 'کاربر یافت نشد' });
    }

    const updateData: Partial<typeof users.$inferInsert> = { fullName: full_name, role };
    const passwordChanged = Boolean(password && password.trim());
    const roleChanged = Boolean(role && role !== prevUser.role);

    if (passwordChanged) {
      const salt = bcrypt.genSaltSync(10);
      updateData.password = bcrypt.hashSync(password, salt);
      updateData.mustResetPassword = 0;
    }

    // V9-2.2: تغییر نقش یا رمز عبور نشست‌های فعال کاربر هدف را باطل می‌کند (tokenVersion)
    if (passwordChanged || roleChanged) {
      updateData.tokenVersion = (prevUser.tokenVersion || 0) + 1;
    }

    await orm.update(users).set(updateData).where(eq(users.id, targetUserId));

    const { diff, hasChanges } = computeAuditDiff(
      { fullName: prevUser.fullName, role: prevUser.role },
      { fullName: full_name, role: role }
    );

    await logActivity({
      req,
      action: 'UPDATE',
      entity: 'کاربران سیستم',
      entityId: targetUserId,
      description: `ویرایش مشخصات کاربر شناسه #${targetUserId} (${prevUser.username})${passwordChanged ? ' (شامل بازنشانی کلمه عبور)' : ''}`,
      details: {
        userId: targetUserId,
        username: prevUser.username,
        before: { fullName: prevUser.fullName, role: prevUser.role },
        after: { fullName: full_name, role: role },
        changes: diff,
        hasChanges,
        passwordChanged
      }
    });

    res.json({ success: true });
  } catch (err) {
    throw err;
  }
});

router.delete('/users/:id', authorizePermission('users.manage'), validate(userParamsSchema), async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);

    // V9-2.2: ممنوعیت حذف حساب خودی
    if (req.user?.id && Number(req.user.id) === targetUserId) {
      return res.status(409).json({ error: 'حذف حساب کاربری خودی مجاز نیست.' });
    }

    let deletedUserInfo: { fullName: string | null; username: string; role: string } | null = null;

    await orm.transaction(async (tx) => {
      const [delUser] = await tx.select().from(users).where(eq(users.id, targetUserId)).for('update');
      if (!delUser || delUser.isDeleted === 1) {
        throw new NotFoundError('کاربر یافت نشد');
      }

      // ممنوعیت حذف آخرین مدیر فعال سیستم (قفل‌شدن سامانه) — با قفل سطری ردیف‌های ادمین‌ها
      if (delUser.role === 'admin') {
        const adminRows = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, 'admin'), eq(users.isDeleted, 0)))
          .for('update');
        if (adminRows.length <= 1) {
          throw new ConflictError('آخرین مدیر سیستم قابل حذف نیست؛ ابتدا باید مدیر دیگری تعریف شود.');
        }
      }

      // Soft-Delete + ابطال فوری تمام نشست‌های فعال (افزایش tokenVersion)
      await tx.update(users).set({
        isDeleted: 1,
        tokenVersion: (delUser.tokenVersion || 0) + 1
      }).where(eq(users.id, targetUserId));

      deletedUserInfo = { fullName: delUser.fullName, username: delUser.username, role: delUser.role };
    });

    const finalInfo = deletedUserInfo as { fullName: string | null; username: string; role: string };
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
});

export default router;

