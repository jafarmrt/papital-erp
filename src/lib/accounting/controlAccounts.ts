/**
 * v11 phase 6.1b (M3, M6, decisions ت۵۲-۲ and ت۵۶-۳): the control accounts, shared by the server and the voucher forms.
 *
 * A control account has its own book beside the general ledger: a treasury account's balance, a party's statement, a
 * payslip, the monthly insurance and tax list, the eidi slip, an advance, the cheque book or the Kardex. An entry on it
 * that does not come from that book leaves the book and the ledger apart. So a manual voucher (and the replacement rows
 * of a correction) posts on one only with the permission `accounting.control_adjustment` and a reason, and a treasury,
 * cheque or petty cash entry never takes one as its free counter account. The server reads the accounts from the
 * account mapping, the treasury accounts and the chart (`AccountMappingService.controlAccountsById`).
 */

export const CONTROL_ADJUSTMENT_PERMISSION = 'accounting.control_adjustment';

export const CONTROL_ACCOUNT_KINDS = ['treasury', 'party', 'payroll', 'statutory', 'eidi', 'advance', 'colleague_account', 'cheque', 'inventory'] as const;
export type ControlAccountKind = typeof CONTROL_ACCOUNT_KINDS[number];

/** where the entries of each kind are made (read after «از») */
export const CONTROL_ACCOUNT_PATHS: Record<ControlAccountKind, string> = {
  treasury: 'خزانه (دریافت، پرداخت و انتقال وجه)',
  party: 'فاکتور فروش و خرید و دریافت و پرداخت با نام طرف حساب',
  payroll: 'فیش حقوق و پرداخت آن',
  statutory: '«فهرست بیمه و مالیات ماهانه»',
  eidi: 'فیش عیدی و پرداخت آن',
  advance: 'پرداخت مساعده به پرسنل در خزانه',
  colleague_account: '«هزینهٔ پرداختی همکار» و دریافت و پرداخت «حساب جاری همکار» در خزانه',
  cheque: 'دفتر چک',
  inventory: 'اسناد انبار (رسید، حواله، شمارش و رسید تولید)',
};

export interface ControlAccountEntry {
  id: number;
  code: string;
  name: string;
  kind: ControlAccountKind;
}

export const CONTROL_REASON_MAX = 500;

export const CONTROL_REASON_REQUIRED_MESSAGE = 'دلیل ثبت روی حساب کنترلی را بنویسید.';

/** an account of a refusal: its name and code */
export function controlAccountName(account: Pick<ControlAccountEntry, 'code' | 'name'>, persianDigits: (v: string) => string): string {
  return `«${account.name}» (کد ${persianDigits(account.code)})`;
}

/** an account of a refusal with the book its entries come from */
export function controlAccountLine(account: Pick<ControlAccountEntry, 'code' | 'name' | 'kind'>, persianDigits: (v: string) => string): string {
  return `${controlAccountName(account, persianDigits)} از ${CONTROL_ACCOUNT_PATHS[account.kind]}`;
}

/** the control accounts among a form's rows, each once, in row order (an empty or unknown account is skipped) */
export function controlAccountsOfRows(
  accountIds: ReadonlyArray<number | string | null | undefined>,
  entries: readonly ControlAccountEntry[] | undefined,
): ControlAccountEntry[] {
  const byId = new Map((entries ?? []).map(entry => [entry.id, entry]));
  const hits = new Map<number, ControlAccountEntry>();
  for (const id of accountIds) {
    const entry = byId.get(Number(id));
    if (entry && !hits.has(entry.id)) hits.set(entry.id, entry);
  }
  return [...hits.values()];
}

/** the refusal of a manual row on a control account to a user without the permission (server 403 and the voucher forms) */
export function controlAccountRefusalMessage(entries: readonly Pick<ControlAccountEntry, 'code' | 'name' | 'kind'>[], persianDigits: (v: string) => string): string {
  const lines = entries.map(entry => controlAccountLine(entry, persianDigits));
  return `این حساب‌ها حساب کنترلی‌اند و ثبت هر کدام از دفتر خودش است: ${lines.join('؛ ')}. سند دستی روی حساب کنترلی فقط با اجازهٔ «اصلاح حساب کنترلی» و نوشتن دلیل ثبت می‌شود.`;
}

/**
 * the refusal of a change to a stored voucher with a row on a control account (edit, delete, reversal, correction) to a
 * user without the permission: taking an entry off a control account is the same adjustment as writing one
 */
export function controlVoucherChangeRefusalMessage(entries: readonly Pick<ControlAccountEntry, 'code' | 'name' | 'kind'>[], persianDigits: (v: string) => string): string {
  const lines = entries.map(entry => controlAccountLine(entry, persianDigits));
  return `این سند ردیف حساب کنترلی دارد و ویرایش، حذف، برگشت یا اصلاح آن هم فقط با اجازهٔ «اصلاح حساب کنترلی» انجام می‌شود: ${lines.join('؛ ')}.`;
}
