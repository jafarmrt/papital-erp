import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { users, appSettings } from '../db/schema.js';
import { generateToken, generateCsrfToken, AUTH_COOKIE_NAME, getAuthCookieOptions, authenticateToken } from '../middleware/auth.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { uploadBase64ToStorage } from '../lib/storage.js';
import { logActivity } from '../lib/auditLogger.js';
import { logger } from '../middleware/logger.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { UnauthorizedError, BadRequestError, ConflictError, AppError } from '../errors/customErrors.js';

const router = Router();

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MIN = 30;

export async function checkAccountLockout(username: string): Promise<{ isLocked: boolean; remainingMinutes?: number }> {
  try {
    const [u] = await orm.select().from(users).where(eq(users.username, username)).limit(1);
    if (!u) return { isLocked: false };
    if (u.lockedUntil) {
      const lockDate = new Date(u.lockedUntil);
      const now = new Date();
      if (lockDate > now) {
        const remainingMs = lockDate.getTime() - now.getTime();
        const remainingMinutes = Math.max(1, Math.ceil(remainingMs / (60 * 1000)));
        return { isLocked: true, remainingMinutes };
      }
    }
    return { isLocked: false };
  } catch (err: any) {
    logger.error(`[Account Lockout Check Error] ${err.message}`);
    return { isLocked: false };
  }
}

export async function recordFailedAttempt(username: string): Promise<{ locked: boolean; remainingAttempts: number; remainingMinutes?: number }> {
  try {
    const [u] = await orm.select().from(users).where(eq(users.username, username)).limit(1);
    if (!u) return { locked: false, remainingAttempts: 0 };
    
    // If account was already locked and lock expired, reset count to 0 first
    let currentCount = u.failedLoginCount || 0;
    if (u.lockedUntil && new Date(u.lockedUntil) <= new Date()) {
      currentCount = 0;
    }
    
    const newFailedCount = currentCount + 1;
    const isLocked = newFailedCount >= LOCKOUT_THRESHOLD;
    const lockedUntil = isLocked 
      ? new Date(Date.now() + LOCKOUT_DURATION_MIN * 60 * 1000).toISOString()
      : null;
    
    await orm.update(users).set({ 
      failedLoginCount: newFailedCount,
      lockedUntil: lockedUntil 
    }).where(eq(users.id, u.id));

    if (isLocked) {
      logger.warn(`[Account Lockout] User ${username} (ID ${u.id}) locked out for ${LOCKOUT_DURATION_MIN} minutes after ${newFailedCount} failed attempts`);
      return { locked: true, remainingAttempts: 0, remainingMinutes: LOCKOUT_DURATION_MIN };
    }

    const remaining = Math.max(0, LOCKOUT_THRESHOLD - newFailedCount);
    return { locked: false, remainingAttempts: remaining };
  } catch (err: any) {
    logger.error(`[Record Failed Attempt Error] ${err.message}`);
    return { locked: false, remainingAttempts: 0 };
  }
}

export async function resetFailedAttempts(userIdOrUsername: number | string): Promise<void> {
  try {
    if (typeof userIdOrUsername === 'number') {
      await orm.update(users).set({ 
        failedLoginCount: 0,
        lockedUntil: null 
      }).where(eq(users.id, userIdOrUsername));
    } else {
      await orm.update(users).set({ 
        failedLoginCount: 0,
        lockedUntil: null 
      }).where(eq(users.username, String(userIdOrUsername).trim()));
    }
  } catch (err: any) {
    logger.error(`[Reset Failed Attempts Error] ${err.message}`);
  }
}

const loginSchema = z.object({
  body: z.object({
    username: z.string().min(1, 'نام کاربری الزامی است'),
    password: z.string().min(1, 'رمز عبور الزامی است'),
  })
});

