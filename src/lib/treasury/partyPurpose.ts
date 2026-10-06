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
