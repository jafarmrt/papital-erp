import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getJwtSecret, AUTH_COOKIE_NAME } from './auth.js';
import { AuthUserPayload } from '../types.js';
import { logger } from './logger.js';

/**
 * Performs a constant-time comparison of two string tokens using SHA-256 hashes
 * to eliminate timing side-channel attacks.
 */
export function safeCompareTokens(a: string, b: string): boolean {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const hashA = crypto.createHash('sha256').update(a.trim()).digest();
  const hashB = crypto.createHash('sha256').update(b.trim()).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Verifies credentials for the Prometheus metrics endpoints (/metrics, /api/metrics).
 * Addresses finding S-3 / Subphase 2.3:
 * - Scrapers can authenticate via process.env.METRICS_TOKEN (Authorization: Bearer <token> or X-Metrics-Token).
 * - Operators/Admins can authenticate via valid JWT session (cookie auth_token or Authorization: Bearer <jwt>) with role === 'admin'.
 * - Arbitrary or unverified Bearer tokens (e.g. 'Bearer foo') are strictly rejected with 401.
 * - Authenticated non-admin users receive 403 Forbidden.
 */
export const metricsAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
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
  try {
    const jwtSecret = getJwtSecret();
    const decoded = jwt.verify(candidateJwt, jwtSecret) as AuthUserPayload;

    if (!decoded || !decoded.id) {
      return res.status(401).json({ error: 'توکن احراز هویت نامعتبر است.' });
    }

    // Role check: Only 'admin' users may inspect internal system metrics
    if (decoded.role !== 'admin') {
      logger.warn(`[Metrics] Non-admin user (ID: ${decoded.id}, Role: ${decoded.role}) attempted to access metrics`);
      return res.status(403).json({ error: 'تنها کاربران با نقش مدیر (Admin) مجاز به مشاهده متریک‌های سامانه هستند.' });
    }

    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({
      error: 'احراز هویت متریک‌ها ناموفق بود: توکن ارائه شده نامعتبر یا منقضی است.'
    });
  }
};
