import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { bankAccounts, documents, journalVoucherItems, journalVouchers, pieceworkPayrolls, treasuryTransactions } from '../../db/schema.js';
import { ForbiddenError, ValidationError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { requireStorageDate } from '../../lib/storageDate.js';
import { isPayablePayrollStatus } from '../../lib/payroll/payrollPayable.js';
import { SETTLEABLE_DOCUMENT_STATUSES, type SettlementAllocationInput } from '../../lib/treasury/settlementAllocation.js';
import {
  treasuryImportDescription, treasuryImportDuplicateKey, treasuryImportOrder,
  type TreasuryImportResult, type TreasuryImportRow, type TreasuryImportRowOutcome,
} from '../../lib/historyImport/treasuryHistoryImport.js';
import { historyImportAmount } from '../../lib/historyImport/historyImportAmount.js';
import { formatPersianNumber, isoToJalaliDate, toPersianDigits } from '../../utils.js';
import { toStorageDate } from '../../utils/calendarDate.js';
import { TreasuryTransactionService } from '../accounting/treasury/treasuryTransaction.service.js';
import { lockTreasuryBanks } from '../accounting/treasury/treasuryPosting.js';
import type { TreasuryAuditActor } from '../accounting/treasury/treasuryAudit.js';
import { PayrollPaymentService } from '../accounting/payrollPayment.service.js';
import { readDocumentPayableAndSettled } from '../documents/documentRemainingAmount.js';
import { runImportRows } from './importRunner.js';

/**
 * v11 history import, tool 1: the treasury rows of 1405 from Excel (decision of the owner, 6 Aban 1405: all of 1405 is
 * entered again from 1 Farvardin, each document on its own day). Each row goes through the service a user's form calls
 * (the treasury receipt or payment, the transfer between accounts, the payment of a payslip), so the rows, vouchers
 * (draft), audit rows and events are the ones a hand entry makes. Rows are posted in date order; a row dated before the
 * last movement of its account already in the books is refused, so each account's balance is checked on the row's own
 * day (`postTreasuryRow` checks the current balance). A row like one already in the file or in the books waits for the
 * user to accept it. A preview runs everything and keeps nothing; a post keeps everything or nothing.
 */

export interface TreasuryImportOptions {
  commit: boolean;
  userId?: number;
  username?: string;
  audit?: TreasuryAuditActor;
  /** the user holds «پرداخت حقوق» (`piecework.pay`), which a payslip row needs, as the payslip payment form does */
  canPayPayslips?: boolean;
}

interface PreparedRow {
  row: TreasuryImportRow;
  isoDate: string;
  amount: string;
  outcome: TreasuryImportRowOutcome;
}

const faDate = (iso: string) => toPersianDigits(isoToJalaliDate(iso));

// a past receipt settles invoices only (never a quote), and only those dated on or before it
const RECEIPT_DOCUMENT_TYPES = ['invoice'];
const PAYMENT_DOCUMENT_TYPES = ['purchase', 'receipt'];

/**
 * The last day each account moved: its live treasury rows (a voided row and its reversal are not movements), the lines of
 * live vouchers on its ledger account (a cleared cheque, a void's reversal, a manual voucher), and its opening day. Money
 * that reached the account later must not pay an earlier row.
 */
async function lastMovementDays(tx: DbExecutor, bankIds: number[]): Promise<Map<number, string>> {
  const days = new Map<number, string>();
  if (bankIds.length === 0) return days;
  const later = (id: number, day: string | null | undefined) => {
    if (day && day > (days.get(id) ?? '')) days.set(id, day);
  };
  const rows = await tx.select({
    bankAccountId: treasuryTransactions.bankAccountId,
    day: sql<string>`to_char(max(${treasuryTransactions.date}::date), 'YYYY-MM-DD')`,
  }).from(treasuryTransactions)
    .where(and(
      inArray(treasuryTransactions.bankAccountId, bankIds),
      eq(treasuryTransactions.isDeleted, 0),
      eq(treasuryTransactions.status, 'completed'),
      isNull(treasuryTransactions.reversalOfId),
    ))
    .groupBy(treasuryTransactions.bankAccountId);
  for (const r of rows) if (r.bankAccountId) later(Number(r.bankAccountId), r.day);

  const banks = await tx.select({ id: bankAccounts.id, accountId: bankAccounts.accountId, openingDate: bankAccounts.openingDate })
    .from(bankAccounts).where(inArray(bankAccounts.id, bankIds));
  for (const b of banks) later(b.id, toStorageDate(b.openingDate) || null);
  // a voucher line names its bank by its detail (treasury rows, cleared cheques and opening vouchers do); a line without that
  // detail counts only for a bank alone on its ledger account, since banks often share 1003 or 1001
  const banksOfAccount = new Map<number, number[]>();
  for (const b of banks) if (b.accountId) banksOfAccount.set(b.accountId, [...(banksOfAccount.get(b.accountId) ?? []), b.id]);
  if (banksOfAccount.size > 0) {
    const sharing = await tx.select({ accountId: bankAccounts.accountId, n: sql<number>`count(*)::int` }).from(bankAccounts)
      .where(and(inArray(bankAccounts.accountId, [...banksOfAccount.keys()]), eq(bankAccounts.isDeleted, 0)))
      .groupBy(bankAccounts.accountId);
    const shared = new Set(sharing.filter(r => Number(r.n) > 1).map(r => Number(r.accountId)));
    // voucher dates are text (Jalali or ISO), so each distinct one is read here
    const lines = await tx.selectDistinct({
      accountId: journalVoucherItems.accountId,
      detailedType: journalVoucherItems.detailedType,
      detailedId: journalVoucherItems.detailedId,
      date: journalVouchers.date,
    })
      .from(journalVoucherItems)
      .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
      .where(and(
        inArray(journalVoucherItems.accountId, [...banksOfAccount.keys()]),
        eq(journalVoucherItems.isDeleted, 0),
        eq(journalVouchers.isDeleted, 0),
      ));
    for (const l of lines) {
      const day = toStorageDate(l.date) || null;
      const ofAccount = banksOfAccount.get(l.accountId) ?? [];
      if (l.detailedType === 'bank_account' && l.detailedId) {
        if (ofAccount.includes(l.detailedId)) later(l.detailedId, day);
      } else if (!shared.has(l.accountId)) {
        for (const id of ofAccount) later(id, day);
      }
    }
  }
  return days;
}

/** Rows already in the books that look like an imported row: same day, account, kind and amount. */
async function bookedKeys(tx: DbExecutor, prepared: PreparedRow[]): Promise<Set<string>> {
  const keys = new Set<string>();
  const bankIds = [...new Set(prepared.map(p => p.row.bankAccountId))];
  const days = [...new Set(prepared.map(p => p.isoDate))];
  if (bankIds.length === 0 || days.length === 0) return keys;
  const rows = await tx.select({
    bankAccountId: treasuryTransactions.bankAccountId,
    type: treasuryTransactions.type,
    amount: treasuryTransactions.amount,
    day: sql<string>`to_char(${treasuryTransactions.date}::date, 'YYYY-MM-DD')`,
  }).from(treasuryTransactions)
    .where(and(
      inArray(treasuryTransactions.bankAccountId, bankIds),
      inArray(sql`to_char(${treasuryTransactions.date}::date, 'YYYY-MM-DD')`, days),
      eq(treasuryTransactions.isDeleted, 0),
      eq(treasuryTransactions.status, 'completed'),
      isNull(treasuryTransactions.reversalOfId),
    ));
  for (const r of rows) keys.add([r.day, r.bankAccountId, r.type, fin(r.amount).round(4).toString()].join('|'));
  return keys;
}

const bookedKeyOf = (p: PreparedRow) =>
  [p.isoDate, p.row.bankAccountId, p.row.kind === 'receipt' ? 'receipt' : 'payment', fin(p.amount).round(4).toString()].join('|');

/**
 * The open documents of a customer (receipt) or supplier (payment) dated on or before the row, oldest first, with what each has left, read in the
 * import's transaction, so a document an earlier row of the same import settled shows what it still has left.
 */
async function oldestFirstParts(tx: DbExecutor, row: TreasuryImportRow, isoDate: string, amount: string): Promise<SettlementAllocationInput[]> {
  const isReceipt = row.kind === 'receipt';
  if (!row.partyId || row.partyType !== (isReceipt ? 'customer' : 'supplier')) return [];
  const candidates = await tx.select({ id: documents.id }).from(documents)
    .where(and(
      eq(documents.partyId, row.partyId),
      eq(documents.isDeleted, 0),
      inArray(documents.type, isReceipt ? RECEIPT_DOCUMENT_TYPES : PAYMENT_DOCUMENT_TYPES),
      inArray(documents.status, [...SETTLEABLE_DOCUMENT_STATUSES]),
      sql`coalesce(nullif(trim(${documents.currency}), ''), 'IRR') = 'IRR'`,
      sql`${documents.date}::date <= ${isoDate}::date`,
    ))
    .orderBy(asc(documents.date), asc(documents.id));
  const parts: SettlementAllocationInput[] = [];
  let left = fin(amount);
  for (const c of candidates) {
    if (!left.greaterThan(0)) break;
    const doc = await readDocumentPayableAndSettled(tx, c.id);
    if (!doc) continue;
    const remaining = doc.payable.subtract(doc.settled.isNegative() ? 0 : doc.settled).subtract(doc.returned).round(4);
    if (!remaining.greaterThan(0)) continue;
    const part = left.lessThan(remaining) ? left : remaining;
    parts.push({ documentId: c.id, amount: part.round(4).toNumber() });
    left = left.subtract(part);
  }
  return parts;
}

/** Pays a colleague's issued payslips, oldest first, each up to what it has left; more than they all have left is refused. */
async function payPayslips(tx: DbExecutor, p: PreparedRow, options: TreasuryImportOptions, description: string): Promise<string[]> {
  const personnelId = Number(p.row.personnelId);
  if (!personnelId) throw new ValidationError('برای پرداخت حقوق، همکار ردیف مشخص نیست.', undefined, 'HISTORY_IMPORT_PERSONNEL_REQUIRED');
  const slips = await tx.select({
    id: pieceworkPayrolls.id, status: pieceworkPayrolls.status, netPayable: pieceworkPayrolls.netPayable, paidAmount: pieceworkPayrolls.paidAmount,
  }).from(pieceworkPayrolls)
    .where(and(eq(pieceworkPayrolls.personnelId, personnelId), eq(pieceworkPayrolls.isDeleted, 0)))
    .orderBy(asc(pieceworkPayrolls.endDate), asc(pieceworkPayrolls.id));
  const created: string[] = [];
  let left = fin(p.amount);
  for (const slip of slips) {
    if (!left.greaterThan(0)) break;
    if (!isPayablePayrollStatus(slip.status)) continue;
    const remaining = fin(slip.netPayable).subtract(fin(slip.paidAmount ?? 0)).round(4);
    if (!remaining.greaterThan(0)) continue;
    const part = left.lessThan(remaining) ? left : remaining;
    const paid = await PayrollPaymentService.registerPayrollPayment({
      payrollId: slip.id,
      bankAccountId: p.row.bankAccountId,
      method: await methodOf(tx, p.row.bankAccountId),
      amount: part.round(4).toString(),
      paymentDate: p.isoDate,
      paymentReference: (p.row.invoiceRef ?? '').trim(),
      notes: description,
      userId: options.userId,
      username: options.username,
    }, tx);
    const number = (paid as { transactionNumber?: string } | undefined)?.transactionNumber;
    if (number) created.push(number);
    left = left.subtract(part);
  }
  if (left.greaterThan(0)) {
    throw new ValidationError(
      `${formatPersianNumber(left.toNumber())} از مبلغ این ردیف بیش از ماندهٔ فیش‌های حقوقی تأییدشدهٔ این همکار است؛ اول فیش حقوقی آن ماه را صادر و تأیید کنید.`,
      undefined,
      'HISTORY_IMPORT_PAYSLIP_REMAINING',
    );
  }
  return created;
}

const methodCache = new WeakMap<object, Map<number, 'cash' | 'bank_transfer'>>();

/** A cash box or petty cash pays in cash, a bank by transfer (the Excel sheets do not say). */
async function methodOf(tx: DbExecutor, bankAccountId: number): Promise<'cash' | 'bank_transfer'> {
  let cache = methodCache.get(tx as object);
  if (!cache) { cache = new Map(); methodCache.set(tx as object, cache); }
  const known = cache.get(bankAccountId);
  if (known) return known;
  const [bank] = await tx.select({ type: bankAccounts.type }).from(bankAccounts).where(eq(bankAccounts.id, bankAccountId));
  const method = bank?.type === 'cash' || bank?.type === 'petty_cash' ? 'cash' : 'bank_transfer';
  cache.set(bankAccountId, method);
  return method;
}

async function postRow(tx: DbExecutor, p: PreparedRow, options: TreasuryImportOptions): Promise<Pick<TreasuryImportRowOutcome, 'created' | 'settled'>> {
  const { row } = p;
  const description = treasuryImportDescription(row);
  const actor = { userId: options.userId, username: options.username, audit: options.audit };
  if (row.kind === 'transfer') {
    if (!row.toBankAccountId) throw new ValidationError('حساب مقصد انتقال مشخص نیست.', undefined, 'HISTORY_IMPORT_TRANSFER_TARGET');
    const res = await TreasuryTransactionService.createTreasuryTransfer({
      date: p.isoDate,
      amount: Number(p.amount),
      fromBankAccountId: row.bankAccountId,
      toBankAccountId: row.toBankAccountId,
      trackingNumber: (row.invoiceRef ?? '').trim(),
      description,
      ...actor,
    }, tx);
    return { created: [res.payment.transactionNumber, res.receipt.transactionNumber].filter(Boolean) as string[] };
  }
  if (row.kind === 'payslip') {
    // the payslip payment form needs «پرداخت حقوق»; the import does not open a way around it
    if (!options.canPayPayslips) throw new ForbiddenError('پرداخت فیش حقوقی مجوز «پرداخت حقوق» را می‌خواهد؛ این ردیف بدون آن ثبت نمی‌شود.', undefined, 'HISTORY_IMPORT_PAYSLIP_FORBIDDEN');
    return { created: await payPayslips(tx, p, options, description) };
  }

  const partyType = row.partyType ?? 'other';
  const parts = row.settleOldest ? await oldestFirstParts(tx, row, p.isoDate, p.amount) : [];
  const created = await TreasuryTransactionService.createTreasuryTransaction({
    type: row.kind,
    date: p.isoDate,
    method: await methodOf(tx, row.bankAccountId),
    amount: Number(p.amount),
    bankAccountId: row.bankAccountId,
    partyType,
    partyId: row.partyId ?? null,
    partyName: (row.partyName ?? '').trim(),
    purpose: row.purpose ?? undefined,
    contraAccountId: row.contraAccountId ?? null,
    trackingNumber: (row.invoiceRef ?? '').trim(),
    description,
    allocations: parts.length > 0 ? parts : undefined,
    ...actor,
  }, tx);
  const settled: Array<{ refNumber: string; amount: number }> = [];
  if (parts.length > 0) {
    const refs = await tx.select({ id: documents.id, refNumber: documents.refNumber }).from(documents)
      .where(inArray(documents.id, parts.map(x => x.documentId)));
    const refOf = new Map(refs.map(r => [r.id, r.refNumber ?? String(r.id)]));
    for (const part of parts) settled.push({ refNumber: refOf.get(part.documentId) ?? String(part.documentId), amount: Number(part.amount) });
  }
  return { created: created.transactionNumber ? [created.transactionNumber] : [], settled };
}

/** Reads each row's day and amount; a row whose day or amount cannot be read is an error and goes no further. */
function prepare(rows: TreasuryImportRow[]): PreparedRow[] {
  return rows.map(row => {
    const outcome: TreasuryImportRowOutcome = { rowNo: row.rowNo, sheet: row.sheet, status: 'ok' };
    let isoDate = '';
    let amount = '';
    try {
      isoDate = requireStorageDate(row.date, `تاریخ ردیف ${toPersianDigits(String(row.rowNo))}`);
      if (!isoDate) throw new ValidationError('تاریخ ردیف خالی است؛ هر ردیف با تاریخ خودش ثبت می‌شود.');
      amount = historyImportAmount(row.amount) ?? '';
      if (!amount) throw new ValidationError('مبلغ ردیف خالی یا نادرست است؛ یک مبلغ بزرگ‌تر از صفر بنویسید.');
    } catch (err) {
      outcome.status = 'error';
      outcome.message = err instanceof ValidationError ? err.message : 'تاریخ ردیف خوانده نشد.';
    }
    return { row, isoDate, amount, outcome };
  });
}

export async function importTreasuryHistory(rows: TreasuryImportRow[], options: TreasuryImportOptions): Promise<TreasuryImportResult> {
  const prepared = prepare(rows);
  const ordered = treasuryImportOrder(prepared.filter(p => p.outcome.status === 'ok'));

  await runImportRows({ commit: options.commit }, async (tx, attempt) => {
    // a row dated before the last movement of one of its accounts would be checked against a later balance
    const bankIds = [...new Set(ordered.flatMap(p => [p.row.bankAccountId, p.row.toBankAccountId ?? 0]).filter(id => id > 0))];
    // the accounts are locked before they are read, so no hand entry or other import moves them between the check and the post
    await lockTreasuryBanks(tx, bankIds);
    const lastDays = await lastMovementDays(tx, bankIds);
    const booked = await bookedKeys(tx, ordered);
    const inFile = new Map<string, number>();
    for (const p of ordered) {
      const late = [p.row.bankAccountId, p.row.toBankAccountId ?? 0]
        .map(id => ({ id, day: lastDays.get(id) }))
        .find(x => x.day && x.day > p.isoDate);
      if (late) {
        p.outcome.status = 'error';
        p.outcome.message = `این حساب گردشی با تاریخ ${faDate(late.day as string)} دارد؛ ردیف پیش از آن (${faDate(p.isoDate)}) ثبت نمی‌شود تا مانده هر روز درست سنجیده شود. ردیف‌ها را به ترتیب ماه وارد کنید.`;
        continue;
      }
      const key = treasuryImportDuplicateKey(p.isoDate, p.row, p.amount);
      const seen = inFile.get(key);
      inFile.set(key, p.row.rowNo);
      if (!p.row.duplicateAccepted && (seen !== undefined || booked.has(bookedKeyOf(p)))) {
        p.outcome.status = 'duplicate';
        p.outcome.message = seen !== undefined
          ? `این ردیف با ردیف ${toPersianDigits(String(seen))} همین پرونده یکی است (همان روز، حساب، مبلغ و طرف حساب).`
          : 'ردیفی با همین روز، حساب، نوع و مبلغ پیش‌تر در برنامه ثبت شده است.';
        continue;
      }
      const result = await attempt(sp => postRow(sp, p, options));
      if (result.ok) {
        if (options.commit) p.outcome.created = result.value.created;
        if (result.value.settled?.length) p.outcome.settled = result.value.settled;
      } else {
        p.outcome.status = 'error';
        p.outcome.message = result.message;
      }
    }
    return prepared.every(p => p.outcome.status === 'ok');
  });

  const outcomes = prepared.map(p => p.outcome).sort((a, b) => (a.sheet === b.sheet ? a.rowNo - b.rowNo : a.sheet < b.sheet ? -1 : 1));
  const count = (s: string) => outcomes.filter(o => o.status === s).length;
  const okCount = count('ok');
  const committed = options.commit && okCount === outcomes.length;
  if (!committed) for (const o of outcomes) delete o.created;
  return { committed, rows: outcomes, okCount, errorCount: count('error'), duplicateCount: count('duplicate') };
}

