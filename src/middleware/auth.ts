import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AuthUserPayload } from '../types.js';
import { updateRequestContext } from '../lib/requestContext.js';
import { orm } from '../db/drizzle.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { safeCompareTokens } from '../lib/timingSafeCompare.js';
import { PASSWORD_RESET_REQUIRED, PASSWORD_RESET_REQUIRED_MESSAGE, isPasswordResetAllowedPath } from '../lib/auth/passwordReset.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
      csrfToken?: string;
    }
  }
}

export interface AuthenticatedRequest extends Request {
  user: AuthUserPayload;
}

export const DEFAULT_DEV_JWT_SECRET = 'papital_workshop_erp_default_secure_jwt_secret_dev_key_32_chars_long';

export const INSECURE_DEFAULT_SECRETS = new Set([
  DEFAULT_DEV_JWT_SECRET,
  'short_secret_key_123',
  '12345678901234567890123456789012',
  'secretsecretsecretsecretsecret32',
  'default_secret_key_change_me_in_prod'
]);

/**
 * v7.0.41 (audit P2-11): الگوریتم امضای توکن نشست صریحاً HS256 است و راستی‌آزمایی فقط همین را می‌پذیرد
 * (دفاع در عمق؛ jsonwebtoken با کلید متنی به‌طور پیش‌فرض HS384 و HS512 را هم قبول می‌کند).
 */
export const JWT_ALGORITHM = 'HS256' as const;
export const JWT_VERIFY_OPTIONS: jwt.VerifyOptions = { algorithms: [JWT_ALGORITHM] };

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET || '';
  const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

  // Strictly enforce presence and minimum 32 characters in all environments
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET environment variable is missing or shorter than 32 characters');
  }

  // V5.0.17 (TD-131): strictly reject known default or weak fallback secrets in non-development/non-test environments
  if (!isDevOrTest && INSECURE_DEFAULT_SECRETS.has(secret)) {
    throw new Error(
      'SECURITY ERROR: JWT_SECRET environment variable is using an insecure default secret. In production or containerized environments, a cryptographically random secret of at least 32 characters is required.'
    );
  }

  return secret;
}

export const AUTH_COOKIE_NAME = 'auth_token';

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const, // Required for iframe preview and cross-site subresource authentication
  maxAge: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  path: '/'
};

/**
 * V1.3.8: کوکی احراز هویت بر اساس پروتکل واقعی درخواست تنظیم می‌شود.
 * - HTTPS (دامنه با SSL / پیش‌نمایش AI Studio): Secure + SameSite=None (پشتیبانی iframe)
 * - HTTP (سرور مجازی قبل از تنظیم دامنه): بدون Secure + SameSite=Lax — چون مرورگرهای
 *   مدرن کوکی Secure را روی HTTP ذخیره نمی‌کنند و ورود/تصاویر از کار می‌افتاد.
 */
export const getAuthCookieOptions = (req?: any) => {
  const isHttps = req?.secure === true || req?.headers?.['x-forwarded-proto'] === 'https';
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/'
  };
};

/**
 * v7.0.27 (TD-185 / audit P1-4): تحویل JWT در بدنه پاسخ ورود/راه‌اندازی به‌صورت پیش‌فرض خاموش است
 * (AGENTS.md §5: جاوااسکریپت مرورگر نباید به توکن خام دسترسی داشته باشد). فقط برای محیط‌هایی که مرورگر
 * کوکی iframe را مسدود می‌کند (مثل پیش‌نمایش AI Studio — BUG-08) با EXPOSE_TOKEN_IN_BODY=true فعال می‌شود.
 */
export function shouldExposeTokenInBody(): boolean {
  return String(process.env.EXPOSE_TOKEN_IN_BODY || '').trim().toLowerCase() === 'true';
}

export const generateCsrfToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

const PUBLIC_PATHS = new Set([
  '/api/login',
  '/api/auth/login',
  '/api/logout',
  '/api/auth/logout',
  '/api/check-setup',
  '/api/public-settings',
  '/api/setup',
  '/api/events/webhook-echo',
  '/api/health',
  '/api/health/live',
  '/api/health/ready',
  '/api/health/startup',
  '/health',
  '/health/live',
  '/health/ready',
  '/health/startup',
  '/metrics',
  '/api/metrics'
]);

// V9-2.2: مسیرهای دقیق وب‌هوک عمومی — جایگزین تطبیق زیررشته‌ای includes('/webhook/')
// که هر مسیر آینده حاوی این زیررشته را به‌صورت ناخواسته بدون احراز هویت رها می‌کرد.
const PUBLIC_WEBHOOK_PATHS = new Set([
  '/api/woocommerce/webhook/order',
  '/api/events/webhook-echo'
]);

