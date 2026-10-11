import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { journalVoucherItems, journalVouchers } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import { AccountMappingService } from './accountMapping.service.js';
import { voucherItemReportAmountSql } from './voucherItemAmount.js';

/**
 * v10.0.172 (TD-922 / TD-919، تصمیم ت۴ ب فاز ۵): مانده کالای در جریان ساخت (۱۴۰۲، مفهوم `workInProgressCode`) هر پروژه
 * به ریال: ردیف‌های زنده اسناد زنده با تفصیلی پروژه، هر وضعیتی (پیش‌نویس هم)، ردیف ارزی به نرخ خود ردیف (TD-260).
 * بدهکار مثبت است؛ پروژه‌ای که مانده‌اش زیر رواداری تراز است در نتیجه نمی‌آید.
 */
export async function projectWipBalances(db: DbExecutor, projectIds?: number[]): Promise<Map<number, string>> {
  const balances = new Map<number, string>();
  if (projectIds && projectIds.length === 0) return balances;
  const wip = await AccountMappingService.resolveAccount('workInProgressCode', db);
  if (!wip) return balances;
  const amount = sql<string>`COALESCE(SUM(${voucherItemReportAmountSql(journalVoucherItems.debit)} - ${voucherItemReportAmountSql(journalVoucherItems.credit)}), 0)::text`;
  const rows = await db.select({ projectId: journalVoucherItems.detailedId, balance: amount })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .where(and(
      eq(journalVouchers.isDeleted, 0), eq(journalVoucherItems.isDeleted, 0),
      eq(journalVoucherItems.accountId, wip.id), eq(journalVoucherItems.detailedType, 'project'),
      projectIds ? inArray(journalVoucherItems.detailedId, projectIds) : sql`${journalVoucherItems.detailedId} IS NOT NULL`,
    ))
    .groupBy(journalVoucherItems.detailedId);
  for (const row of rows) {
    if (row.projectId === null) continue;
    if (fin(row.balance).abs().lessThan(VOUCHER_BALANCE_TOLERANCE)) continue;
    balances.set(Number(row.projectId), fin(row.balance).toString());
  }
  return balances;
}