// Login
router.get('/check-setup', asyncHandler(async (req, res) => {
  const { sql, inArray } = await import('drizzle-orm');
  let count = 0;
  try {
    const result = await orm.select({ count: sql<number>`count(*)` })
      .from(users)
      .where(sql`${users.username} NOT ILIKE 'testuser_%' AND ${users.username} NOT ILIKE 'test_%' AND ${users.username} NOT ILIKE 'e2e_%'`);
    count = Number(result[0]?.count || 0);
  } catch (dbErr: any) {
    // If table doesn't exist yet, run seed to create tables and retry
    const { runSeed } = await import('../db/seed.js');
    await runSeed();
    const result = await orm.select({ count: sql<number>`count(*)` })
      .from(users)
      .where(sql`${users.username} NOT ILIKE 'testuser_%' AND ${users.username} NOT ILIKE 'test_%' AND ${users.username} NOT ILIKE 'e2e_%'`);
    count = Number(result[0]?.count || 0);
  }
  
  let companyName = '';
  let companyLogo = '';

  if (count > 0) {
    const settings = await orm.select().from(appSettings).where(inArray(appSettings.key, ['company_name', 'company_logo']));
    const rawName = settings.find(s => s.key === 'company_name')?.value || '';
    companyName = (rawName === 'سامانه انبارداری' || rawName === 'سامانه انبار پاپیتال') ? 'سامانه جامع ERP پاپیتال' : (rawName || 'سامانه جامع ERP پاپیتال');
    companyLogo = settings.find(s => s.key === 'company_logo')?.value || '';
  }

  res.json({ 
    isSetup: count > 0,
    companyName,
    companyLogo
  });
}));

router.get('/public-settings', asyncHandler(async (req, res) => {
  const { inArray } = await import('drizzle-orm');
  let settings: { key: string; value: string }[] = [];
  try {
    settings = await orm.select().from(appSettings).where(inArray(appSettings.key, ['company_name', 'company_logo', 'currency']));
  } catch {
    const { runSeed } = await import('../db/seed.js');
    await runSeed();
    settings = await orm.select().from(appSettings).where(inArray(appSettings.key, ['company_name', 'company_logo', 'currency']));
  }
  const rawName = settings.find(s => s.key === 'company_name')?.value || '';
  const name = (rawName === 'سامانه انبارداری' || rawName === 'سامانه انبار پاپیتال') ? 'سامانه جامع ERP پاپیتال' : (rawName || 'سامانه جامع ERP پاپیتال');
  const logo = settings.find(s => s.key === 'company_logo')?.value || '';
  const currency = settings.find(s => s.key === 'currency')?.value || 'IRR';

  res.json({
    companyName: name,
    companyLogo: logo,
    currency,
    settings
  });
}));

const setupSchema = z.object({
  body: z.object({
    username: z.string().min(3, 'نام کاربری باید حداقل ۳ کاراکتر باشد'),
    password: z.string().min(6, 'رمز عبور باید حداقل ۶ کاراکتر باشد'),
    fullName: z.string().min(1, 'نام و نام خانوادگی الزامی است'),
    companyName: z.string().optional().default(''),
    warehouseName: z.string().optional().default('انبار مرکزی'),
    phone: z.string().optional().default(''),
    address: z.string().optional().default(''),
    logo: z.string().optional().default(''),
    currency: z.string().optional().default('IRR'),
    setupToken: z.string().optional(),
  })
});

