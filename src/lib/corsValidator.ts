/**
 * CORS Origin Validator (SEC-005 / S-1 / TD-088)
 *
 * Implements strict CORS origin validation:
 * - In Development (NODE_ENV !== 'production'):
 *   Allows localhost, AI Studio preview domains (*.run.app, *.google.com, *.googleusercontent.com),
 *   explicit ALLOWED_ORIGINS, APP_URL, and logs non-listed development origins.
 *
 * - In Production (NODE_ENV === 'production'):
 *   STRICT PERIMETER HARDENING:
 *   Rejects any origin not explicitly listed in ALLOWED_ORIGINS or matching APP_URL.
 *   Blanket wildcards ('*') or regexes matching *.run.app or *.googleusercontent.com
 *   are strictly FORBIDDEN with credentials: true in production, preventing arbitrary
 *   Cloud Run services or attacker-hosted pages from executing credentialed requests.
 */

export interface CorsValidationOptions {
  nodeEnv?: string;
  allowedOrigins?: string | string[];
  appUrl?: string;
}

export interface CorsValidationResult {
  allowed: boolean;
  fatal?: boolean;
  reason?: string;
  devMode?: boolean;
}

export function parseAllowedOrigins(allowedOriginsInput?: string | string[]): string[] {
  if (!allowedOriginsInput) return [];
  if (Array.isArray(allowedOriginsInput)) {
    return allowedOriginsInput.map(o => o.trim()).filter(Boolean);
  }
  return allowedOriginsInput.split(',').map(o => o.trim()).filter(Boolean);
}

export function validateCorsOrigin(
  origin: string | undefined,
  options: CorsValidationOptions = {}
): CorsValidationResult {
  // 1. Same-origin or non-browser requests without Origin header
  if (!origin) {
    return { allowed: true };
  }

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const isProduction = nodeEnv === 'production';
  const allowedOrigins = parseAllowedOrigins(options.allowedOrigins ?? process.env.ALLOWED_ORIGINS);

  // 2. Check explicit APP_URL match
  const appUrlStr = options.appUrl ?? process.env.APP_URL;
  let isAppUrl = false;
  if (appUrlStr) {
    try {
      const appOrigin = new URL(appUrlStr).origin;
      if (origin === appOrigin) {
        isAppUrl = true;
      }
    } catch {
      // ignore invalid APP_URL format
    }
  }

  // 3. Explicit allowlist match or exact APP_URL match
  if (allowedOrigins.includes(origin) || isAppUrl) {
    return { allowed: true };
  }

  // 4. Production Mode: Strict Perimeter Enforcement
  if (isProduction) {
    // If production has no allowedOrigins and no appUrl configured, server is misconfigured for cross-origin
    if (allowedOrigins.length === 0 && !isAppUrl) {
      return {
        allowed: false,
        fatal: true,
        reason: 'CORS not configured in production — ALLOWED_ORIGINS or APP_URL must be explicitly specified'
      };
    }

    return {
      allowed: false,
      fatal: false,
      reason: `Origin '${origin}' not allowed by production CORS policy`
    };
  }

  // 5. Non-Production Mode (development, testing, staging):
  // Check development helpers
  const isCloudRunOrAiStudio = /^https:\/\/([a-zA-Z0-9-]+\.)*(run\.app|google\.com|aistudio\.google\.com|googleusercontent\.com)$/.test(origin);
  const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  if (isCloudRunOrAiStudio || isLocalhost || allowedOrigins.includes('*')) {
    return { allowed: true, devMode: true };
  }

  if (allowedOrigins.length === 0) {
    return { allowed: true, devMode: true };
  }

  // Non-production fallback
  return {
    allowed: true,
    devMode: true,
    reason: `Allowed non-listed origin in development: ${origin}`
  };
}
