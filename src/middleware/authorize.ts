import { Request, Response, NextFunction, RequestHandler } from 'express';
import { orm } from '../db/drizzle.js';
import { roles } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { rolePermissionsCache } from '../lib/memoryCache.js';
import { asyncHandler } from './asyncHandler.js';
import { isCatalogPermission, SYSTEM_ADMIN_ROLE } from '../lib/permissions/permissionCatalog.js';

async function getCachedRoleData(roleCode: string) {
  return rolePermissionsCache.getOrSet(roleCode, async () => {
    const [roleRecord] = await orm.select().from(roles).where(eq(roles.code, roleCode));
    if (!roleRecord) return null;
    return {
      permissions: Array.isArray(roleRecord.permissions) ? (roleRecord.permissions as string[]) : [],
      isSystem: roleRecord.isSystem ?? 0
    };
  }, 60_000);
}

/**
 * v7.0.51 (audit P2-10): کد نقش و کلید مجوز دو فضای نام جدا هستند. کلید مجوز همیشه نقطه دارد (`customers.manage`)
 * و کد نقش هرگز (`ROLE_CODE_PATTERN`، بررسی در ساخت نقش). پیش‌تر کد نقش کاربر با همه ورودی‌های گارد مقایسه می‌شد،
 * پس نقشی با کد `customers.manage` هر مسیری را که این مجوز لازم داشت باز می‌کرد، بدون آن‌که مجوز را داشته باشد.
 * اکنون کد نقش فقط با ورودی‌های بدون نقطه (نام نقش) و مجوزهای نقش فقط با کلیدهای مجوز سنجیده می‌شوند.
 */
export const ROLE_CODE_PATTERN = /^[a-z0-9_-]+$/;

export function isPermissionKey(entry: string): boolean {
  return entry.includes('.');
}

/**
 * مجوزهای نقش (از کش ۶۰ ثانیه‌ای). v9.0.97 (TD-516): `*` دیگر چیزی نمی‌دهد؛ مهاجرت 0062 آن را در نقش‌های موجود با
 * همه کلیدهای فهرست جایگزین کرده است و ساخت تازه‌اش از v8.0.57 (TD-304) رد می‌شود.
 */
async function roleHoldsAny(role: string, permissionKeys: readonly string[]): Promise<boolean> {
  const roleData = await getCachedRoleData(role);
  const perms: string[] = roleData?.permissions || [];
  return permissionKeys.some(k => perms.includes(k));
}

/**
 * v9.0.87 (TD-881، مدل مجوز §۴.۲): تنها بررسی دسترسی بر پایه مجوز. «مدیر سیستم» همه را دارد؛ هر کاربر دیگر فقط وقتی
 * نقشش یکی از کلیدها را دارد. کد نقش هرگز پرسیده نمی‌شود: ورودی بی‌نقطه خطای برنامه‌نویسی است و پرتاب می‌شود.
 */
export async function can(user: { role?: string } | undefined, ...permissionKeys: string[]): Promise<boolean> {
  const notKeys = permissionKeys.filter(k => !isPermissionKey(k));
  if (permissionKeys.length === 0 || notKeys.length > 0) {
    throw new TypeError(`can() accepts permission keys only, got: ${notKeys.join(', ') || '(none)'}`);
  }
  if (!user?.role) return false;
  if (user.role === SYSTEM_ADMIN_ROLE) return true;
  return roleHoldsAny(user.role, permissionKeys);
}

/**
 * نشانه گارد روی میدل‌ور، برای استخراج جدول «مسیر ← مجوز» از روترها (`src/lib/routeGuardTable.ts`).
 * کلید رشته‌ای است نه Symbol: express-async-errors هر هندلر را می‌پوشاند و فقط کلیدهای رشته‌ای را کپی می‌کند.
 */
export const GUARD_ENTRIES = '__erpRouteGuardEntries';

function tagGuard(entries: string[], mw: RequestHandler): RequestHandler {
  return Object.assign(mw, { [GUARD_ENTRIES]: [...entries] });
}

/**
 * v9.0.97 (TD-516، تصمیم ت۱ و فهرست تأییدشده M2): گارد کارهای نگهداری سامانه که فقط «مدیر سیستم» انجام می‌دهد
 * (پشتیبان‌گیری، پاک کردن داده، پاک‌سازی سجل و پیوست‌ها، بازگرداندن پیش‌فرض‌ها، سلامت سامانه). جای `authorize`
 * را گرفت که کد نقش را هم می‌پذیرفت؛ هیچ گارد دیگری کد نقش نمی‌پرسد.
 */
export const requireSystemAdmin: RequestHandler = tagGuard([SYSTEM_ADMIN_ROLE], (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    res.status(401).json({ error: 'احراز هویت انجام نشده است' });
    return;
  }
  if (req.user.role === SYSTEM_ADMIN_ROLE) {
    next();
    return;
  }
  res.status(403).json({ error: 'این کار فقط برای مدیر سیستم مجاز است' });
});

/**
 * v9.0.87 (TD-881): گارد route فقط با کلیدهای کاتالوگ مجوز. کلید بیرون از کاتالوگ یا کد نقش هنگام ساختن روتر
 * (راه‌اندازی سرور) خطا می‌دهد، پس گاردی که هیچ نقشی نمی‌تواند بگیرد ساخته نمی‌شود. عبور با `can`.
 */
export const requirePermission = (...permissionKeys: string[]) => {
  const invalid = permissionKeys.filter(k => !isCatalogPermission(k));
  if (permissionKeys.length === 0 || invalid.length > 0) {
    throw new TypeError(`requirePermission() accepts permission catalog keys only, got: ${invalid.join(', ') || '(none)'}`);
  }
  return tagGuard(permissionKeys, asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'احراز هویت انجام نشده است' });
    }

    try {
      if (await can(user, ...permissionKeys)) {
        return next();
      }

      return res.status(403).json({ error: `شما مجوز لازم (${permissionKeys.join(' یا ')}) برای انجام این کار را ندارید` });
    } catch (err) {
      return res.status(500).json({ error: 'خطا در بررسی مجوز دسترسی' });
    }
  }));
};

/** نام قدیمی همان گارد `requirePermission` (۲۰۵ route)؛ گارد تازه `requirePermission` را به کار ببرد */
export const authorizePermission = requirePermission;

/**
 * v7.0.26 (TD-184): بررسی برنامه‌ای مجوز برای منطق سرویس‌ها (مثلاً مجوز سطح کلید در تنظیمات). v9.0.97 (TD-516):
 * فقط کلید مجوز و همان `can`؛ خطای خواندن نقش بی‌دسترسی است. کد تازه `can` را به کار ببرد.
 */
export async function userHasRoleOrPermission(
  user: { role?: string } | undefined,
  ...permissionKeys: string[]
): Promise<boolean> {
  try {
    return await can(user, ...permissionKeys);
  } catch (err) {
    if (err instanceof TypeError) throw err;
    return false;
  }
}
