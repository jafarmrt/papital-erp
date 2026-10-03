import { TestCaseResult, makeTestCase } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';
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

export async function runBusinessInvariantTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const wh = (await getDefaultWarehouseCode(orm)) ?? '';

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
