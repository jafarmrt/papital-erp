import type { Request, Response, NextFunction } from 'express';
import { parseAllowedOrigins } from '../lib/corsValidator.js';
import { logger } from './logger.js';

/**
 * v9.0.62 (TD-528, B02-13): ورود، خروج و راه‌اندازی از CSRF معاف‌اند (هنوز نشستی نیست)، پس صفحه‌ای در سایت دیگر با یک
 * فرم پنهان کاربر را از همه دستگاه‌ها بیرون می‌کرد یا او را بی‌خبر وارد حساب مهاجم می‌کرد. این مسیرها فقط درخواست
 * هم‌مبدأ را می‌پذیرند: مبدأ مرورگر (`Origin`، وگرنه `Referer`) با میزبان خود درخواست یکی باشد، یا در `ALLOWED_ORIGINS`
 * (بی `*`) یا `APP_URL` باشد؛ بیرون از تولید localhost و پیش‌نمایش‌های گوگل هم. درخواست بی هر دو سرآیند از کلاینت
 * غیرمرورگر است و می‌گذرد؛ مبدأ `null` (iframe جعبه‌شنی، فایل محلی) رد می‌شود.
 */
export const SESSION_ENDPOINT_PATHS = new Set(['/api/login', '/api/auth/login', '/api/logout', '/api/auth/logout', '/api/setup']);

export const CROSS_ORIGIN_SESSION_MESSAGE = 'ورود، خروج و راه‌اندازی فقط از صفحه خود سامانه پذیرفته می‌شود. نشانی سامانه را مستقیم در مرورگر باز کنید.';

export interface SessionOriginOptions {
  nodeEnv?: string;
  allowedOrigins?: string | string[];
  appUrl?: string;
}

type HeaderBag = Record<string, string | string[] | undefined>;

const firstHeader = (headers: HeaderBag, name: string): string => {
  const v = headers[name];
  return (Array.isArray(v) ? v[0] : v ?? '').trim();
};

/** مبدأ مرورگری که درخواست را فرستاده: `Origin`، وگرنه مبدأ `Referer`؛ `none` یعنی هیچ‌کدام نیست */
export function browserSourceOrigin(headers: HeaderBag): { kind: 'none' } | { kind: 'opaque' } | { kind: 'origin'; origin: string } {
  const origin = firstHeader(headers, 'origin');
  if (origin) {
    if (origin === 'null') return { kind: 'opaque' };
    return { kind: 'origin', origin };
  }
  const referer = firstHeader(headers, 'referer');
  if (!referer) return { kind: 'none' };
  try {
    return { kind: 'origin', origin: new URL(referer).origin };
  } catch {
    return { kind: 'opaque' };
  }
}

/** آیا مبدأ مرورگر برای ورود، خروج یا راه‌اندازی پذیرفتنی است (میزبان همان درخواست، یا فهرست مجاز) */
export function sessionOriginAllowed(source: string, requestHost: string | undefined, options: SessionOriginOptions = {}): boolean {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return false;
  }
  if (url.origin === 'null') return false;
  if (requestHost && url.host.toLowerCase() === requestHost.trim().toLowerCase()) return true;

  const allowed = parseAllowedOrigins(options.allowedOrigins ?? process.env.ALLOWED_ORIGINS).filter(o => o !== '*');
  if (allowed.includes(url.origin)) return true;

  const appUrl = options.appUrl ?? process.env.APP_URL;
  if (appUrl) {
    try {
      if (new URL(appUrl).origin === url.origin) return true;
    } catch {
      // نشانی APP_URL نامعتبر نادیده گرفته می‌شود
    }
  }

  if ((options.nodeEnv ?? process.env.NODE_ENV) !== 'production') {
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url.origin)) return true;
    if (/^https:\/\/([a-zA-Z0-9-]+\.)*(run\.app|google\.com|googleusercontent\.com)$/.test(url.origin)) return true;
  }
  return false;
}

export function sessionEndpointOriginGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'POST') return next();
  const path = (req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
  if (!SESSION_ENDPOINT_PATHS.has(path)) return next();

  const source = browserSourceOrigin(req.headers as HeaderBag);
  if (source.kind === 'none') return next();
  if (source.kind === 'origin' && sessionOriginAllowed(source.origin, req.get('host'))) return next();

  const shown = source.kind === 'origin' ? source.origin : 'null';
  logger.warn(`[SessionOrigin] Refused cross-origin POST ${path} from origin ${shown}`);
  res.status(403).json({ error: CROSS_ORIGIN_SESSION_MESSAGE, message: CROSS_ORIGIN_SESSION_MESSAGE, code: 'CROSS_ORIGIN_SESSION_REQUEST' });
}
