import { and, desc, eq, inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../../db/drizzle.js';
import { accounts, colleagueExpenseLines, colleagueExpenses, journalVouchers, personnel } from '../../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../errors/customErrors.js';
import { fin } from '../../../lib/financialDecimal.js';
import { money } from '../../../lib/money.js';
import { toLatinDigits } from '../../../lib/numericInput.js';
import { logActivity } from '../../../lib/auditLogger.js';
import { validateLockOrder, LockHierarchyLevel } from '../../../lib/lockOrder.js';
import { pettyCashLineAmount, pettyCashStatementError, type PettyCashLineInput } from '../../../lib/treasury/pettyCash.js';
import { colleagueExpenseLineDescription, type ColleagueExpense, type ColleagueExpenseList } from '../../../lib/treasury/colleagueExpense.js';
import { idempotentTransactionIn } from '../../../middleware/idempotency.js';
import { lockAdvancePersonnel } from './advanceVoidGuard.js';
import { assertExpenseAccounts } from './pettyCashExpense.service.js';
import { colleagueAccountBalance } from './colleagueAccountBalance.js';
import type { TreasuryAuditActor } from './treasuryAudit.js';
import { resolveTreasuryWriteDate } from './treasuryDate.js';
import { TreasuryTransactionService } from './treasuryTransaction.service.js';

/**
 * v11 (the 1405 replay, tool 4; owner's decisions 7 Aban 1405): an expense a colleague paid for the company from their own
 * pocket. No money moves, so there is no treasury row: its draft voucher debits each line's expense account (the accounts a
 * petty cash statement takes) and credits the colleague's running account (mapped colleague current account, 3208, a
 * control account) on their detail. Petty cash given to the colleague or a payback is a treasury payment «حساب جاری همکار»
 * (debit), money they hand back a receipt of it (credit), so the account may stand on either side. VAT, seller and invoice
 * number are never required, as on a petty cash statement. The record and its lines stay in `colleague_expenses` /
 * `colleague_expense_lines`; the voucher is sourced (`VOUCHER_HAS_SOURCE`) and changes only by voiding the record: a draft
 * voucher is soft-deleted, an approved one reversed (`voidSourceVoucher`). The colleague's row is locked (level 30) first.
 */

const CURRENCY = 'IRR';

export interface ColleagueExpenseInput {
  personnelId: number;
  date?: string;
  description?: string;
  lines: PettyCashLineInput[];
  /** the scans of the receipts, kept on the voucher */
  attachments?: unknown[];
  userId?: number;
  username?: string;
  audit?: TreasuryAuditActor;
}

/** Locks the colleague; a void also takes a colleague deleted since (their expense can still turn out wrong). */
async function lockColleague(tx: DbExecutor, personnelId: number, options: { allowDeleted?: boolean } = {}): Promise<{ id: number; name: string }> {
  await lockAdvancePersonnel(tx, personnelId);
  const [row] = await tx.select({ id: personnel.id, name: personnel.fullName }).from(personnel)
    .where(options.allowDeleted ? eq(personnel.id, personnelId) : and(eq(personnel.id, personnelId), eq(personnel.isDeleted, 0)));
  if (!row) throw new NotFoundError('همکار یافت نشد یا حذف شده است.', undefined, 'COLLEAGUE_EXPENSE_PERSONNEL_INVALID');
  return row;
}

async function currentAccount(tx: DbExecutor) {
  const account = await TreasuryTransactionService.colleagueCurrentAccount(tx);
  if (!account) {
    throw new NotFoundError('حساب «حساب جاری همکاران» در نگاشت حساب‌ها پیدا نشد؛ آن را در تنظیمات حسابداری تعیین کنید.', undefined, 'COLLEAGUE_EXPENSE_ACCOUNT_MISSING');
  }
  return account;
}

/** Records the expense; inside the history import's transaction a savepoint of it, otherwise its own transaction. */
export async function createColleagueExpense(input: ColleagueExpenseInput, executor?: DbExecutor): Promise<ColleagueExpense> {
  const statementError = pettyCashStatementError(input.lines);
  if (statementError) throw new ValidationError(statementError, undefined, 'COLLEAGUE_EXPENSE_LINES_INVALID');
  if (!Number.isInteger(input.personnelId) || input.personnelId <= 0) {
    throw new ValidationError('همکاری را که هزینه را پرداخته از فهرست انتخاب کنید.', undefined, 'COLLEAGUE_EXPENSE_PERSONNEL_INVALID');
  }
  const lines = input.lines.map((line, i) => ({
    lineNo: i + 1,
    accountId: Number(line.accountId),
    amount: fin(pettyCashLineAmount(line.amount)).round(4),
    description: (line.description ?? '').trim(),
    sellerName: (line.sellerName ?? '').trim(),
    invoiceNumber: toLatinDigits(line.invoiceNumber ?? '').trim(),
  }));
  const total = lines.reduce((sum, line) => sum.add(line.amount), fin(0)).round(4);
  const date = await resolveTreasuryWriteDate(input.date, 'تاریخ هزینه');
  const description = (input.description ?? '').trim();

  return await idempotentTransactionIn(executor, async (tx) => {
    validateLockOrder([
      { name: 'personnel', hierarchyLevel: LockHierarchyLevel.PARTIES },
      { name: 'journalVoucher', hierarchyLevel: LockHierarchyLevel.JOURNAL_VOUCHERS },
    ]);
    const colleague = await lockColleague(tx, input.personnelId);
    const accountNames = await assertExpenseAccounts(tx, lines.map(l => l.accountId));
    const payable = await currentAccount(tx);
    const voucherDescription = description || `هزینهٔ پرداختی ${colleague.name} از جیب خود`;
    const voucher = await TreasuryTransactionService.createColleagueExpenseVoucher({
      date,
      description: voucherDescription,
      currency: CURRENCY,
      attachments: input.attachments,
      userId: input.userId,
      username: input.username,
      items: [
        ...lines.map(line => ({
          accountId: line.accountId,
          detailedType: 'none',
          debit: line.amount,
          credit: 0,
          currency: CURRENCY,
          exchangeRate: 1,
          description: colleagueExpenseLineDescription(colleague.name, line),
        })),
        {
          accountId: payable.id,
          detailedType: 'personnel',
          detailedId: colleague.id,
          detailedName: colleague.name,
          debit: 0,
          credit: total,
          currency: CURRENCY,
          exchangeRate: 1,
          description: voucherDescription,
        },
      ],
    }, tx);
    const [row] = await tx.insert(colleagueExpenses).values({
      personnelId: colleague.id,
      date,
      description,
      total: money(total),
      voucherId: voucher.id,
      createdById: input.userId || null,
    }).returning();
    await tx.insert(colleagueExpenseLines).values(lines.map(line => ({
      colleagueExpenseId: row.id,
      lineNo: line.lineNo,
      accountId: line.accountId,
      amount: money(line.amount),
      description: line.description,
      sellerName: line.sellerName,
      invoiceNumber: line.invoiceNumber,
    })));
    const created: ColleagueExpense = {
      id: row.id,
      personnelId: colleague.id,
      personnelName: colleague.name,
      date,
      description,
      total: total.toNumber(),
      status: 'active',
      voucherId: voucher.id,
      voucherNumber: Number(voucher.voucherNumber),
      voucherStatus: voucher.status ?? 'draft',
      lines: lines.map(line => ({
        lineNo: line.lineNo,
        accountId: line.accountId,
        accountCode: accountNames.get(line.accountId)?.code ?? '',
        accountName: accountNames.get(line.accountId)?.name ?? '',
        amount: line.amount.toNumber(),
        description: line.description,
        sellerName: line.sellerName,
        invoiceNumber: line.invoiceNumber,
      })),
    };
    await logActivity({
      tx,
      req: input.audit?.req,
      userFullName: input.audit?.userFullName,
      action: 'CREATE',
      entity: 'colleague_expense',
      entityId: String(row.id),
      description: `ثبت هزینهٔ پرداختی ${colleague.name} به مبلغ ${total.toNumber().toLocaleString('fa-IR')} ریال`,
      details: { before: null, after: created },
    });
    return created;
  });
}

/** Voids the expense: its draft voucher is soft-deleted, an approved one reversed today (the running account may go either side). */
export async function voidColleagueExpense(id: number, params: { reason: string; userId?: number; username?: string; audit?: TreasuryAuditActor }): Promise<{ id: number; status: 'voided'; voucherAction: 'deleted' | 'reversed' }> {
  const reason = (params.reason ?? '').trim();
  if (!reason) throw new ValidationError('دلیل ابطال را بنویسید.', undefined, 'COLLEAGUE_EXPENSE_VOID_REASON');
  return await idempotentTransactionIn(undefined, async (tx) => {
    const [peek] = await tx.select({ personnelId: colleagueExpenses.personnelId }).from(colleagueExpenses).where(eq(colleagueExpenses.id, id));
    if (!peek) throw new NotFoundError('هزینهٔ پرداختی همکار یافت نشد.');
    const colleague = await lockColleague(tx, peek.personnelId, { allowDeleted: true });
    const [row] = await tx.select().from(colleagueExpenses).where(eq(colleagueExpenses.id, id)).for('update');
    if (row.status !== 'active') throw new ConflictError('این هزینه پیش‌تر ابطال شده است.', undefined, 'COLLEAGUE_EXPENSE_ALREADY_VOIDED');
    let voucherAction: 'deleted' | 'reversed' = 'deleted';
    if (row.voucherId) {
      const voided = await TreasuryTransactionService.voidColleagueExpenseVoucher({
        voucherId: row.voucherId,
        reason: `ابطال هزینهٔ پرداختی ${colleague.name}: ${reason}`,
        userId: params.userId,
        username: params.username,
        externalTx: tx,
      });
      voucherAction = voided.action;
    }
    await tx.update(colleagueExpenses).set({
      status: 'voided', voidReason: reason, voidedAt: new Date().toISOString(), voidedById: params.userId || null,
    }).where(eq(colleagueExpenses.id, id));
    await logActivity({
      tx,
      req: params.audit?.req,
      userFullName: params.audit?.userFullName,
      action: 'DELETE',
      entity: 'colleague_expense',
      entityId: String(id),
      description: `ابطال هزینهٔ پرداختی ${colleague.name} به مبلغ ${Number(row.total).toLocaleString('fa-IR')} ریال: ${reason}`,
      details: { before: { status: row.status }, after: { status: 'voided', voucherAction } },
    });
    return { id, status: 'voided', voucherAction };
  });
}

/** The latest expenses paid by colleagues (one colleague's, when given), newest first, with each colleague's running account now. */
export async function listColleagueExpenses(filters: { personnelId?: number; limit?: number } = {}): Promise<ColleagueExpenseList> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const rows = await orm.select({
    id: colleagueExpenses.id, personnelId: colleagueExpenses.personnelId, personnelName: personnel.fullName, date: colleagueExpenses.date,
    description: colleagueExpenses.description, total: colleagueExpenses.total, status: colleagueExpenses.status, voucherId: colleagueExpenses.voucherId,
    voucherNumber: journalVouchers.voucherNumber, voucherStatus: journalVouchers.status,
  }).from(colleagueExpenses)
    .innerJoin(personnel, eq(personnel.id, colleagueExpenses.personnelId))
    .leftJoin(journalVouchers, eq(journalVouchers.id, colleagueExpenses.voucherId))
    .where(filters.personnelId ? eq(colleagueExpenses.personnelId, filters.personnelId) : undefined)
    .orderBy(desc(colleagueExpenses.date), desc(colleagueExpenses.id))
    .limit(limit);
  const ids = rows.map(r => r.id);
  const lineRows = ids.length === 0 ? [] : await orm.select({
    colleagueExpenseId: colleagueExpenseLines.colleagueExpenseId, lineNo: colleagueExpenseLines.lineNo, accountId: colleagueExpenseLines.accountId,
    accountCode: accounts.code, accountName: accounts.name, amount: colleagueExpenseLines.amount, description: colleagueExpenseLines.description,
    sellerName: colleagueExpenseLines.sellerName, invoiceNumber: colleagueExpenseLines.invoiceNumber,
  }).from(colleagueExpenseLines)
    .innerJoin(accounts, eq(accounts.id, colleagueExpenseLines.accountId))
    .where(inArray(colleagueExpenseLines.colleagueExpenseId, ids)).orderBy(colleagueExpenseLines.colleagueExpenseId, colleagueExpenseLines.lineNo);
  const account = await TreasuryTransactionService.colleagueCurrentAccount();
  const people = new Map(rows.map(r => [r.personnelId, r.personnelName]));
  const owed = account ? await Promise.all([...people].map(async ([personnelId, personnelName]) => ({
    personnelId, personnelName, owed: (await colleagueAccountBalance(orm, account.id, personnelId)).toNumber(),
  }))) : [];
  return {
    rows: rows.map(r => ({
      id: r.id, personnelId: r.personnelId, personnelName: r.personnelName, date: r.date, description: r.description,
      total: Number(r.total), status: r.status === 'voided' ? 'voided' : 'active', voucherId: r.voucherId,
      voucherNumber: r.voucherNumber == null ? null : Number(r.voucherNumber), voucherStatus: r.voucherStatus ?? null,
      lines: lineRows.filter(l => l.colleagueExpenseId === r.id).map(l => ({
        lineNo: l.lineNo, accountId: l.accountId, accountCode: l.accountCode, accountName: l.accountName, amount: Number(l.amount),
        description: l.description, sellerName: l.sellerName, invoiceNumber: l.invoiceNumber,
      })),
    })),
    owed,
  };
}
