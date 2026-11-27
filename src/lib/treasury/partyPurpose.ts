/**
 * v9.0.82 (TD-507، تصمیم مالک محصول ت۴ الف): هدف دریافت و پرداخت پرسنل و قاعده «سرفصل طرف مقابل را کاربر انتخاب می‌کند»؛
 * سرور و فرم خزانه همین را می‌خوانند. v10.0.257 (TD-952، ت۵ الف): «واریز کسورات حقوق» سایر کسورات فیش (۳۲۰۵) را با
 * تفصیلی همان پرسنل بدهکار می‌کند تا پس از واریز، مانده او صفر شود.
 */
export const PERSONNEL_PURPOSES = ['settlement', 'advance', 'deductions', 'colleague_account', 'partner_account', 'other'] as const;
export type PersonnelPurpose = typeof PERSONNEL_PURPOSES[number];

export const PERSONNEL_PURPOSE_LABELS: Record<PersonnelPurpose, string> = {
  settlement: 'تسویه حقوق',
  advance: 'مساعده و وام',
  deductions: 'واریز کسورات حقوق',
  colleague_account: 'حساب جاری همکار',
  partner_account: 'حساب جاری شریک',
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
 * v10.0.57 (TD-925، P5-W02، تصمیم ت۸ الف بازبینی فاز ۵): تسویه حقوق پرسنل فقط از «پرداخت فیش» است. پرداخت خزانه به پرسنل
 * با هدف «تسویه حقوق» و پرداخت فیش هر دو «حقوق پرداختنی» را بدهکار می‌کردند و یک خالص دو بار از بانک می‌رفت. دریافت از
 * پرسنل با هدف تسویه (پس دادن پول) پذیرفته می‌ماند. سرور و فرم خزانه همین را می‌خوانند.
 */
export function isSalarySettlementPayment(type: string | null | undefined, partyType: string | null | undefined, purpose: string | null | undefined): boolean {
  return type === 'payment' && partyType === 'personnel' && purpose === 'settlement';
}

export const SALARY_SETTLEMENT_VIA_PAYSLIP_MESSAGE =
  'تسویه حقوق پرسنل فقط از «پرداخت فیش» در صفحه کارمزد ثبت می‌شود تا یک فیش دو بار پرداخت نشود؛ برای مساعده «مساعده و وام» و برای پرداخت دیگر «سایر» را انتخاب کنید.';

/**
 * v11 (the 1405 replay, tool 4; owner's decision 7 Aban 1405): each colleague has a running account (حساب جاری همکار, the
 * mapped colleague current account, 3208, on the colleague's detail) that may stand on either side. An expense the colleague
 * paid for the company from their own pocket credits it; money given to the colleague (petty cash in hand, or paying back
 * their expenses) is a treasury payment of this purpose and debits it; money the colleague hands back is a receipt of this
 * purpose and credits it. Rials only, as the expenses are.
 */
export function isColleagueAccountMove(partyType: string | null | undefined, purpose: string | null | undefined): boolean {
  return partyType === 'personnel' && purpose === 'colleague_account';
}

/**
 * v12 colleague sales part B2 (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md, owner's decisions of 7 Azar 1405): a
 * partner's running account («حساب جاری شرکا», mapped 4101, the partner's personnel detail) holds their debt in euros. A
 * receipt from the partner (or a payment to them) of this purpose moves it in euros: a euro row at the bank's rate, or a
 * rial row turned into euros at the rate typed with it. The euros that settle the open balance leave it at the balance's
 * average rate, and the rial difference goes to «سود تسعیر ارز» or «زیان تسعیر ارز».
 */
export function isPartnerAccountMove(partyType: string | null | undefined, purpose: string | null | undefined): boolean {
  return partyType === 'personnel' && purpose === 'partner_account';
}
