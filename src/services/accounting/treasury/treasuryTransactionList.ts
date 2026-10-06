import { orm } from '../../../db/drizzle.js';
import { accounts, bankAccounts, treasuryTransactions, users } from '../../../db/schema.js';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { fin } from '../../../lib/financialDecimal.js';
import { containsLikePattern } from '../../../lib/sqlLike.js';
import type { TreasuryTransaction } from '../../../types.js';

/** فیلترهای فهرست تراکنش‌های خزانه (همان فیلترهای جدول صفحه خزانه) */
export interface TreasuryListFilters {
  // v7.0.110 (TD-240): «all» یعنی بدون فیلتر نوع (مانند فهرست اسناد حسابداری)
  type?: 'receipt' | 'payment' | 'all';
  bankAccountId?: number;
  startDate?: string;
  endDate?: string;
  method?: string;
  /** جستجو در نام طرف حساب، شماره رسید، شماره پیگیری و توضیحات */
  q?: string;
}

export interface TreasuryTransactionPage {
  data: TreasuryTransaction[];
  total: number;
  page: number;
  limit: number;
}

function listConditions(filters: TreasuryListFilters): SQL[] {
  const conditions: SQL[] = [eq(treasuryTransactions.isDeleted, 0)];
  if (filters.type && filters.type !== 'all') conditions.push(eq(treasuryTransactions.type, filters.type));
  if (filters.bankAccountId) conditions.push(eq(treasuryTransactions.bankAccountId, filters.bankAccountId));
  if (filters.startDate) conditions.push(gte(treasuryTransactions.date, filters.startDate));
  if (filters.endDate) conditions.push(lte(treasuryTransactions.date, filters.endDate));
  if (filters.method && filters.method !== 'all') conditions.push(eq(treasuryTransactions.method, filters.method));
  const q = filters.q?.trim();
  if (q) {
    const pattern = containsLikePattern(q);
    const match = or(
      ilike(treasuryTransactions.partyName, pattern),
      ilike(treasuryTransactions.transactionNumber, pattern),
      ilike(treasuryTransactions.trackingNumber, pattern),
      ilike(treasuryTransactions.description, pattern),
    );
    if (match) conditions.push(match);
  }
  return conditions;
}

function selectTransactions() {
  return orm.select({
    id: treasuryTransactions.id,
    transactionNumber: treasuryTransactions.transactionNumber,
    type: treasuryTransactions.type,
    date: treasuryTransactions.date,
    method: treasuryTransactions.method,
    amount: treasuryTransactions.amount,
    currency: treasuryTransactions.currency,
    exchangeRate: treasuryTransactions.exchangeRate,
    bankAccountId: treasuryTransactions.bankAccountId,
    bankAccountTitle: bankAccounts.title,
    partyType: treasuryTransactions.partyType,
    partyId: treasuryTransactions.partyId,
    partyName: treasuryTransactions.partyName,
    trackingNumber: treasuryTransactions.trackingNumber,
    voucherId: treasuryTransactions.voucherId,
    chequeId: treasuryTransactions.chequeId,
    documentId: treasuryTransactions.documentId,
    payrollId: treasuryTransactions.payrollId,
    reversalOfId: treasuryTransactions.reversalOfId,
    purpose: treasuryTransactions.purpose,
    contraAccountId: treasuryTransactions.contraAccountId,
    contraAccountName: accounts.name,
    // V1.6.0: وضعیت آشتی‌سنجی بانکی
    reconciled: treasuryTransactions.reconciled,
    reconciledAt: treasuryTransactions.reconciledAt,
    reconciledBatch: treasuryTransactions.reconciledBatch,
    // V1.5.0: هویت ثبت‌کننده (یک موجودیت کاربر)
    createdById: treasuryTransactions.createdById,
    creatorName: users.fullName,
    description: treasuryTransactions.description,
    status: treasuryTransactions.status,
    attachments: treasuryTransactions.attachments,
    createdAt: treasuryTransactions.createdAt,
  })
  .from(treasuryTransactions)
  .leftJoin(bankAccounts, eq(bankAccounts.id, treasuryTransactions.bankAccountId))
  .leftJoin(users, eq(users.id, treasuryTransactions.createdById))
  .leftJoin(accounts, eq(accounts.id, treasuryTransactions.contraAccountId));
}

type TransactionRow = Awaited<ReturnType<ReturnType<typeof selectTransactions>['where']>>[number];

