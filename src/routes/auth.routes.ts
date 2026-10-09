import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { users, roles, appSettings } from '../db/schema.js';
import { generateToken, generateCsrfToken, AUTH_COOKIE_NAME, getAuthCookieOptions, authenticateToken, getJwtSecret, JWT_VERIFY_OPTIONS, invalidateUserAuthCache, shouldExposeTokenInBody } from '../middleware/auth.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { logActivity, extractClientIp } from '../lib/auditLogger.js';
import { logger } from '../middleware/logger.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { UnauthorizedError, ValidationError } from '../errors/customErrors.js';
import { safeCompareTokens } from '../lib/timingSafeCompare.js';
import { revokeUserSessions, runInitialSetup } from '../services/auth/initialSetup.service.js';
import {
  checkAccountLockout,
  recordFailedAttempt,
  resetFailedAttempts,
  verifyPasswordConstantWork,
  lockoutMessage,
  GENERIC_LOGIN_FAILURE_MESSAGE
} from '../services/auth/loginSecurity.service.js';
import { notSyntheticTestUsername, isSyntheticTestUsername, SYNTHETIC_USERNAME_REFUSED } from '../lib/syntheticUsers.js';
import { MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE } from '../lib/auth/passwordPolicy.js';
import { FULL_NAME_MAX_LENGTH, FULL_NAME_TOO_LONG_MESSAGE } from '../lib/users/profileFields.js';
import { roleDisplayName } from '../lib/users/roleDisplayName.js';
import { normalizeRialDisplayUnit } from '../lib/rialDisplay.js';
import {
  SETUP_USERNAME_MIN_LENGTH, SETUP_USERNAME_TOO_SHORT_MESSAGE, SETUP_COMPANY_NAME_REQUIRED_MESSAGE,
  SETUP_TOKEN_NOT_CONFIGURED_MESSAGE, SETUP_DEFAULT_PASSWORD_MESSAGE,
} from '../lib/auth/setupRules.js';

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
  const currency = normalizeRialDisplayUnit(settings.find(s => s.key === 'currency')?.value);

  res.json({
    companyName: name,
    companyLogo: logo,
    currency,
    settings
  });
}));

const setupSchema = z.object({
  body: z.object({
    username: z.string().trim().min(SETUP_USERNAME_MIN_LENGTH, SETUP_USERNAME_TOO_SHORT_MESSAGE),
    password: z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE),
    fullName: z.string().min(1, 'نام و نام خانوادگی الزامی است').max(FULL_NAME_MAX_LENGTH, FULL_NAME_TOO_LONG_MESSAGE),
    // v9.0.392 (TD-622، تصمیم ت۸): نام شرکت روی سربرگ فاکتور چاپ می‌شود؛ پیش‌فرض ندارد و اجباری است
    companyName: z.string({ error: SETUP_COMPANY_NAME_REQUIRED_MESSAGE }).trim().min(1, SETUP_COMPANY_NAME_REQUIRED_MESSAGE),
    warehouseName: z.string().optional().default('انبار مرکزی'),
    phone: z.string().optional().default(''),
    address: z.string().optional().default(''),
    logo: z.string().optional().default(''),
    // v9.0.275 (TD-667، تصمیم ت۱): واحد نمایش مبالغ ریالی، فقط ریال یا تومان
    currency: z.enum(['IRR', 'TOMAN'], { message: 'واحد نمایش مبالغ فقط «ریال» یا «تومان» است' }).optional().default('IRR'),
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
      throw new UnauthorizedError(SETUP_TOKEN_NOT_CONFIGURED_MESSAGE);
    }
  }

  const effectiveSetupToken = (configuredSetupToken || 'papital_erp_setup_token_2026').trim();
  const headerToken = (req.headers['x-setup-token'] as string || '').trim();
  const bodyToken = (req.body?.setupToken as string || '').trim();
  const providedToken = headerToken || bodyToken;

  if (!providedToken || !safeCompareTokens(providedToken, effectiveSetupToken)) {
    logger.warn(`[Setup] Unauthorized setup attempt with invalid or missing token from IP: ${req.ip}`);
    throw new UnauthorizedError('رمز راه‌اندازی نادرست است');
  }

  const { username, password, fullName, companyName, warehouseName, phone, address, logo, currency } = req.body;
  if (isProduction && (password === 'admin123456' || password.length < MIN_PASSWORD_LENGTH)) {
    throw new ValidationError(password === 'admin123456' ? SETUP_DEFAULT_PASSWORD_MESSAGE : PASSWORD_TOO_SHORT_MESSAGE);
  }
  const tUsername = (username || '').trim();
  // v9.0.76 (TD-521): مدیر نخست با پیشوند کاربران آزمون شمرده نمی‌شد و راه‌اندازی دوباره باز می‌ماند
  if (isSyntheticTestUsername(tUsername)) {
    throw new ValidationError(SYNTHETIC_USERNAME_REFUSED);
  }

  // v10.0.39 (L5 E7, TD-960): admin, default warehouse, company settings and the audit row in one transaction under
  // the transaction advisory lock 79234 (SEC-012); the company logo stays a data URL in app_settings (V3.1.11)
  const user = await runInitialSetup({
    username: tUsername, password, fullName, companyName, warehouseName, phone, address, logo: logo || '', currency,
    ipAddress: extractClientIp(req),
  });

  // Clean up residual test artifacts once the setup has run (only a setup that created the admin gets here)
  // TST-001: computed specifier keeps src/tests out of the production bundle
  try {
    const spec = ['..', 'tests', 'fixtures', 'dbTestHelper.js'].join('/');
    const { cleanupAllTestFixtures } = await import(/* @vite-ignore */ spec);
    await cleanupAllTestFixtures();
  } catch {
    // Non-blocking
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

    // v9.0.224 (TD-540): سجل ورود نام نقش را هم نگه می‌دارد تا جزئیات رویداد کد نقش نشان ندهد
    const [roleRow] = await orm.select({ name: roles.name }).from(roles).where(eq(roles.code, activeUser.role)).limit(1);
    await logActivity({
      userId: activeUser.id,
      username: activeUser.username,
      userFullName: activeUser.fullName || activeUser.username,
      action: 'LOGIN',
      entity: 'احراز هویت',
      entityId: activeUser.id,
      description: `ورود موفق کاربر ${activeUser.fullName || activeUser.username} به سامانه`,
      ipAddress: clientIp,
      details: { role: activeUser.role, roleName: roleDisplayName(activeUser.role, roleRow?.name), method: 'نام کاربری و رمز عبور', status: 'success', userAgent },
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
  // v9.0.77 (TD-528): نشست معتبر فقط با سرآیند CSRF همان نشست بسته می‌شود؛ پیش‌تر فرمی از سایت دیگر همه نشست‌های کاربر
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
        // v10.0.39 (L5 E7): the token version is raised under the user row lock in a service
        const revoked = await revokeUserSessions(targetUserId);
        if (revoked) {
          targetUsername = targetUsername || revoked.username;
          targetFullName = targetFullName || revoked.fullName;
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
