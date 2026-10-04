import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts, bankAccounts, productionProjects } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { FinancialHealthService } from '../../services/accounting/financialHealth.service.js';
import { PayrollPaymentService } from '../../services/accounting/payrollPayment.service.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { VoucherSyncService } from '../../services/accounting/voucherSync.service.js';
import { DocumentService } from '../../services/document.service.js';
import { createTestItem } from '../fixtures/factories.js';

/**
 * v8.0.15 — سناریوی سخت‌گیرانه ردیف‌های حذف‌شده سند حسابداری در گزارش‌ها (TD-270) برای سوئیت business_invariants.
 * تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

export async function healthMetric(testId: string, metric: string): Promise<number> {
  const report = await FinancialHealthService.runHealthCheck();
  const test = report.tests.find(t => t.id === testId);
  const value = (test?.metrics as Record<string, unknown> | undefined)?.[metric];
  return Number(value);
}

async function activeVoucherIds(documentId: number): Promise<number[]> {
  const res = await pool.query<{ id: number }>('SELECT id FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0', [documentId]);
  return res.rows.map(r => r.id);
}

async function deletedItemCount(voucherIds: number[]): Promise<number> {
  const res = await pool.query<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM journal_voucher_items WHERE voucher_id = ANY($1::int[]) AND is_deleted = 1', [voucherIds]);
  return Number(res.rows[0]?.n ?? 0);
}

/**
 * TD-270: همگام‌سازی دوباره سند حسابداری پیش‌نویس ردیف‌های قبلی را حذف نرم می‌کند (is_deleted = 1) و پس از تأیید، سند
 * تأییدشده آن ردیف‌ها را هم دارد؛ ویرایش سند پیش‌نویس به دست حسابدار هم همین‌طور. بررسی سلامت مالی (مانده دفتر کل
 * موجودی)، گزارش خلاصه و ریز پروژه، مانده دفتری حساب بانکی و مانده مساعده پرسنل نباید ردیف حذف‌شده را بشمارند.
 */
export async function checkReportsIgnoreDeletedVoucherItems(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const stamp = Date.now();
  const [project] = await orm.insert(productionProjects).values({ projectCode: `PRJ-TD270-${stamp}`, title: 'پروژه آزمون TD-270' })
    .returning({ id: productionProjects.id });
  const material = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const product = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });

  const ledgerBefore = await healthMetric('inventory_reconciliation', 'ledgerValuation');
  // رسید خرید ۱۰ × ۱۰۰٬۰۰۰ (بدهکار موجودی مواد ۱٬۰۰۰٬۰۰۰)، همگام‌سازی دوباره سند پیش‌نویس و سپس تأیید
  const receipt = await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date: '2026-06-01', user: 'inv', buyerName: 'تامین‌کننده آزمون TD-270',
    items: [{ itemId: material.id, quantity: 10, unitPrice: 100000, location: wh }],
  });
  await VoucherSyncService.syncPurchaseInvoiceVoucher(receipt, { strict: true });
  const receiptVouchers = await activeVoucherIds(receipt);
  if (await deletedItemCount(receiptVouchers) === 0) problems.push('پیش‌شرط: همگام‌سازی دوباره ردیف حذف‌شده‌ای نساخت');
  await VoucherService.approveJournalVouchers(receiptVouchers, undefined, 'inv');
  const ledgerAfter = await healthMetric('inventory_reconciliation', 'ledgerValuation');
  if (Math.round(ledgerAfter - ledgerBefore) !== 1000000) {
    problems.push(`بررسی سلامت مالی: مانده دفتر کل موجودی ${Math.round(ledgerAfter - ledgerBefore)} ریال تغییر کرد، انتظار ۱٬۰۰۰٬۰۰۰`);
  }

  // رسید تولید پروژه ۵ × ۲۰۰٬۰۰۰ (بستانکار کالای در جریان ساخت با تفصیلی پروژه)، همگام‌سازی دوباره
  const production = await DocumentService.createDocument({
    docType: 'production_receipt', inOut: 'in', status: 'final', date: '2026-06-01', user: 'inv', projectId: project.id,
    items: [{ itemId: product.id, quantity: 5, unitPrice: 200000, location: wh }],
  });
  await VoucherSyncService.syncPurchaseInvoiceVoucher(production, { strict: true });
  const summary = (await AccountingReportService.getProjectSummaryReport()).find(r => r.projectId === project.id);
  if (!summary || !fin(summary.totalCredit).equals(1000000) || summary.entriesCount !== 1) {
    problems.push(`گزارش خلاصه پروژه: بستانکار ${summary?.totalCredit ?? '-'} در ${summary?.entriesCount ?? 0} ردیف، انتظار ۱٬۰۰۰٬۰۰۰ در یک ردیف`);
  }
  const detail = await AccountingReportService.getProjectDetailReport(project.id);
  if (detail.length !== 1) problems.push(`گزارش ریز پروژه ${detail.length} ردیف دارد، انتظار یک ردیف`);


  // سند دستی پیش‌نویس: بدهکار حساب بانکی (تفصیلی بانک) ۳۰۰٬۰۰۰ و مساعده پرسنل ۵۰۰٬۰۰۰؛ ویرایش پیش از تأیید و سپس تأیید
  const [bank] = await orm.insert(bankAccounts).values({ code: `B-TD270-${stamp}`, title: 'حساب بانکی آزمون TD-270', type: 'bank', initialBalance: money(0) })
    .returning({ id: bankAccounts.id });
  const [cash] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1001'), eq(accounts.isDeleted, 0)));
  const advanceAcc = await AccountMappingService.getEmployeeAdvanceAccount();
  const capitalAcc = await AccountMappingService.getOpeningCapitalAccount();
  const personnelId = 900000000 + (stamp % 1000000);
  if (!cash || !advanceAcc || !capitalAcc) return [...problems, 'پیش‌شرط: حساب ۱۰۰۱، مساعده یا سرمایه یافت نشد'];
  const manualItems = [
    { accountId: cash.id, detailedType: 'bank_account', detailedId: bank.id, detailedName: 'حساب بانکی آزمون TD-270', debit: 300000, credit: 0 },
    { accountId: advanceAcc.id, detailedType: 'personnel', detailedId: personnelId, detailedName: 'پرسنل آزمون TD-270', debit: 500000, credit: 0 },
    { accountId: capitalAcc.id, debit: 0, credit: 800000 },
  ];
  const manual = await VoucherService.createJournalVoucher({
    date: '2026-06-02', voucherType: 'general', status: 'draft', description: 'سند دستی آزمون TD-270', items: manualItems, username: 'inv',
  });
  if (!manual) return [...problems, 'پیش‌شرط: سند دستی ثبت نشد'];
  await VoucherService.updateJournalVoucher(manual.id, { description: 'سند دستی آزمون TD-270 (ویرایش‌شده)', items: manualItems });
  await VoucherService.approveJournalVouchers([manual.id], undefined, 'inv');
  const bankRow = (await BankAccountService.getBankAccounts()).find(b => b.id === bank.id);
  if (!bankRow || !fin(bankRow.ledgerBalance ?? 0).equals(300000)) problems.push(`مانده دفتری حساب بانکی ${bankRow?.ledgerBalance ?? '-'}، انتظار ۳۰۰٬۰۰۰`);
  const advance = await PayrollPaymentService.getPersonnelAdvanceBalance(personnelId);
  if (!fin(advance.totalAdvances).equals(500000)) problems.push(`مانده مساعده پرسنل ${advance.totalAdvances}، انتظار ۵۰۰٬۰۰۰`);
  return problems;
}
