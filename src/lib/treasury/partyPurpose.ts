/**
 * v9.0.82 (TD-507، تصمیم مالک محصول ت۴ الف): هدف دریافت و پرداخت پرسنل و قاعده «سرفصل طرف مقابل را کاربر انتخاب می‌کند»؛
 * سرور و فرم خزانه همین را می‌خوانند.
 */
export const PERSONNEL_PURPOSES = ['settlement', 'advance', 'other'] as const;
export type PersonnelPurpose = typeof PERSONNEL_PURPOSES[number];

export const PERSONNEL_PURPOSE_LABELS: Record<PersonnelPurpose, string> = {
  settlement: 'تسویه حقوق',
  advance: 'مساعده و وام',
  other: 'سایر',
};

/** «متفرقه» و هدف «سایر» پرسنل حساب نگاشت‌شده ندارند؛ سرفصل طرف مقابل را کاربر انتخاب می‌کند */
export function needsChosenContraAccount(partyType: string | null | undefined, purpose: string | null | undefined): boolean {
  return partyType === 'other' || (partyType === 'personnel' && purpose === 'other');
}

export function personnelPurposeLabel(purpose: string | null | undefined): string {
  return purpose && purpose in PERSONNEL_PURPOSE_LABELS ? PERSONNEL_PURPOSE_LABELS[purpose as PersonnelPurpose] : '';
}

/**
 * v10.0.22 (TD-925، P5-W02، تصمیم ت۸ الف بازبینی فاز ۵): تسویه حقوق پرسنل فقط از «پرداخت فیش» است. پرداخت خزانه به پرسنل
 * با هدف «تسویه حقوق» و پرداخت فیش هر دو «حقوق پرداختنی» را بدهکار می‌کردند و یک خالص دو بار از بانک می‌رفت. دریافت از
 * پرسنل با هدف تسویه (پس دادن پول) پذیرفته می‌ماند. سرور و فرم خزانه همین را می‌خوانند.
 */
export function isSalarySettlementPayment(type: string | null | undefined, partyType: string | null | undefined, purpose: string | null | undefined): boolean {
  return type === 'payment' && partyType === 'personnel' && purpose === 'settlement';
}

export const SALARY_SETTLEMENT_VIA_PAYSLIP_MESSAGE =
  'تسویه حقوق پرسنل فقط از «پرداخت فیش» در صفحه کارمزد ثبت می‌شود تا یک فیش دو بار پرداخت نشود؛ برای مساعده «مساعده و وام» و برای پرداخت دیگر «سایر» را انتخاب کنید.';
