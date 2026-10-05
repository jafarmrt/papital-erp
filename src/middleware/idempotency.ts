import { Request, Response, NextFunction } from 'express';
import { IdempotencyService, type AcquireResult } from '../services/idempotency.service.js';
import { logger } from './logger.js';
import { asyncHandler } from './asyncHandler.js';

export interface IdempotencyMiddlewareOptions {
  scope?: string;
  headerName?: string;
  ttlSeconds?: number;
  lockTimeoutSeconds?: number;
  /**
   * If true, mutating requests (POST, PUT, PATCH, DELETE) lacking an Idempotency-Key
   * will be rejected with 400 Bad Request (fail-closed policy for sensitive financial/inventory routes).
   */
  required?: boolean;
}

/**
 * Express middleware to enforce request idempotency via Idempotency-Key headers.
 */
export function idempotency(options: IdempotencyMiddlewareOptions = {}) {
  const headerName = (options.headerName || 'idempotency-key').toLowerCase();
  const altHeaderName = 'x-idempotency-key';

  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    // Only apply idempotency to mutating HTTP methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
      return next();
    }

    const key = (req.headers[headerName] || req.headers[altHeaderName] || req.body?.idempotencyKey) as string | undefined;

    if (!key || typeof key !== 'string' || key.trim() === '') {
      if (options.required) {
        return res.status(400).json({
          error: 'ارسال شناسه ایدمپوتنسی (Idempotency-Key) برای این عملیات مالی و انبارداری الزامی است.',
          code: 'IDEMPOTENCY_KEY_REQUIRED'
        });
      }
      return next();
    }

    const cleanKey = key.trim();
    const userId = (req as Request & { user?: { id?: number } }).user?.id ?? null;
    const scope = options.scope || req.baseUrl || 'api';

    let result: AcquireResult;
    try {
      result = await IdempotencyService.acquireKey(cleanKey, {
        scope,
        requestMethod: req.method,
        requestPath: req.originalUrl,
        requestPayload: req.body,
        userId,
        ttlSeconds: options.ttlSeconds,
        lockTimeoutSeconds: options.lockTimeoutSeconds
      });
    } catch (err) {
      // v8.0.79 (TD-329): کلیدی گرفته نشده؛ ردیف موجود (شاید درخواست در جریان دیگری) دست نمی‌خورد
      logger.error(`[Idempotency Middleware] Error handling key ${cleanKey}:`, err);
      return next(err);
    }

    if (result.state === 'mismatch') {
      return res.status(422).json({
        error: 'این شناسه تکرار درخواست (Idempotency-Key) پیش‌تر برای درخواست دیگری (مسیر یا محتوای متفاوت) به کار رفته است؛ درخواست اجرا نشد.',
        code: 'IDEMPOTENCY_KEY_REUSED'
      });
    }

    if (result.state === 'cached') {
      res.setHeader('X-Idempotency-Hit', 'true');
      res.setHeader('X-Idempotency-Key', cleanKey);
      res.setHeader('X-Idempotency-Scope', scope);
      return res.status(result.responseStatus).json(result.responseBody);
    }

    if (result.state === 'in_flight') {
      res.setHeader('Retry-After', '2');
      return res.status(409).json({
        error: 'درخواست تکراری در حال پردازش است. لطفاً چند لحظه دیگر دوباره تلاش کنید.',
        code: 'IDEMPOTENCY_IN_FLIGHT',
        lockedUntil: result.lockedUntil
      });
    }

    // State is 'acquired' - intercept response
    const stopHeartbeat = startLockHeartbeat(cleanKey, scope, userId, options.lockTimeoutSeconds || 60);
    res.on('finish', stopHeartbeat);
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    /**
     * v8.0.79 (TD-329): فقط پاسخ موفق (۲xx) ذخیره می‌شود و پاسخ ناموفق کلید را آزاد می‌کند؛ هر دو پیش از فرستادن پاسخ
     * انجام می‌شوند تا تکرار بلافاصله پس از پاسخ، پاسخ ذخیره‌شده را بگیرد نه «در حال پردازش».
     */
    const finalize = async (body: unknown): Promise<void> => {
      stopHeartbeat();
      try {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          await IdempotencyService.saveResponse(cleanKey, res.statusCode, parseBody(body), { scope, userId });
        } else {
          await IdempotencyService.releaseKey(cleanKey, { scope, userId });
        }
      } catch (saveErr) {
        logger.error(`[Idempotency Middleware] Failed to save response for key ${cleanKey}:`, saveErr);
      }
    };

    let finalizing = false;
    const sendAfterFinalize = (body: unknown, send: () => Response): Response => {
      if (finalizing) return send();
      finalizing = true;
      res.setHeader('X-Idempotency-Key', cleanKey);
      res.setHeader('X-Idempotency-Scope', scope);
      void finalize(body).then(() => {
        try {
          send();
        } catch (sendErr) {
          logger.error(`[Idempotency Middleware] Failed to send response for key ${cleanKey}:`, sendErr);
          if (!res.headersSent) res.status(500).end();
        }
      });
      return res;
    };

    res.json = (body: unknown): Response => sendAfterFinalize(body, () => originalJson(body));
    res.send = (body?: unknown): Response => sendAfterFinalize(body, () => originalSend(body));

    next();
  });
}

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return { raw: body };
  }
}

/** بیشینه زمانی که کلید یک درخواست زنده نگه داشته می‌شود (پس از آن پنجره قفل عادی منقضی می‌شود) */
const MAX_LOCK_HOLD_MS = 30 * 60 * 1000;

/** v8.0.79 (TD-329): پنجره قفل کلید را در طول اجرای درخواست، هر یک‌سوم پنجره، از نو تمدید می‌کند */
function startLockHeartbeat(key: string, scope: string, userId: number | null, lockTimeoutSeconds: number): () => void {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - startedAt > MAX_LOCK_HOLD_MS) {
      clearInterval(timer);
      return;
    }
    void IdempotencyService.extendLock(key, { scope, userId, lockTimeoutSeconds });
  }, Math.max(200, Math.floor((lockTimeoutSeconds * 1000) / 3)));
  timer.unref();
  return () => clearInterval(timer);
}
