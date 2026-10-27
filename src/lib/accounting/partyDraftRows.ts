/**
 * v11 phase 6.1t (U1, evaluation finding F1): an automatic voucher stays a draft until an accountant approves it, and the
 * party's card and statement read only approved vouchers. A customer with a final invoice and two receipts showed «no
 * transaction yet», or a creditor balance once only the receipt was approved. The card and the statement now list the
 * party's draft rows apart, clearly labelled, and give the balance with them; the approved balance stays as it was.
 */
import type { ForeignAmountOrigin } from '../../types/accounting.types';

export interface PartyDraftRow extends ForeignAmountOrigin {
  voucherId: number;
  voucherNumber: number;
  date: string;
  description: string;
  accountCode: string;
  accountName: string;
  currency: string;
  debit: number;
  credit: number;
}

/** The party's rows of draft vouchers in the report's range, on permanent accounts (the rule of the balance) */
export interface PartyDraftRows {
  items: PartyDraftRow[];
  totalDebit: number;
  totalCredit: number;
  /** how many draft vouchers the rows come from */
  voucherCount: number;
  /** the approved balance at the end of the range plus every draft row up to that day (debit positive) */
  balanceWithDrafts: number;
}

export const PARTY_DRAFT_ROWS_TITLE = 'اسناد پیش‌نویس (هنوز تأیید نشده)';
export const PARTY_DRAFT_ROWS_NOTE = 'این ردیف‌ها از اسناد حسابداری پیش‌نویس‌اند و در مانده تأییدشده بالا نیستند؛ با تأیید هر سند به گردش بالا می‌روند.';
export const PARTY_BALANCE_WITH_DRAFTS_LABEL = 'مانده با احتساب پیش‌نویس‌ها';

export function partyDraftRowsOf(value: { draftRows?: PartyDraftRows | null } | null | undefined): PartyDraftRow[] {
  return Array.isArray(value?.draftRows?.items) ? value.draftRows.items : [];
}

/** «بدهکار» for a positive balance (the party owes us), «بستانکار» for a negative one, and «بی‌حساب» at zero */
export function partyBalanceSide(balance: number): 'بدهکار' | 'بستانکار' | 'بی‌حساب' {
  return balance > 0 ? 'بدهکار' : balance < 0 ? 'بستانکار' : 'بی‌حساب';
}
