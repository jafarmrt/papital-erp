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
import { checkWooChangedOrderFlagged, checkWooShopWarehouse, checkWooExactLineTotals, checkWooNegativeFeeAsLineDiscount, checkWooPhoneMatchesCustomer, checkWooRialUnits, probeWooEditedOrderIgnored, probeWooFractionalRialResidue, probeWooNegativeFeeRejected, probeWooPartialRefundIgnored, probeWooPhoneFormatDuplicatesCustomer, probeWooStockOutsideDefaultWarehouse, probeWooThousandTomanCurrency } from '../invariants/wooScenarios.js';
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
import { DATE_BOUNDARY_CHECKS } from '../invariants/dateBoundaryScenarios.js';
import { DOMAIN_CHECKS } from '../invariants/domainChecks.js';
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
      year: CLOSING_PROBE_YEAR, createOpeningVoucher: false, username: 'inv',
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
  if (a.length !== 1 || a[0].is_deleted !== 1) problems.push(`invoice with a draft voucher: the voucher was not soft-deleted, or a reversal was issued (${JSON.stringify(a)})`);

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
    problems.push(`invoice with an approved voucher must get an approved reversal voucher (${JSON.stringify(b)})`);
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
    problems.push('treasury transaction got no journal voucher');
  } else {
    await TreasuryTransactionService.voidTreasuryTransaction(receipt.id, { reason: 'آزمون v8.0.2', username: 'inv' });
    const c = await vouchersOfSource('id', receipt.voucherId);
    if (c.length !== 1 || c[0].is_deleted !== 1) problems.push(`treasury transaction with a draft voucher: the voucher was not soft-deleted, or a reversal was issued (${JSON.stringify(c)})`);
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
  const preview = await FiscalYearService.getFiscalYearClosingPreview({ year });
  const draftIds = (preview.draftVouchers ?? []).map(v => v.id);
  const [invoiceVoucher] = await vouchersOfSource('source_document_id', invoiceId);
  if ((preview.draftVoucherCount ?? 0) < 2 || !invoiceVoucher || !draftIds.includes(invoiceVoucher.id)) {
    problems.push(`the year closing preview did not list the draft vouchers of the year (${preview.draftVoucherCount ?? 'no count'})`);
  }
  let refused = false;
  try {
    await FiscalYearService.executeFiscalYearClosing({ year, createOpeningVoucher: false, username: 'inv' });
  } catch (err) {
    refused = getErrorMessage(err).includes('پیش‌نویس');
  }
  if (!refused) problems.push('year closing was not refused with a draft journal voucher');

  await VoucherService.approveJournalVouchers(draftIds, undefined, 'inv');
  try {
    const closed = await FiscalYearService.executeFiscalYearClosing({ year, createOpeningVoucher: false, username: 'inv' });
    if (fin(closed.netProfit).isZero()) problems.push('year closing after approving the vouchers did not show the sales profit');
  } catch (err) {
    problems.push(`year closing after approving the draft vouchers was refused: ${getErrorMessage(err)}`);
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
    // ── v8.0.47 به بعد: حوزه I، مرز تاریخ و شماره‌گذاری (TD-310 تا TD-317) ──
    ...DATE_BOUNDARY_CHECKS,
    ...DOMAIN_CHECKS, // حوزه J همزمانی، حوزه L فرانت و سرور، حسابداری و بهای تمام‌شده (v8.0.67 به بعد)
    ['inv_td_255_stock_count_voucher', 'v8.0.3: a stock count gets a draft "inventory count differences" voucher at Kardex cost, a surplus without WAC is valued at zero, and voiding the count deletes that voucher (TD-255)',
      checkStockCountVoucher, '7012 voucher at Kardex cost, surplus without WAC at zero cost, void deleted the draft voucher'],
    ['inv_td_262_excel_adjustment_voucher', 'v8.0.3: an Excel stock adjustment gets an "inventory count differences" voucher and a new Excel item gets an opening voucher (TD-262)',
      checkExcelAdjustmentVoucher, 'Excel adjustment voucher and new item opening voucher issued; warehouse value = general ledger'],
    ['inv_td_263_audit_must_be_final', 'v8.0.3: a stock count is recorded only as final, an old draft is not finalized, and voiding it restores the stock (TD-263)',
      checkAuditMustBeFinal, 'draft refused, finalize refused, void restored the stock'],
    // ── v8.0.44: TD-293 ──
    ['inv_td_293_woo_shop_warehouse', 'v8.0.44: "online shop warehouse": a WooCommerce order invoice draws from that warehouse and the stock sync sends the sellable stock of that warehouse (minus reservations) (TD-293, option A)',
      () => checkWooShopWarehouse(), 'order of a shop warehouse item invoiced; sends 3 (5 − 2 reserved) and 1 (not the total 7), in single-item and bulk sync'],
    // ── v8.0.43: TD-294 ──
    ['inv_td_294_woo_changed_order_flagged', 'v8.0.43: an invoiced order edited in the shop or partially refunded becomes "needs review" and the message states the difference; the invoice is untouched (TD-294, option A)',
      () => checkWooChangedOrderFlagged(), 'unchanged order stays processed; edit 2 -> 3 and refund 1000 both needs_review with a difference message; invoice stays at 2 units'],
    // ── v8.0.42: TD-295 ──
    ['inv_td_295_woo_negative_fee_as_line_discount', 'v8.0.42: a negative fee (discount) on a WooCommerce order becomes line discounts in proportion to line amounts and the order is not refused; a discount above the item total is refused (TD-295, option A)',
      () => checkWooNegativeFeeAsLineDiscount(), '400 -> 100 and 300 (debit 3600); with shipping 200 the shipping stays whole; 100 -> 33 and 67; discount 600 on 500 refused'],
    // ── v8.0.41: TD-297 ──
    ['inv_td_297_woo_exact_line_totals', 'v8.0.41: a WooCommerce order line total stays exact on the invoice; an indivisible line is split into two lines with whole unit prices and the customer debit equals the amount paid (TD-297)',
      () => checkWooExactLineTotals(), '1000 for 3 = 2×333 + 1×334; 100,000 for 7 = 6×14285 + 1×14290; with shipping and tax 1190; 1000 for 4 is one line of 250'],
    // ── v8.0.40: TD-296 ──
    ['inv_td_296_woo_phone_matches_customer', 'v8.0.40: a WooCommerce order finds the existing customer by phone in any format (+98, 0098, no leading zero, with spaces, Persian digits) and creates no duplicate customer (TD-296)',
      () => checkWooPhoneMatchesCustomer(), 'five phone formats reached the same customer, no duplicate customer created, and another phone got a new customer'],
    // ── v8.0.39: TD-292 ──
    ['inv_td_292_woo_rial_units', 'v8.0.39: a WooCommerce order in thousand toman (IRHT) or thousand rial (IRHR) is converted to rial and the invoice is in rial (TD-292)',
      () => checkWooRialUnits(), 'IRHT 100 = 1,000,000, IRHR 250 = 250,000 and IRT 300 = 3,000 rial debited to the customer'],
    // ── v8.0.38: TD-289 ──
    ['inv_td_289_requisition_over_order_needs_reason', 'v8.0.38: an order above the purchase requisition is recorded only with a reason, which goes on the row, the requisition notes and the order document; the conversion is all-or-nothing (TD-289, option B)',
      () => checkRequisitionOverOrderNeedsReason(wh), 'without a reason refused (service and form 422); with a reason 4 extra recorded; 7 for 5 only 2 extra; a failed second package left nothing behind'],
    // ── v8.0.37: TD-291 ──
    ['inv_td_291_split_order_form_accepted', 'v8.0.37: the requisition-to-order route accepts the "split order" form body and keeps the target warehouse and package status (TD-291)',
      () => checkSplitOrderFormAccepted(), 'form accepted; draft order created in the target warehouse and the requisition ordered quantity became 5'],
    // ── v8.0.36: TD-290 ──
    ['inv_td_290_requisition_receipt_sums_lines', 'v8.0.36: purchase order delivery counts the requisition received quantity from the sum of all lines of each item and fills it across the rows of that item; the requisition update runs in the delivery transaction under a lock, and a concurrent delivery loses no other write (TD-290)',
      () => checkRequisitionReceiptSumsLines(wh), 'two lines 2 and 3 = 5 and received; repeated delivery has no effect; 5 filled across rows of 3 and 2; concurrent write 4 + delivery 5 = 9'],
    // ── v8.0.35: TD-285 ──
    ['inv_td_285_project_delivery_posts_voucher', 'v8.0.35: project "deliver to warehouse" issues a final "production receipt" document linked to the project that debits finished goods / credits the project work in progress; an unpriced delivery is at weighted average cost (TD-285, option A)',
      () => checkProjectDeliveryPostsVoucher(wh), 'production receipt issued with one journal voucher; project 1402 was zero and became −200,000 after the unpriced delivery; the warehouse vs ledger difference stayed zero'],
    // ── v8.0.34: TD-286 ──
    ['inv_td_286_bom_allocation_posts_voucher', 'v8.0.34: a BOM material allocation gets a voucher debiting work in progress / crediting inventory at Kardex cost, and its release voids it; warehouse value stays equal to the general ledger (TD-286, option A)',
      () => checkBomAllocationPostsVoucher(wh), 'project 1402 became 700,000 and returned to zero after two releases (draft and approved); the warehouse vs ledger difference stayed zero'],
    // ── v8.0.33: TD-288 ──
    ['inv_td_288_bom_release_at_own_cost', 'v8.0.33: releasing a material allocation returns at the Kardex outflow cost of that same allocation and creates no value from nothing; an allocation of an older receipt adds no stock (TD-288)',
      () => checkBomReleaseAtOwnCost(wh), 'returned at 100,000, weighted average cost 150,000 and warehouse value 3,000,000; releasing the older receipt allocation kept the stock at 20'],
    // ── v8.0.32: TD-287 ──
    ['inv_td_287_bom_receipt_allocation_needs_receipt', 'v8.0.32: a "direct BOM receipt" allocation without a registered receipt is refused; an allocation from a registered receipt moves the materials out of the warehouse and its release restores exactly that stock (TD-287, option A)',
      () => checkBomReceiptAllocationNeedsReceipt(wh), 'without a receipt refused and no stock created; the allocation from the receipt moved 4 units out and the release brought the same 4 back'],
    // ── v8.0.31: TD-283 ──
    ['inv_td_283_payroll_payment_voidable', 'v8.0.31: a payslip payment is voidable; bank balance, payment voucher, paid amount and payslip status are restored, and a payslip without payments is deleted (TD-283, option A)',
      () => checkPayrollPaymentVoidable(), 'two payments voided and everything restored; repeated void refused; payslip deleted and wages payable became zero'],
    // ── v8.0.30: TD-284 ──
    ['inv_td_284_fixed_salary_prorated_by_month', 'v8.0.30: fixed salary for each Jalali month of the payslip period, a partial month pro rata by days; an earlier payslip counts its start month as full (TD-284, option B)',
      () => checkFixedSalaryProratedByMonth(), 'a two-month payslip got two months and two half-month payslips exactly one month of salary; the earlier payslip covered its start month'],
    // ── v8.0.29: TD-282 ──
    ['inv_td_282_advance_deduction_within_balance', 'v8.0.29: an advance deduction above the outstanding personnel advance is refused; a deduction up to the balance is accepted (TD-282, option A)',
      () => checkAdvanceDeductionWithinBalance(), 'deduction without an advance and above the balance refused with no effect; a deduction up to the balance cleared the advance account'],
    // ── v8.0.28: TD-281 ──
    ['inv_td_281_payroll_status_keeps_lifecycle', 'v8.0.28: payslip status is set by hand only to draft/approved, a payslip with payments takes no manual status, and a work log of a live payslip is not counted again (TD-281)',
      () => checkPayrollStatusKeepsLifecycle(), 'invalid status and reverting a paid payslip refused; each work log appeared on a payslip only once'],
    // ── v8.0.27: TD-280 ──
    ['inv_td_280_cheque_reconciliation_matches_ledger', 'v8.0.27: cheque book reconciliation with the ledgers shows no difference on issue, bounce and return of a paid cheque and on receipt, collection, bounce and return of a received cheque (TD-280)',
      () => checkChequeReconciliationMatchesLedger(), 'no cheque transition changed the cheque book reconciliation difference; a bounced paid cheque was not counted in "open paid cheques"'],
    // ── v8.0.26: TD-278 ──
    ['inv_td_278_treasury_cheque_method_refused', 'v8.0.26: the "cheque" method is refused in the treasury form (cheques only from the cheque book); an earlier cheque-method transaction does not change the account treasury balance and is voidable (TD-278, option A)',
      () => checkTreasuryChequeMethodRefused(), 'cheque method refused with no effect; the earlier cheque-method transaction left the account consistent and was voided'],
    // ── v8.0.25: TD-277 ──
    ['inv_td_277_cheque_clearing_needs_ledger_account', 'v8.0.25: clearing a cheque into a bank account without a subsidiary ledger account is refused with no effect; clearing into an account with one gets a voucher (TD-277)',
      () => checkChequeClearingNeedsLedgerAccount(), 'clearing into the account without a ledger account refused; clearing into the account with one closed notes receivable'],
    // ── v8.0.24: TD-276 ──
    ['inv_td_276_cleared_cheque_keeps_bank_synced', 'v8.0.24: a cleared cheque counts in the bank account treasury balance and the account stays "in sync" after clearing (TD-276)',
      () => checkClearedChequeKeepsBankSynced(), 'treasury and ledger balances stayed equal and the account stayed in sync after clearing received and paid cheques'],
    // ── v8.0.23: TD-275 ──
    ['inv_td_275_foreign_cheque_refused', 'v8.0.23: a foreign-currency cheque is not accepted (no cheque record, no journal voucher); a rial cheque is recorded as before (TD-275, option C)',
      () => checkForeignChequeRefused(), 'dollar cheque refused with no effect; rial cheque got its registration voucher'],
    // ── v8.0.22: TD-273 ──
    ['inv_td_273_returned_cheque_moves_to_customer', 'v8.0.22: returning a bounced cheque to its drawer moves the claim from protested cheques back to the customer account (TD-273, option A)',
      () => checkReturnedChequeMovesToCustomer(), 'returning the bounced cheque (direct and in collection) closed protested cheques and moved the claim to the customer account; deleting it brought the ledger back to zero'],
    // ── v8.0.21: TD-272 ──
    ['inv_td_272_paid_cheque_bounce_restores_supplier', 'v8.0.21: a bounced paid cheque gets a voucher (debit notes payable, credit the supplier); its return and delete keep the ledger correct (TD-272)',
      () => checkPaidChequeBounceRestoresSupplier(), 'bounce, return and delete of a paid cheque left notes payable and the supplier account correct'],
    // ── v8.0.20: TD-274 ──
    ['inv_td_274_foreign_treasury_uses_rate', 'v8.0.20: foreign-currency treasury receipts, payments and transfers are posted at an exchange rate (explicit, or the rate of the settled invoice) and are refused without a rate (TD-274)',
      checkForeignTreasuryUsesRate, 'receipt at an explicit rate, invoice settlement at the invoice rate, refusal without a rate and the foreign-currency transfer were posted correctly in rial'],
    // ── v8.0.19: TD-271 (حوزه C) ──
    ['inv_td_271_cheque_delete_keeps_other_cheques', 'v8.0.19: deleting a cheque voids only the vouchers of that cheque, not those of another cheque with the same number; an old unlinked voucher of a shared number refuses the delete (TD-271)',
      () => checkChequeDeleteKeepsOtherCheques(), 'vouchers of the other cheque with the same number kept; general ledger stayed correct; delete with an ambiguous old voucher refused'],
    // ── v8.0.18: TD-261 ──
    ['inv_td_261_foreign_cost_rows_exact_in_irr', 'v8.0.18: cost of sales and inventory rows of a foreign-currency voucher, at their own row rate, equal the rial Kardex cost exactly and the foreign-currency voucher stays balanced (TD-261)',
      checkForeignCostRowsExactInIrr, 'dollar sale, return, free goods and mixed purchase posted exactly equal to the Kardex in rial'],
    // ── v8.0.17: TD-268 ──
    ['inv_td_268_free_goods_voucher_at_wac', 'v8.0.17: free goods on a receipt and purchase enter the warehouse at weighted average cost and credit "donated goods income"; the supplier is credited only with the priced lines (TD-268)',
      checkFreeGoodsVoucherAtWac, 'free receipt, mixed purchase, full discount and foreign-currency receipt got the correct 5204 voucher; void and warehouse value stayed consistent with the general ledger'],
    // ── v8.0.16: TD-260 ──
    ['inv_td_260_reports_convert_foreign_rows', 'v8.0.16: the account card, party statement and financial health check convert a foreign-currency row to rial at its own row rate in the all-currencies view (TD-260)',
      checkReportsConvertForeignRows, 'account card and party statement (all currencies, dollar, rial, opening balance) and the inventory general ledger balance were converted correctly'],
    // ── v8.0.15: TD-270 ──
    ['inv_td_270_reports_ignore_deleted_voucher_items', 'v8.0.15: the financial health check and the project report do not count deleted journal voucher rows (after a draft re-sync) (TD-270)',
      checkReportsIgnoreDeletedVoucherItems, 'the inventory general ledger balance in the health check and the project report counted only active rows'],
    // ── v8.0.14: TD-259 ──
    ['inv_td_259_vouchers_follow_account_mapping', 'v8.0.14: purchase receipt, production receipt and sales return vouchers take the inventory, payables and receivables accounts from the account mapping (TD-259)',
      checkVouchersFollowAccountMapping, 'with a custom mapping all lines went to the mapped accounts and warehouse value stayed equal to the general ledger'],
    // ── v8.0.13: TD-269 ──
    ['inv_td_269_replay_starts_at_zero_wac', 'v8.0.13: Kardex WAC replay starts from WAC zero; an item first received at price zero has the same live WAC after the rebuild (TD-269)',
      checkReplayStartsAtZeroWac, 'rebuild of three items (free first receipt, initial WAC with a free receipt, no movements) kept the live WAC'],
    // ── v8.0.12: TD-256 ──
    ['inv_td_256_zero_price_receipt_at_wac', 'v8.0.12: a receipt at price zero is recorded in the Kardex at the current WAC; voiding it does not change WAC, and the production receipt voucher equals the Kardex value (TD-256)',
      checkZeroPriceReceiptAtWac, 'Kardex row recorded at WAC; void and rebuild kept WAC; mixed production receipt voucher = Kardex value'],
    // ── v8.0.11: TD-254 ──
    ['inv_td_254_void_outflow_restores_cost', 'v8.0.11: voiding an outflow after the item WAC changed returns it at that outflow own cost and recalculates WAC (TD-254)',
      checkVoidOutflowRestoresCost, 'void of a sale (draft and approved) and of a remittance recalculated WAC correctly; rebuild and general ledger stayed consistent'],
    // ── v8.0.10: TD-267 ──
    ['inv_td_267_procurement_delivery_incoming_only', 'v8.0.10: procurement delivery finalizes only an incoming purchase document, and a purchase proforma enters the warehouse on delivery, not as a sale (TD-267)',
      checkProcurementDeliveryIncomingOnly, 'sales proforma refused; purchase proforma stayed a receipt and its delivery brought the items in; the purchase document was an inflow'],
    // ── v8.0.9: TD-250 ──
    ['inv_td_250_purchase_discount_in_cost', 'v8.0.9: a purchased item with a line discount enters the warehouse at the net price after discount and WAC stays equal to the general ledger (TD-250)',
      checkPurchaseDiscountInCost, 'rial, foreign-currency and finalized draft receipts entered at net price; warehouse value stayed equal to the general ledger'],
    // ── v8.0.8: TD-253 ──
    ['inv_td_253_return_within_sold', 'v8.0.8: a sales return against an original invoice does not exceed the returnable remainder of that invoice (TD-253)',
      checkReturnWithinSold, 'return up to the sold quantity accepted and above it (at once, in parts, on finalize) refused; voiding a return freed the cap'],
    // ── v8.0.7: TD-266 ──
    ['inv_td_266_running_kardex_shows_voided', 'v8.0.7: the detailed item Kardex shows a voided document with a label and its running balance equals the stock (TD-266)',
      checkRunningKardexShowsVoided, 'voided row and reversal shown with labels; running balance, movement totals and WAC were correct'],
    // ── v8.0.6: TD-265 ──
    ['inv_td_265_void_consumed_receipt_refused', 'v8.0.6: voiding an incoming document whose stock was consumed by later outflows is refused, naming the consuming documents (TD-265)',
      checkVoidConsumedReceiptRefused, 'void of the consumed receipt refused with no effect; the unconsumed receipt and the sales invoice were voided'],
    // ── v8.0.5: TD-264 ──
    ['inv_td_264_excel_wac_change_refused', 'v8.0.5: Excel import does not change the WAC of an item with stock and refuses the row with a clear message (TD-264)',
      checkExcelWacChangeRefused, 'row changing the WAC of an item with stock refused; an item without stock and a value equal to the current WAC stayed allowed'],
    // ── v8.0.4: TD-257 و TD-258 ──
    ['inv_td_257_backdated_stock_movement', 'v8.0.4: a stock movement dated before the item last movement is refused without the permission and, with it, accepted only with enough stock up to that date (TD-257)',
      checkBackdatedStockMovement, 'backdated invoice, finalize and transfer refused without the permission; with it only with enough stock up to that date; same day and re-recording after a void allowed'],
    ['inv_td_258_rebuild_matches_live_engine', 'v8.0.4: the Kardex rebuild does not change a WAC consistent with the live engine (void of a sold receipt, backdated receipt) (TD-258)',
      checkRebuildMatchesLiveEngine, 'Kardex rebuild left WAC and stock untouched and warehouse value stayed equal to the general ledger'],
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
