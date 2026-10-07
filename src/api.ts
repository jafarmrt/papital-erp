import { fetchThroughStartup } from './lib/systemStarting';
import { inFlightRetryDelayMs, isInFlightResponse, releaseSubmissionKey, settlesSubmissionKey, submissionKeyFor } from './lib/submissionKey';
import { PASSWORD_RESET_REQUIRED } from './lib/auth/passwordReset';

export const API_URL = '/api';

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: any;

  constructor(message: string, code = 'INTERNAL_ERROR', status = 500, details?: any) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ProtocolError extends ApiError {
  constructor(message: string, status = 500, details?: any) {
    super(message, 'PROTOCOL_ERROR', status, details);
    this.name = 'ProtocolError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const e = err as any;
    if (e.name === 'AbortError') return true;
    if (typeof e.message === 'string' && (
      e.message.includes('The operation was aborted') ||
      e.message.toLowerCase().includes('aborted') ||
      e.message.toLowerCase().includes('user aborted')
    )) {
      return true;
    }
  }
  return false;
}

let inMemoryCsrfToken: string | null = null;
let inMemoryAuthToken: string | null = null;

export function setCsrfToken(token: string | null | undefined): void {
  inMemoryCsrfToken = token || null;
  if (typeof document !== 'undefined') {
    if (token) {
      document.cookie = `csrf_token=${encodeURIComponent(token)}; path=/; SameSite=None; Secure; max-age=86400`;
    } else {
      document.cookie = `csrf_token=; path=/; SameSite=None; Secure; max-age=0`;
    }
    try {
      localStorage.removeItem('csrf_token');
    } catch {
      // Ignore if localStorage unavailable
    }
  }
}

export function getCsrfToken(): string | null {
  if (inMemoryCsrfToken) return inMemoryCsrfToken;
  if (typeof document !== 'undefined') {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    if (match && match[1]) {
      const decoded = decodeURIComponent(match[1]);
      inMemoryCsrfToken = decoded;
      return decoded;
    }
  }
  return null;
}

let activeCsrfRefreshPromise: Promise<string | null> | null = null;