function toTreasuryTransactionDto(t: TransactionRow): TreasuryTransaction {
  return {
    ...t,
    amount: t.amount.toNumber(), // قرارداد API: مبلغ عدد (P2-6)
    exchangeRate: t.exchangeRate?.toNumber() ?? null,
    type: t.type as 'receipt' | 'payment',
    method: t.method as TreasuryTransaction['method'],
    partyType: t.partyType as TreasuryTransaction['partyType'],
    status: t.status as TreasuryTransaction['status'],
    transaction_number: t.transactionNumber,
    bank_account_id: t.bankAccountId || undefined,
    party_type: t.partyType as TreasuryTransaction['partyType'],
    party_id: t.partyId,
    party_name: t.partyName,
    tracking_number: t.trackingNumber || '',
    voucher_id: t.voucherId,
    cheque_id: t.chequeId,
    document_id: t.documentId,
  } as TreasuryTransaction;
}

/** همه تراکنش‌های منطبق با فیلترها (خروجی اکسل، تطبیق صورت‌حساب یک بانک) */
export async function listTreasuryTransactions(filters: TreasuryListFilters): Promise<TreasuryTransaction[]> {
  const rows = await selectTransactions()
    .where(and(...listConditions(filters)))
    .orderBy(desc(treasuryTransactions.date), desc(treasuryTransactions.id));
  return rows.map(toTreasuryTransactionDto);
}

/**
 * مانده پس از هر ردیف این صفحه برای فیلتر یک حساب: مانده اول دوره + جمع ردیف‌های باطل‌نشده همان حساب به ترتیب (تاریخ،
 * شناسه)، بی‌اثر از فیلترهای دیگر — همان قاعده‌ای که جدول پیش‌تر روی کل فهرست در مرورگر حساب می‌کرد. ردیف باطل‌شده مانده ندارد.
 */
async function runningBalancesOf(bankAccountId: number, ids: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (ids.length === 0) return result;
  const [bank] = await orm.select({ initialBalance: bankAccounts.initialBalance }).from(bankAccounts).where(eq(bankAccounts.id, bankAccountId));
  const initial = fin(bank?.initialBalance ?? 0);
  const ranked = orm.$with('ranked').as(
    orm.select({
      id: treasuryTransactions.id,
      cumulative: sql<string>`SUM(CASE WHEN ${treasuryTransactions.type} = 'receipt' THEN ${treasuryTransactions.amount} ELSE -${treasuryTransactions.amount} END) OVER (ORDER BY ${treasuryTransactions.date}, ${treasuryTransactions.id})::text`.as('cumulative'),
    })
    .from(treasuryTransactions)
    .where(and(
      eq(treasuryTransactions.isDeleted, 0),
      eq(treasuryTransactions.bankAccountId, bankAccountId),
      sql`COALESCE(${treasuryTransactions.status}, 'completed') <> 'voided'`,
    )),
  );
  const rows = await orm.with(ranked).select({ id: ranked.id, cumulative: ranked.cumulative }).from(ranked).where(inArray(ranked.id, ids));
  for (const row of rows) result.set(row.id, initial.add(fin(row.cumulative)).toNumber());
  return result;
}

/**
 * v9.0.102 (TD-509، B04-13): یک صفحه از فهرست خزانه با شمار کل منطبق‌ها، صفحه‌بندی و مانده جاری در SQL. پیش‌تر صفحه خزانه
 * کل فهرست را می‌خواند (۲۰٬۰۰۰ ردیف، ۱۵٫۸۸ MB) و `page` / `limit` نادیده گرفته می‌شد.
 */
export async function pageTreasuryTransactions(filters: TreasuryListFilters, page: number, limit: number): Promise<TreasuryTransactionPage> {
  const where = and(...listConditions(filters));
  const [{ total }] = await orm.select({ total: sql<number>`COUNT(*)::int` }).from(treasuryTransactions).where(where);
  const rows = await selectTransactions()
    .where(where)
    .orderBy(desc(treasuryTransactions.date), desc(treasuryTransactions.id))
    .limit(limit)
    .offset((page - 1) * limit);
  const data = rows.map(toTreasuryTransactionDto);
  if (filters.bankAccountId) {
    const balances = await runningBalancesOf(filters.bankAccountId, data.filter(t => t.status !== 'voided').map(t => t.id));
    for (const tx of data) {
      const balance = balances.get(tx.id);
      if (balance !== undefined) tx.runningBalance = balance;
    }
  }
  return { data, total: Number(total), page, limit };
}
