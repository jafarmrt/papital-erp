import { Request, Response, NextFunction } from 'express';

/**
 * v9.0.164 (TD-584, product-owner decision ت۲): the port opens at once (AGENTS §8), but until the background
 * migrations, seed and engine start finish, every `/api` request except the health probes answers 503 with
 * `Retry-After` and code `SYSTEM_STARTING`; the browser shows a waiting page and retries. The WooCommerce
 * webhook is left open because it must always answer 200 (AGENTS §4). Only `server.ts` turns the gate on
 * (`beginStartup`); an app built for tests is never gated.
 */
export const SYSTEM_STARTING_CODE = 'SYSTEM_STARTING';
export const SYSTEM_STARTING_MESSAGE = 'سامانه در حال به‌روزرسانی است؛ چند لحظه دیگر دوباره تلاش کنید';
export const SYSTEM_STARTING_RETRY_AFTER_SECONDS = 5;

let gateEnabled = false;
let startupComplete = false;

/** Called by server.ts before the app is built: the API stays closed until `markStartupComplete` */
export function beginStartup(): void {
  gateEnabled = true;
  startupComplete = false;
}

/** Called once migrations, seed and the background engines have started */
export function markStartupComplete(): void {
  startupComplete = true;
}

export function isStartupComplete(): boolean {
  return startupComplete;
}

/** True while a gated server is still starting */
export function isStarting(): boolean {
  return gateEnabled && !startupComplete;
}

const OPEN_DURING_STARTUP = [/^\/health(\/|$)/, /^\/woocommerce\/webhook(\/|$)/];

/** Mounted on `/api`; `req.path` is relative to that mount */
export function startupGate(req: Request, res: Response, next: NextFunction): void {
  if (!isStarting() || OPEN_DURING_STARTUP.some(re => re.test(req.path))) {
    next();
    return;
  }
  res.set('Retry-After', String(SYSTEM_STARTING_RETRY_AFTER_SECONDS));
  res.status(503).json({
    error: SYSTEM_STARTING_MESSAGE,
    message: SYSTEM_STARTING_MESSAGE,
    code: SYSTEM_STARTING_CODE,
    errorCode: SYSTEM_STARTING_CODE,
    statusCode: 503,
    success: false,
  });
}