async function refreshActiveCsrfToken(): Promise<string | null> {
  if (activeCsrfRefreshPromise) {
    return activeCsrfRefreshPromise;
  }
  activeCsrfRefreshPromise = (async () => {
    try {
      const csrfRes = await fetch(`${API_URL}/auth/csrf`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (csrfRes.ok) {
        const csrfData = await csrfRes.json().catch(() => null);
        if (csrfData?.csrfToken) {
          setCsrfToken(csrfData.csrfToken);
          return csrfData.csrfToken;
        }
      }
      return null;
    } catch {
      return null;
    } finally {
      activeCsrfRefreshPromise = null;
    }
  })();
  return activeCsrfRefreshPromise;
}

export function setAuthToken(token: string | null | undefined): void {
  inMemoryAuthToken = token || null;
}

export function getAuthToken(): string | null {
  return inMemoryAuthToken;
}

/**
 * مسیرهای ورود، راه‌اندازی و بررسی نشست: بدون پیش‌گرفتن توکن CSRF و کلید Idempotency،
 * و پاسخ 401 آن‌ها کاربر را خارج نمی‌کند.
 * v7.0.61 (audit P3-9): تطبیق دقیق مسیر؛ پیش‌تر `includes('/me')` مسیرهایی مثل `/menu-visibility`
 * و هر مسیری که رشته جستجویش «/login» یا «/setup» داشت را هم عمومی حساب می‌کرد.
 */
const PUBLIC_API_PATHS = new Set([
  '/login', '/auth/login',
  '/check-setup', '/setup',
  '/public-settings',
  '/csrf', '/auth/csrf',
  '/me', '/auth/me',
]);

export function isPublicApiEndpoint(endpoint: string): boolean {
  let path = endpoint.split(/[?#]/)[0];
  if (!path.startsWith('/')) path = `/${path}`;
  if (path === '/api' || path.startsWith('/api/')) path = path.substring(4);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return PUBLIC_API_PATHS.has(path);
}

/** بیشینه بار انتظار برای نتیجه درخواستی که سرور «در حال پردازش» گزارش می‌کند (هر بار به اندازه Retry-After) */
const IN_FLIGHT_MAX_WAITS = 15;

/**
 * v8.0.79 (TD-329): `inFlightWaits` شمار انتظارهای انجام‌شده برای پاسخ ۴۰۹ «در حال پردازش» است (فقط فراخوانی درونی).
 */
export async function fetchJson<T = any>(endpoint: string, options?: RequestInit, retries = 1, inFlightWaits = 0): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const isPublicEndpoint = isPublicApiEndpoint(cleanEndpoint);

  // Proactively acquire CSRF token if missing for mutation requests on authenticated routes
  let csrfToken = getCsrfToken();
  if (isMutation && !csrfToken && !isPublicEndpoint && typeof window !== 'undefined') {
    const refreshedToken = await refreshActiveCsrfToken();
    if (refreshedToken) {
      csrfToken = refreshedToken;
    }
  }

  const authToken = getAuthToken();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
    ...((options?.headers as Record<string, string>) || {}),
  };

  // Auto-attach Idempotency-Key for mutating requests if not explicitly supplied
  // v8.0.79 (TD-329): کلید از محتوای ارسال (submissionKeyFor) و در تلاش دوباره همان کلید؛ options فراخواننده دست نمی‌خورد
  let idempotencyKey: string | null = null;
  if (isMutation && !isPublicEndpoint) {
    const existingKey = headers['Idempotency-Key'] || headers['idempotency-key'] || headers['x-idempotency-key'];
    idempotencyKey = existingKey || submissionKeyFor(method, cleanEndpoint, options?.body);
    headers['Idempotency-Key'] = idempotencyKey;
  }
  const sameKeyOptions = (): RequestInit | undefined => (idempotencyKey
    ? { ...options, headers: { ...(options?.headers as Record<string, string>), 'Idempotency-Key': idempotencyKey } }
    : options);
  const settleKey = (status: number) => {
    if (idempotencyKey && settlesSubmissionKey(status)) releaseSubmissionKey(idempotencyKey);
  };

  const normalizedEndpoint = cleanEndpoint.startsWith('/api/')
    ? cleanEndpoint.substring(4)
    : cleanEndpoint === '/api'
    ? ''
    : cleanEndpoint;
  const url = `${API_URL}${normalizedEndpoint}`;

  let res: Response;
  try {
    // v9.0.164 (TD-584): while the server finishes an update it answers 503 SYSTEM_STARTING; wait and resend
    res = await fetchThroughStartup(() => fetch(url, {
      ...options,
      credentials: 'include', // Automatically passes and receives HttpOnly Secure cookies
      headers,
    }), options?.signal);
  } catch (err: any) {
    if (isAbortError(err) || options?.signal?.aborted) {
      const abortErr = new Error('The operation was aborted.');
      abortErr.name = 'AbortError';
      throw (err?.name === 'AbortError' ? err : abortErr);
    }
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 800));
      return fetchJson(endpoint, sameKeyOptions(), retries - 1, inFlightWaits);
    }
    throw new ApiError(`ارتباط با سرور برقرار نشد: ${err?.message || 'خطای شبکه'}`, 'NETWORK_ERROR', 0);
  }

  if (!res.ok) {
    let data: any;
    try {
      const text = await res.text();
      data = text ? JSON.parse(text) : {};
    } catch (parseErr: any) {
      if (isAbortError(parseErr) || options?.signal?.aborted) {
        const abortErr = new Error('The operation was aborted.');
        abortErr.name = 'AbortError';
        throw (parseErr?.name === 'AbortError' ? parseErr : abortErr);
      }
      settleKey(res.status);
      throw new ProtocolError(
        `پاسخ خطای سرور با فرمت معتبر JSON دریافت نشد (وضعیت ${res.status}): ${parseErr?.message || 'خطای پروتکل'}`,
        res.status
      );
    }
    // v8.0.79 (TD-329): درخواست اول با همین کلید هنوز در سرور اجرا می‌شود؛ پس از مکث همان کلید نتیجه‌اش را می‌گیرد
    if (idempotencyKey && isInFlightResponse(res.status, data?.code) && inFlightWaits < IN_FLIGHT_MAX_WAITS) {
      await new Promise(resolve => setTimeout(resolve, inFlightRetryDelayMs(res.headers.get('Retry-After'))));
      return fetchJson(endpoint, sameKeyOptions(), retries, inFlightWaits + 1);
    }
    settleKey(res.status);

    if (res.status === 401) {
      if (typeof window !== 'undefined' && !isPublicEndpoint) {
        setCsrfToken(null);
        setAuthToken(null);
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      }
    }

    const isCsrfError = 
      res.status === 403 && (
        data.error === 'CSRF token invalid' ||
        (typeof data.message === 'string' && (data.message.includes('CSRF') || data.message.includes('توکن امنیتی'))) ||
        (typeof data.error === 'string' && (data.error.includes('CSRF') || data.error.includes('توکن امنیتی')))
      );

    // Auto-heal and retry on CSRF mismatch/expiry
    if (isCsrfError && retries > 0 && typeof window !== 'undefined') {
      const newCsrf = await refreshActiveCsrfToken();
      if (newCsrf) {
        return fetchJson(endpoint, sameKeyOptions(), retries - 1, inFlightWaits);
      }
    }

    const code = data.code || data.errorCode || data.errorObject?.code || 'UNKNOWN_ERROR';
    const errorMessage = 
      data.message || 
      (typeof data.error === 'string' ? data.error : '') ||
      data.errorObject?.message || 
      `خطا در برقراری ارتباط با سرور (${res.status})`;
    const details = data.details || data.errorDetails || data.errorObject?.details || null;

    if (res.status === 403) {
      // v9.0.219 (TD-523): رمز موقت؛ برنامه به برگه تغییر رمز می‌رود
      if (code === PASSWORD_RESET_REQUIRED && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:password-reset-required'));
      }
      const forbiddenMsg = data.message || (typeof data.error === 'string' ? data.error : '') || 'دسترسی غیرمجاز یا توکن امنیتی منقضی شده است (۴۰۳)';
      throw new ApiError(forbiddenMsg, code || 'AUTHORIZATION_ERROR', 403, details);
    }
    if (res.status === 429) {
      const rateLimitMsg = data.message || (typeof data.error === 'string' ? data.error : '') || data.errorObject?.message || 'تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً چند لحظه صبر کنید (۴۲۹)';
      // v9.0.220 (TD-539): قفل ورود با `locked` و `remainingMinutes` در جزئیات خطا می‌ماند؛ صفحه ورود شمارش را از همین می‌سازد
      const lockout = data.locked === true ? { locked: true, remainingMinutes: data.remainingMinutes } : null;
      throw new ApiError(rateLimitMsg, code || 'RATE_LIMIT_EXCEEDED', 429, details ?? lockout);
    }
    throw new ApiError(errorMessage, code, res.status, details);
  }

  settleKey(res.status);
  let jsonResponse: T;
  try {
    if (res.status === 204) {
      jsonResponse = {} as T;
    } else {
      const text = await res.text();
      jsonResponse = (text ? JSON.parse(text) : {}) as T;
    }
  } catch (parseErr: any) {
    if (isAbortError(parseErr) || options?.signal?.aborted) {
      const abortErr = new Error('The operation was aborted.');
      abortErr.name = 'AbortError';
      throw (parseErr?.name === 'AbortError' ? parseErr : abortErr);
    }
    throw new ProtocolError(
      `پاسخ سرور قابل تفسیر به JSON نیست (وضعیت ${res.status}): ${parseErr?.message || 'خطای پروتکل'}`,
      res.status
    );
  }
  if ((jsonResponse as any)?.csrfToken) {
    setCsrfToken((jsonResponse as any).csrfToken);
  }
  if ((jsonResponse as any)?.token) {
    setAuthToken((jsonResponse as any).token);
  }
  return jsonResponse;
}
