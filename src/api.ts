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

let inMemoryCsrfToken: string | null = null;
let inMemoryAuthToken: string | null = null;

export function setCsrfToken(token: string | null | undefined): void {
  inMemoryCsrfToken = token || null;
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem('csrf_token', token);
    } else {
      localStorage.removeItem('csrf_token');
    }
  }
}

export function getCsrfToken(): string | null {
  if (inMemoryCsrfToken) return inMemoryCsrfToken;
  if (typeof window !== 'undefined') {
    return localStorage.getItem('csrf_token');
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
        const csrfData = await csrfRes.json().catch(() => ({}));
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

export async function fetchJson<T = any>(endpoint: string, options?: RequestInit, retries = 1): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const isPublicEndpoint = 
    cleanEndpoint.includes('/login') || 
    cleanEndpoint.includes('/check-setup') || 
    cleanEndpoint.includes('/public-settings') || 
    cleanEndpoint.includes('/setup') ||
    cleanEndpoint.includes('/csrf') ||
    cleanEndpoint.includes('/auth/me') ||
    cleanEndpoint.includes('/me');

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
  if (isMutation && !isPublicEndpoint) {
    const existingKey = headers['Idempotency-Key'] || headers['idempotency-key'] || headers['x-idempotency-key'];
    const keyToUse = existingKey || (
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `fe_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    );
    headers['Idempotency-Key'] = keyToUse;
    if (options && typeof options === 'object') {
      options.headers = { ...(options.headers as Record<string, string>), 'Idempotency-Key': keyToUse };
    }
  }

  const normalizedEndpoint = cleanEndpoint.startsWith('/api/')
    ? cleanEndpoint.substring(4)
    : cleanEndpoint === '/api'
    ? ''
    : cleanEndpoint;
  const url = `${API_URL}${normalizedEndpoint}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      credentials: 'include', // Automatically passes and receives HttpOnly Secure cookies
      headers,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError' || options?.signal?.aborted) {
      throw err;
    }
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 800));
      return fetchJson(endpoint, options, retries - 1);
    }
    throw new ApiError(`ارتباط با سرور برقرار نشد: ${err?.message || 'خطای شبکه'}`, 'NETWORK_ERROR', 0);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
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
        return fetchJson(endpoint, options, retries - 1);
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
      const forbiddenMsg = data.message || (typeof data.error === 'string' ? data.error : '') || 'دسترسی غیرمجاز یا توکن امنیتی منقضی شده است (۴۰۳)';
      throw new ApiError(forbiddenMsg, code || 'AUTHORIZATION_ERROR', 403, details);
    }
    if (res.status === 429) {
      const rateLimitMsg = data.message || (typeof data.error === 'string' ? data.error : '') || data.errorObject?.message || 'تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً چند لحظه صبر کنید (۴۲۹)';
      throw new ApiError(rateLimitMsg, code || 'RATE_LIMIT_EXCEEDED', 429, details);
    }
    throw new ApiError(errorMessage, code, res.status, details);
  }
  const jsonResponse = await res.json().catch(() => ({}));
  if (jsonResponse?.csrfToken) {
    setCsrfToken(jsonResponse.csrfToken);
  }
  if (jsonResponse?.token) {
    setAuthToken(jsonResponse.token);
  }
  return jsonResponse;
}
