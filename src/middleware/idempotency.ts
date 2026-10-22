import { Request, Response, NextFunction } from 'express';
import { IDEMPOTENCY_KEY_TTL_SECONDS, IdempotencyService, type AcquireResult } from '../services/idempotency.service.js';
import { orm, type DbTransaction } from '../db/drizzle.js';
import { logger } from './logger.js';
import { asyncHandler } from './asyncHandler.js';
import { IDEMPOTENT } from './idempotencyMark.js';
import { IDEMPOTENT_REPLAY_MESSAGE, type IdempotentReplayBody } from '../lib/idempotentReplay.js';
import { getRequestContext, type RequestIdempotencyKey } from '../lib/requestContext.js';

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

  return Object.assign(asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
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
    // v10.2.35: a payroll or piecework write completes this key in its own transaction (`idempotentTransaction`)
    let pending: RequestIdempotencyKey | undefined;
    if (RESPONSE_NOT_KEPT_SCOPES.has(scope)) {
      const context = getRequestContext();
      if (context) {
        pending = { key: cleanKey, scope, userId, completedInTx: false };
        context.idempotency = pending;
      }
    }
    const stopHeartbeat = startLockHeartbeat(cleanKey, scope, userId, options.lockTimeoutSeconds || 60, options.ttlSeconds || IDEMPOTENCY_KEY_TTL_SECONDS);
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
          await IdempotencyService.saveResponse(cleanKey, res.statusCode, keptResponseBody(scope, parseBody(body)), { scope, userId });
        } else if (pending?.completedInTx) {
          // v10.2.35: a write of this request has committed with the key; a later failure keeps it, so a resend does not
          // run that write again and gets the notice instead
          logger.warn(`[Idempotency Middleware] Key ${cleanKey} kept after status ${res.statusCode}: a write of the request already committed`);
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
  }), { [IDEMPOTENT]: true });
}

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return { raw: body };
  }
}

/**
 * v10.2.33 (TD-1328): scopes whose answers are not kept with their key (payslips and their payments, piecework logs and
 * rates carry amounts and names), and the largest answer kept at all. A repeat of such a request gets the stored status
 * with `IDEMPOTENCY_REPLAY_BODY` instead of the first answer; it still never runs twice.
 */
export const RESPONSE_NOT_KEPT_SCOPES: ReadonlySet<string> = new Set(['payroll', 'piecework']);
export const IDEMPOTENCY_RESPONSE_MAX_BYTES = 64 * 1024;
export const IDEMPOTENCY_REPLAY_BODY: Readonly<IdempotentReplayBody> = Object.freeze({
  success: true,
  idempotentReplay: true,
  message: IDEMPOTENT_REPLAY_MESSAGE,
});

/** The answer kept with a key: the answer itself, or the replay body for a scope above or an answer over the limit */
export function keptResponseBody(scope: string, body: unknown): unknown {
  if (RESPONSE_NOT_KEPT_SCOPES.has(scope)) return IDEMPOTENCY_REPLAY_BODY;
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(body ?? null) ?? '', 'utf8');
  } catch {
    return IDEMPOTENCY_REPLAY_BODY;
  }
  return size > IDEMPOTENCY_RESPONSE_MAX_BYTES ? IDEMPOTENCY_REPLAY_BODY : body;
}

/**
 * v8.0.79 (TD-329): پنجره قفل کلید را در طول اجرای درخواست، هر یک‌سوم پنجره، از نو تمدید می‌کند.
 * v10.2.33 (TD-1328): until the request answers, as long as the key itself lives (`ttlSeconds`), never a fixed 30 minutes,
 * so a repeat of a request still running after half an hour waits instead of running it a second time.
 */
function startLockHeartbeat(key: string, scope: string, userId: number | null, lockTimeoutSeconds: number, ttlSeconds: number): () => void {
  const startedAt = Date.now();
  const holdMs = ttlSeconds * 1000;
  const timer = setInterval(() => {
    if (Date.now() - startedAt > holdMs) {
      clearInterval(timer);
      return;
    }
    void IdempotencyService.extendLock(key, { scope, userId, lockTimeoutSeconds });
  }, Math.max(200, Math.floor((lockTimeoutSeconds * 1000) / 3)));
  timer.unref();
  return () => clearInterval(timer);
}

/** A service answer that refuses the request without throwing (`{ status, error }`, e.g. payslip generation) */
function isRefusal(value: unknown): boolean {
  return typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string';
}

/**
 * v10.2.35: the transaction of a payroll or piecework write. Inside a request that holds such a key (set by the
 * `idempotency` middleware) the key is completed in the same commit (`completeInTransaction`), unless the write refused
 * the request by returning `{ error }` (the key is then released as before); anywhere else (a script, a request of
 * another scope) it is a plain `orm.transaction`.
 */
export async function idempotentTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  const pending = getRequestContext()?.idempotency;
  let completed = false;
  const result = await orm.transaction(async (tx) => {
    const out = await fn(tx);
    if (pending && !isRefusal(out)) {
      await IdempotencyService.completeInTransaction(tx, pending);
      completed = true;
    }
    return out;
  });
  if (pending && completed) pending.completedInTx = true;
  return result;
}
