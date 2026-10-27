import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import type { HealthCheckIssueItem, HealthCheckStatus, HealthCheckTestResult } from '../../types.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { formatPersianNumber, formatPersianPrice } from '../../utils/persianNumber.js';
import { AccountMappingService } from './accountMapping.service.js';
import type { InventoryLedgerValues } from './inventoryLedgerValue.js';

/**
 * The stock vs ledger health check (`inventory_reconciliation`): the warehouse value (quantity × weighted average cost,
 * TD-401) against the general account 14 without work in progress (TD-964).
 *
 * v11 phase 6.1j (M21): a gap of up to 1000 rials was reported healthy, so a manual 900-rial posting to an inventory
 * account, or a small drift that grows with every rounding, went unseen. Both sides are rounded to the rial, so a gap
 * of one rial is the only one rounding explains (`INVENTORY_RECONCILIATION_TOLERANCE`); a larger gap is listed. The
 * approved manual vouchers that post to an inventory account are listed with it, since stock moves only through stock
 * documents and a hand posting there is the usual cause of a gap no document explains.
 */
export const INVENTORY_RECONCILIATION_TOLERANCE = 1;

export interface WarehouseValuation {
  total_items_count?: number;
  total_physical_valuation?: string;
  unvalued_stock_count?: number;
  negative_stock_count?: number;
}

export interface ManualInventoryPosting {
  id: number;
  voucherNumber: number;
  date: string;
  description: string;
  /** net debit minus credit in rial on the inventory accounts */
  amount: string;
}

const LISTED_POSTINGS = 20;

/** approved and permanent manual vouchers (not a year's opening or closing) with a net amount on account 14 without work in progress */
export async function findManualInventoryPostings(): Promise<ManualInventoryPosting[]> {
  const wip = await AccountMappingService.getWorkInProgressAccount();
  const res = await orm.execute(sql`
    WITH postings AS (
      SELECT v.id, v.voucher_number, v.date, COALESCE(v.description, '') AS description,
             SUM(CASE WHEN UPPER(COALESCE(NULLIF(vi.currency, ''), NULLIF(v.currency, ''), 'IRR')) = 'IRR' THEN vi.debit - vi.credit
                      ELSE ROUND((vi.debit - vi.credit) * COALESCE(NULLIF(vi.exchange_rate, 0), 1), 0) END) AS amount
        FROM journal_vouchers v
        JOIN journal_voucher_items vi ON vi.voucher_id = v.id AND vi.is_deleted = 0
        JOIN accounts a ON a.id = vi.account_id AND a.is_deleted = 0
       WHERE v.is_deleted = 0 AND v.status IN ('approved', 'permanent')
         AND COALESCE(v.reference_module, 'manual') = 'manual'
         AND COALESCE(v.voucher_type, 'general') NOT IN ('opening', 'closing')
         AND a.code LIKE '14%' AND vi.account_id <> ${wip?.id ?? 0}
       GROUP BY v.id, v.voucher_number, v.date, v.description
    )
    SELECT id, voucher_number, date::text AS date, description, amount::text AS amount
      FROM postings
     WHERE amount <> 0
     ORDER BY date DESC, voucher_number DESC
     LIMIT ${LISTED_POSTINGS}`);
  return ((res.rows ?? []) as Array<Record<string, unknown>>).map(r => ({
    id: Number(r.id),
    voucherNumber: Number(r.voucher_number),
    date: String(r.date ?? '').slice(0, 10),
    description: String(r.description ?? ''),
    amount: String(r.amount ?? '0'),
  }));
}

const TITLE = 'انطباق ریالی موجودی انبار با دفتر کل حسابداری';
const DESCRIPTION = 'بررسی هم‌خوانی ارزش کاردکس و موجودی کالای فیزیکی با سرفصل ۱۴ (موجودی مواد و کالا)، بی حساب کالای در جریان ساخت که بیرون از انبار است؛ '
  + 'اختلاف بیش از یک ریال (گرد کردن دو طرف) گزارش می‌شود';