router.post('/setup', validate(setupSchema), asyncHandler(async (req, res) => {
  // 1. Enforce setup token (SEC-012)
  const setupToken = process.env.ERP_SETUP_TOKEN;
  if (!setupToken) {
    throw new AppError('Setup token not configured. Set ERP_SETUP_TOKEN env var.', 503, 'SERVICE_UNAVAILABLE');
  }

  const headerToken = req.headers['x-setup-token'] as string;
  const bodyToken = req.body?.setupToken as string;
  const providedToken = (headerToken || bodyToken || '').trim();

  if (!providedToken || providedToken !== setupToken.trim()) {
    logger.warn(`[Setup] Unauthorized setup attempt with invalid or missing token from IP: ${req.ip}`);
    throw new UnauthorizedError('Invalid setup token');
  }

  // 2. PostgreSQL advisory lock (79234) to prevent race conditions (SEC-012)
  const { sql } = await import('drizzle-orm');
  const lockResult: any = await orm.execute(sql`SELECT pg_try_advisory_lock(79234) AS acquired`);
  const rows = lockResult?.rows || (Array.isArray(lockResult) ? lockResult : []);
  const isAcquired = Boolean(rows[0]?.acquired === true || rows[0]?.acquired === 't');

  if (!isAcquired) {
    throw new ConflictError('Another setup is in progress. Please wait.');
  }

  try {
    // 3. Race-safe check for existing admin users
    const [{ count }] = await orm.select({ count: sql<number>`count(*)` })
      .from(users)
      .where(sql`${users.username} NOT ILIKE 'testuser_%' AND ${users.username} NOT ILIKE 'test_%' AND ${users.username} NOT ILIKE 'e2e_%'`);
    
    if (Number(count) > 0) {
      throw new BadRequestError('سیستم قبلاً راه اندازی شده است');
    }

    // Clean up any residual test artifacts before creating initial admin
    // TST-001: computed specifier keeps src/tests out of the production bundle
    try {
      const spec = ['..', 'tests', 'fixtures', 'dbTestHelper.js'].join('/');
      const { cleanupAllTestFixtures } = await import(/* @vite-ignore */ spec);
      await cleanupAllTestFixtures();
    } catch {
      // Non-blocking
    }

    const { username, password, fullName, companyName, warehouseName, phone, address, logo, currency } = req.body;
    const tUsername = (username || '').trim();
    const hash = bcrypt.hashSync(password, 10);

    let logoPath = logo || '';
    if (logoPath && logoPath.startsWith('data:image')) {
      // پیشوند 'logo' → فایل لوگو در /uploads عمومی سرو می‌شود (صفحه ورود بدون نشست)
      logoPath = await uploadBase64ToStorage(logoPath, 'image', 'logo');
    }

    const [user] = await orm.insert(users).values({
      username: tUsername,
      password: hash,
      fullName,
      role: 'admin',
    }).returning();

    // Create the default warehouse from setup
    const { warehouses } = await import('../db/schema.js');
    await orm.insert(warehouses).values({
      name: warehouseName || 'انبار مرکزی',
      code: 'main',
      isActive: 1
    }).onConflictDoNothing();

    // Save company business settings
    const companySettings = [
      { key: 'company_name', value: companyName || 'سامانه جامع ERP پاپیتال' },
      { key: 'company_phone', value: phone || '' },
      { key: 'company_address', value: address || '' },
      { key: 'company_logo', value: logoPath || '' },
      { key: 'currency', value: currency || 'IRR' },
      { key: 'display_timezone', value: process.env.DISPLAY_TIMEZONE || 'Asia/Tehran' }
    ];

    for (const item of companySettings) {
      await orm.insert(appSettings).values(item)
        .onConflictDoUpdate({ target: appSettings.key, set: { value: item.value } });
    }

    const token = generateToken({ id: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion || 0 });
    const { password: _, ...userWithoutPassword } = user;
    
    // Set secure HttpOnly cookie
    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(req));

    res.json({ success: true, user: { ...userWithoutPassword, full_name: user.fullName || user.username }, token });
  } finally {
    // 4. Always release the advisory lock
    try {
      await orm.execute(sql`SELECT pg_advisory_unlock(79234)`);
    } catch (unlockErr: any) {
      logger.warn(`[Setup] Error releasing advisory lock 79234: ${unlockErr?.message || unlockErr}`);
    }
  }
}));

