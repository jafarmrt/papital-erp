import { serverTimestampToUtcIso } from '../serverTimestamp';
import { toPersianDigits } from '../../utils/persianNumber';

/**
 * v9.0.436 (TD-725، B15-23): زمان نسبی اعلان («همین الان»، «۵ دقیقه پیش») از زمان سرور UTC؛ مقدار بی‌منطقه با Z خوانده
 * می‌شود و عدد با رقم فارسی است. پیش‌تر رشته بی‌منطقه ساعت منطقه توافقی خوانده می‌شد و اعلان تازه «3 ساعت پیش» بود.
 */
export function notificationRelativeTime(timeStr: string | null | undefined, now: Date = new Date()): string {
  const iso = serverTimestampToUtcIso(timeStr);
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMins < 1) return 'همین الان';
  if (diffMins < 60) return `${toPersianDigits(diffMins)} دقیقه پیش`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${toPersianDigits(diffHours)} ساعت پیش`;
  return `${toPersianDigits(Math.floor(diffHours / 24))} روز پیش`;
}
