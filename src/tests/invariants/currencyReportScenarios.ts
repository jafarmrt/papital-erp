import { pool } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { DocumentService } from '../../services/document.service.js';
import { createTestItem } from '../fixtures/factories.js';
import { healthMetric } from './voucherReportScenarios.js';

/**
 * v8.0.16 — سناریوی سخت‌گیرانه تسعیر ردیف‌های ارزی در کارت حساب، صورت‌حساب طرف‌حساب و بررسی سلامت مالی (TD-260) برای
 * سوئیت business_invariants. تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

const RATE = 600000;

async function approveDocumentVouchers(documentId: number): Promise<void> {
  const res = await pool.query<{ id: number }>('SELECT id FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0', [documentId]);
  await VoucherService.approveJournalVouchers(res.rows.map(r => r.id), undefined, 'inv');
}

function expectAmount(problems: string[], label: string, actual: number | undefined, expected: number): void {
  if (actual === undefined || !fin(actual).equals(expected)) problems.push(`${label}: ${actual ?? '-'}, expected ${expected}`);
}

/**
 * TD-260: در نمای «همه ارزها» ردیف ارزی با نرخ همان ردیف به ریال تبدیل می‌شود (قاعده تراز آزمایشی)؛ در نمای یک ارز فقط
 * ردیف‌های همان ارز با مبلغ خودشان می‌آیند. کارت حساب، صورت‌حساب طرف‌حساب (با مانده ابتدای دوره) و مانده دفتر کل موجودی در
 * بررسی سلامت مالی همین قاعده را دارند.
 */
export async function checkReportsConvertForeignRows(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const buyer = `مشتری ارزی آزمون TD-260 ${Date.now()}`;
  const product = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date: '2026-07-01', user: 'inv',
    items: [{ itemId: product.id, quantity: 5, unitPrice: 100000, location: wh }],
  });
  const sale = (date: string, unitPrice: number, extra: Record<string, unknown>) => DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status: 'final', date, user: 'inv', buyerName: buyer,
    items: [{ itemId: product.id, quantity: 1, unitPrice, location: wh }], ...extra,
  });
  // فاکتور ریالی ۱٬۰۰۰٬۰۰۰ و فاکتور ۲ دلاری با نرخ ۶۰۰٬۰۰۰ ← ۲٬۲۰۰٬۰۰۰ ریال بدهکار
  await approveDocumentVouchers(await sale('2026-07-02', 1000000, {}));
  await approveDocumentVouchers(await sale('2026-07-03', 2, { currency: 'USD', exchangeRate: RATE }));
  const receivable = await AccountMappingService.getTradeReceivablesAccount();
  if (!receivable) return ['پیش‌شرط: حساب بدهکاران تجاری یافت نشد'];

  const card = (currency?: string, startDate?: string) =>
    AccountingReportService.getDetailedAccountCard({ accountId: receivable.id, detailedName: buyer, currency, startDate });
  const all = await card();
  expectAmount(problems, 'all-currencies account card, total debit', all.totalDebit, 2200000);
  expectAmount(problems, 'all-currencies account card, balance', all.finalBalance, 2200000);
  if (all.currency !== 'IRR') problems.push(`currency of the all-currencies account card amounts is ${all.currency ?? '-'}, expected IRR`);
  const usdRow = all.items.find(r => r.originalCurrency === 'USD');
  if (!usdRow || !fin(usdRow.debit).equals(1200000) || !fin(usdRow.originalDebit ?? 0).equals(2) || usdRow.currency !== 'IRR') {
    problems.push(`dollar row of the account card: ${JSON.stringify(usdRow ?? null)}, expected 1,200,000 rials from 2 dollars`);
  }
  const usd = await card('USD');
  expectAmount(problems, 'dollar account card, total debit', usd.totalDebit, 2);
  if (usd.items.length !== 1) problems.push(`the dollar account card has ${usd.items.length} rows, expected one row`);
  expectAmount(problems, 'rial account card, total debit', (await card('IRR')).totalDebit, 1000000);
  expectAmount(problems, 'all-currencies account card, opening balance', (await card(undefined, '2026-07-04')).openingBalance, 2200000);

  const party = (currency?: string, startDate?: string) => AccountingReportService.getDetailedPartyLedger({ partyName: buyer, currency, startDate });
  const partyAll = await party();
  expectAmount(problems, 'all-currencies party statement, total debit', partyAll.totalDebit, 2200000);
  expectAmount(problems, 'dollar party statement, total debit', (await party('USD')).totalDebit, 2);
  expectAmount(problems, 'all-currencies party statement, opening balance', (await party(undefined, '2026-07-04')).openingBalance, 2200000);

  // رسید خرید دلاری ۱۰ × ۲ دلار با نرخ ۶۰۰٬۰۰۰ ← مانده دفتر کل موجودی ۱۲٬۰۰۰٬۰۰۰ ریال بالا می‌رود
  const material = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const before = await healthMetric('inventory_reconciliation', 'ledgerValuation');
  await approveDocumentVouchers(await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date: '2026-07-05', user: 'inv', buyerName: 'تامین‌کننده ارزی آزمون TD-260',
    currency: 'USD', exchangeRate: RATE, items: [{ itemId: material.id, quantity: 10, unitPrice: 2, location: wh }],
  }));
  const after = await healthMetric('inventory_reconciliation', 'ledgerValuation');
  expectAmount(problems, 'financial health check, change in the inventory general ledger balance', Math.round(after - before), 12000000);
  return problems;
}
