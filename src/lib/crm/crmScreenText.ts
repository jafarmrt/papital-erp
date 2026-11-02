/**
 * v10.2.0: three small rules of the sales lead screens, found while taking the user guide pictures of 10.1.
 *
 * - A lead moved to «فروش موفق» said a proforma notice went to the warehouse; no such notice exists. The server only
 *   notifies the holders of `crm.manage` (`notifySalesOnWonLead`), so the message says that.
 * - The seller and follow-up pickers kept only personnel whose status was exactly «فعال», so a status with a space, or
 *   «مرخصی», hid a person; only a personnel who left («قطع همکاری») is left out, as in the workshop recipient rule.
 * - An activity result is free text, but older entries hold an English word («positive»), shown as is in the drawer;
 *   such words are shown in Persian.
 */
/** the personnel status of one who left (as `TERMINATED_EMPLOYMENT_STATUS` of payroll; CRM does not import payroll) */
const LEFT_STATUS = 'قطع همکاری';

export const WON_LEAD_MESSAGE = 'معامله با موفقیت بسته شد و به مدیران فروش خبر داده شد.';

export function crmAssignablePersonnel<T extends { employmentStatus?: string | null }>(people: readonly T[]): T[] {
  return people.filter(p => String(p.employmentStatus ?? '').trim() !== LEFT_STATUS);
}

const LEGACY_RESULT_LABELS: Record<string, string> = {
  positive: 'مثبت',
  negative: 'منفی',
  neutral: 'بی‌نتیجه',
};

/** The result of an activity as shown: an older English word in Persian, anything else as written */
export function activityResultLabel(result: string | null | undefined): string {
  const text = String(result ?? '').trim();
  return LEGACY_RESULT_LABELS[text.toLowerCase()] ?? text;
}

/**
 * v11 (owner report 11 Aban 1405): a follow-up belongs to the user whose personnel row is its responsible
 * (`ownFollowupCondition`). A responsible personnel with no linked user owns it for nobody: it is in no inbox, no
 * «پیگیری‌های من» and gets no due reminder. The follow-up window says so when such a person is picked.
 */
export const FOLLOWUP_ASSIGNEE_NO_USER_TEXT =
  'این همکار به هیچ حساب کاربری وصل نیست، پس این پیگیری در کارتابل هیچ‌کس دیده نمی‌شود و یادآوری هم برای آن نمی‌آید. در صفحهٔ «پرسنل»، او را به حساب کاربری‌اش وصل کنید.';

export const FOLLOWUP_ASSIGNEE_NO_USER_TAG = 'بدون حساب کاربری';

/** Whether a personnel pick row is known to have no linked user (a row without the `userId` field is not judged) */
export function personnelHasNoUser(p: { userId?: number | string | null } | null | undefined): boolean {
  if (!p || !('userId' in p)) return false;
  return p.userId === null || p.userId === undefined || String(p.userId).trim() === '' || Number(p.userId) <= 0;
}