const isPublicWebhookPath = (path: string): boolean => PUBLIC_WEBHOOK_PATHS.has(path);

interface CachedUserAuth {
  id: number;
  role: string;
  isDeleted: number;
  tokenVersion: number;
  fullName: string | null;
  mustResetPassword: boolean;
  cachedAt: number;
}

const USER_AUTH_CACHE_TTL_MS = 30_000; // 30 seconds TTL (A-2 / Phase 5.3)
const MAX_USER_AUTH_CACHE_SIZE = 1000;
const userAuthCache = new Map<number, CachedUserAuth>();

export function invalidateUserAuthCache(userId?: number): void {
  if (typeof userId === 'number') {
    userAuthCache.delete(userId);
  } else {
    userAuthCache.clear();
  }
}

export function getUserAuthCacheStats(): { size: number; maxSize: number } {
  return { size: userAuthCache.size, maxSize: MAX_USER_AUTH_CACHE_SIZE };
}

export type LiveSessionResult =
  | { ok: true; user: AuthUserPayload; mustResetPassword: boolean }
  | { ok: false; status: 401 | 500; error: string };

/**
 * Live check of a verified JWT payload against the users table (30 s cache): a deleted user or a token
 * whose tokenVersion no longer matches is refused; role and full name come from the database.
 * Shared by `authenticateToken` and the metrics guard (v9.0.146, TD-599).
 */
export async function resolveLiveSession(payload: AuthUserPayload): Promise<LiveSessionResult> {
  try {
    const userIdNum = Number(payload.id);
    const now = Date.now();
    let liveUser: CachedUserAuth | undefined;

    const cached = userAuthCache.get(userIdNum);
    if (cached && (now - cached.cachedAt < USER_AUTH_CACHE_TTL_MS)) {
      liveUser = cached;
    } else {
      const [dbUser] = await orm
        .select({ id: users.id, role: users.role, isDeleted: users.isDeleted, tokenVersion: users.tokenVersion, fullName: users.fullName, mustResetPassword: users.mustResetPassword })
        .from(users)
        .where(eq(users.id, userIdNum))
        .limit(1);

      if (dbUser) {
        liveUser = {
          id: dbUser.id,
          role: dbUser.role ?? '',
          isDeleted: dbUser.isDeleted ?? 0,
          tokenVersion: dbUser.tokenVersion ?? 0,
          fullName: dbUser.fullName,
          mustResetPassword: Number(dbUser.mustResetPassword ?? 0) === 1,
          cachedAt: now,
        };
        if (userAuthCache.size >= MAX_USER_AUTH_CACHE_SIZE) {
          const firstKey = userAuthCache.keys().next().value;
          if (firstKey !== undefined) userAuthCache.delete(firstKey);
        }
        userAuthCache.set(userIdNum, liveUser);
      }
    }

    if (!liveUser || liveUser.isDeleted === 1) {
      userAuthCache.delete(userIdNum);
      return { ok: false, status: 401, error: 'حساب کاربری حذف یا غیرفعال شده است. لطفاً مجدداً وارد شوید.' };
    }

    const claimVersion = Number((payload as any).tokenVersion ?? 0);
    const dbVersion = Number(liveUser.tokenVersion ?? 0);
    if (claimVersion !== dbVersion) {
      userAuthCache.delete(userIdNum);
      return { ok: false, status: 401, error: 'نشست شما به دلیل تغییر نقش یا اطلاعات کاربری منقضی شده است. لطفاً مجدداً وارد شوید.' };
    }

    // نقش، نام کامل و توکن CSRF همیشه از وضعیت معتبر دیتابیس/کش بازخوانی می‌شوند
    // یک موجودیت هویت کاربر: full_name همیشه در req.user موجود است
    return {
      ok: true,
      user: { ...payload, role: liveUser.role, full_name: liveUser.fullName || (payload as any).full_name || payload.username },
      mustResetPassword: liveUser.mustResetPassword,
    };
  } catch {
    // در صورت خطای موقت دیتابیس، اعتبارسنجی DB را نقض نکنیم
    return { ok: false, status: 500, error: 'خطا در اعتبارسنجی نشست کاربر' };
  }
}

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const normalizedPath = req.path.replace(/\/+$/, '');
  const originalPath = (req.originalUrl || '').split('?')[0].replace(/\/+$/, '');

  if (
    PUBLIC_PATHS.has(normalizedPath) ||
    PUBLIC_PATHS.has(originalPath) ||
    isPublicWebhookPath(normalizedPath) ||
    isPublicWebhookPath(originalPath)
  ) {
    return next();
  }

  // Extract JWT token from HttpOnly cookie first, with Authorization header as fallback
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME] || req.cookies?.['token'];
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader && authHeader.split(' ')[1];
  const token = cookieToken || headerToken;

  if (!token) {
    return res.status(401).json({ error: 'توکن احراز هویت یافت نشد' });
  }

  const jwtSecret = getJwtSecret();
  // v7.0.66 (TD-229): callback هم‌زمان؛ رد Promise بدنه به next می‌رود نه unhandledRejection
  jwt.verify(token, jwtSecret, JWT_VERIFY_OPTIONS, (err: any, decoded: any) => { (async () => {
    if (err || !decoded) {
      return res.status(401).json({ error: 'توکن نامعتبر است یا منقضی شده' });
    }
    const payload = decoded as AuthUserPayload;

    // V9-2.2 & Phase 5.3 (A-2): اعتبارسنجی زنده وضعیت کاربر با لایه کش سبک TTL (30s) جهت پیشگیری از N+1 در هر درخواست
    const live = await resolveLiveSession(payload);
    if (!live.ok) {
      return res.status(live.status).json({ error: live.error });
    }
    // v9.0.219 (TD-523، ت۵ الف): با رمز موقتی که مدیر گذاشته، تا تغییر رمز فقط نشست، نمایه، مجوزهای خود، CSRF و خروج باز است
    if (live.mustResetPassword && !isPasswordResetAllowedPath(originalPath)) {
      return res.status(403).json({ error: PASSWORD_RESET_REQUIRED_MESSAGE, code: PASSWORD_RESET_REQUIRED });
    }
    req.user = live.user;

    if (req.user?.csrfToken) {
      req.csrfToken = req.user.csrfToken;
    }
    if (req.user?.id) {
      updateRequestContext({ userId: req.user.id, username: req.user.username });
    }
    next();
  })().catch(next); });
};

