/** v10.0.34 (OBS-R1-78): پیام پاسخ ناموفق ورود اکسل؛ پیام سرور اگر باشد، وگرنه پیامی که می‌گوید چیزی ثبت نشد */
export function importFailureMessage(res: unknown): string {
  const message = res && typeof res === 'object' && 'message' in res ? (res as { message?: unknown }).message : undefined;
  return typeof message === 'string' && message.trim()
    ? message
    : 'ورود داده‌های اکسل انجام نشد و چیزی ثبت نشد.';
}
