import { TestCaseResult, makeTestCase } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { accounts, bankAccounts } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { and, eq } from 'drizzle-orm';
import { DocumentService } from '../../services/document.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { FiscalYearService } from '../../services/accounting/fiscalYear.service.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { fin } from '../../lib/financialDecimal.js';
import { createTestItem } from '../fixtures/factories.js';
import { runBusinessYearSimulation, SimulationResult } from '../simulation/businessYearSimulator.js';
import { classifyFinding, KNOWN_FINDINGS } from '../simulation/knownFindings.js';
import { checkAuditMustBeFinal, checkExcelAdjustmentVoucher, checkExcelWacChangeRefused, checkStockCountVoucher, probeExcelWacOverwrite } from '../invariants/stockAdjustmentScenarios.js';
import { checkReturnWithinSold } from '../invariants/salesReturnScenarios.js';
import { checkFreeGoodsVoucherAtWac, checkPurchaseDiscountInCost, checkVoidOutflowRestoresCost, checkZeroPriceReceiptAtWac, probeZeroPricePurchaseWithoutVoucher } from '../invariants/purchaseCostScenarios.js';
import { checkWooRialUnits, probeWooEditedOrderIgnored, probeWooFractionalRialResidue, probeWooNegativeFeeRejected, probeWooPartialRefundIgnored, probeWooPhoneFormatDuplicatesCustomer, probeWooStockOutsideDefaultWarehouse, probeWooThousandTomanCurrency } from '../invariants/wooScenarios.js';
import { checkProcurementDeliveryIncomingOnly, checkRequisitionOverOrderNeedsReason, checkSplitOrderFormAccepted } from '../invariants/procurementScenarios.js';
import { checkVouchersFollowAccountMapping } from '../invariants/accountMappingScenarios.js';
import { checkReportsIgnoreDeletedVoucherItems } from '../invariants/voucherReportScenarios.js';
import { checkReportsConvertForeignRows } from '../invariants/currencyReportScenarios.js';
import { checkForeignCostRowsExactInIrr } from '../invariants/foreignCostScenarios.js';
import {
  checkChequeDeleteKeepsOtherCheques, checkForeignTreasuryUsesRate, checkPaidChequeBounceRestoresSupplier, checkReturnedChequeMovesToCustomer, checkForeignChequeRefused, checkClearedChequeKeepsBankSynced, checkChequeClearingNeedsLedgerAccount, checkTreasuryChequeMethodRefused, checkChequeReconciliationMatchesLedger, probeChequeClearedIntoBankWithoutLedger, probeClearedChequeMakesBankDiscrepant, probeForeignChequeAtRateOne,
  probeForeignTreasuryAtRateOne, probePaidChequeBounceWithoutVoucher, probeReturnedChequeStaysInProtest,
  probeTreasuryChequeMethodWithoutCheque,
} from '../invariants/treasuryScenarios.js';
import { checkAdvanceDeductionWithinBalance, checkFixedSalaryProratedByMonth, checkPayrollPaymentVoidable, checkPayrollStatusKeepsLifecycle, probeAdvanceDeductionBeyondBalance, probeFixedSalaryOneMonthPerPayroll, probePayrollPaymentNotVoidable, probePayrollStatusDoubleCountsLogs } from '../invariants/payrollScenarios.js';
import { checkBomAllocationPostsVoucher, checkBomReceiptAllocationNeedsReceipt, checkBomReleaseAtOwnCost, checkProjectDeliveryPostsVoucher, checkRequisitionReceiptSumsLines, probeBomAllocationWithoutVoucher, probeBomReceiptAllocationFromNothing, probeBomReleaseAtCurrentWac, probeProjectDeliveryWithoutVoucher, probeRequisitionReceiptCountsFirstLine, probeRequisitionReconvertedOverOrdered } from '../invariants/projectScenarios.js';
import { checkBackdatedStockMovement, checkRebuildMatchesLiveEngine, checkReplayStartsAtZeroWac, checkRunningKardexShowsVoided, checkVoidConsumedReceiptRefused, probeRunningKardexAfterVoid, probeVoidConsumedReceipt } from '../invariants/stockDateScenarios.js';

/**
 * v8.0.1 — سوئیت ناوردایی‌های منطق کاری (V8_MASTER_ROADMAP.md؛ گزارش docs/audit/BUSINESS_LOGIC_AUDIT_V8.md).
 *
 * ۱. مسیرهای پایه بدون محرک یافته‌های شناخته‌شده هیچ ناوردایی‌ای را نقض نمی‌کنند (نبود مثبت کاذب در بررسی‌کننده).
 * ۲. شبیه‌ساز بذر ثابت و سه آزمون متمرکز دقیقاً همان کلاس‌های یافته‌ای را می‌بینند که در knownFindings.ts ثبت شده‌اند:
 *    کلاس تازه = رگرسیون؛ کلاسی که دیگر دیده نمی‌شود = رفع‌شده و باید از خط پایه و TECH_DEBT.md برداشته شود.
 */

const BASELINE_SEED = 3;
const BASELINE_STEPS = 220;

/** سال مالی که آزمون بستن سال در آن اجرا می‌شود؛ دور از تاریخ‌های داده سوئیت‌های دیگر و شبیه‌ساز (۱۴۰۴) */
const CLOSING_PROBE_YEAR = 1390;

function push(results: TestCaseResult[], id: string, name: string, start: number, passed: boolean, info: string): void {
  results.push(makeTestCase({
    id,
    name,
    layer: 'business_invariants',
    executionType: 'real_database',
    passed,
    durationMs: Date.now() - start,
    ...(passed ? { details: info } : { error: info }),
  }));
}