/** نشانه میدل‌ور احراز هویت برای جدول «مسیر ← مجوز» (`src/lib/routeGuardTable.ts`؛ کلید رشته‌ای، مانند `GUARD_ENTRIES`). */
export const AUTHENTICATES = '__erpAuthenticates';
Object.assign(authenticateToken, { [AUTHENTICATES]: true });

export const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
  // Only state-changing mutation requests require CSRF protection
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  const normalizedPath = req.path.replace(/\/+$/, '');
  const originalPath = (req.originalUrl || '').split('?')[0].replace(/\/+$/, '');

  // Exempt public endpoints (like login, initial setup) and webhook ingestion
  if (
    PUBLIC_PATHS.has(normalizedPath) ||
    PUBLIC_PATHS.has(originalPath) ||
    isPublicWebhookPath(normalizedPath) ||
    isPublicWebhookPath(originalPath)
  ) {
    return next();
  }

  // Pure API Bearer token authorization without cookie is exempt from browser CSRF
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME] || req.cookies?.['token'];
  const authHeader = req.headers['authorization'];
  if (!cookieToken && authHeader && authHeader.startsWith('Bearer ')) {
    return next();
  }

  // If request uses cookie session, validate CSRF token
  if (cookieToken) {
    let expectedCsrfToken = req.csrfToken || req.user?.csrfToken;
    if (!expectedCsrfToken) {
      try {
        const decoded = jwt.verify(cookieToken, getJwtSecret(), JWT_VERIFY_OPTIONS) as any;
        expectedCsrfToken = decoded?.csrfToken;
      } catch {
        // If JWT signature is invalid, authenticateToken handles 401
        return next();
      }
    }

    // V9-2.2 (Fail-Closed): کوکی نشست بدون ادعای CSRF هرگز نباید بدون اعتبارسنجی عبور کند —
    // توکن‌های قدیمی فاقد csrfToken باید با پیام واضح به ورود مجدد هدایت شوند.
    if (!expectedCsrfToken) {
      return res.status(403).json({
        error: 'CSRF token invalid',
        message: 'نشست شما قدیمی است و فاقد توکن امنیتی CSRF می‌باشد. لطفاً از سامانه خارج شده و مجدداً وارد شوید.'
      });
    }

    const requestCsrf = (req.headers['x-csrf-token'] || req.headers['x-xsrf-token']) as string;
    // v7.0.41 (audit P2-11): مقایسه در زمان ثابت
    if (!requestCsrf || !safeCompareTokens(requestCsrf, expectedCsrfToken)) {
      return res.status(403).json({
        error: 'CSRF token invalid',
        message: 'توکن امنیتی CSRF نامعتبر است یا ارسال نشده است'
      });
    }
  }

  next();
};

export const generateToken = (payload: AuthUserPayload | { id: number; username: string; role: string; fullName?: string; full_name?: string; csrfToken?: string; tokenVersion?: number }) => {
  const jwtSecret = getJwtSecret();
  return jwt.sign(payload, jwtSecret, { expiresIn: '24h', algorithm: JWT_ALGORITHM });
};

export { authorizePermission, requirePermission, requireSystemAdmin } from './authorize.js';

