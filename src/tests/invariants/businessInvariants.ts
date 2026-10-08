import { fin, FinancialDecimal } from '../../lib/financialDecimal.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import { createLedgerLocationResolver } from '../../services/inventory/warehouseResolver.js';
import { activeLedgerRows, isInRow, isOutRow, QTY_TOLERANCE, rows } from './ledgerRows.js';
import { checkKardexRebuildWac } from './kardexRebuildInvariant.js';
import { checkBankInvariants } from './bankInvariants.js';
import { checkPayrollInvariants } from './payrollInvariants.js';
import { checkRowsOnPostingAccounts, checkVatPayable, checkVoucherRialBalance } from './ledgerIntegrityInvariants.js';
import { checkPartyBalances } from './partyBalanceInvariant.js';
import { checkChequeTransitions } from './chequeInvariant.js';
import { checkFiscalYearClosings } from './fiscalCloseInvariant.js';
import { checkNumberUniqueness } from './numberingInvariant.js';
import { checkProjectReservations, checkReservationWithinStock } from './reservationInvariants.js';

/**
 * v8.0.1 — ناوردایی‌های قابل اجرای منطق کاری (V8_MASTER_ROADMAP.md بخش ۴).
 *
 * هر بررسی فقط داده‌های «دامنه» را می‌خواند: کالاهای مشخص و اسناد، اسناد حسابداری و ردیف‌های کاردکسی که پس از
 * نقطه شروع (watermark) ساخته شده‌اند. این دامنه به شبیه‌ساز اجازه می‌دهد روی پایگاه‌داده مشترک اجرای تست هم بدون
 * مثبت کاذب از داده سوئیت‌های دیگر کار کند. فقط SELECT اجرا می‌شود؛ هیچ داده‌ای تغییر نمی‌کند.
 */

export type InvariantId =
  /** شبیه‌ساز: عملیات با خطای غیرکسب‌وکاری (غیر AppError) شکست خورد */
  | 'I0_unexpected_error'
  /** شبیه‌ساز: عملیات ردشده اثر نیمه‌کاره به جا گذاشت */
  | 'I0_atomic_rejection'
  | 'I1_voucher_balanced'
  | 'I2_three_way_stock'
  | 'I2_warehouse_stock'
  | 'I3_stock_value_equals_ledger'
  | 'I4_one_voucher_per_document'
  | 'I5_invoice_receivable'
  | 'I6_void_trial_balance'
  /** v10.0.7 (TD-982): project reservation rows never negative, only on finalized projects, deductions agree with sources */
  | 'I7_project_reservation'
  /** v10.0.7 (TD-982): receivable balance of a customer = invoices - returns - receipts - cheques */
  | 'I8_customer_balance'
  /** v10.0.7 (TD-982): cheque history is a chain of allowed transitions, each posting step has its voucher */
  | 'I9_cheque_transitions'
  /** v9.0.266 (TD-804): gross − deductions = net = wages payable credit of the payslip's voucher */
  | 'I10_payroll_net_equals_payable'
  /** v10.0.7 (TD-982): a closed year balances to zero, its opening mirrors its closing, nothing is posted into it later */
  | 'I11_fiscal_year_closing'
  /** v10.0.7 (TD-982): document, voucher, treasury and payslip numbers are unique; a document is numbered in its own year */
  | 'I12_unique_numbers'
  | 'I13_kardex_rebuild_wac'
  /** شبیه‌ساز: برگشت از فروش بیش از مقدار فروخته‌شده پذیرفته شد */
  | 'I14_return_within_sold'
  /** v9.0.67 (TD-499): مانده بانک = ردیف‌های دفتری آن (هر وضعیت سند) + مانده اول دوره بی سند افتتاحیه */
  | 'I15_bank_balance_matches_ledger'
  /** v9.0.67 (TD-499): ردیف خزانه‌ای که اثر تراکنش باطل‌شده را بی سند برمی‌گرداند («احیا») نیست */
  | 'I16_no_revived_treasury_without_voucher'
  /** v10.0.7 (TD-982): every voucher balances in rials (TD-260) and no foreign row lacks its own rate */
  | 'I17_voucher_rial_balance'
  /** v10.0.7 (TD-982): no live row on a deleted, group or general account, or one with active sub-accounts */
  | 'I18_rows_on_posting_accounts'
  /** v10.0.7 (TD-982): reservations of an item do not exceed its stock (reported after guarded steps only) */
  | 'I19_reservation_within_stock'
  /** v10.0.7 (TD-982): VAT payable = VAT of final sales invoices - VAT of their returns */
  | 'I20_vat_payable_matches_documents';

