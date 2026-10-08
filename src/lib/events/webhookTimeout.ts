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