export function buildInventoryReconciliationHealthTest(
  physical: WarehouseValuation,
  ledger: InventoryLedgerValues,
  manualPostings: ManualInventoryPosting[],
): HealthCheckTestResult {
  const warehouseValDec = fin(physical.total_physical_valuation).round(0);
  const ledgerValDec = fin(ledger.posted).round(0);
  const draftLedgerVal = fin(ledger.draft).round(0).toNumber();
  const workInProgressVal = fin(ledger.workInProgress).round(0).toNumber();
  const invDiscrepancy = warehouseValDec.subtract(ledgerValDec).abs().toNumber();
  const warehouseVal = warehouseValDec.toNumber();
  const ledgerVal = ledgerValDec.toNumber();
  const unvaluedStockCount = Number(physical.unvalued_stock_count) || 0;
  const negativeStockCount = Number(physical.negative_stock_count) || 0;
  const maxVal = Math.max(warehouseVal, ledgerVal, 1);
  const invDiscrepancyPercent = Number(((invDiscrepancy / maxVal) * 100).toFixed(1));
  const hasGap = invDiscrepancy > INVENTORY_RECONCILIATION_TOLERANCE;
  const metrics = {
    warehouseValuation: warehouseVal,
    ledgerValuation: ledgerVal,
    discrepancy: invDiscrepancy,
    discrepancyPercent: invDiscrepancyPercent,
    negativeStockCount,
    unvaluedStockCount,
    draftLedgerValuation: draftLedgerVal,
    workInProgressValuation: workInProgressVal,
    manualInventoryPostingCount: manualPostings.length,
  };
  const unvaluedNote = unvaluedStockCount > 0
    ? ` ${formatPersianNumber(unvaluedStockCount)} کالای دارای موجودی هنوز بهای تمام‌شده ندارد و با ارزش صفر شمرده شد.`
    : '';

  if (!hasGap && negativeStockCount === 0) {
    return {
      id: 'inventory_reconciliation', category: 'inventory', title: TITLE, description: DESCRIPTION, status: 'healthy', scoreImpact: 0, count: 0,
      message: 'ارزش کاردکس فیزیکی انبار با مانده سرفصل کل ۱۴ حسابداری در تراز کامل قرار دارد.' + unvaluedNote,
      metrics,
    };
  }

  let penalty = 0;
  let status: HealthCheckStatus = 'warning';
  if (negativeStockCount > 0) {
    penalty += 10;
    status = 'error';
  }
  if (invDiscrepancyPercent > 5) penalty += 15;
  else if (invDiscrepancyPercent > 1) penalty += 5;

  const items: HealthCheckIssueItem[] = [];
  if (negativeStockCount > 0) {
    items.push({
      id: 'neg_stock',
      title: 'کالاهای دارای موجودی منفی فیزیکی',
      subtitle: `${negativeStockCount} قلم کالا دارای موجودی فیزیکی کمتر از صفر هستند که نیازمند انبارگردانی یا ثبت رسید خرید است.`,
      details: 'موجودی منفی باعث خطا در بهای تمام شده میانگین موزون می‌شود.',
      linkType: 'item',
    });
  }
  if (unvaluedStockCount > 0) {
    items.push({
      id: 'unvalued_stock',
      title: 'کالاهای دارای موجودی بدون بهای تمام‌شده',
      subtitle: `${formatPersianNumber(unvaluedStockCount)} قلم کالا موجودی دارند ولی میانگین موزون ندارند و در ارزش انبار صفر شمرده شدند.`,
      details: 'ارزش انبار فقط به بهای تمام‌شده سنجیده می‌شود، نه قیمت فهرست فروش؛ رسید با قیمت یا بهای اولیه کالا را ثبت کنید.',
      linkType: 'item',
    });
  }
  if (hasGap) {
    items.push({
      id: 'inv_diff',
      title: 'اختلاف ریالی ارزش انبار و مانده دفتر کل کالا',
      subtitle: `ارزش کاردکس انبار: ${formatPersianPrice(warehouseVal)} ریال | مانده دفتر کل (حساب ۱۴ بی کالای در جریان ساخت): ${formatPersianPrice(ledgerVal)} ریال | کالای در جریان ساخت: ${formatPersianPrice(workInProgressVal)} ریال`,
      amount: invDiscrepancy,
      discrepancy: invDiscrepancy,
      details: `درصد انحراف: ${invDiscrepancyPercent}٪ — علل متداول: سند دستی روی حساب موجودی، فاکتورهای خرید بدون سند دوبل یا ثبت نشدن سند بهای تمام شده کالای فروش‌رفته (COGS).`,
    });
  }
  if (hasGap && draftLedgerVal !== 0) {
    const gapAfterApproval = warehouseValDec.subtract(ledgerValDec).subtract(fin(draftLedgerVal)).abs().toNumber();
    items.push({
      id: 'inv_draft_share',
      title: 'سهم سندهای حسابداری پیش‌نویس',
      subtitle: `سندهای پیش‌نویس ${formatPersianPrice(draftLedgerVal)} ریال روی حساب‌های موجودی دارند که تا تأیید در مانده دفتر کل شمرده نمی‌شود.`,
      amount: Math.abs(draftLedgerVal),
      details: `با تأیید این سندها اختلاف به ${formatPersianPrice(gapAfterApproval)} ریال می‌رسد.`,
    });
  }
  if (hasGap) {
    for (const posting of manualPostings) {
      items.push({
        id: `manual_${posting.id}`,
        code: `سند #${posting.voucherNumber}`,
        title: posting.description || `سند شماره ${posting.voucherNumber}`,
        subtitle: `سند دستی روی حساب موجودی کالا — تاریخ: ${isoToJalaliDate(posting.date) || posting.date} | مبلغ: ${formatPersianPrice(posting.amount, undefined, 4)} ریال`,
        amount: Math.abs(Number(posting.amount)),
        date: posting.date,
        details: 'موجودی کالا فقط با سند انبار جابه‌جا می‌شود؛ این سند مانده دفتر را بی گردش کاردکس عوض کرده است.',
        linkType: 'voucher',
        linkId: posting.id,
      });
    }
  }

  return {
    id: 'inventory_reconciliation',
    category: 'inventory',
    title: TITLE,
    description: DESCRIPTION,
    status,
    scoreImpact: -penalty,
    count: (negativeStockCount > 0 ? 1 : 0) + (hasGap ? 1 : 0),
    message: negativeStockCount > 0
      ? `${negativeStockCount} کالای دارای موجودی منفی و اختلاف ریالی ${formatPersianPrice(invDiscrepancy)} ریال مشاهده شد.`
      : `مغایرت ریالی ${formatPersianPrice(invDiscrepancy)} ریالی (${invDiscrepancyPercent}٪) بین ارزش انبار و دفاتر ثبت شده است.`,
    quickFixHint: 'ثبت اسناد انبارگردانی و صدور اسناد مکانیزه ورود و خروج انبار',
    items,
    metrics,
  };
}
