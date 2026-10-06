import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { users, appSettings } from '../db/schema.js';
import { generateToken, generateCsrfToken, AUTH_COOKIE_NAME, getAuthCookieOptions, authenticateToken, getJwtSecret, JWT_VERIFY_OPTIONS, invalidateUserAuthCache, shouldExposeTokenInBody } from '../middleware/auth.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { logActivity, extractClientIp } from '../lib/auditLogger.js';
import { logger } from '../middleware/logger.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { UnauthorizedError, BadRequestError, ConflictError, ValidationError } from '../errors/customErrors.js';
import { safeCompareTokens } from '../lib/timingSafeCompare.js';
import {
  checkAccountLockout,
  recordFailedAttempt,
  resetFailedAttempts,
  verifyPasswordConstantWork,
  lockoutMessage,
  GENERIC_LOGIN_FAILURE_MESSAGE
} from '../services/auth/loginSecurity.service.js';
import { notSyntheticTestUsername, isSyntheticTestUsername, SYNTHETIC_USERNAME_REFUSED } from '../lib/syntheticUsers.js';

const router = Router();

// v7.0.28 (TD-186 / audit P1-5): منطق قفل حساب به سرویس loginSecurity منتقل شد (RULE 01)؛
// توابع برای سازگاری با تست‌ها و فراخوان‌های موجود دوباره صادر می‌شوند.
export { checkAccountLockout, recordFailedAttempt, resetFailedAttempts } from '../services/auth/loginSecurity.service.js';

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
      .where(notSyntheticTestUsername(users.username));
    count = Number(result[0]?.count || 0);
  } catch (dbErr) {
    // V3.0.7 (TD-065): مسیر عمومی هرگز seed اجرا نمی‌کند — قبلاً خطای DB از یک
    // endpoint بدون احراز هویت به نوشتن در دیتابیس تبدیل می‌شد. خطا گزارش و
    // به‌عنوان «راه‌اندازی نشده» پاسخ داده می‌شود؛ seed فقط از startup/مسیر مدیریتی.
    logger.error(`[check-setup] Database error: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
    count = 0;
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
  } catch (dbErr) {
    // V3.0.7 (TD-065): اجرای seed از مسیر عمومی ممنوع (fail-safe به مقادیر پیش‌فرض)
    logger.error(`[public-settings] Database error: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
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
    password: z.string().min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد'),
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
  // 1. Enforce setup token (SEC-012 / S-4)
  const isProduction = process.env.NODE_ENV === 'production';
  const configuredSetupToken = process.env.ERP_SETUP_TOKEN;

  if (isProduction) {
    if (!configuredSetupToken || configuredSetupToken.trim() === 'papital_erp_setup_token_2026' || configuredSetupToken.trim().length < 16) {
      logger.error(`[Setup] ERP_SETUP_TOKEN is not securely configured in production environment (IP: ${req.ip})`);
      throw new UnauthorizedError('راه‌اندازی اولیه در محیط عملیاتی مستلزم پیکربندی متغیر محیطی امن ERP_SETUP_TOKEN (حداقل ۱۶ کاراکتر) است');
    }
  }

  const effectiveSetupToken = (configuredSetupToken || 'papital_erp_setup_token_2026').trim();
  const headerToken = (req.headers['x-setup-token'] as string || '').trim();
  const bodyToken = (req.body?.setupToken as string || '').trim();
  const providedToken = headerToken || bodyToken;

  if (!providedToken || !safeCompareTokens(providedToken, effectiveSetupToken)) {
    logger.warn(`[Setup] Unauthorized setup attempt with invalid or missing token from IP: ${req.ip}`);
    throw new UnauthorizedError('توکن راه‌اندازی نامعتبر است');
  }

  // 2. PostgreSQL advisory lock (79234) to prevent race conditions (SEC-012)
  const { sql } = await import('drizzle-orm');
  const lockResult = (await orm.execute(sql`SELECT pg_try_advisory_lock(79234) AS acquired`)) as unknown as { rows?: Array<{ acquired?: boolean | string }> } | Array<{ acquired?: boolean | string }>;
  const rows = (lockResult as { rows?: Array<{ acquired?: boolean | string }> })?.rows || (Array.isArray(lockResult) ? lockResult : []);
  const isAcquired = Boolean(rows[0]?.acquired === true || rows[0]?.acquired === 't');

  if (!isAcquired) {
    throw new ConflictError('Another setup is in progress. Please wait.');
  }

  try {
    // 3. Race-safe check for existing admin users
    const [{ count }] = await orm.select({ count: sql<number>`count(*)` })
      .from(users)
      .where(notSyntheticTestUsername(users.username));
    
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
    if (isProduction && (password === 'admin123456' || password.length < 8)) {
      throw new ValidationError('رمز عبور مدیر در محیط عملیاتی باید حداقل ۸ کاراکتر بوده و نمی‌تواند رمزهای پیش‌فرض باشد');
    }
    const tUsername = (username || '').trim();
    // v9.0.70 (TD-521): مدیر نخست با پیشوند کاربران آزمون شمرده نمی‌شد و راه‌اندازی دوباره باز می‌ماند
    if (isSyntheticTestUsername(tUsername)) {
      throw new ValidationError(SYNTHETIC_USERNAME_REFUSED);
    }
    const hash = await bcrypt.hash(password, 10);

    let logoPath = logo || '';
    // V3.1.11: لوگوی شرکت مستقیماً به‌صورت Data URL متنی در دیتابیس (appSettings) ذخیره می‌شود
    // تا در محیط‌های Containerized و Cloud Run با ری‌استارت کانتاینر از بین نرود.

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

    const csrfToken = generateCsrfToken();
    const token = generateToken({ id: user.id, username: user.username, role: user.role, csrfToken, tokenVersion: user.tokenVersion || 0 });
    const { password: _, ...userWithoutPassword } = user;
    
    // Set secure HttpOnly cookie
    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(req));

    // V3.0.6 (BUG-08) / v7.0.27 (TD-185): توکن فقط در کوکی HttpOnly؛ فیلد token تنها با EXPOSE_TOKEN_IN_BODY=true
    res.json({ 
      success: true, 
      user: { ...userWithoutPassword, full_name: user.fullName || user.username },
      ...(shouldExposeTokenInBody() ? { token } : {}),
      csrfToken
    });
  } finally {
    // 4. Always release the advisory lock
    try {
      await orm.execute(sql`SELECT pg_advisory_unlock(79234)`);
    } catch (unlockErr) {
      const errMsg = unlockErr instanceof Error ? unlockErr.message : String(unlockErr);
      logger.warn(`[Setup] Error releasing advisory lock 79234: ${errMsg}`);
    }
  }
}));

