import { createHash, timingSafeEqual } from 'node:crypto';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../errors/customErrors.js';
import { isEchoSimulatorEnvironment } from '../../lib/ssrfGuard.js';
import { EventActionEngineService } from './eventActionEngineService.js';

/**
 * v10.0.28 (OBS-R2-80): شبیه‌ساز echo وب‌هوک فقط در آزمون و توسعه پاسخ می‌دهد، همان محیطی که TD-704 مقصد خروجی آن را
 * محدود کرد؛ در تولید این نشانی بی ورود 404 است و هیچ سرآیندی بازتاب نمی‌شود. توکن با مقایسه زمان‌ثابت سنجیده می‌شود
 * (پیش‌تر `!==`) و پیام‌ها فارسی‌اند.
 */
export interface EchoRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

const PROTECTED_HEADERS = new Set(['cookie', 'authorization', 'x-csrf-token', 'x-xsrf-token']);

function sameToken(received: string, expected: string): boolean {
  const a = createHash('sha256').update(received).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function webhookEchoAnswer(req: EchoRequest, env: NodeJS.ProcessEnv = process.env) {
  if (!isEchoSimulatorEnvironment(env)) {
    throw new NotFoundError('این نشانی وجود ندارد.', undefined, 'WEBHOOK_ECHO_UNAVAILABLE');
  }
  const expected = await EventActionEngineService.getWebhookSecretToken();
  if (!expected) {
    throw new ForbiddenError('توکن امضای وب‌هوک سامانه تعیین نشده و شبیه‌ساز غیرفعال است.', undefined, 'WEBHOOK_ECHO_DISABLED');
  }
  const raw = req.headers['x-erp-signature-token'];
  const received = Array.isArray(raw) ? raw[0] : raw;
  if (typeof received !== 'string' || !sameToken(received, expected)) {
    throw new UnauthorizedError('توکن امضای وب‌هوک معتبر نیست.');
  }
  // کوکی و نشانه‌های ورود هرگز بازتاب نمی‌شوند
  const headers: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const k = key.toLowerCase();
    headers[k] = PROTECTED_HEADERS.has(k) ? '[PROTECTED]' : value;
  }
  return {
    success: true,
    message: 'وب‌هوک شبیه‌ساز دریافت شد.',
    echoed: { method: req.method, headers, body: req.body },
    timestamp: new Date().toISOString(),
  };
}
