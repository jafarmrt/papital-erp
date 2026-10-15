/**
 * v10.1.13 (طرح آغاز ۱۰.۱، L4): صفحه «معرفی و به‌روزرسانی‌ها» برداشته شد و فقط شماره نسخه در پای منو دیده می‌شود.
 * شماره از `GET /api/health` می‌آید (برای همه باز، TD-601) و با رقم فارسی نوشته می‌شود.
 */
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

export function appVersionLabel(version: unknown): string {
  const text = String(version ?? '').trim().replace(/^v/i, '');
  if (!/^\d+(\.\d+)*$/.test(text)) return '';
  return `نسخه ${text.replace(/\d/g, d => PERSIAN[Number(d)])}`;
}