export interface InvariantViolation {
  invariant: InvariantId;
  /** کلید پایدار موجودیت (مانند item:12 یا doc:40) برای گروه‌بندی و مقایسه بین اجراها */
  key: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface InvariantScope {
  itemIds: number[];
  /** فقط اسناد با شناسه بزرگ‌تر از این مقدار */
  documentIdAfter: number;
  /** فقط اسناد حسابداری با شناسه بزرگ‌تر از این مقدار */
  voucherIdAfter: number;
  /** v9.0.67 (TD-499): حساب‌های خزانه‌ای که ناوردایی‌های بانک (I15، I16) روی آن‌ها سنجیده می‌شود */
  bankAccountIds?: number[];
  /** v9.0.266 (TD-804): only payslips with a larger id (I10); without it I10 is not checked */
  payrollIdAfter?: number;
  /** v10.0.7 (TD-982): customers whose receivable balance is checked (I8) */
  partyIds?: number[];
  /** v10.0.7 (TD-982): only cheques with a larger id (I9) */
  chequeIdAfter?: number;
  /** v10.0.7 (TD-982): only treasury rows with a larger id (I12) */
  treasuryIdAfter?: number;
  /** v10.0.7 (TD-982): projects whose reservation is checked (I7) */
  projectIds?: number[];
  /** v10.0.7 (TD-982): Jalali fiscal years checked by I11 when closed */
  fiscalYears?: number[];
}

/** انواع سندی که هنگام ثبت نهایی سند حسابداری می‌گیرند (انبارگردانی از v8.0.3، TD-255) */
export const VOUCHER_DOCUMENT_TYPES = ['invoice', 'proforma', 'receipt', 'production_receipt', 'purchase', 'remittance', 'waste', 'return', 'audit'];


/** I1: هر سند حسابداری فعال در دامنه تراز است */
async function checkVouchersBalanced(scope: InvariantScope): Promise<InvariantViolation[]> {
  const unbalanced = await rows<{ id: number; voucher_number: number; debit: string; credit: string }>(
    `SELECT v.id, v.voucher_number,
            COALESCE(SUM(i.debit), 0)::text AS debit, COALESCE(SUM(i.credit), 0)::text AS credit
       FROM journal_vouchers v
       LEFT JOIN journal_voucher_items i ON i.voucher_id = v.id AND i.is_deleted = 0
      WHERE v.is_deleted = 0 AND v.id > $1
      GROUP BY v.id, v.voucher_number
     HAVING ABS(COALESCE(SUM(i.debit), 0) - COALESCE(SUM(i.credit), 0)) > $2`,
    [scope.voucherIdAfter, VOUCHER_BALANCE_TOLERANCE]
  );
  return unbalanced.map(v => ({
    invariant: 'I1_voucher_balanced',
    key: `voucher:${v.id}`,
    message: `سند حسابداری ${v.voucher_number} تراز نیست`,
    expected: v.debit,
    actual: v.credit,
  }));
}

/** I2: موجودی انبارها = موجودی کل کالا = مانده کاردکس (کل و هر انبار) */
async function checkThreeWayStock(scope: InvariantScope): Promise<InvariantViolation[]> {
  if (scope.itemIds.length === 0) return [];
  const violations: InvariantViolation[] = [];
  const itemRows = await rows<{ id: number; current_stock: string; iws_total: string }>(
    `SELECT i.id, COALESCE(i.current_stock, 0)::text AS current_stock,
            COALESCE((SELECT SUM(s.current_stock) FROM item_warehouse_stocks s WHERE s.item_id = i.id), 0)::text AS iws_total
       FROM items i WHERE i.id = ANY($1::int[])`,
    [scope.itemIds]
  );
  const whRows = await rows<{ item_id: number; warehouse_id: number; current_stock: string }>(
    `SELECT item_id, warehouse_id, current_stock::text AS current_stock FROM item_warehouse_stocks WHERE item_id = ANY($1::int[])`,
    [scope.itemIds]
  );
  const warehouses = await rows<{ id: number; code: string; name: string | null; is_active: number | null }>(
    `SELECT id, code, name, is_active FROM warehouses`
  );
  const resolve = createLedgerLocationResolver(warehouses.map(w => ({ id: w.id, code: w.code, name: w.name ?? '', isActive: w.is_active })));

  const ledger = await activeLedgerRows(scope.itemIds, 'id');
  const ledgerTotal = new Map<number, FinancialDecimal>();
  const ledgerByWh = new Map<string, FinancialDecimal>();
  for (const t of ledger) {
    const signed = isInRow(t) ? fin(t.quantity) : isOutRow(t) ? fin(t.quantity).negate() : fin(0);
    ledgerTotal.set(t.item_id, (ledgerTotal.get(t.item_id) ?? fin(0)).add(signed));
    const wh = resolve(t.location);
    const key = `${t.item_id}:${wh ? wh.id : `?${t.location ?? ''}`}`;
    ledgerByWh.set(key, (ledgerByWh.get(key) ?? fin(0)).add(signed));
  }

  for (const it of itemRows) {
    const cached = fin(it.current_stock);
    const table = fin(it.iws_total);
    const kardex = ledgerTotal.get(it.id) ?? fin(0);
    if (cached.subtract(table).abs().greaterThan(QTY_TOLERANCE) || table.subtract(kardex).abs().greaterThan(QTY_TOLERANCE)) {
      violations.push({
        invariant: 'I2_three_way_stock',
        key: `item:${it.id}`,
        message: `three-way stock of item ${it.id} does not match (items.current_stock / item_warehouse_stocks / Kardex)`,
        expected: kardex.toString(),
        actual: `${cached.toString()} / ${table.toString()}`,
      });
    }
  }

  const tableByWh = new Map<string, FinancialDecimal>();
  for (const r of whRows) tableByWh.set(`${r.item_id}:${r.warehouse_id}`, fin(r.current_stock));
  const keys = new Set([...tableByWh.keys(), ...ledgerByWh.keys()]);
  for (const key of keys) {
    const table = tableByWh.get(key) ?? fin(0);
    const kardex = ledgerByWh.get(key) ?? fin(0);
    if (table.subtract(kardex).abs().greaterThan(QTY_TOLERANCE)) {
      violations.push({
        invariant: 'I2_warehouse_stock',
        key: `item-wh:${key}`,
        message: `warehouse stock ${key} does not match the Kardex balance of the same warehouse`,
        expected: kardex.toString(),
        actual: table.toString(),
      });
    }
  }
  return violations;
}

async function inventoryAccountIds(): Promise<number[]> {
  const raw = await AccountMappingService.getInventoryRawMaterialsAccount();
  const finished = await AccountMappingService.getInventoryFinishedGoodsAccount();
  return [raw?.id, finished?.id].filter((id): id is number => typeof id === 'number');
}

/**
 * I3: ارزش ریالی موجودی انبار کالاهای دامنه (مقدار × WAC) = گردش ریالی حساب‌های موجودی مواد و کالای ساخته‌شده
 * در اسناد حسابداری دامنه (همه وضعیت‌ها، چون سند خودکار پیش‌نویس است). ردیف ارزی با نرخ همان ردیف به ریال تبدیل
 * می‌شود (همان قاعده تراز آزمایشی). کالای در جریان ساخت (۱۴۰۲) بیرون از انبار است و شمرده نمی‌شود.
 */
export interface InventoryValueGap {
  stockValue: FinancialDecimal;
  ledgerValue: FinancialDecimal;
  /** ارزش انبار منهای مانده دفتر کل */
  gap: FinancialDecimal;
  tolerance: FinancialDecimal;
}

export async function inventoryValueGap(scope: InvariantScope): Promise<InventoryValueGap> {
  const accountIds = await inventoryAccountIds();
  const [stock] = await rows<{ value: string; lines: string }>(
    `SELECT COALESCE(SUM(COALESCE(current_stock, 0) * COALESCE(weighted_average_cost, 0)), 0)::text AS value,
            COUNT(*)::text AS lines
       FROM items WHERE id = ANY($1::int[])`,
    [scope.itemIds]
  );
  const [ledger] = await rows<{ value: string; lines: string }>(
    `SELECT COALESCE(SUM(
              CASE WHEN UPPER(COALESCE(NULLIF(i.currency, ''), 'IRR')) = 'IRR' THEN i.debit - i.credit
                   ELSE ROUND((i.debit - i.credit) * COALESCE(NULLIF(i.exchange_rate, 0), 1), 0) END
            ), 0)::text AS value,
            COUNT(*)::text AS lines
       FROM journal_voucher_items i
       JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND v.id > $1 AND i.account_id = ANY($2::int[])`,
    [scope.voucherIdAfter, accountIds]
  );
  const stockValue = fin(stock?.value);
  const ledgerValue = fin(ledger?.value);
  // گرد کردن: هر ردیف حسابداری حداکثر ۱ ریال و هر کالا حداکثر ۱ ریال (WAC تا ۴ رقم اعشار)
  const tolerance = fin(Number(ledger?.lines ?? 0) + Number(stock?.lines ?? 0));
  return { stockValue, ledgerValue, gap: stockValue.subtract(ledgerValue), tolerance };
}

async function checkStockValueEqualsLedger(scope: InvariantScope): Promise<InvariantViolation[]> {
  if (scope.itemIds.length === 0) return [];
  const { stockValue, ledgerValue, gap, tolerance } = await inventoryValueGap(scope);
  if (gap.abs().greaterThan(tolerance)) {
    return [{
      invariant: 'I3_stock_value_equals_ledger',
      key: 'inventory-value',
      message: `ارزش موجودی انبار با مانده حساب‌های موجودی دفتر کل یکی نیست (اختلاف ${gap.round(2).toString()} ریال)`,
      expected: ledgerValue.round(2).toString(),
      actual: stockValue.round(2).toString(),
    }];
  }
  return [];
}

/** I4: هر سند نهایی فعال یک سند حسابداری فعال دارد؛ اثر خالص سند حسابداری سند ابطال‌شده صفر است */
async function checkOneVoucherPerDocument(scope: InvariantScope): Promise<InvariantViolation[]> {
  // سند بی‌ارزش (مثلاً رسید تولید با قیمت صفر برای کالای بدون WAC) سند حسابداری ندارد و نباید داشته باشد
  const docs = await rows<{ id: number; type: string; ref_number: string; is_deleted: number; active_vouchers: string; has_value: boolean }>(
    `SELECT d.id, d.type, d.ref_number, d.is_deleted,
            (SELECT COUNT(*) FROM journal_vouchers v WHERE v.source_document_id = d.id AND v.is_deleted = 0)::text AS active_vouchers,
            (EXISTS (SELECT 1 FROM document_items di WHERE di.document_id = d.id AND di.quantity * di.unit_price > 0)
             OR EXISTS (SELECT 1 FROM transactions t WHERE t.document_id = d.id AND t.reversal_of_id IS NULL AND t.total_price > 0)
             OR d.vat_amount > 0 OR d.service_charge_amount > 0) AS has_value
       FROM documents d
      WHERE d.id > $1 AND d.status = 'final' AND d.type = ANY($2::text[])`,
    [scope.documentIdAfter, VOUCHER_DOCUMENT_TYPES]
  );
  const violations: InvariantViolation[] = [];
  for (const d of docs) {
    const count = Number(d.active_vouchers);
    // سند ابطال‌شده: سند پیش‌نویسش حذف شده (۰) یا سند تأییدشده‌اش با سند معکوس بی‌اثر شده (۱) — v8.0.2، TD-251
    const ok = d.is_deleted === 1 ? count <= 1 : (count === 1 || (count === 0 && !d.has_value));
    if (!ok) {
      violations.push({
        invariant: 'I4_one_voucher_per_document',
        key: `doc:${d.id}`,
        message: `${d.type} document ${d.ref_number}${d.is_deleted ? ' (voided)' : ''} has ${count} active journal vouchers`,
        expected: '1',
        actual: String(count),
      });
    }
  }
  // اثر خالص سند ابطال‌شده: جمع گردش سند اصلی و سند معکوس آن روی هر حساب صفر است
  const deletedNet = await rows<{ id: number; ref_number: string; account_id: number; net: string }>(
    `SELECT d.id, d.ref_number, i.account_id, SUM(i.debit - i.credit)::text AS net
       FROM documents d
       JOIN journal_vouchers o ON o.source_document_id = d.id AND o.is_deleted = 0
       JOIN journal_vouchers v ON (v.id = o.id OR (v.reference_id = o.id AND v.reference_number LIKE 'REV-V%')) AND v.is_deleted = 0
       JOIN journal_voucher_items i ON i.voucher_id = v.id AND i.is_deleted = 0
      WHERE d.id > $1 AND d.is_deleted = 1 AND d.status = 'final'
      GROUP BY d.id, d.ref_number, i.account_id
     HAVING ABS(SUM(i.debit - i.credit)) > $2`,
    [scope.documentIdAfter, VOUCHER_BALANCE_TOLERANCE]
  );
  for (const r of deletedNet) {
    violations.push({
      invariant: 'I4_one_voucher_per_document',
      key: `doc-void:${r.id}`,
      message: `voided document ${r.ref_number} has a nonzero net effect on account ${r.account_id}`,
      expected: '0',
      actual: r.net,
    });
  }
  return violations;
}

/**
 * I6: سند ابطال‌شده در دفاتری که گزارش‌ها می‌خوانند (فقط اسناد حسابداری تأییدشده و دائم — getTrialBalance) هم اثر
 * خالص صفر دارد؛ یعنی سند معکوس بدون سند اصلی‌اش در تراز آزمایشی ظاهر نمی‌شود.
 */
async function checkVoidTrialBalance(scope: InvariantScope): Promise<InvariantViolation[]> {
  const net = await rows<{ id: number; ref_number: string; account_id: number; net: string }>(
    `SELECT d.id, d.ref_number, i.account_id, SUM(i.debit - i.credit)::text AS net
       FROM documents d
       JOIN journal_vouchers o ON o.source_document_id = d.id AND o.is_deleted = 0
       JOIN journal_vouchers v ON (v.id = o.id OR (v.reference_id = o.id AND v.reference_number LIKE 'REV-V%')) AND v.is_deleted = 0
       JOIN journal_voucher_items i ON i.voucher_id = v.id AND i.is_deleted = 0
      WHERE d.id > $1 AND d.is_deleted = 1 AND d.status = 'final' AND v.status IN ('approved', 'permanent')
      GROUP BY d.id, d.ref_number, i.account_id
     HAVING ABS(SUM(i.debit - i.credit)) > $2`,
    [scope.documentIdAfter, VOUCHER_BALANCE_TOLERANCE]
  );
  return net.map(r => ({
    invariant: 'I6_void_trial_balance',
    key: `doc-void:${r.id}`,
    message: `سند ابطال‌شده ${r.ref_number} در تراز آزمایشی (اسناد تأییدشده) روی حساب ${r.account_id} اثر خالص غیرصفر دارد`,
    expected: '0',
    actual: r.net,
  }));
}

/** I5: بدهکاری مشتری در سند حسابداری فاکتور = خالص اقلام + مالیات + هزینه ارسال و خدمات */
async function checkInvoiceReceivable(scope: InvariantScope): Promise<InvariantViolation[]> {
  const receivable = await AccountMappingService.getTradeReceivablesAccount();
  if (!receivable) return [];
  const invoices = await rows<{ id: number; ref_number: string; payable: string; ar_debit: string | null }>(
    `SELECT d.id, d.ref_number,
            (COALESCE((SELECT SUM(GREATEST(di.quantity * di.unit_price - di.discount, 0)) FROM document_items di
                        WHERE di.document_id = d.id AND di.is_deleted = 0), 0)
             + d.vat_amount + d.service_charge_amount)::text AS payable,
            (SELECT SUM(i.debit) FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
              WHERE v.source_document_id = d.id AND v.is_deleted = 0 AND i.is_deleted = 0 AND i.account_id = $3)::text AS ar_debit
       FROM documents d
      WHERE d.id > $1 AND d.is_deleted = 0 AND d.status = 'final' AND d.type = ANY($2::text[])`,
    [scope.documentIdAfter, ['invoice'], receivable.id]
  );
  const violations: InvariantViolation[] = [];
  for (const inv of invoices) {
    const payable = fin(inv.payable);
    const debit = fin(inv.ar_debit ?? 0);
    if (payable.subtract(debit).abs().greaterThan(VOUCHER_BALANCE_TOLERANCE)) {
      violations.push({
        invariant: 'I5_invoice_receivable',
        key: `doc:${inv.id}`,
        message: `customer debit of invoice ${inv.ref_number} does not match its payable amount`,
        expected: payable.toString(),
        actual: debit.toString(),
      });
    }
  }
  return violations;
}

export async function checkBusinessInvariants(scope: InvariantScope): Promise<InvariantViolation[]> {
  return [
    ...(await checkVouchersBalanced(scope)),
    ...(await checkThreeWayStock(scope)),
    ...(await checkStockValueEqualsLedger(scope)),
    ...(await checkOneVoucherPerDocument(scope)),
    ...(await checkInvoiceReceivable(scope)),
    ...(await checkVoidTrialBalance(scope)),
    ...(await checkKardexRebuildWac(scope)),
    ...(await checkBankInvariants(scope.bankAccountIds ?? [])),
    ...(await checkPayrollInvariants(scope.payrollIdAfter)),
    ...(await checkProjectReservations(scope.projectIds)),
    ...(await checkPartyBalances(scope.partyIds)),
    ...(await checkChequeTransitions(scope.chequeIdAfter)),
    ...(await checkFiscalYearClosings(scope.fiscalYears)),
    ...(await checkNumberUniqueness(scope)),
    ...(await checkVoucherRialBalance(scope)),
    ...(await checkRowsOnPostingAccounts(scope)),
    ...(await checkVatPayable(scope)),
  ];
}

/**
 * v10.0.7 (TD-982): I19 is not part of `checkBusinessInvariants`, because a stock count or a void may lower stock below a
 * reservation by design (TD-819); the simulator reports it only after a guarded step.
 */
export async function checkGuardedReservations(scope: InvariantScope): Promise<InvariantViolation[]> {
  return checkReservationWithinStock(scope.itemIds);
}
