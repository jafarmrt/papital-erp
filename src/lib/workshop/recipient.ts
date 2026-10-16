/**
 * v10.1.36 (N-01, TD-1283, decision ت۴ الف of the mobile workshop plan): «تحویل‌گیرنده», the personnel who receives a
 * remittance or a material allocation and confirms it in the workshop cartable. One rule for the document and the
 * allocation paths and their forms.
 */
export const RECIPIENT_INVALID = 'RECIPIENT_PERSONNEL_INVALID';
export const RECIPIENT_REMITTANCE_ONLY = 'RECIPIENT_REMITTANCE_ONLY';
export const RECIPIENT_INVALID_MESSAGE = 'تحویل‌گیرنده باید پرسنل فعال باشد؛ پرسنل انتخاب‌شده پیدا نشد، حذف شده یا قطع همکاری کرده است.';
export const RECIPIENT_REMITTANCE_ONLY_MESSAGE = 'تحویل‌گیرنده فقط برای حواله خروج ثبت می‌شود.';
/** The personnel status that ends work; such a personnel never receives goods. */
export const RECIPIENT_TERMINATED_STATUS = 'قطع همکاری';

/**
 * The recipient a body sends: `undefined` when not sent, `null` when cleared, a positive whole id, else `NaN`
 * (the caller refuses it).
 */
export function parseRecipientPersonnelId(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || (typeof raw === 'string' && raw.trim() === '')) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : Number.NaN;
}
