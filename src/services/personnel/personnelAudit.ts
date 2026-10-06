import type { personnel } from '../../db/schema.js';

/**
 * v9.0.26 (TD-437، AGENTS §5): ممیزی پرسنل مقدار قبل و بعد دارد. ویرایش فقط فیلدهای تغییرکرده را ثبت می‌کند، ثبت و حذف
 * کل پرونده را؛ رمز نوبیتکس هرگز در ممیزی نمی‌آید و فقط «تغییر کرد» علامت می‌خورد. پیش‌تر `details` خالی بود و تغییر
 * حقوق، شبا یا کارت پرداخت ردپای قابل بازسازی نداشت.
 */
type PersonnelRow = typeof personnel.$inferSelect;

const AUDITED_KEYS = [
  'firstName', 'lastName', 'fullName', 'personnelCode', 'userId', 'gender', 'birthDate', 'nationality', 'nationalId', 'phone',
  'employmentStatus', 'salaryType', 'monthlySalary', 'jobTitle', 'education', 'endDate', 'terminationReason', 'specializedSkills',
  'otherSkills', 'referralSource', 'cardNumber', 'accountNumber', 'shebaNumber', 'bankName', 'nobitexUsername', 'address', 'notes',
] as const satisfies ReadonlyArray<keyof PersonnelRow>;

type AuditedKey = typeof AUDITED_KEYS[number];
export type PersonnelAuditSnapshot = Partial<Record<AuditedKey, unknown>>;

/** مقدار قابل مقایسه و ذخیره: Money و عدد به متن، null و undefined به '' */
function auditValue(v: unknown): unknown {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'toString' in v) return String(v);
  return v;
}

export function personnelAuditSnapshot(row: Partial<PersonnelRow>): PersonnelAuditSnapshot {
  const out: PersonnelAuditSnapshot = {};
  for (const k of AUDITED_KEYS) out[k] = auditValue(row[k]);
  return out;
}

/** فقط فیلدهای تغییرکرده، و اینکه رمز نوبیتکس عوض شد یا نه */
export function personnelAuditChanges(before: Partial<PersonnelRow>, after: Partial<PersonnelRow>) {
  const b = personnelAuditSnapshot(before);
  const a = personnelAuditSnapshot(after);
  const changedBefore: PersonnelAuditSnapshot = {};
  const changedAfter: PersonnelAuditSnapshot = {};
  for (const k of AUDITED_KEYS) {
    if (String(b[k]) !== String(a[k])) {
      changedBefore[k] = b[k];
      changedAfter[k] = a[k];
    }
  }
  const nobitexPasswordChanged = (before.nobitexPassword ?? '') !== (after.nobitexPassword ?? '');
  return { before: changedBefore, after: changedAfter, ...(nobitexPasswordChanged ? { nobitexPasswordChanged: true } : {}) };
}
