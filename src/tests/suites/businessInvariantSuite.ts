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
import { checkPurchaseDiscountInCost, checkVoidOutflowRestoresCost } from '../invariants/purchaseCostScenarios.js';
import { checkProcurementDeliveryIncomingOnly } from '../invariants/procurementScenarios.js';
import { checkBackdatedStockMovement, checkRebuildMatchesLiveEngine, checkRunningKardexShowsVoided, checkVoidConsumedReceiptRefused, probeRunningKardexAfterVoid, probeVoidConsumedReceipt } from '../invariants/stockDateScenarios.js';

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