/** TD-252: بستن سال مالی با سند حسابداری پیش‌نویس همان سال اجرا می‌شود و آن سند در بستن حساب‌ها نمی‌آید */
async function probeFiscalClosingIgnoresDrafts(wh: string): Promise<boolean> {
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date: '2011-04-01', user: 'inv', buyerName: 'تامین‌کننده آزمون بستن سال',
    items: [{ itemId: item.id, quantity: 5, unitPrice: 100000, location: wh }],
  });
  const invoiceId = await DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status: 'final', date: '2011-06-01', user: 'inv', buyerName: 'مشتری آزمون بستن سال',
    items: [{ itemId: item.id, quantity: 2, unitPrice: 250000, location: wh }],
  });
  const draft = await pool.query<{ status: string }>(`SELECT status FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0`, [invoiceId]);
  if (draft.rows[0]?.status !== 'draft') return false;
  try {
    await FiscalYearService.executeFiscalYearClosing({
      year: CLOSING_PROBE_YEAR, closingDate: `${CLOSING_PROBE_YEAR}-12-29`, createOpeningVoucher: false, username: 'inv',
    });
  } catch {
    return false; // بستن سال رد شد؛ رفتار درست وقتی سند پیش‌نویس در سال هست
  }
  const after = await pool.query<{ status: string }>(`SELECT status FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0`, [invoiceId]);
  return after.rows[0]?.status === 'draft';
}

/** TD-259: سند خرید سرفصل موجودی مواد را از کد ثابت ۱۴۰۱ می‌گیرد، نه از نگاشت حساب‌ها */
async function probePurchaseIgnoresMapping(wh: string): Promise<boolean> {
  const previous = await AccountMappingService.getMappings();
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '14'), eq(accounts.isDeleted, 0)));
  const code = `14${Date.now().toString().slice(-6)}`;
  const [custom] = await orm.insert(accounts).values({
    code, name: 'موجودی مواد (نگاشت آزمون)', level: 'subsidiary', parentId: parent?.id ?? null,
    accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  try {
    await AccountMappingService.saveMappings({ inventoryRawMaterialsCode: code });
    const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
    const receiptId = await DocumentService.createDocument({
      docType: 'receipt', inOut: 'in', status: 'final', date: '2025-04-01', user: 'inv', buyerName: 'تامین‌کننده آزمون نگاشت',
      items: [{ itemId: item.id, quantity: 3, unitPrice: 100000, location: wh }],
    });
    const lines = await pool.query<{ account_id: number; debit: string }>(
      `SELECT i.account_id, i.debit::text AS debit FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
        WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 AND i.debit > 0`,
      [receiptId]
    );
    return !lines.rows.some(l => l.account_id === custom.id);
  } finally {
    await AccountMappingService.saveMappings({ inventoryRawMaterialsCode: previous.inventoryRawMaterialsCode });
  }
}

/** TD-260: کارت حساب ردیف ارزی را بدون تسعیر با ریال جمع می‌زند؛ تراز آزمایشی تسعیر می‌کند */
async function probeAccountCardMixesCurrencies(wh: string): Promise<boolean> {
  const buyer = `مشتری ارزی آزمون ${Date.now()}`;
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date: '2025-04-01', user: 'inv',
    items: [{ itemId: item.id, quantity: 5, unitPrice: 100000, location: wh }],
  });
  const invoiceId = await DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status: 'final', date: '2025-04-02', user: 'inv', buyerName: buyer,
    currency: 'USD', exchangeRate: 600000, items: [{ itemId: item.id, quantity: 1, unitPrice: 2, location: wh }],
  });
  const vouchers = await pool.query<{ id: number }>(`SELECT id FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0`, [invoiceId]);
  await VoucherService.approveJournalVouchers(vouchers.rows.map(v => v.id), undefined, 'inv');
  const receivable = await AccountMappingService.getTradeReceivablesAccount();
  if (!receivable) return false;
  const card = await AccountingReportService.getDetailedAccountCard({ accountId: receivable.id, detailedName: buyer });
  const cardDebit = fin(card.totalDebit);
  // ۲ دلار با نرخ ۶۰۰٬۰۰۰ = ۱٬۲۰۰٬۰۰۰ ریال در تراز آزمایشی
  return !cardDebit.equals(1200000);
}

interface VoucherRow extends Record<string, unknown> { id: number; status: string; is_deleted: number; reference_number: string | null }

async function vouchersOfSource(column: 'source_document_id' | 'id', value: number): Promise<VoucherRow[]> {
  const own = await pool.query<VoucherRow>(
    `SELECT id, status, is_deleted, reference_number FROM journal_vouchers WHERE ${column} = $1 ORDER BY id`, [value]);
  const ids = own.rows.map(r => r.id);
  const rev = ids.length === 0 ? { rows: [] as VoucherRow[] } : await pool.query<VoucherRow>(
    `SELECT id, status, is_deleted, reference_number FROM journal_vouchers WHERE reference_id = ANY($1::int[]) AND reference_number LIKE 'REV-V%' ORDER BY id`, [ids]);
  return [...own.rows, ...rev.rows];
}

/**
 * v8.0.2 (TD-251، تصمیم مالک محصول): ابطال منشأ — سند حسابداری پیش‌نویس حذف نرم می‌شود و سند معکوس نمی‌گیرد؛ سند
 * تأییدشده همچنان سند معکوس تأییدشده می‌گیرد. هر سه مسیر: سند انبار/فاکتور، تراکنش خزانه.
 */
