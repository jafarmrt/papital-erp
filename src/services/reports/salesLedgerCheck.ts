import { and, eq, inArray, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, journalVoucherItems, journalVouchers } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import type { ReportRange } from '../../lib/reports/reportPeriods.js';
import type { SalesLedgerCheck } from '../../lib/reports/salesReport.js';
import { AccountMappingService } from '../accounting/accountMapping.service.js';
import { voucherItemCurrencyCondition, voucherItemReportAmountSql } from '../accounting/voucherItemAmount.js';
import { yearEndClosingVoucherSql } from '../accounting/yearEndClosingVouchers.js';

/**
 * v10.1.7 (D-03، طرح گزارش‌های مدیریتی §۲.۴): سطر هم‌خوانی گزارش فروش با دفتر کل. حساب‌ها همان‌اند که سند فروش و برگشت
 * می‌زنند: درآمد فروش و تخفیف فروش از نگاشت حساب‌ها و «برگشت از فروش» 5101؛ مانده (بستانکار − بدهکار) آن‌ها در همان بازه
 * برابر فروش منهای تخفیف و برگشت است. مبلغ ردیف به قاعده TD-260 (نمای همه ارزها: ردیف ارزی با نرخ خودش به ریال؛ نمای یک
 * ارز: فقط ردیف‌های همان ارز). سند پیش‌نویس (سند خودکار فروش تا تأیید حسابدار) جدا جمع می‌شود و تفاوت گزارش با همه سندها
 * سنجیده می‌شود؛ سند بستن سال (`yearEndClosingVoucherSql`) و ردیف و سند حذف‌شده شمرده نمی‌شوند.
 */

const SALES_RETURN_ACCOUNT_CODE = '5101';

export async function salesLedgerCheck(range: ReportRange, currency: string, reportNet: string): Promise<SalesLedgerCheck> {
  const [revenue, discount, returns] = await Promise.all([
    AccountMappingService.getSalesRevenueAccount(),
    AccountMappingService.getSalesDiscountAccount(),
    orm.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts)
      .where(and(eq(accounts.code, SALES_RETURN_ACCOUNT_CODE), eq(accounts.isDeleted, 0))),
  ]);
  const byId = new Map<number, { code: string; name: string }>();
  for (const acc of [revenue, discount, returns[0]]) {
    if (acc) byId.set(acc.id, { code: acc.code, name: acc.name });
  }
  let approved = fin(0);
  let draft = fin(0);
  if (byId.size > 0) {
    const amount = sql`(${voucherItemReportAmountSql(journalVoucherItems.credit, currency)} - ${voucherItemReportAmountSql(journalVoucherItems.debit, currency)})`;
    const currencyCondition = voucherItemCurrencyCondition(currency);
    const [row] = await orm.select({
      approved: sql<string>`COALESCE(SUM(${amount}) FILTER (WHERE ${journalVouchers.status} IN ('approved', 'permanent')), 0)::text`,
      draft: sql<string>`COALESCE(SUM(${amount}) FILTER (WHERE ${journalVouchers.status} = 'draft'), 0)::text`,
    })
      .from(journalVoucherItems)
      .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
      .where(and(
        eq(journalVoucherItems.isDeleted, 0),
        eq(journalVouchers.isDeleted, 0),
        inArray(journalVoucherItems.accountId, Array.from(byId.keys())),
        sql`${journalVouchers.date} >= ${range.from} AND ${journalVouchers.date} <= ${range.to}`,
        sql`NOT ${yearEndClosingVoucherSql}`,
        currencyCondition,
      ));
    approved = fin(row?.approved ?? '0');
    draft = fin(row?.draft ?? '0');
  }
  const ledgerTotal = approved.add(draft);
  return {
    reportNet,
    approved: approved.round(4).toString(),
    draft: draft.round(4).toString(),
    ledgerTotal: ledgerTotal.round(4).toString(),
    difference: fin(reportNet).subtract(ledgerTotal).round(4).toString(),
    accounts: Array.from(byId.values()),
  };
}
