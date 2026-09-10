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

export function setAuthToken(token: string | null | undefined): void {
  inMemoryAuthToken = token || null;
}

export function getAuthToken(): string | null {
  return inMemoryAuthToken;
}

export async function fetchJson<T = any>(endpoint: string, options?: RequestInit, retries = 1): Promise<T> {
  const csrfToken = getCsrfToken();
  const authToken = getAuthToken();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
    ...((options?.headers as Record<string, string>) || {}),
  };

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
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
      const isPublicEndpoint = 
        endpoint.includes('/login') || 
        endpoint.includes('/check-setup') || 
        endpoint.includes('/public-settings') || 
        endpoint.includes('/setup') ||
        endpoint.includes('/auth/me') ||
        endpoint.includes('/me');

      if (typeof window !== 'undefined' && !isPublicEndpoint) {
        setCsrfToken(null);
        setAuthToken(null);
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
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
      throw new ApiError(data.message || (typeof data.error === 'string' ? data.error : '') || 'دسترسی غیرمجاز یا توکن CSRF نامعتبر (۴۰۳)', code || 'AUTHORIZATION_ERROR', 403, details);
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