async function checkVoidDraftVoucher(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date: '2025-05-01', user: 'inv',
    items: [{ itemId: item.id, quantity: 10, unitPrice: 100000, location: wh }],
  });

  // الف) فاکتور با سند پیش‌نویس → ابطال → سند حذف نرم، بدون سند معکوس
  const draftInvoice = await DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status: 'final', date: '2025-05-02', user: 'inv', buyerName: 'مشتری آزمون ابطال',
    items: [{ itemId: item.id, quantity: 2, unitPrice: 150000, location: wh }],
  });
  await DocumentService.deleteDocument(draftInvoice, 'inv');
  const a = await vouchersOfSource('source_document_id', draftInvoice);
  if (a.length !== 1 || a[0].is_deleted !== 1) problems.push(`فاکتور با سند پیش‌نویس: سند حذف نرم نشد یا سند معکوس گرفت (${JSON.stringify(a)})`);

  // ب) فاکتور با سند تأییدشده → ابطال → سند اصلی فعال + سند معکوس تأییدشده
  const approvedInvoice = await DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status: 'final', date: '2025-05-03', user: 'inv', buyerName: 'مشتری آزمون ابطال',
    items: [{ itemId: item.id, quantity: 1, unitPrice: 150000, location: wh }],
  });
  const before = await vouchersOfSource('source_document_id', approvedInvoice);
  await VoucherService.approveJournalVouchers(before.map(v => v.id), undefined, 'inv');
  await DocumentService.deleteDocument(approvedInvoice, 'inv');
  const b = await vouchersOfSource('source_document_id', approvedInvoice);
  const bOriginal = b.find(v => v.id === before[0]?.id);
  const bReversal = b.find(v => String(v.reference_number ?? '').startsWith('REV-V'));
  if (!bOriginal || bOriginal.is_deleted !== 0 || bOriginal.status !== 'approved' || !bReversal || bReversal.status !== 'approved') {
    problems.push(`فاکتور با سند تأییدشده باید سند معکوس تأییدشده بگیرد (${JSON.stringify(b)})`);
  }

  // ج) تراکنش خزانه با سند پیش‌نویس → ابطال → سند حذف نرم، بدون سند معکوس
  const [cash] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1001'), eq(accounts.isDeleted, 0)));
  const [bank] = await orm.insert(bankAccounts).values({
    code: `ERP-TEST-V802-${Date.now()}`, title: 'ERP-TEST-MARKER صندوق آزمون ابطال', type: 'cash', currency: 'IRR',
    accountId: cash?.id ?? null, initialBalance: money(0), currentBalance: money(0),
  }).returning({ id: bankAccounts.id });
  const receipt = await TreasuryTransactionService.createTreasuryTransaction({
    type: 'receipt', method: 'cash', amount: 500000, bankAccountId: bank.id, date: '2025-05-04',
    partyType: 'customer', partyName: 'ERP-TEST-MARKER مشتری خزانه', username: 'inv',
  });
  if (!receipt.voucherId) {
    problems.push('تراکنش خزانه سند حسابداری نگرفت');
  } else {
    await TreasuryTransactionService.voidTreasuryTransaction(receipt.id, { reason: 'آزمون v8.0.2', username: 'inv' });
    const c = await vouchersOfSource('id', receipt.voucherId);
    if (c.length !== 1 || c[0].is_deleted !== 1) problems.push(`تراکنش خزانه با سند پیش‌نویس: سند حذف نرم نشد یا سند معکوس گرفت (${JSON.stringify(c)})`);
  }
  return problems;
}

/** v8.0.2 (TD-252، تصمیم مالک محصول): سال با سند پیش‌نویس بسته نمی‌شود؛ پس از تأیید آن‌ها بسته می‌شود */
async function checkClosingRefusesDrafts(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const year = CLOSING_PROBE_YEAR + 1; // ۱۳۹۱: جدا از سال آزمون خط پایه
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date: '2012-05-01', user: 'inv',
    items: [{ itemId: item.id, quantity: 5, unitPrice: 100000, location: wh }],
  });
  const invoiceId = await DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status: 'final', date: '2012-06-01', user: 'inv', buyerName: 'مشتری آزمون بستن سال',
    items: [{ itemId: item.id, quantity: 2, unitPrice: 250000, location: wh }],
  });
  const preview = await FiscalYearService.getFiscalYearClosingPreview({ year, closingDate: `${year}-12-29` });
  const draftIds = (preview.draftVouchers ?? []).map(v => v.id);
  const [invoiceVoucher] = await vouchersOfSource('source_document_id', invoiceId);
  if ((preview.draftVoucherCount ?? 0) < 2 || !invoiceVoucher || !draftIds.includes(invoiceVoucher.id)) {
    problems.push(`پیش‌نمایش بستن سال اسناد پیش‌نویس سال را فهرست نکرد (${preview.draftVoucherCount ?? 'بدون شمارش'})`);
  }
  let refused = false;
  try {
    await FiscalYearService.executeFiscalYearClosing({ year, closingDate: `${year}-12-29`, createOpeningVoucher: false, username: 'inv' });
  } catch (err) {
    refused = getErrorMessage(err).includes('پیش‌نویس');
  }
  if (!refused) problems.push('بستن سال با سند حسابداری پیش‌نویس رد نشد');

  await VoucherService.approveJournalVouchers(draftIds, undefined, 'inv');
  try {
    const closed = await FiscalYearService.executeFiscalYearClosing({ year, closingDate: `${year}-12-29`, createOpeningVoucher: false, username: 'inv' });
    if (fin(closed.netProfit).isZero()) problems.push('بستن سال پس از تأیید اسناد، سود فروش را نیاورد');
  } catch (err) {
    problems.push(`بستن سال پس از تأیید اسناد پیش‌نویس رد شد: ${getErrorMessage(err)}`);
  }
  return problems;
}

