/**
 * v9.0.359 (TD-720، B15-18): مهلت پاسخ درگاه وب‌هوک (مشترک فرم و کارساز).
 * فرم `timeoutMs` می‌فرستاد ولی مسیر ساخت فقط `timeoutSeconds` را می‌خواند، پس هر مهلت واردشده بی‌صدا ۱۰ ثانیه می‌شد.
 */
export const WEBHOOK_TIMEOUT_MIN_MS = 1000;
export const WEBHOOK_TIMEOUT_MAX_MS = 30000;
export const WEBHOOK_TIMEOUT_DEFAULT_MS = 5000;

export type WebhookTimeoutResult = { ok: true; timeoutMs: number | undefined } | { ok: false; message: string };

/** مهلت بدنه: `timeoutMs`، وگرنه `timeoutSeconds` قدیمی × ۱۰۰۰؛ هیچ‌کدام = undefined (پیش‌فرض یا مقدار ذخیره‌شده) */
export function resolveWebhookTimeoutMs(body: { timeoutMs?: unknown; timeoutSeconds?: unknown }): WebhookTimeoutResult {
  const raw = body.timeoutMs ?? (body.timeoutSeconds !== undefined && body.timeoutSeconds !== null && body.timeoutSeconds !== ''
    ? Number(body.timeoutSeconds) * 1000
    : undefined);
  if (raw === undefined || raw === null || raw === '') return { ok: true, timeoutMs: undefined };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < WEBHOOK_TIMEOUT_MIN_MS || value > WEBHOOK_TIMEOUT_MAX_MS) {
    return { ok: false, message: 'مهلت پاسخ وب‌هوک باید عدد درستی از ۱٬۰۰۰ تا ۳۰٬۰۰۰ میلی‌ثانیه باشد.' };
  }
  return { ok: true, timeoutMs: value };
}

export const WEBHOOK_RETRY_LIMIT_MIN = 1;
export const WEBHOOK_RETRY_LIMIT_MAX = 10;

export type WebhookFormLimits = { ok: true; retryLimit: number; timeoutMs: number } | { ok: false; message: string };

/**
 * v10.1.51 (OBS-R2-87): the webhook form's retry limit and timeout as typed (the `DecimalInput` text, '' when empty or
 * invalid). An empty or wrong entry is an error the form shows, never silently the default (`parseInt(v) || default`).
 */
export function webhookFormLimits(form: { retryLimit: string; timeoutMs: string }): WebhookFormLimits {
  const retry = form.retryLimit.trim() === '' ? NaN : Number(form.retryLimit);
  if (!Number.isInteger(retry) || retry < WEBHOOK_RETRY_LIMIT_MIN || retry > WEBHOOK_RETRY_LIMIT_MAX) {
    return { ok: false, message: 'سقف تلاش مجدد وب‌هوک باید عدد درستی از ۱ تا ۱۰ باشد.' };
  }
  const timeout = resolveWebhookTimeoutMs({ timeoutMs: form.timeoutMs.trim() === '' ? NaN : Number(form.timeoutMs) });
  if (!timeout.ok) return timeout;
  return { ok: true, retryLimit: retry, timeoutMs: timeout.timeoutMs ?? WEBHOOK_TIMEOUT_DEFAULT_MS };
}
