import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { journalVoucherItems, journalVouchers, personnel } from '../../../db/schema.js';
import { ConflictError } from '../../../errors/customErrors.js';
import { fin, type FinancialDecimal } from '../../../lib/financialDecimal.js';
import { formatPersianNumber } from '../../../utils/persianNumber.js';

/**
 * v10.0.58 (TD-926، P5-W03، تصمیم ت۸ الف بازبینی فاز ۵): مساعده‌ای که فیش زنده کسر کرده باطل نمی‌شود. پیش‌تر ابطال آن آزاد
 * بود: ردیف بدهکار «مساعده و وام پرسنل» (نگاشت ۱۳۰۱) برمی‌گشت در حالی که بستانکار کسر فیش می‌ماند، پس مانده مساعده پرسنل
 * منفی (دارایی منفی) و پول دوباره به بانک برمی‌گشت.
 *
 * قاعده: ابطال پرداخت مساعده (پرداخت خزانه به پرسنل با هدف «مساعده») وقتی رد می‌شود که مانده مساعده پرسنل پس از برداشتن
 * ردیف‌های همین سند از صفر کمتر شود؛ همان دفتری که `getPersonnelAdvanceBalance` و نگهبان کسر فیش (TD-282) می‌خوانند. مساعده‌ای
 * که هنوز کسر نشده یا فیش کسرکننده‌اش حذف شده آزاد است. فراخواننده ردیف پرسنل را پیش از ردیف خزانه `FOR UPDATE` قفل می‌کند
 * (همان قفلی که صدور فیش می‌گیرد)، پس صدور فیش همزمان کسر را بر مانده‌ای که در حال ابطال است نمی‌نویسد.
 */

export function isAdvancePayment(row: { type: string | null; partyType: string | null; purpose: string | null; partyId: number | null }): boolean {
  return row.type === 'payment' && row.partyType === 'personnel' && row.purpose === 'advance' && !!row.partyId;
}

/** ردیف پرسنل یک پرداخت مساعده، سطح ۳۰ (پس از بانک، پیش از ردیف خزانه) */
export async function lockAdvancePersonnel(tx: DbExecutor, personnelId: number): Promise<void> {
  await tx.select({ id: personnel.id }).from(personnel).where(eq(personnel.id, personnelId)).for('update');
}

async function advanceNet(tx: DbExecutor, accountId: number, personnelId: number, voucherId?: number): Promise<FinancialDecimal> {
  const rows = await tx.select({ debit: journalVoucherItems.debit, credit: journalVoucherItems.credit })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVoucherItems.voucherId, journalVouchers.id))
    .where(and(
      eq(journalVoucherItems.accountId, accountId),
      eq(journalVoucherItems.detailedType, 'personnel'),
      eq(journalVoucherItems.detailedId, personnelId),
      eq(journalVouchers.isDeleted, 0),
      eq(journalVoucherItems.isDeleted, 0),
      ...(voucherId ? [eq(journalVouchers.id, voucherId)] : []),
    ));
  return rows.reduce((sum, r) => sum.add(r.debit).subtract(r.credit), fin(0));
}

/** The caller passes the mapped employee advance account, so this core file imports no other core (package boundary). */
export async function assertAdvanceVoidKeepsBalance(tx: DbExecutor, row: {
  transactionNumber: string;
  partyId: number | null;
  partyName: string | null;
  voucherId: number | null;
}, advanceAccount: { id: number } | null | undefined): Promise<void> {
  if (!row.partyId || !row.voucherId) return;
  if (!advanceAccount) return;
  const outstanding = await advanceNet(tx, advanceAccount.id, row.partyId);
  const own = await advanceNet(tx, advanceAccount.id, row.partyId, row.voucherId);
  const after = outstanding.subtract(own);
  if (after.lessThan(-0.01)) {
    throw new ConflictError(
      `مساعده ${row.transactionNumber} در فیش حقوقی ${row.partyName || 'پرسنل'} کسر شده است و ابطال آن مانده مساعده را ${formatPersianNumber(after.abs().toNumber())} ریال منفی می‌کند؛ نخست آن فیش را حذف یا کسر مساعده‌اش را اصلاح کنید.`,
      { outstandingAdvance: outstanding.toNumber(), voidedAdvance: own.toNumber() },
      'TREASURY_ADVANCE_DEDUCTED',
    );
  }
}