router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const tUsername = (username || '').trim();
  
  // Check account lockout status (SEC-009)
  const lockout = await checkAccountLockout(tUsername);
  if (lockout.isLocked) {
    logger.warn(`[Login Rejected] Account ${tUsername} is locked for ${lockout.remainingMinutes} more minutes`);
    return res.status(429).json({ 
      error: `حساب کاربری به دلیل تلاش‌های ناموفق مکرر قفل شده است. لطفاً ${lockout.remainingMinutes} دقیقه دیگر تلاش فرمایید.`,
      locked: true,
      remainingMinutes: lockout.remainingMinutes
    });
  }

  const [user] = await orm.select().from(users).where(eq(users.username, tUsername)).limit(1);

  // V9-2.2: کاربران حذف‌شده (soft-delete) امکان ورود ندارند
  if (user && user.isDeleted === 1) {
    return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
  }

  if (user) {
    let isMatch = false;
    const isBcryptHash = user.password && (user.password.startsWith('$2a$') || user.password.startsWith('$2b$') || user.password.startsWith('$2y$'));
    
    if (isBcryptHash) {
      isMatch = bcrypt.compareSync(password, user.password);
    } else {
      // Plain-text passwords are strictly disallowed for login (SEC-008). 
      // All passwords must be bcrypt hashed via startup migration or user reset.
      isMatch = false;
    }

    if (isMatch) { 
      // Reset failed login attempts on successful authentication
      await resetFailedAttempts(user.id);

      const csrfToken = generateCsrfToken();
      const token = generateToken({ id: user.id, username: user.username, role: user.role, csrfToken, tokenVersion: user.tokenVersion || 0 });
      const { password: _, ...userWithoutPassword } = user;
      
      // Set secure HttpOnly cookie
    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(req));

      await logActivity({
        userId: user.id,
        username: user.username,
        userFullName: user.fullName || user.username,
        action: 'LOGIN',
        entity: 'کاربر',
        entityId: user.id,
        description: `ورود موفق کاربر ${user.fullName || user.username} به سامانه`,
        ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip || ''
      });

      res.json({ 
        success: true, 
        user: { 
          ...userWithoutPassword, 
          full_name: user.fullName || user.username, 
          avatar_url: user.avatarUrl || '',
          mustResetPassword: Boolean(user.mustResetPassword),
          must_reset_password: Boolean(user.mustResetPassword)
        }, 
        token,
        csrfToken
      });
    } else {
      const failStatus = await recordFailedAttempt(tUsername);
      if (failStatus.locked) {
        return res.status(429).json({ 
          error: `حساب کاربری شما پس از ۵ تلاش ناموفق به مدت ${failStatus.remainingMinutes} دقیقه قفل شد.`,
          locked: true,
          remainingMinutes: failStatus.remainingMinutes
        });
      }
      res.status(401).json({ 
        error: `نام کاربری یا رمز عبور اشتباه است.${failStatus.remainingAttempts > 0 ? ` (${failStatus.remainingAttempts} تلاش باقی‌مانده)` : ''}`,
        remainingAttempts: failStatus.remainingAttempts
      });
    }
  } else {
    res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
  }
}));

// Logout endpoint - Clears the HttpOnly auth cookie
const logoutHandler = asyncHandler(async (req: any, res: any) => {
  const user = req.user;
  if (user) {
    await logActivity({
      userId: user.id,
      username: user.username,
      userFullName: user.fullName || user.username,
      action: 'LOGIN',
      entity: 'کاربر',
      entityId: user.id,
      description: `خروج کاربر ${user.fullName || user.username} از سامانه`,
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip || ''
    });
  }

  res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieOptions(req));

  res.json({ success: true, message: 'خروج از حساب با موفقیت انجام شد' });
});

router.post('/logout', logoutHandler);
router.post('/auth/logout', logoutHandler);

// Check current session endpoint
const meHandler = asyncHandler(async (req: any, res: any) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new UnauthorizedError('کاربر احراز هویت نشده است');
  }

  const [user] = await orm.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.isDeleted === 1) {
    throw new UnauthorizedError('حساب کاربری یافت نشد یا حذف شده است');
  }

  const token = generateToken({ id: user.id, username: user.username, role: user.role, csrfToken: req.user?.csrfToken, tokenVersion: user.tokenVersion || 0 });
  const { password: _, ...userWithoutPassword } = user;
  res.json({
    authenticated: true,
    user: {
      ...userWithoutPassword,
      full_name: user.fullName || user.username,
      avatar_url: user.avatarUrl || '',
      mustResetPassword: Boolean(user.mustResetPassword),
      must_reset_password: Boolean(user.mustResetPassword)
    },
    token,
    csrfToken: req.user?.csrfToken || req.csrfToken || ''
  });
});

router.get('/auth/me', authenticateToken, meHandler);
router.get('/me', authenticateToken, meHandler);

export default router;
