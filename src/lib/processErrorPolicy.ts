/**
 * v7.0.40 (audit P2-11): سیاست واحد خطاهای مدیریت‌نشده پردازه در همه محیط‌ها.
 * پیش‌تر در غیرپروداکشن هر uncaughtException فقط لاگ می‌شد و پردازه در وضعیت نامعلوم ادامه می‌داد،
 * و وجود کلمه «FATAL» در متن هر خطایی (حتی پیام کاربر) پردازه را خاموش می‌کرد.
 */

/** قطع اتصال‌های PostgreSQL که استخر اتصال خودش بازیابی می‌کند و نباید سرور را خاموش کنند */
export const RECOVERABLE_CONNECTION_PATTERNS = [
  'terminating connection',
  'Connection terminated',
  'connection terminated',
  'ECONNRESET',
  'idle-in-transaction',
  'socket closed',
] as const;

export type ProcessErrorAction = 'ignore' | 'shutdown';

export function processErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

export function decideProcessErrorAction(err: unknown): ProcessErrorAction {
  const msg = processErrorMessage(err);
  return RECOVERABLE_CONNECTION_PATTERNS.some(p => msg.includes(p)) ? 'ignore' : 'shutdown';
}
