/**
 * v11 history import (tool 1 of the 1405 replay): the contract between the treasury Excel import window and the server.
 * The window reads the sheets «دریافت و پرداخت» and «هزینه‌ها», the user maps each name once (bank, party, expense type),
 * and the window sends one resolved row per Excel row. The server previews them (the real services in a transaction that
 * is rolled back) or posts them all in one transaction, in date order; one refused row posts nothing.
 */

export const TREASURY_IMPORT_MAX_ROWS = 1500;

/**
 * What one Excel row becomes: a receipt or payment of the treasury form, a transfer between two of our accounts, or a
 * payment of the payslips of a colleague (wages are paid only through a payslip).
 */
export type TreasuryImportKind = 'receipt' | 'payment' | 'transfer' | 'payslip';

export type TreasuryImportPartyType = 'customer' | 'supplier' | 'personnel' | 'other';

export interface TreasuryImportRow {
  /** the Excel row number, for messages */
  rowNo: number;
  /** the sheet the row came from */
  sheet: string;
  /** the date as written in Excel (Jalali, `1405-01-05` or `1405/01/05`) */
  date: string;
  kind: TreasuryImportKind;
  /** the account the money leaves (payment, transfer, payslip) or enters (receipt) */
  bankAccountId: number;
  /** transfer only: the account the money enters */
  toBankAccountId?: number | null;
  /** the amount as decimal text, in the account's currency */
  amount: string;
  /** receipt and payment: the party, as the treasury form takes it */
  partyType?: TreasuryImportPartyType;
  partyId?: number | null;
  partyName?: string;
  /** a colleague's receipt or payment: `advance` (مساعده) or `other` (with a counter account) */
  purpose?: 'advance' | 'other' | null;
  /** party «other» and a colleague's `other`: the counter account */
  contraAccountId?: number | null;
  /** payslip only: the colleague whose payslips are paid */
  personnelId?: number | null;
  /** the Excel reference or invoice number (شماره مرجع-فاکتور), kept in the description */
  invoiceRef?: string;
  /** the Excel cost centre (مرکز هزینه), kept in the description */
  costCenter?: string;
  description?: string;
  /** a customer receipt or supplier payment settles that party's open documents, oldest first */
  settleOldest?: boolean;
  /** the user has seen that this row looks like one already recorded and wants it recorded again */
  duplicateAccepted?: boolean;
}

export type TreasuryImportRowStatus = 'ok' | 'error' | 'duplicate';

export interface TreasuryImportRowOutcome {
  rowNo: number;
  sheet: string;
  status: TreasuryImportRowStatus;
  /** the reason of an error or a duplicate, in Persian */
  message?: string;
  /** the numbers of what the row made (treasury numbers), on a posted import; placeholders on a preview are not sent */
  created?: string[];
  /** the documents a receipt or payment settled: reference number and amount */
  settled?: Array<{ refNumber: string; amount: number }>;
}

export interface TreasuryImportResult {
  /** true only when every row was posted */
  committed: boolean;
  rows: TreasuryImportRowOutcome[];
  okCount: number;
  errorCount: number;
  duplicateCount: number;
}

const KIND_ORDER: Record<TreasuryImportKind, number> = { receipt: 0, transfer: 1, payment: 2, payslip: 3 };

/**
 * The order rows are posted in: by day, and within a day money in first, then transfers, then money out, then the Excel
 * order. The Excel sheets are not in date order, and an account must not go below zero on a day it ends above zero.
 */
export function treasuryImportOrder<T extends { isoDate: string; row: Pick<TreasuryImportRow, 'kind' | 'rowNo' | 'sheet'> }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.isoDate !== b.isoDate) return a.isoDate < b.isoDate ? -1 : 1;
    const k = KIND_ORDER[a.row.kind] - KIND_ORDER[b.row.kind];
    if (k !== 0) return k;
    if (a.row.sheet !== b.row.sheet) return a.row.sheet < b.row.sheet ? -1 : 1;
    return a.row.rowNo - b.row.rowNo;
  });
}

/** The description a row is recorded with: the Excel text, its invoice or reference number and its cost centre. */
export function treasuryImportDescription(row: Pick<TreasuryImportRow, 'description' | 'invoiceRef' | 'costCenter'>): string {
  const parts = [(row.description ?? '').trim()];
  const ref = (row.invoiceRef ?? '').trim();
  if (ref) parts.push(`(مرجع اکسل: ${ref})`);
  const centre = (row.costCenter ?? '').trim();
  if (centre) parts.push(`(مرکز هزینه: ${centre})`);
  return parts.filter(Boolean).join(' ');
}

/**
 * Two rows are the same payment when they have the same day, kind, accounts, amount and party; a row like one already in
 * the file or in the books is held back until the user accepts it (a bank fee of the same amount on the same day is real).
 */
export function treasuryImportDuplicateKey(
  isoDate: string,
  row: Pick<TreasuryImportRow, 'kind' | 'bankAccountId' | 'toBankAccountId' | 'amount' | 'partyName' | 'personnelId'>,
  normalizedAmount: string,
): string {
  const party = row.kind === 'payslip' ? `p${row.personnelId ?? ''}` : (row.partyName ?? '').trim();
  return [isoDate, row.kind, row.bankAccountId, row.toBankAccountId ?? '', normalizedAmount, party].join('|');
}
