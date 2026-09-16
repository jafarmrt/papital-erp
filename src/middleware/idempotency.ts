import { Request, Response, NextFunction } from 'express';
import { IdempotencyService } from '../services/idempotency.service.js';
import { logger } from './logger.js';

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

  return async (req: Request, res: Response, next: NextFunction) => {
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
    const userId = (req as any).user?.id ?? null;
    const scope = options.scope || req.baseUrl || 'api';

    try {
      const result = await IdempotencyService.acquireKey(cleanKey, {
        scope,
        requestMethod: req.method,
        requestPath: req.originalUrl,
        requestPayload: req.body,
        userId,
        ttlSeconds: options.ttlSeconds,
        lockTimeoutSeconds: options.lockTimeoutSeconds
      });

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
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);

      let saved = false;
      const saveResponseOnce = async (body: any) => {
        if (saved) return;
        saved = true;
        try {
          let parsedBody = body;
          if (typeof body === 'string') {
            try {
              parsedBody = JSON.parse(body);
            } catch {
              parsedBody = { raw: body };
            }
          }
          await IdempotencyService.saveResponse(cleanKey, res.statusCode, parsedBody, {
            scope,
            userId
          });
        } catch (saveErr) {
          logger.error(`[Idempotency Middleware] Failed to save response for key ${cleanKey}:`, saveErr);
        }
      };

      res.json = function (body: any): Response {
        saveResponseOnce(body);
        res.setHeader('X-Idempotency-Key', cleanKey);
        res.setHeader('X-Idempotency-Scope', scope);
        return originalJson(body);
      };

      res.send = function (body: any): Response {
        saveResponseOnce(body);
        res.setHeader('X-Idempotency-Key', cleanKey);
        res.setHeader('X-Idempotency-Scope', scope);
        return originalSend(body);
      };

      next();
    } catch (err: any) {
      logger.error(`[Idempotency Middleware] Error handling key ${cleanKey}:`, err);
      await IdempotencyService.markFailed(cleanKey, err, {
        scope,
        userId
      });
      next(err);
    }
  };
}
