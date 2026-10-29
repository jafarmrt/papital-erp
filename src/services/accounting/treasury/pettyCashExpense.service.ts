import { and, asc, eq, inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../../db/drizzle.js';
import { accounts, pettyCashExpenseLines, productionProjects, treasuryTransactions } from '../../../db/schema.js';
import { NotFoundError, ValidationError } from '../../../errors/customErrors.js';
import { fin } from '../../../lib/financialDecimal.js';
import { money } from '../../../lib/money.js';
import { toLatinDigits } from '../../../lib/numericInput.js';
import { validateLockOrder, LockHierarchyLevel } from '../../../lib/lockOrder.js';
import {
  PETTY_CASH_CURRENCY, PETTY_CASH_TYPE, pettyCashLineAmount, pettyCashLineVoucherDescription, pettyCashStatementError,
  type PettyCashLineInput,
} from '../../../lib/treasury/pettyCash.js';
import type { PettyCashExpenseLine, TreasuryTransaction } from '../../../types.js';
import { choosableContraAccounts, type ContraAccountOption } from './partyContraAccount.js';
import { auditTreasuryTransactionCreated, type TreasuryAuditActor } from './treasuryAudit.js';
import { resolveTreasuryWriteDate } from './treasuryDate.js';
import { TreasuryTransactionService } from './treasuryTransaction.service.js';
import { lockTreasuryBankRow, postTreasuryRow } from './treasuryPosting.js';
import { idempotentTransaction } from '../../../middleware/idempotency.js';
import { expenseLineDetail, projectTitleOf, resolveExpenseProjects } from './expenseProject.js';

/**
 * v10.1.32 (D-16، تصمیم مالک محصول ت۳۰ «متغیر»): صورت‌هزینه تنخواه‌گردان. یک پرداخت خزانه از حساب تنخواه (نوع
 * `petty_cash`، ریالی) که سند پیش‌نویس آن هر ردیف را به حساب هزینه همان ردیف بدهکار و سرفصل تنخواه را با تفصیلی همان
 * تنخواه بستانکار می‌کند؛ مانده تنخواه به اندازه جمع ردیف‌ها کم می‌شود و از مانده بیشتر نمی‌شود. ردیف‌ها در
 * `petty_cash_expense_lines` می‌مانند. مالیات بر ارزش افزوده، فروشنده و شماره فاکتور لازم نیستند و ردیف مالیات خرید
 * ساخته نمی‌شود (ت۱۳). ابطال همان ابطال تراکنش خزانه است: سند پیش‌نویس حذف نرم و سند تأییدشده معکوس می‌شود و مانده
 * برمی‌گردد. شارژ و برگشت وجه همان «انتقال وجه» است.
 */

/** انواع حسابی که ردیف صورت‌هزینه می‌پذیرد: هزینه و بهای تمام‌شده (گروه «هزینه» نگاشت حساب‌ها) */
export const PETTY_CASH_EXPENSE_ACCOUNT_TYPES = ['expense', 'cost_of_sales'] as const;

const FUND_INVALID = 'PETTY_CASH_FUND_INVALID';
const ACCOUNT_INVALID = 'PETTY_CASH_EXPENSE_ACCOUNT_INVALID';

export interface PettyCashExpenseInput {
  fundId: number;
  date?: string;
  description?: string;
  lines: PettyCashLineInput[];
  attachments?: unknown[];
  userId?: number;
  username?: string;
  audit?: TreasuryAuditActor;
}

export type PettyCashExpenseResult = TreasuryTransaction & { lines: PettyCashExpenseLine[] };

/** حساب‌هایی که فرم صورت‌هزینه (و «هزینهٔ پرداختی همکار») پیشنهاد می‌دهد: سرفصل طرف مقابل مجاز، از نوع هزینه و بی زیرحساب فعال (قابل ثبت) */
export function pettyCashExpenseAccounts(): Promise<ContraAccountOption[]> {
  return expenseAccountsWith(orm);
}

async function expenseAccountsWith(executor: DbExecutor): Promise<ContraAccountOption[]> {
  const options = (await choosableContraAccounts(executor))
    .filter(a => (PETTY_CASH_EXPENSE_ACCOUNT_TYPES as readonly string[]).includes(a.accountType));
  if (options.length === 0) return [];
  const parents = new Set((await executor.select({ parentId: accounts.parentId }).from(accounts)
    .where(and(inArray(accounts.parentId, options.map(a => a.id)), eq(accounts.isDeleted, 0), eq(accounts.isActive, 1)))
  ).map(r => Number(r.parentId)));
  return options.filter(a => !parents.has(a.id));
}

export async function assertExpenseAccounts(tx: DbExecutor, accountIds: number[]): Promise<Map<number, { code: string; name: string }>> {
  // قفل اشتراکی حساب‌ها مانند سند دستی؛ فهرست مجاز فقط حساب‌های معین فعال هزینه‌ای بی زیرحساب فعال (قابل ثبت) را دارد
  await tx.select({ id: accounts.id }).from(accounts)
    .where(inArray(accounts.id, [...new Set(accountIds)])).orderBy(asc(accounts.id)).for('share');
  const allowed = new Map((await expenseAccountsWith(tx)).map(a => [a.id, { code: a.code, name: a.name }]));
  const refused = [...new Set(accountIds)].filter(id => !allowed.has(id));
  if (refused.length > 0) {
    throw new ValidationError(
      'ردیف صورت‌هزینه فقط روی حساب هزینه یا بهای تمام‌شده ثبت می‌شود؛ حساب‌های دریافتنی، پرداختنی، چک، موجودی کالا و خزانه پذیرفته نمی‌شوند.',
      { accountIds: refused },
      ACCOUNT_INVALID,
    );
  }
  return allowed;
}

async function lockFund(tx: DbExecutor, fundId: number) {
  const fund = await lockTreasuryBankRow(tx, fundId);
  if (!fund) throw new NotFoundError('تنخواه‌گردان یافت نشد', undefined, FUND_INVALID);
  if (fund.type !== PETTY_CASH_TYPE) {
    throw new ValidationError(`حساب «${fund.title}» تنخواه‌گردان نیست؛ صورت‌هزینه فقط از تنخواه‌گردان ثبت می‌شود.`, undefined, FUND_INVALID);
  }
  if ((fund.isActive ?? 1) !== 1) throw new ValidationError(`تنخواه «${fund.title}» غیرفعال است.`, undefined, FUND_INVALID);
  if ((fund.currency || PETTY_CASH_CURRENCY).toUpperCase() !== PETTY_CASH_CURRENCY) {
    throw new ValidationError(`تنخواه «${fund.title}» ریالی نیست؛ تنخواه‌گردان فقط ریالی است.`, undefined, 'PETTY_CASH_RIAL_ONLY');
  }
  if (!fund.accountId) {
    throw new ValidationError(`تنخواه «${fund.title}» سرفصل حسابداری ندارد؛ نخست در ویرایش حساب سرفصل آن را انتخاب کنید.`, undefined, FUND_INVALID);
  }
  return fund;
}

export async function createPettyCashExpense(input: PettyCashExpenseInput): Promise<PettyCashExpenseResult> {
  const statementError = pettyCashStatementError(input.lines);
  if (statementError) throw new ValidationError(statementError, undefined, 'PETTY_CASH_LINES_INVALID');
  const lines = input.lines.map((line, i) => ({
    lineNo: i + 1,
    accountId: Number(line.accountId),
    amount: fin(pettyCashLineAmount(line.amount)).round(4),
    description: (line.description ?? '').trim(),
    sellerName: (line.sellerName ?? '').trim(),
    // شماره فاکتور مانند شماره چک با ارقام لاتین ذخیره می‌شود (TD-385)
    invoiceNumber: toLatinDigits(line.invoiceNumber ?? '').trim(),
    projectId: line.projectId ?? null,
  }));
  const total = lines.reduce((sum, line) => sum.add(line.amount), fin(0)).round(4);
  const date = await resolveTreasuryWriteDate(input.date, 'تاریخ صورت‌هزینه');
  const description = (input.description ?? '').trim();

  return await idempotentTransaction(async (tx) => {
    validateLockOrder([
      { name: 'bankAccount', hierarchyLevel: LockHierarchyLevel.BANK_ACCOUNTS },
      { name: 'journalVoucher', hierarchyLevel: LockHierarchyLevel.JOURNAL_VOUCHERS },
      { name: 'treasuryTransaction', hierarchyLevel: LockHierarchyLevel.TREASURY_TRANSACTIONS },
    ]);
    const fund = await lockFund(tx, input.fundId);
    const accountNames = await assertExpenseAccounts(tx, lines.map(l => l.accountId));
    const projects = await resolveExpenseProjects(tx, lines.map(l => l.projectId));

    const voucherDescription = description || `صورت‌هزینه تنخواه ${fund.title}`;
    // v10.2.2 (OBS-R2-52): از راه مشترک خزانه (`postTreasuryRow`): مانده تنخواه با همان نگهبان مانده منفی (پیام و کد
    // خود تنخواه)، شماره، سند پیش‌نویس، ردیف و رویداد آن؛ ردیف‌های صورت‌هزینه و پیوست‌ها پس از آن نوشته می‌شوند
    const { row } = await postTreasuryRow(tx, fund, {
      type: 'payment',
      date,
      method: 'cash',
      amount: total,
      currency: PETTY_CASH_CURRENCY,
      exchangeRate: 1,
      partyType: 'other',
      partyId: null,
      partyName: 'هزینه‌های تنخواه',
      purpose: null,
      contraAccountId: null,
      trackingNumber: '',
      documentId: null,
      description: voucherDescription,
      createdById: input.userId || null,
      voucher: (txNum) => TreasuryTransactionService.createTreasuryVoucher({
        date,
        description: voucherDescription,
        referenceNumber: txNum,
        currency: PETTY_CASH_CURRENCY,
        userId: input.userId,
        username: input.username,
        items: [
          ...lines.map(line => ({
            accountId: line.accountId,
            ...expenseLineDetail(projects.get(line.projectId ?? 0)),
            debit: line.amount,
            credit: 0,
            currency: PETTY_CASH_CURRENCY,
            exchangeRate: 1,
            description: pettyCashLineVoucherDescription(fund.title, line),
          })),
          {
            accountId: Number(fund.accountId),
            detailedType: 'bank_account',
            detailedId: fund.id,
            detailedName: fund.title,
            debit: 0,
            credit: total,
            currency: PETTY_CASH_CURRENCY,
            exchangeRate: 1,
            description: voucherDescription,
          },
        ],
      }, tx),
      event: (rowId) => ({
        transactionId: rowId, type: 'withdrawal', currency: PETTY_CASH_CURRENCY,
        accountId: fund.id, accountName: fund.title, pettyCashLines: lines.length,
      }),
      actor: { userId: input.userId, username: input.username },
      insufficientBalance: (balance) => new ValidationError(
        `جمع صورت‌هزینه از مانده تنخواه «${fund.title}» (${balance.toNumber().toLocaleString('fa-IR')} ریال) بیشتر است؛ نخست تنخواه را شارژ کنید.`,
        { balance: balance.toNumber(), total: total.toNumber() },
        'PETTY_CASH_INSUFFICIENT_BALANCE',
      ),
    });
    await tx.insert(pettyCashExpenseLines).values(lines.map(line => ({
      treasuryTransactionId: row.id,
      lineNo: line.lineNo,
      accountId: line.accountId,
      amount: money(line.amount),
      description: line.description,
      sellerName: line.sellerName,
      invoiceNumber: line.invoiceNumber,
      projectId: line.projectId,
    })));
    row.attachments = await TreasuryTransactionService.attachTreasuryRowFiles(tx, row.id, input.attachments, input.username);

    const resultLines: PettyCashExpenseLine[] = lines.map(line => ({
      lineNo: line.lineNo,
      accountId: line.accountId,
      accountCode: accountNames.get(line.accountId)?.code ?? '',
      accountName: accountNames.get(line.accountId)?.name ?? '',
      amount: line.amount.toNumber(),
      description: line.description,
      sellerName: line.sellerName,
      invoiceNumber: line.invoiceNumber,
      projectId: line.projectId,
      projectTitle: projectTitleOf(projects.get(line.projectId ?? 0)),
    }));
    const created = {
      ...row,
      amount: row.amount.toNumber(),
      exchangeRate: row.exchangeRate?.toNumber() ?? null,
      type: 'payment',
      method: 'cash',
      partyType: 'other',
      status: row.status as TreasuryTransaction['status'],
      bankAccountTitle: fund.title,
      pettyCashLineCount: lines.length,
      lines: resultLines,
    } as PettyCashExpenseResult;
    await auditTreasuryTransactionCreated(tx, input.audit, created, { ...created });
    return created;
  });
}

/** ردیف‌های صورت‌هزینه یک تراکنش خزانه (تهی برای تراکنشی که صورت‌هزینه نیست) */
export async function listPettyCashExpenseLines(transactionId: number): Promise<PettyCashExpenseLine[]> {
  const [row] = await orm.select({ id: treasuryTransactions.id }).from(treasuryTransactions)
    .where(and(eq(treasuryTransactions.id, transactionId), eq(treasuryTransactions.isDeleted, 0)));
  if (!row) throw new NotFoundError('تراکنش خزانه یافت نشد');
  const rows = await orm.select({
    lineNo: pettyCashExpenseLines.lineNo,
    accountId: pettyCashExpenseLines.accountId,
    accountCode: accounts.code,
    accountName: accounts.name,
    amount: pettyCashExpenseLines.amount,
    description: pettyCashExpenseLines.description,
    sellerName: pettyCashExpenseLines.sellerName,
    invoiceNumber: pettyCashExpenseLines.invoiceNumber,
    projectId: pettyCashExpenseLines.projectId,
    projectCode: productionProjects.projectCode,
    projectName: productionProjects.title,
  }).from(pettyCashExpenseLines)
    .leftJoin(accounts, eq(accounts.id, pettyCashExpenseLines.accountId))
    .leftJoin(productionProjects, eq(productionProjects.id, pettyCashExpenseLines.projectId))
    .where(eq(pettyCashExpenseLines.treasuryTransactionId, transactionId))
    .orderBy(asc(pettyCashExpenseLines.lineNo));
  return rows.map(({ projectCode, projectName, ...r }) => ({
    ...r,
    accountCode: r.accountCode ?? '',
    accountName: r.accountName ?? '',
    amount: r.amount.toNumber(),
    projectTitle: projectCode ? projectTitleOf({ code: projectCode, title: projectName ?? '' }) : '',
  }));
}