export async function runBusinessInvariantTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const wh = (await getDefaultWarehouseCode(orm)) ?? '';

  // ── v8.0.2: آزمون‌های سخت‌گیرانه رفع TD-251 و TD-252 ─────────────────────
  const t251 = Date.now();
  const name251 = 'v8.0.2: ابطال سند انبار یا تراکنش خزانه سند حسابداری پیش‌نویس را حذف نرم می‌کند و سند تأییدشده را معکوس (TD-251)';
  try {
    const problems = await checkVoidDraftVoucher(wh);
    push(results, 'inv_td_251_void_deletes_draft_voucher', name251, t251, problems.length === 0,
      problems.length === 0 ? 'پیش‌نویس حذف نرم شد؛ تأییدشده سند معکوس گرفت' : problems.join(' | '));
  } catch (err) {
    push(results, 'inv_td_251_void_deletes_draft_voucher', name251, t251, false, getErrorMessage(err));
  }
  const t252 = Date.now();
  const name252 = 'v8.0.2: بستن سال مالی با سند حسابداری پیش‌نویس رد و فهرست می‌شود و پس از تأیید آن‌ها انجام می‌شود (TD-252)';
  try {
    const problems = await checkClosingRefusesDrafts(wh);
    push(results, 'inv_td_252_closing_refuses_draft_vouchers', name252, t252, problems.length === 0,
      problems.length === 0 ? 'بستن سال رد شد و پس از تأیید اسناد انجام شد' : problems.join(' | '));
  } catch (err) {
    push(results, 'inv_td_252_closing_refuses_draft_vouchers', name252, t252, false, getErrorMessage(err));
  }

  // ── v8.0.3 تا v8.0.8: آزمون‌های سخت‌گیرانه رفع یافته‌های انبار و حسابداری (TD-255 تا TD-266، TD-253) ─────
  const v803: Array<[string, string, (w: string) => Promise<string[]>, string]> = [
    ['inv_td_255_stock_count_voucher', 'v8.0.3: انبارگردانی سند پیش‌نویس «کسری و اضافات انبار» با بهای کاردکس می‌گیرد، اضافی بدون WAC با بهای صفر و ابطال آن سند را حذف می‌کند (TD-255)',
      checkStockCountVoucher, 'سند ۷۰۱۲ با بهای کاردکس، اضافی بدون WAC با بهای صفر، ابطال سند پیش‌نویس را حذف کرد'],
    ['inv_td_262_excel_adjustment_voucher', 'v8.0.3: اصلاح موجودی از اکسل سند «کسری و اضافات انبار» و کالای تازه اکسل سند افتتاحیه می‌گیرد (TD-262)',
      checkExcelAdjustmentVoucher, 'سند اصلاح اکسل و سند افتتاحیه کالای تازه صادر شد؛ ارزش انبار = دفتر کل'],
    ['inv_td_263_audit_must_be_final', 'v8.0.3: انبارگردانی فقط نهایی ثبت می‌شود، پیش‌نویس قدیمی نهایی نمی‌شود و ابطالش موجودی را برمی‌گرداند (TD-263)',
      checkAuditMustBeFinal, 'پیش‌نویس رد شد، نهایی‌سازی رد شد، ابطال موجودی را برگرداند'],
    // ── v8.0.39: TD-292 ──
    ['inv_td_292_woo_rial_units', 'v8.0.39: سفارش ووکامرس با واحد هزار تومان (IRHT) یا هزار ریال (IRHR) به ریال تبدیل و فاکتور ریالی می‌شود (TD-292)',
      () => checkWooRialUnits(), 'IRHT ۱۰۰ = ۱٬۰۰۰٬۰۰۰، IRHR ۲۵۰ = ۲۵۰٬۰۰۰ و IRT ۳۰۰ = ۳٬۰۰۰ ریال بدهکار مشتری'],
    // ── v8.0.38: TD-289 ──
    ['inv_td_289_requisition_over_order_needs_reason', 'v8.0.38: سفارش بیش از درخواست خرید فقط با دلیل ثبت می‌شود و دلیل روی ردیف، یادداشت درخواست و سند سفارش می‌نشیند؛ تبدیل یک‌جاست (TD-289، گزینه ب)',
      () => checkRequisitionOverOrderNeedsReason(wh), 'بی‌دلیل رد شد (سرویس و فرم ۴۲۲)؛ با دلیل ۴ اضافه ثبت شد؛ ۷ برای ۵ فقط ۲ اضافه؛ شکست بسته دوم چیزی باقی نگذاشت'],
    // ── v8.0.37: TD-291 ──
    ['inv_td_291_split_order_form_accepted', 'v8.0.37: مسیر تبدیل درخواست به سفارش بدنه فرم «تقسیم سفارش» را می‌پذیرد و انبار مقصد و وضعیت بسته را نگه می‌دارد (TD-291)',
      () => checkSplitOrderFormAccepted(), 'فرم پذیرفته شد؛ سفارش پیش‌نویس در انبار مقصد ساخته شد و سفارش‌شده درخواست ۵ شد'],
    // ── v8.0.36: TD-290 ──
    ['inv_td_290_requisition_receipt_sums_lines', 'v8.0.36: تحویل سفارش خرید مقدار دریافتی درخواست را از جمع همه سطرهای هر کالا می‌شمارد و میان ردیف‌های همان کالا پر می‌کند؛ به‌روزرسانی درخواست در تراکنش تحویل و زیر قفل است و تحویل هم‌زمان نوشته دیگری را گم نمی‌کند (TD-290)',
      () => checkRequisitionReceiptSumsLines(wh), 'دو سطر ۲ و ۳ = ۵ و received؛ تحویل دوباره بی‌اثر؛ ۵ میان ردیف‌های ۳ و ۲ پر شد؛ نوشتن هم‌زمان ۴ + تحویل ۵ = ۹'],
    // ── v8.0.35: TD-285 ──
    ['inv_td_285_project_delivery_posts_voucher', 'v8.0.35: «ورود به انبار» پروژه سند «رسید تولید» نهایی با پیوند پروژه صادر می‌کند که بدهکار کالای ساخته‌شده / بستانکار کالای در جریان ساخت پروژه است؛ تحویل بی‌بها به میانگین موزون (TD-285، گزینه الف)',
      () => checkProjectDeliveryPostsVoucher(wh), 'رسید تولید با یک سند حسابداری صادر شد؛ ۱۴۰۲ پروژه صفر و پس از تحویل بی‌بها −۲۰۰٬۰۰۰ شد؛ اختلاف انبار و دفتر صفر ماند'],
    // ── v8.0.34: TD-286 ──
    ['inv_td_286_bom_allocation_posts_voucher', 'v8.0.34: تخصیص مواد BOM سند بدهکار کالای در جریان ساخت / بستانکار موجودی به بهای کاردکس می‌گیرد و آزادسازی آن را باطل می‌کند؛ ارزش انبار با دفتر کل یکی می‌ماند (TD-286، گزینه الف)',
      () => checkBomAllocationPostsVoucher(wh), '۱۴۰۲ پروژه ۷۰۰٬۰۰۰ شد و با دو آزادسازی (پیش‌نویس و تأییدشده) صفر شد؛ اختلاف انبار و دفتر صفر ماند'],
    // ── v8.0.33: TD-288 ──
    ['inv_td_288_bom_release_at_own_cost', 'v8.0.33: آزادسازی تخصیص مواد به بهای کاردکس خروج همان تخصیص برمی‌گردد و ارزش از هیچ نمی‌سازد؛ تخصیصِ رسیدِ پیشین موجودی اضافه نمی‌کند (TD-288)',
      () => checkBomReleaseAtOwnCost(wh), 'بازگشت به ۱۰۰٬۰۰۰، میانگین موزون ۱۵۰٬۰۰۰ و ارزش انبار ۳٬۰۰۰٬۰۰۰؛ آزادسازی تخصیصِ رسیدِ پیشین موجودی را ۲۰ نگه داشت'],
    // ── v8.0.32: TD-287 ──
    ['inv_td_287_bom_receipt_allocation_needs_receipt', 'v8.0.32: تخصیص «رسید مستقیم BOM» بی‌رسید ثبت‌شده رد می‌شود؛ تخصیص از رسید ثبت‌شده مواد را از انبار خارج می‌کند و آزادسازی آن موجودی را دقیقاً برمی‌گرداند (TD-287، گزینه الف)',
      () => checkBomReceiptAllocationNeedsReceipt(wh), 'بی‌رسید رد شد و موجودی ساخته نشد؛ تخصیص از رسید ۴ واحد را خارج و آزادسازی همان ۴ را برگرداند'],
    // ── v8.0.31: TD-283 ──
    ['inv_td_283_payroll_payment_voidable', 'v8.0.31: پرداخت فیش حقوق ابطال‌پذیر است؛ مانده بانک، سند پرداخت، مبلغ پرداخت‌شده و وضعیت فیش برمی‌گردند و فیش بی‌پرداخت حذف می‌شود (TD-283، گزینه الف)',
      () => checkPayrollPaymentVoidable(), 'دو پرداخت ابطال شد و همه چیز برگشت؛ ابطال تکراری رد شد؛ فیش حذف و حقوق پرداختنی صفر شد'],
    // ── v8.0.30: TD-284 ──
    ['inv_td_284_fixed_salary_prorated_by_month', 'v8.0.30: حقوق ثابت برای هر ماه شمسیِ بازه فیش، ماه ناقص به نسبت روزها؛ فیش پیشین ماه شروعش را کامل حساب می‌کند (TD-284، گزینه ب)',
      () => checkFixedSalaryProratedByMonth(), 'فیش دوماهه دو ماه و دو فیش نیم‌ماهه دقیقاً یک ماه حقوق گرفتند؛ فیش پیشین ماه شروعش را پوشاند'],
    // ── v8.0.29: TD-282 ──
    ['inv_td_282_advance_deduction_within_balance', 'v8.0.29: کسر مساعده بیش از مانده مساعده تسویه‌نشده پرسنل رد می‌شود؛ کسر تا سقف مانده پذیرفته می‌شود (TD-282، گزینه الف)',
      () => checkAdvanceDeductionWithinBalance(), 'کسر بی‌مساعده و بیش از مانده رد شد و اثری نگذاشت؛ کسر تا سقف مانده حساب مساعده را صفر کرد'],
    // ── v8.0.28: TD-281 ──
    ['inv_td_281_payroll_status_keeps_lifecycle', 'v8.0.28: وضعیت فیش فقط پیش‌نویس/تأییدشده دستی تنظیم می‌شود، فیش پرداخت‌دار وضعیت دستی نمی‌گیرد و کارکرد فیش زنده دوباره شمرده نمی‌شود (TD-281)',
      () => checkPayrollStatusKeepsLifecycle(), 'وضعیت غیرمجاز و برگرداندن فیش پرداخت‌شده رد شد؛ هر کارکرد فقط یک بار در فیش آمد'],
    // ── v8.0.27: TD-280 ──
    ['inv_td_280_cheque_reconciliation_matches_ledger', 'v8.0.27: آشتی دفتر چک با دفاتر در صدور، برگشت و عودت چک پرداختی و در دریافت، واگذاری، برگشت و عودت چک دریافتی بی‌مغایرت می‌ماند (TD-280)',
      () => checkChequeReconciliationMatchesLedger(), 'هیچ گذار چکی مغایرت آشتی دفتر چک را تغییر نداد؛ چک پرداختی برگشتی در «چک‌های پرداختی باز» شمرده نشد'],
    // ── v8.0.26: TD-278 ──
    ['inv_td_278_treasury_cheque_method_refused', 'v8.0.26: روش «چک» در فرم خزانه رد می‌شود (چک فقط از دفتر چک)؛ تراکنش چکی پیشین مانده خزانه حساب را تغییر نمی‌دهد و ابطال‌پذیر است (TD-278، گزینه الف)',
      () => checkTreasuryChequeMethodRefused(), 'روش چک رد شد و اثری نگذاشت؛ تراکنش چکی پیشین حساب را مغایر نکرد و ابطال شد'],
    // ── v8.0.25: TD-277 ──
    ['inv_td_277_cheque_clearing_needs_ledger_account', 'v8.0.25: وصول چک به حساب بانکی بدون سرفصل معین رد می‌شود و اثری نمی‌گذارد؛ وصول به حساب سرفصل‌دار سند می‌گیرد (TD-277)',
      () => checkChequeClearingNeedsLedgerAccount(), 'وصول به حساب بی‌سرفصل رد شد؛ وصول به حساب سرفصل‌دار اسناد دریافتنی را بست'],
    // ── v8.0.24: TD-276 ──
    ['inv_td_276_cleared_cheque_keeps_bank_synced', 'v8.0.24: چک وصول‌شده در مانده خزانه حساب بانکی شمرده می‌شود و حساب پس از وصول «هم‌خوان» می‌ماند (TD-276)',
      () => checkClearedChequeKeepsBankSynced(), 'مانده خزانه و دفتر پس از وصول چک دریافتی و پرداختی یکی و حساب هم‌خوان ماند'],
    // ── v8.0.23: TD-275 ──
    ['inv_td_275_foreign_cheque_refused', 'v8.0.23: چک ارزی پذیرفته نمی‌شود (نه رکورد چک، نه سند حسابداری)؛ چک ریالی مثل قبل ثبت می‌شود (TD-275، گزینه ج)',
      () => checkForeignChequeRefused(), 'چک دلاری رد شد و اثری نگذاشت؛ چک ریالی سند ثبت گرفت'],
    // ── v8.0.22: TD-273 ──
    ['inv_td_273_returned_cheque_moves_to_customer', 'v8.0.22: عودت چک برگشتی به صادرکننده مطالبه را از اسناد واخواستی به حساب مشتری برمی‌گرداند (TD-273، گزینه الف)',
      () => checkReturnedChequeMovesToCustomer(), 'عودت چک برگشتی (مستقیم و در جریان وصول) اسناد واخواستی را بست و مطالبه را به حساب مشتری برد؛ حذف آن دفتر را صفر کرد'],
    // ── v8.0.21: TD-272 ──
    ['inv_td_272_paid_cheque_bounce_restores_supplier', 'v8.0.21: برگشت چک پرداختی سند می‌گیرد (بدهکار اسناد پرداختنی، بستانکار تأمین‌کننده)؛ عودت و حذف آن دفتر را درست نگه می‌دارند (TD-272)',
      () => checkPaidChequeBounceRestoresSupplier(), 'برگشت، عودت و حذف چک پرداختی اسناد پرداختنی و حساب تأمین‌کننده را درست گذاشتند'],
    // ── v8.0.20: TD-274 ──
    ['inv_td_274_foreign_treasury_uses_rate', 'v8.0.20: دریافت، پرداخت و انتقال ارزی خزانه با نرخ تسعیر (صریح یا نرخ فاکتور تسویه‌شده) در سند ثبت می‌شوند و بدون نرخ رد می‌شوند (TD-274)',
      checkForeignTreasuryUsesRate, 'دریافت با نرخ صریح، تسویه فاکتور با نرخ فاکتور، رد بدون نرخ و انتقال ارزی درست به ریال ثبت شدند'],
    // ── v8.0.19: TD-271 (حوزه C) ──
    ['inv_td_271_cheque_delete_keeps_other_cheques', 'v8.0.19: حذف چک فقط اسناد همان چک را باطل می‌کند، نه اسناد چک دیگری با همان شماره؛ سند قدیمی بی‌پیوند شماره مشترک حذف را رد می‌کند (TD-271)',
      () => checkChequeDeleteKeepsOtherCheques(), 'اسناد چک دیگر با همان شماره ماندند؛ دفتر کل درست ماند؛ حذف با سند قدیمی مبهم رد شد'],
    // ── v8.0.18: TD-261 ──
    ['inv_td_261_foreign_cost_rows_exact_in_irr', 'v8.0.18: ردیف‌های بهای تمام‌شده و موجودی سند ارزی با نرخ همان ردیف دقیقاً برابر بهای ریالی کاردکس‌اند و سند ارزی تراز می‌ماند (TD-261)',
      checkForeignCostRowsExactInIrr, 'فروش، برگشت، کالای رایگان و خرید ترکیبی دلاری دقیقاً برابر کاردکس به ریال ثبت شدند'],
    // ── v8.0.17: TD-268 ──
    ['inv_td_268_free_goods_voucher_at_wac', 'v8.0.17: کالای رایگان رسید و خرید به میانگین موزون وارد انبار و بستانکار «درآمد کالای اهدایی» می‌شود؛ تأمین‌کننده فقط ردیف‌های بها‌دار را بستانکار می‌شود (TD-268)',
      checkFreeGoodsVoucherAtWac, 'رسید رایگان، خرید ترکیبی، تخفیف کامل و رسید ارزی سند ۵۲۰۴ درست گرفتند؛ ابطال و ارزش انبار با دفتر کل همخوان ماندند'],
    // ── v8.0.16: TD-260 ──
    ['inv_td_260_reports_convert_foreign_rows', 'v8.0.16: کارت حساب، صورت‌حساب طرف‌حساب و بررسی سلامت مالی ردیف ارزی را در نمای همه ارزها با نرخ همان ردیف به ریال تبدیل می‌کنند (TD-260)',
      checkReportsConvertForeignRows, 'کارت حساب و صورت‌حساب طرف‌حساب (همه ارزها، دلاری، ریالی، مانده ابتدای دوره) و مانده دفتر کل موجودی درست تسعیر شدند'],
    // ── v8.0.15: TD-270 ──
    ['inv_td_270_reports_ignore_deleted_voucher_items', 'v8.0.15: بررسی سلامت مالی و گزارش پروژه ردیف‌های حذف‌شده سند حسابداری (پس از همگام‌سازی دوباره پیش‌نویس) را نمی‌شمارند (TD-270)',
      checkReportsIgnoreDeletedVoucherItems, 'مانده دفتر کل موجودی در بررسی سلامت و گزارش پروژه فقط ردیف‌های فعال را شمردند'],
    // ── v8.0.14: TD-259 ──
    ['inv_td_259_vouchers_follow_account_mapping', 'v8.0.14: سند رسید خرید، رسید تولید و برگشت از فروش حساب‌های موجودی، بستانکاران و بدهکاران را از نگاشت حساب‌ها می‌گیرند (TD-259)',
      checkVouchersFollowAccountMapping, 'با نگاشت سفارشی، همه سطرها به حساب‌های نگاشت‌شده رفتند و ارزش انبار با دفتر کل یکی ماند'],
    // ── v8.0.13: TD-269 ──
    ['inv_td_269_replay_starts_at_zero_wac', 'v8.0.13: بازپخش WAC کاردکس از WAC صفر شروع می‌شود؛ کالایی که نخست با قیمت صفر وارد شده پس از بازسازی همان WAC زنده را دارد (TD-269)',
      checkReplayStartsAtZeroWac, 'بازسازی سه کالا (ورود نخست رایگان، WAC اولیه با ورود رایگان، بی‌گردش) WAC زنده را نگه داشت'],
    // ── v8.0.12: TD-256 ──
    ['inv_td_256_zero_price_receipt_at_wac', 'v8.0.12: ورود با قیمت صفر در کاردکس به WAC جاری ثبت می‌شود؛ ابطالش WAC را تغییر نمی‌دهد و سند رسید تولید با ارزش کاردکس یکی است (TD-256)',
      checkZeroPriceReceiptAtWac, 'ردیف کاردکس به WAC ثبت شد؛ ابطال و بازسازی WAC را نگه داشتند؛ سند رسید تولید ترکیبی = ارزش کاردکس'],
    // ── v8.0.11: TD-254 ──
    ['inv_td_254_void_outflow_restores_cost', 'v8.0.11: ابطال خروج پس از تغییر WAC کالا را با بهای همان خروج برمی‌گرداند و WAC را بازمحاسبه می‌کند (TD-254)',
      checkVoidOutflowRestoresCost, 'ابطال فروش (پیش‌نویس و تأییدشده) و حواله WAC را درست بازمحاسبه کرد؛ بازسازی و دفتر کل همخوان ماندند'],
    // ── v8.0.10: TD-267 ──
    ['inv_td_267_procurement_delivery_incoming_only', 'v8.0.10: تحویل تدارکات فقط سند ورودی خرید را نهایی می‌کند و پیش‌فاکتور خرید هنگام تحویل وارد انبار می‌شود، نه فروش (TD-267)',
      checkProcurementDeliveryIncomingOnly, 'پیش‌فاکتور فروش رد شد؛ پیش‌فاکتور خرید رسید ماند و تحویلش کالا را وارد کرد؛ سند purchase ورود بود'],
    // ── v8.0.9: TD-250 ──
    ['inv_td_250_purchase_discount_in_cost', 'v8.0.9: کالای خرید با تخفیف ردیف با قیمت خالص پس از تخفیف وارد انبار می‌شود و WAC با دفتر کل یکی می‌ماند (TD-250)',
      checkPurchaseDiscountInCost, 'رسید ریالی، ارزی و پیش‌نویس نهایی‌شده با قیمت خالص وارد شدند؛ ارزش انبار با دفتر کل یکی ماند'],
    // ── v8.0.8: TD-253 ──
    ['inv_td_253_return_within_sold', 'v8.0.8: برگشت از فروش با فاکتور مرجع از مانده قابل برگشت آن فاکتور بیشتر نمی‌شود (TD-253)',
      checkReturnWithinSold, 'برگشت تا سقف فروخته‌شده پذیرفته و بیش از آن (یک‌جا، چندباره، نهایی‌سازی) رد شد؛ ابطال برگشت سقف را آزاد کرد'],
    // ── v8.0.7: TD-266 ──
    ['inv_td_266_running_kardex_shows_voided', 'v8.0.7: کاردکس تفصیلی کالا سند ابطال‌شده را با برچسب نشان می‌دهد و مانده جاری آن با موجودی یکی است (TD-266)',
      checkRunningKardexShowsVoided, 'ردیف باطل‌شده و معکوس با برچسب آمدند؛ مانده جاری، جمع گردش و WAC درست بود'],
    // ── v8.0.6: TD-265 ──
    ['inv_td_265_void_consumed_receipt_refused', 'v8.0.6: ابطال سند ورودی‌ای که موجودی‌اش با خروج‌های بعدی مصرف شده با نام اسناد مصرف‌کننده رد می‌شود (TD-265)',
      checkVoidConsumedReceiptRefused, 'ابطال رسیدِ مصرف‌شده رد شد و اثری نگذاشت؛ رسید مصرف‌نشده و فاکتور فروش ابطال شدند'],
    // ── v8.0.5: TD-264 ──
    ['inv_td_264_excel_wac_change_refused', 'v8.0.5: درون‌ریزی اکسل WAC کالای دارای موجودی را تغییر نمی‌دهد و ردیف را با پیام روشن رد می‌کند (TD-264)',
      checkExcelWacChangeRefused, 'ردیف تغییر WAC کالای دارای موجودی رد شد؛ کالای بدون موجودی و مقدار برابر WAC فعلی آزاد ماندند'],
    // ── v8.0.4: TD-257 و TD-258 ──
    ['inv_td_257_backdated_stock_movement', 'v8.0.4: گردش انبار با تاریخ پیش از آخرین گردش کالا بی‌مجوز رد و با مجوز فقط با موجودی کافی تا آن تاریخ پذیرفته می‌شود (TD-257)',
      checkBackdatedStockMovement, 'فاکتور، نهایی‌سازی و انتقال با تاریخ گذشته بی‌مجوز رد شد؛ با مجوز فقط با موجودی کافی تا آن تاریخ؛ هم‌روز و ثبت دوباره پس از ابطال آزاد'],
    ['inv_td_258_rebuild_matches_live_engine', 'v8.0.4: بازسازی کاردکس WAC همخوان با موتور زنده را تغییر نمی‌دهد (ابطال رسید فروخته‌شده، رسید با تاریخ گذشته) (TD-258)',
      checkRebuildMatchesLiveEngine, 'بازسازی کاردکس WAC و موجودی را دست‌نخورده گذاشت و ارزش انبار با دفتر کل یکی ماند'],
  ];
  for (const [id, name, check, okInfo] of v803) {
    const started = Date.now();
    try {
      const problems = await check(wh);
      push(results, id, name, started, problems.length === 0, problems.length === 0 ? okInfo : problems.join(' | '));
    } catch (err) {
      push(results, id, name, started, false, getErrorMessage(err));
    }
  }

  // ── ۱. مسیرهای پایه: هیچ نقضی ─────────────────────────────────────────────
  const t1 = Date.now();
  const cleanName = 'v8.0.1: خرید، فروش، برگشت از فروش، حواله، ضایعات و انتقال بدون محرک یافته‌ها هیچ ناوردایی‌ای را نقض نمی‌کنند';
  try {
    const clean = await runBusinessYearSimulation({
      seed: 7,
      steps: 60,
      checkEvery: 20,
      weights: { purchase: 10, sale: 10, sales_return: 3, remittance: 3, waste: 2, transfer: 3 },
      features: { discounts: false, foreignCurrency: false, zeroPriceReceipts: false },
    });
    const ok = clean.findings.length === 0 && clean.counts.ok > 30;
    push(results, 'inv_clean_flows_no_violation', cleanName, t1, ok, ok
      ? `${clean.counts.ok} عملیات موفق، ${clean.counts.rejected} ردشده، بدون نقض`
      : `${clean.counts.ok} عملیات موفق؛ نقض‌ها: ${clean.findings.map(f => `${f.invariant}:${f.key}`).join(' | ') || '-'}`);
  } catch (err) {
    push(results, 'inv_clean_flows_no_violation', cleanName, t1, false, getErrorMessage(err));
  }

  // ── ۲. خط پایه یافته‌های شناخته‌شده (شبیه‌ساز + آزمون‌های متمرکز) ───────────
  const t2 = Date.now();
  const baselineName = 'v8.0.1: کلاس یافته‌های شبیه‌ساز و آزمون‌های متمرکز دقیقاً همان خط پایه knownFindings.ts است (نه کلاس تازه، نه کلاس رفع‌شده)';
  try {
    const sim: SimulationResult = await runBusinessYearSimulation({ seed: BASELINE_SEED, steps: BASELINE_STEPS, checkEvery: 20 });
    const observed = new Set<string>();
    for (const f of sim.findings) {
      const cls = classifyFinding(f);
      if (cls) observed.add(cls);
    }
    if (await probeFiscalClosingIgnoresDrafts(wh)) observed.add('FOCUSED:fiscal-closing-ignores-draft-vouchers');
    if (await probePurchaseIgnoresMapping(wh)) observed.add('FOCUSED:purchase-voucher-ignores-account-mapping');
    if (await probeAccountCardMixesCurrencies(wh)) observed.add('FOCUSED:account-card-mixes-currencies');
    if (await probeExcelWacOverwrite(wh)) observed.add('FOCUSED:excel-wac-overwrite-revalues-stock');
    if (await probeVoidConsumedReceipt(wh)) observed.add('I13:void-in-leaves-negative-history');
    if (await probeRunningKardexAfterVoid(wh)) observed.add('FOCUSED:running-kardex-after-void');
    if (await probeZeroPricePurchaseWithoutVoucher(wh)) observed.add('FOCUSED:zero-price-purchase-without-voucher');
    // حوزه C (v8.0.19): خزانه و چک صیادی
    if (await probePaidChequeBounceWithoutVoucher()) observed.add('FOCUSED:paid-cheque-bounce-without-voucher');
    if (await probeReturnedChequeStaysInProtest()) observed.add('FOCUSED:returned-cheque-stays-in-protest');
    if (await probeForeignTreasuryAtRateOne()) observed.add('FOCUSED:foreign-treasury-at-rate-one');
    if (await probeForeignChequeAtRateOne()) observed.add('FOCUSED:foreign-cheque-at-rate-one');
    if (await probeClearedChequeMakesBankDiscrepant()) observed.add('FOCUSED:cleared-cheque-bank-discrepant');
    if (await probeChequeClearedIntoBankWithoutLedger()) observed.add('FOCUSED:cheque-cleared-into-bank-without-ledger');
    if (await probeTreasuryChequeMethodWithoutCheque()) observed.add('FOCUSED:treasury-cheque-method-without-cheque');
    // حوزه D — حقوق و کارمزدی (v8.0.28)
    if (await probePayrollStatusDoubleCountsLogs()) observed.add('FOCUSED:payroll-status-double-counts-logs');
    if (await probeAdvanceDeductionBeyondBalance()) observed.add('FOCUSED:advance-deduction-beyond-balance');
    if (await probePayrollPaymentNotVoidable()) observed.add('FOCUSED:payroll-payment-not-voidable');
    if (await probeFixedSalaryOneMonthPerPayroll()) observed.add('FOCUSED:fixed-salary-one-month-per-payroll');
    // حوزه E — خرید، پروژه، BOM و تولید (v8.0.32)
    if (await probeBomReceiptAllocationFromNothing(wh)) observed.add('FOCUSED:bom-receipt-allocation-from-nothing');
    if (await probeProjectDeliveryWithoutVoucher(wh)) observed.add('FOCUSED:project-delivery-without-voucher');
    if (await probeBomAllocationWithoutVoucher(wh)) observed.add('FOCUSED:bom-allocation-without-voucher');
    if (await probeBomReleaseAtCurrentWac(wh)) observed.add('FOCUSED:bom-release-at-current-wac');
    if (await probeRequisitionReconvertedOverOrdered(wh)) observed.add('FOCUSED:requisition-reconverted-over-ordered');
    if (await probeRequisitionReceiptCountsFirstLine(wh)) observed.add('FOCUSED:requisition-receipt-counts-first-line');
    // حوزه F — ووکامرس (v8.0.39)
    if (await probeWooThousandTomanCurrency()) observed.add('FOCUSED:woo-thousand-toman-currency');
    if (await probeWooPartialRefundIgnored()) observed.add('FOCUSED:woo-partial-refund-ignored');
    if (await probeWooEditedOrderIgnored()) observed.add('FOCUSED:woo-edited-order-ignored');
    if (await probeWooStockOutsideDefaultWarehouse()) observed.add('FOCUSED:woo-stock-outside-default-warehouse');
    if (await probeWooNegativeFeeRejected()) observed.add('FOCUSED:woo-negative-fee-rejected');
    if (await probeWooPhoneFormatDuplicatesCustomer()) observed.add('FOCUSED:woo-phone-format-duplicates-customer');
    if (await probeWooFractionalRialResidue()) observed.add('FOCUSED:woo-fractional-rial-residue');

    const unknown = [...observed].filter(c => !(c in KNOWN_FINDINGS));
    const fixed = Object.keys(KNOWN_FINDINGS).filter(c => !observed.has(c));
    const ok = unknown.length === 0 && fixed.length === 0;
    push(results, 'inv_known_findings_baseline', baselineName, t2, ok, ok
      ? `${observed.size} کلاس شناخته‌شده (${[...observed].map(c => KNOWN_FINDINGS[c]).join('، ')}) در ${sim.counts.ok} عملیات بذر ${BASELINE_SEED}`
      : [
          unknown.length ? `کلاس تازه (رگرسیون یا یافته ثبت‌نشده): ${unknown.join(' | ')}` : '',
          fixed.length ? `دیگر دیده نمی‌شود (رفع‌شده؟ از knownFindings.ts و TECH_DEBT.md بردارید): ${fixed.map(c => `${c} (${KNOWN_FINDINGS[c]})`).join(' | ')}` : '',
        ].filter(Boolean).join(' — '));
  } catch (err) {
    push(results, 'inv_known_findings_baseline', baselineName, t2, false, getErrorMessage(err));
  }

  return results;
}
