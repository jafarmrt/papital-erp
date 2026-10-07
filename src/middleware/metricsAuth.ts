import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret, AUTH_COOKIE_NAME, JWT_VERIFY_OPTIONS, resolveLiveSession } from './auth.js';
import { AuthUserPayload } from '../types.js';
import { logger } from './logger.js';
import { safeCompareTokens } from '../lib/timingSafeCompare.js';
import { SYSTEM_ADMIN_ROLE } from '../lib/permissions/permissionCatalog.js';
import { asyncHandler } from './asyncHandler.js';

export { safeCompareTokens };

/**
 * Verifies credentials for the Prometheus metrics endpoints (/metrics, /api/metrics).
 * Addresses finding S-3 / Subphase 2.3:
 * - Scrapers can authenticate via process.env.METRICS_TOKEN (Authorization: Bearer <token> or X-Metrics-Token).
 * - Operators/Admins can authenticate via valid JWT session (cookie auth_token or Authorization: Bearer <jwt>) with role === 'admin'.
 * - Arbitrary or unverified Bearer tokens (e.g. 'Bearer foo') are strictly rejected with 401.
 * - Authenticated non-admin users receive 403 Forbidden.
 * - v9.0.146 (TD-599): the session is checked live like `authenticateToken` (deleted user, stale tokenVersion, current role).
 */
export const metricsAuthMiddleware = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const configuredMetricsToken = process.env.METRICS_TOKEN?.trim();

  // 1. Extract bearer token or X-Metrics-Token if provided
  const authHeader = req.headers['authorization'];
  let bearerToken: string | null = null;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.slice(7).trim();
  }
  const xMetricsToken = (req.headers['x-metrics-token'] as string)?.trim() || null;
  const candidateScrapeToken = bearerToken || xMetricsToken;

  // 2. Check if candidate token matches configured METRICS_TOKEN
  if (configuredMetricsToken && candidateScrapeToken && safeCompareTokens(candidateScrapeToken, configuredMetricsToken)) {
    return next();
  }

  // 3. Fallback: Authenticate via admin JWT token (cookie or Authorization Bearer)
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME] || req.cookies?.['token'];
  const candidateJwt = bearerToken || (typeof cookieToken === 'string' ? cookieToken.trim() : null);

  if (!candidateJwt) {
    return res.status(401).json({
      error: 'دسترسی به متریک‌های پرومتئوس نیازمند توکن اختصاصی معتبر (METRICS_TOKEN) یا نشست مدیر است.'
    });
  }

  // 4. Verify the candidate JWT
  let decoded: AuthUserPayload;
  try {
    decoded = jwt.verify(candidateJwt, getJwtSecret(), JWT_VERIFY_OPTIONS) as AuthUserPayload;
  } catch {
    return res.status(401).json({
      error: 'احراز هویت متریک‌ها ناموفق بود: توکن ارائه شده نامعتبر یا منقضی است.'
    });
  }
  if (!decoded || !decoded.id) {
    return res.status(401).json({ error: 'توکن احراز هویت نامعتبر است.' });
  }

  // 5. Live session: a deleted or demoted admin (tokenVersion bumped) is refused like on every other route
  const live = await resolveLiveSession(decoded);
  if (!live.ok) {
    return res.status(live.status).json({ error: live.error });
  }

  // Role check: Only the system admin may inspect internal system metrics (live role, not the token's)
  if (live.user.role !== SYSTEM_ADMIN_ROLE) {
    logger.warn(`[Metrics] Non-admin user (ID: ${live.user.id}, Role: ${live.user.role}) attempted to access metrics`);
    return res.status(403).json({ error: 'تنها کاربران با نقش مدیر (Admin) مجاز به مشاهده متریک‌های سامانه هستند.' });
  }

  req.user = live.user;
  return next();
});