router.post(['/login', '/auth/login'], validate(loginSchema), asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const tUsername = (username || '').trim();
  const clientIp = extractClientIp(req);
  const userAgent = (req.headers['user-agent'] as string) || '';

  // v7.0.28 (TD-186 / audit P1-5): پاسخ‌های یکسان برای کاربر موجود/ناموجود، قفل تدریجی و bcrypt غیرهمگام.
  // دلیل واقعی شکست فقط در لاگ ممیزی سمت سرور ثبت می‌شود.

  // 1. Progressive lockout per (username + IP), account-wide after 50 failures (v7.0.70 / TD-187);
  //    applies equally to unknown usernames
  const lockout = await checkAccountLockout(tUsername, clientIp);
  if (lockout.isLocked) {
    const minutes = lockout.remainingMinutes || 1;
    logger.warn(`[Login Rejected] Account ${tUsername} is locked for ${minutes} more minute(s)`);
    await logActivity({
      username: tUsername,
      action: 'LOGIN_FAILED',
      entity: 'احراز هویت',
      description: `تلاش ناموفق برای ورود با نام کاربری مسدود موقت «${tUsername}» (${minutes} دقیقه باقی‌مانده)`,
      ipAddress: clientIp,
      details: { reason: 'حساب به‌طور موقت مسدود است', remainingMinutes: minutes, status: 'account_locked', method: 'نام کاربری و رمز عبور', userAgent },
      req
    });
    return res.status(429).json({ error: lockoutMessage(minutes), locked: true, remainingMinutes: minutes });
  }

  const [user] = await orm.select().from(users).where(eq(users.username, tUsername)).limit(1);
  const activeUser = user && user.isDeleted !== 1 ? user : undefined;

  // 2. Same bcrypt work for existing, deleted and unknown usernames (no timing oracle)
  const isMatch = await verifyPasswordConstantWork(password, activeUser?.password);

  if (activeUser && isMatch) {
    await resetFailedAttempts(activeUser.id, { username: tUsername, ip: clientIp });

    const csrfToken = generateCsrfToken();
    const token = generateToken({ id: activeUser.id, username: activeUser.username, role: activeUser.role, csrfToken, tokenVersion: activeUser.tokenVersion || 0 });
    const { password: _, ...userWithoutPassword } = activeUser;

    // Set secure HttpOnly cookie
    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(req));

    await logActivity({
      userId: activeUser.id,
      username: activeUser.username,
      userFullName: activeUser.fullName || activeUser.username,
      action: 'LOGIN',
      entity: 'احراز هویت',
      entityId: activeUser.id,
      description: `ورود موفق کاربر ${activeUser.fullName || activeUser.username} به سامانه`,
      ipAddress: clientIp,
      details: { role: activeUser.role, method: 'نام کاربری و رمز عبور', status: 'success', userAgent },
      req
    });

    return res.json({
      success: true,
      user: {
        ...userWithoutPassword,
        full_name: activeUser.fullName || activeUser.username,
        avatar_url: activeUser.avatarUrl || '',
        mustResetPassword: Boolean(activeUser.mustResetPassword),
        must_reset_password: Boolean(activeUser.mustResetPassword)
      },
      // v7.0.27 (TD-185 / audit P1-4): توکن فقط در کوکی HttpOnly؛ فیلد token تنها با EXPOSE_TOKEN_IN_BODY=true
      ...(shouldExposeTokenInBody() ? { token } : {}),
      csrfToken
    });
  }

  // 3. Failure: deleted accounts do not count towards a lock; existing and unknown usernames do
  const failStatus = user && user.isDeleted === 1
    ? { locked: false, remainingAttempts: 0, remainingMinutes: undefined }
    : await recordFailedAttempt(tUsername, clientIp);
  const internalReason = !user ? 'user_not_found' : user.isDeleted === 1 ? 'user_deleted' : (failStatus.locked ? 'account_locked_now' : 'wrong_password');

  await logActivity({
    userId: user?.id,
    username: user?.username || tUsername,
    userFullName: user ? (user.fullName || user.username) : undefined,
    action: 'LOGIN_FAILED',
    entity: 'احراز هویت',
    entityId: user?.id,
    description: `تلاش ناموفق برای ورود با نام کاربری «${tUsername}» (${internalReason})`,
    ipAddress: clientIp,
    details: {
      status: internalReason,
      isLocked: failStatus.locked,
      remainingMinutes: failStatus.remainingMinutes,
      method: 'نام کاربری و رمز عبور',
      userAgent
    },
    req
  });

  if (failStatus.locked) {
    const minutes = failStatus.remainingMinutes || 1;
    return res.status(429).json({ error: lockoutMessage(minutes), locked: true, remainingMinutes: minutes });
  }
  return res.status(401).json({ error: GENERIC_LOGIN_FAILURE_MESSAGE });
}));

