import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AuthUserPayload } from '../types.js';
import { updateRequestContext } from '../lib/requestContext.js';
import { orm } from '../db/drizzle.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

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

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    // In development or when unconfigured, use a safe 64-char fallback secret to allow dev server to run smoothly
    return secret && secret.length >= 8 
      ? secret.padEnd(32, '0') 
      : 'papital_workshop_erp_default_secure_jwt_secret_dev_key_32_chars_long';
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
  jwt.verify(token, jwtSecret, async (err, decoded) => {
    if (err || !decoded) {
      return res.status(401).json({ error: 'توکن نامعتبر است یا منقضی شده' });
    }
    const payload = decoded as AuthUserPayload;

    // V9-2.2: اعتبارسنجی زنده وضعیت کاربر — حذف نرم و ابطال نشست (tokenVersion)
    try {
      const [liveUser] = await orm
        .select({ id: users.id, role: users.role, isDeleted: users.isDeleted, tokenVersion: users.tokenVersion, fullName: users.fullName })
        .from(users)
        .where(eq(users.id, Number(payload.id)))
        .limit(1);

      if (!liveUser || liveUser.isDeleted === 1) {
        return res.status(401).json({ error: 'حساب کاربری حذف یا غیرفعال شده است. لطفاً مجدداً وارد شوید.' });
      }

      const claimVersion = Number((payload as any).tokenVersion ?? 0);
      const dbVersion = Number(liveUser.tokenVersion ?? 0);
      if (claimVersion !== dbVersion) {
        return res.status(401).json({ error: 'نشست شما به دلیل تغییر نقش یا اطلاعات کاربری منقضی شده است. لطفاً مجدداً وارد شوید.' });
      }

      // نقش، نام کامل و توکن CSRF همیشه از وضعیت زنده دیتابیس بازخوانی می‌شوند
      // یک موجودیت هویت کاربر: full_name همیشه در req.user موجود است
      req.user = { ...payload, role: liveUser.role, full_name: liveUser.fullName || (payload as any).full_name || payload.username };
    } catch (dbErr) {
      // در صورت خطای موقت دیتابیس، اعتبارسنجی DB را نقض نکنیم اما لاگ ثبت شود
      return res.status(500).json({ error: 'خطا در اعتبارسنجی نشست کاربر' });
    }

    if (req.user?.csrfToken) {
      req.csrfToken = req.user.csrfToken;
    }
    if (req.user?.id) {
      updateRequestContext({ userId: req.user.id, username: req.user.username });
    }
    next();
  });
};

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
        const decoded = jwt.verify(cookieToken, getJwtSecret()) as any;
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
    if (!requestCsrf || requestCsrf !== expectedCsrfToken) {
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
  return jwt.sign(payload, jwtSecret, { expiresIn: '24h' });
};

export { authorize, authorizePermission } from './authorize.js';

