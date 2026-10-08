import type { PoolClient } from 'pg';
import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts, activityLogs, fiscalPeriods, journalVouchers, purchaseRequisitions } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { businessTodayIsoDate, getDisplayTimezone } from '../../lib/businessClock.js';
import { FiscalPeriodService } from '../../services/accounting/fiscalPeriod.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { DocumentService } from '../../services/document.service.js';
import { ProcurementService } from '../../services/procurement.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestItem } from '../fixtures/factories.js';
import { accountIdByCode } from './concurrencyHarness.js';
import { receive } from './scenarioHelpers.js';

/**
 * v8.0.77 — سناریوی سخت‌گیرانه «اتصال دوم استخر درون تراکنش» حوزه J برای سوئیت business_invariants: هر مسیر با استخری
 * اجرا می‌شود که فقط یک اتصال آزاد دارد (همان حالتی که ۲۰ تراکنش هم‌زمان سقف استخر را پر کرده‌اند). مسیری که درون
 * تراکنشش اتصال دومی بخواهد تا مهلت اتصال منتظر می‌ماند و رد می‌شود یا کارش را نیمه رها می‌کند.
 */

const POOL_MAX = Number(process.env.DB_POOL_MAX || 20);
const CONN_TIMEOUT_MS = Number(process.env.DB_CONN_TIMEOUT || 5000);
const ADMIN = { username: 'inv', role: 'admin', permissions: [] as string[] };

type Run<T> = { ok: true; value: T; ms: number } | { ok: false; message: string; ms: number };

/** همه اتصال‌های استخر جز یکی را نگه می‌دارد و کار را با همان یک اتصال آزاد اجرا می‌کند */
async function withOneFreeConnection<T>(run: () => Promise<T>): Promise<Run<T>> {
  const held: PoolClient[] = [];
  try {
    for (let i = 0; i < POOL_MAX - 1; i++) held.push(await pool.connect());
    const started = Date.now();
    try {
      const value = await run();
      return { ok: true, value, ms: Date.now() - started };
    } catch (err) {
      return { ok: false, message: getErrorMessage(err), ms: Date.now() - started };
    }
  } finally {
    for (const client of held) client.release();
  }
}

function waitProblems(label: string, result: Run<unknown>): string[] {
  if (!result.ok) return [`${label} با یک اتصال آزاد رد شد (${result.message.slice(0, 160)})`];
  if (result.ms >= CONN_TIMEOUT_MS * 0.8) return [`${label} ${result.ms} میلی‌ثانیه منتظر اتصال دوم استخر ماند`];
  return [];
}

async function auditRows(entity: string, entityId: number, action: string): Promise<number> {
  const rows = await orm.select({ id: activityLogs.id }).from(activityLogs)
    .where(and(eq(activityLogs.entity, entity), eq(activityLogs.entityId, String(entityId)), eq(activityLogs.action, action)));
  return rows.length;
}

/** کش منطقه زمانی را کهنه نشان می‌دهد (ساعت سیستم ۶۱ ثانیه جلوتر) */
async function withStaleTimezoneCache<T>(run: () => Promise<T>): Promise<T> {
  await getDisplayTimezone();
  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  try {
    return await run();
  } finally {
    Date.now = realNow;
  }
}

/**
 * TD-324: مسیرهای تراکنشی با یک اتصال آزاد استخر کامل می‌شوند: سند حسابداری اول یک سال مالی تازه، ابطال سند با کش کهنه
 * منطقه زمانی (و ثبت ممیزی‌اش)، ثبت درخواست خرید (گردش‌کار و ممیزی) و حساب بانکی با مانده اول دوره (گردش‌کار شرطی)؛ و
 * خطای ثبت ممیزی درون تراکنش بلعیده نمی‌شود. پیش‌تر هر کدام درون تراکنش اتصال دومی می‌گرفت: سند سال تازه رد می‌شد و
 * بقیه پس از مهلت اتصال بی گردش‌کار یا بی ردیف ممیزی تمام می‌شدند.
 */
