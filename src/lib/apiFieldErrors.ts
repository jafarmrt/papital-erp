/**
 * v9.0.328 (TD-901، ت۵ بسته ۱۰): خطاهای اعتبارسنجی سرور به تفکیک فیلد تا فرم هر پیام را زیر همان فیلد نشان دهد، نه فقط در
 * اعلان. پاسخ ۴۰۰ `validate` در `details.issues` مسیر و پیام فارسی هر خطا را دارد (`body.items.0.requestedQty`)؛ کلید
 * خروجی مسیر بی پیشوند `body.` است (`items.0.requestedQty`) و برای هر فیلد پیام نخست می‌ماند.
 */
export function apiFieldErrors(err: unknown, root = 'body'): Record<string, string> {
  const issues = (err as { details?: { issues?: unknown } } | null)?.details?.issues;
  const errors: Record<string, string> = {};
  if (!Array.isArray(issues)) return errors;
  for (const issue of issues) {
    const path = String((issue as { path?: unknown } | null)?.path ?? '');
    const message = String((issue as { message?: unknown } | null)?.message ?? '').trim();
    if (!message) continue;
    const key = path === root ? '' : path.startsWith(`${root}.`) ? path.slice(root.length + 1) : path;
    if (!(key in errors)) errors[key] = message;
  }
  return errors;
}