// Logout endpoint - Clears the HttpOnly auth cookie
const logoutHandler = asyncHandler(async (req, res) => {
  const user = req.user;
  let targetUserId = user?.id;
  let targetUsername = user?.username;
  let targetFullName = (user as any)?.full_name || (user as any)?.fullName || user?.username;

  // V3.0.6 (BUG-08): ابطال واقعی توکن هنگام خروج — مسیر logout عمومی است و
  // authenticateToken روی آن اجرا نمی‌شود، بنابراین توکن را مستقیم از کوکی
  // راستی‌آزمایی و tokenVersion کاربر افزایش می‌دهیم تا توکن سرقت‌شده/کپی‌شده
  // حتی تا پایان اعتبار ۲۴ ساعته خود نیز پذیرفته نشود.
  // v9.0.71 (TD-528): نشست معتبر فقط با سرآیند CSRF همان نشست بسته می‌شود؛ پیش‌تر فرمی از سایت دیگر همه نشست‌های کاربر
  // را باطل می‌کرد. کوکی نامعتبر یا منقضی فقط پاک می‌شود.
  const rawToken = req.cookies?.[AUTH_COOKIE_NAME] || req.cookies?.['token'];
  type LogoutTokenPayload = { id?: number; username?: string; role?: string; csrfToken?: string };
  let payload: LogoutTokenPayload | null = null;
  if (rawToken) {
    try {
      payload = jwt.verify(rawToken, getJwtSecret(), JWT_VERIFY_OPTIONS) as LogoutTokenPayload;
    } catch (err) {
      logger.debug(`[Logout] Session cookie not verified: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (payload?.csrfToken) {
    const provided = String(req.headers['x-csrf-token'] || req.headers['x-xsrf-token'] || '');
    if (!provided || !safeCompareTokens(provided, payload.csrfToken)) {
      return res.status(403).json({ error: 'CSRF token invalid', message: 'توکن امنیتی CSRF نامعتبر است یا ارسال نشده است' });
    }
  }

  try {
    if (payload) {
      targetUserId = targetUserId || payload?.id;
      targetUsername = targetUsername || payload?.username;

      if (targetUserId) {
        const [row] = await orm.select().from(users).where(eq(users.id, targetUserId)).limit(1);
        if (row) {
          targetUsername = targetUsername || row.username;
          targetFullName = targetFullName || row.fullName || row.username;
          await orm.update(users)
            .set({ tokenVersion: (row.tokenVersion || 0) + 1 })
            .where(eq(users.id, targetUserId));
          invalidateUserAuthCache(targetUserId);
        }
      }
    }
  } catch (err) {
    // توکن نامعتبر/منقضی است — پاک‌سازی کوکی کافی است
    logger.debug(`[Logout] Token revocation skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  const clientIp = extractClientIp(req);
  const userAgent = (req.headers['user-agent'] as string) || '';

  if (targetUserId || targetUsername) {
    await logActivity({
      userId: targetUserId,
      username: targetUsername || 'کاربر',
      userFullName: targetFullName || targetUsername || '',
      action: 'LOGOUT',
      entity: 'احراز هویت',
      entityId: targetUserId,
      description: `خروج کاربر ${targetFullName || targetUsername} از سامانه`,
      ipAddress: clientIp,
      details: {
        userAgent,
        method: 'خروج توسط کاربر',
        status: 'success'
      },
      req
    });
  }

  res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieOptions(req));

  res.json({ success: true, message: 'خروج از حساب با موفقیت انجام شد' });
});

router.post('/logout', logoutHandler);
router.post('/auth/logout', logoutHandler);

// Check current session endpoint
const meHandler = asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new UnauthorizedError('کاربر احراز هویت نشده است');
  }

  const [user] = await orm.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.isDeleted === 1) {
    throw new UnauthorizedError('حساب کاربری یافت نشد یا حذف شده است');
  }

  // V3.3.12: ضمانت وجود توکن معتبر CSRF در نشست جاری — در صورت ورود از سشن‌های قدیمی،
  // توکن به صورت خودکار ارتقا یافته و کوکی جدید صادر می‌شود تا هیچ درخواست جهش وضعیتی با خطای ۴۰۳ مسدود نشود.
  let csrfToken = req.user?.csrfToken || (req as unknown as { csrfToken?: string }).csrfToken;
  if (!csrfToken) {
    csrfToken = generateCsrfToken();
    const token = generateToken({
      id: user.id,
      username: user.username,
      role: user.role,
      csrfToken,
      tokenVersion: user.tokenVersion || 0
    });
    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(req));
  }

  // V3.0.6 (BUG-08): توکن بازتولیدشده دیگر در بدنه پاسخ برگردانده نمی‌شود
  // (قبلاً هرگز به‌صورت کوکی هم ست نمی‌شد و صرفاً افشای توکن بود).
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
    csrfToken
  });
});

router.get('/auth/me', authenticateToken, meHandler);
router.get('/me', authenticateToken, meHandler);

// Endpoint to acquire or refresh CSRF token for active session
const csrfHandler = asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new UnauthorizedError('کاربر احراز هویت نشده است');
  }

  let csrfToken = req.user?.csrfToken || (req as unknown as { csrfToken?: string }).csrfToken;
  if (!csrfToken) {
    csrfToken = generateCsrfToken();
    const [user] = await orm.select().from(users).where(eq(users.id, userId)).limit(1);
    if (user && user.isDeleted !== 1) {
      const token = generateToken({
        id: user.id,
        username: user.username,
        role: user.role,
        csrfToken,
        tokenVersion: user.tokenVersion || 0
      });
      res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(req));
    }
  }

  res.json({ success: true, csrfToken });
});

router.get('/auth/csrf', authenticateToken, csrfHandler);
router.get('/csrf', authenticateToken, csrfHandler);

export default router;