export async function checkNoSecondConnectionInTransactions(wh: string): Promise<string[]> {
  const problems: string[] = [];

  // ۱) اولین سند یک سال مالی تازه: ردیف سال در همان تراکنش ساخته می‌شود
  FiscalPeriodService.resetCache();
  const newYearDate = '2041-06-15';
  const lines = [
    { accountId: await accountIdByCode('1001'), debit: 1000, credit: 0 },
    { accountId: await accountIdByCode('4001'), debit: 0, credit: 1000 },
  ];
  const newYear = await withOneFreeConnection(() => VoucherService.createJournalVoucher({
    date: newYearDate, status: 'draft', description: 'آزمون TD-324 سال مالی تازه', items: lines,
  }));
  problems.push(...waitProblems('first voucher of a new fiscal year', newYear));
  const [period] = await orm.select({ status: fiscalPeriods.status }).from(fiscalPeriods)
    .where(eq(fiscalPeriods.fiscalYear, FiscalPeriodService.yearOf(newYearDate)));
  if (newYear.ok && period?.status !== 'open') problems.push(`the new fiscal year row was not created (${period?.status ?? 'missing'})`);
  if (newYear.ok) await orm.update(journalVouchers).set({ isDeleted: 1 }).where(eq(journalVouchers.id, newYear.value.id));

  // ۲) ابطال سند با کش کهنه منطقه زمانی؛ ممیزی در همان تراکنش
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const docId = await receive(item.id, 2, 1000, wh, await businessTodayIsoDate());
  const voided = await withStaleTimezoneCache(() => withOneFreeConnection(() => DocumentService.deleteDocument(docId, 'inv')));
  problems.push(...waitProblems('voiding a document with a stale time zone cache', voided));
  if (voided.ok && await auditRows('اسناد انبار', docId, 'DELETE') !== 1) problems.push('The audit row of the document void was not recorded');

  // ۳) درخواست خرید: گردش‌کار و ممیزی در همان تراکنش
  const requisition = await withOneFreeConnection(() => ProcurementService.createRequisition({
    title: 'درخواست آزمون TD-324',
    items: [{ itemId: item.id, itemCode: item.code, itemName: item.name, unit: 'عدد', requestedQty: 1, unitPriceEstimate: 1000 }],
  }, ADMIN));
  problems.push(...waitProblems('creating a purchase requisition', requisition));
  if (requisition.ok) {
    const [row] = await orm.select({ wf: purchaseRequisitions.workflowInstanceId }).from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, requisition.value.id));
    if (!row?.wf) problems.push('The purchase requisition workflow did not start');
    if (await auditRows('درخواست خرید', requisition.value.id, 'CREATE') !== 1) problems.push('The audit row of the purchase requisition create was not recorded');
  }

  // ۴) حساب بانکی با مانده اول دوره: گردش‌کار شرطی و سند افتتاحیه در همان تراکنش
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
  const [ledger] = await orm.insert(accounts).values({
    code: `1003${Date.now().toString().slice(-7)}`, name: 'بانک آزمون TD-324', level: 'subsidiary', parentId: parent?.id ?? null,
    accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  const bank = await withOneFreeConnection(() => BankAccountService.createBankAccount({
    title: 'بانک آزمون TD-324', type: 'bank', accountId: ledger.id, initialBalance: 5000, currency: 'IRR', username: 'inv',
  }));
  problems.push(...waitProblems('bank account with an opening balance', bank));

  // ۵) خطای ثبت ممیزی درون تراکنش بلعیده نمی‌شود (وگرنه COMMIT بی‌صدا ROLLBACK می‌شود و فراخواننده موفقیت می‌بیند)
  const swallowed = await orm.transaction(async (tx) => {
    await logActivity({ tx, userId: 2147483000, action: 'VIEW', entity: 'آزمون TD-324', description: 'کاربر ناموجود' });
  }).then(() => true, () => false);
  if (swallowed) problems.push('An audit write error inside the transaction was swallowed and the transaction was reported as successful');
  return problems;
}
