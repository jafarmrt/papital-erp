/**
 * OBS-R2-55: the salary model of a personnel and its Persian label. `none` (the default of a new personnel and of older rows)
 * pays like `piecework` (no fixed salary), and the form shows it under its own Persian label instead of passing it off as
 * «کارمزدی» or showing the stored code.
 */
export const SALARY_TYPES = ['none', 'piecework', 'monthly_fixed', 'mixed'] as const;
export type SalaryType = (typeof SALARY_TYPES)[number];

export const SALARY_TYPE_LABELS: Record<SalaryType, string> = {
  none: 'تعیین‌نشده — مانند کارمزدی، بی حقوق ثابت',
  piecework: 'کارمزدی — کارمزد بر اساس عناوین کاری',
  monthly_fixed: 'حقوق ثابت ماهانه — بدون کارمزد',
  mixed: 'ترکیبی — حقوق ثابت + کارمزد عناوین کاری',
};

/** A stored value outside the list (empty included) is read as `none`, as the server stores it */
export function salaryTypeOf(value: unknown): SalaryType {
  return (SALARY_TYPES as readonly string[]).includes(String(value)) ? (String(value) as SalaryType) : 'none';
}
