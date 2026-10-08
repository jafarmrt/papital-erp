import { pool, orm } from '../../db/drizzle.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { AppError } from '../../errors/customErrors.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestCustomer, createTestItem, createTestWarehouse } from '../fixtures/factories.js';
import { checkBusinessInvariants, inventoryValueGap, InvariantScope, InvariantViolation } from '../invariants/businessInvariants.js';
import { fin, FinancialDecimal } from '../../lib/financialDecimal.js';
import { checkReservationWithinStock } from '../invariants/reservationInvariants.js';
import { createFinanceOperations, setupFinance } from './simulationFinanceOperations.js';
import { closeSimulatedYear } from './simulationFiscalClose.js';
import { createProjectOperations, setupProjectWorld } from './simulationProjectOperations.js';
import { createSimulationOperations, isoDay, OpOutcome, SimDoc, SimItem, YEAR_DAYS } from './simulationOperations.js';

/**
 * v8.0.1 — شبیه‌ساز «یک سال کاری» با بذر ثابت (V8_MASTER_ROADMAP.md فاز ۳).
 *
 * عملیات واقعی کسب‌وکار را فقط از مسیر سرویس‌های برنامه اجرا می‌کند (DocumentService.createDocument / deleteDocument،
 * انتقال بین انبار)، با تاریخ‌های سال ۱۴۰۴، ارز خارجی، تخفیف، مالیات، تاریخ عقب‌افتاده، برگشت از فروش و ابطال. پس از
 * هر N گام ناوردایی‌های businessInvariants.ts بررسی می‌شوند. انتخاب‌ها فقط به بذر و وضعیت پایگاه‌داده بستگی دارند، پس
 * یک بذر همیشه همان دنباله را می‌سازد. رد شدن یک عملیات با خطای کسب‌وکار (AppError) مجاز است، ولی نباید اثری به جا
 * بگذارد (اتمیک بودن)؛ هر خطای دیگر (مثلاً نقض CHECK پایگاه‌داده) یافته است.
 */

export type SimOperation =
  | 'purchase'
  | 'sale'
  | 'sales_return'
  | 'over_return'
  | 'remittance'
  | 'waste'
  | 'stock_count'
  | 'transfer'
  | 'void'
  | 'production_receipt'
  | 'backdated_purchase'
  | 'backdated_sale'
  // v10.0.2 (TD-982, I-01): treasury, cheques, payroll, purchasing, material allocation and approval
  | 'treasury_receipt'
  | 'treasury_payment'
  | 'treasury_void'
  | 'cheque_received'
  | 'cheque_step'
  | 'payroll'
  | 'payroll_payment_void'
  | 'procurement'
  | 'bom_allocation'
  | 'bom_release'
  | 'proforma_approval';

/** Operations whose path passes the sellable gate, after which reservations must stay within stock (I19, TD-819) */
const RESERVATION_GUARDED: ReadonlySet<SimOperation> = new Set<SimOperation>([
  'sale', 'backdated_sale', 'remittance', 'waste', 'transfer', 'bom_allocation', 'proforma_approval',
]);

export interface SimulationOptions {
  seed: number;
  steps: number;
  /** فاصله بررسی ناوردایی‌ها (گام) */
  checkEvery?: number;
  rawMaterials?: number;
  products?: number;
  /** وزن هر عملیات؛ عملیات بدون وزن اجرا نمی‌شود */
  weights?: Partial<Record<SimOperation, number>>;
  /** پس از اولین نقض ناوردایی متوقف شود (برای کوتاه کردن دنباله بازتولید) */
  stopOnFirstViolation?: boolean;
  /** ویژگی‌هایی که عملیات می‌توانند داشته باشند (پیش‌فرض همه روشن) */
  features?: { discounts?: boolean; foreignCurrency?: boolean; zeroPriceReceipts?: boolean };
  log?: (line: string) => void;
  /**
   * v10.0.2 (TD-982): after the last step approve the simulator's draft vouchers and close the simulated year (1404) with
   * its opening voucher, then check I11. Only for a schema of its own (`npm run simulate:year`): in the shared suite
   * database other tests keep vouchers in 1404.
   */
  closeFiscalYear?: boolean;
}

export interface SimStepRecord {
  step: number;
  op: SimOperation;
  date: string;
  outcome: 'ok' | 'rejected' | 'skipped';
  detail: string;
  /** ویژگی‌های عملیات (تخفیف، ارز، تاریخ عقب‌افتاده، قیمت صفر …) برای نسبت دادن اختلاف‌ها به علت */
  tags: string[];
  /** تغییر اختلاف ارزش انبار و دفتر کل (I3) در همین گام، اگر از حد گرد کردن بیشتر بود */
  inventoryGapDelta?: string;
}

/** امضای پایدار یک عملیات برای گروه‌بندی یافته‌ها: op[tag1,tag2] */
export function opSignature(op: SimOperation, tags: string[]): string {
  return `${op}[${[...tags].sort().join(',')}]`;
}

export interface SimulationFinding extends InvariantViolation {
  /** نخستین گامی که این نقض در آن دیده شد */
  firstStep: number;
  firstOp: SimOperation | 'setup';
}

export interface SimulationResult {
  seed: number;
  steps: SimStepRecord[];
  /** اختلاف نهایی ارزش انبار و دفتر کل (ریال) */
  finalInventoryGap: string;
  findings: SimulationFinding[];
  counts: Record<'ok' | 'rejected' | 'skipped', number>;
  scope: InvariantScope;
}

export const DEFAULT_WEIGHTS: Record<SimOperation, number> = {
  purchase: 20,
  sale: 20,
  sales_return: 6,
  over_return: 2,
  remittance: 6,
  waste: 4,
  stock_count: 4,
  transfer: 6,
  void: 8,
  production_receipt: 6,
  backdated_purchase: 4,
  backdated_sale: 3,
  treasury_receipt: 5,
  treasury_payment: 4,
  treasury_void: 2,
  cheque_received: 3,
  cheque_step: 4,
  payroll: 3,
  payroll_payment_void: 1,
  procurement: 3,
  bom_allocation: 3,
  bom_release: 2,
  proforma_approval: 3,
};

/** mulberry32 — PRNG کوچک و قطعی */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** تغییر کمتر از این مقدار (ریال) در اختلاف ارزش انبار و دفتر کل در یک گام، گرد کردن است */
const GAP_STEP_TOLERANCE = 5;
/** بیشترین اختلاف گرد کردن یک عملیات ارزی (چند ردیف × نرخ/۲۰۰۰۰) */
const USD_ROUNDING_TOLERANCE = 200;

async function maxId(table: 'documents' | 'journal_vouchers' | 'transactions' | 'treasury_transactions' | 'cheques' | 'piecework_payrolls'): Promise<number> {
  const res = await pool.query<{ m: number | null }>(`SELECT MAX(id) AS m FROM ${table}`);
  return Number(res.rows[0]?.m ?? 0);
}

export async function runBusinessYearSimulation(options: SimulationOptions): Promise<SimulationResult> {
  const rng = createRng(options.seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
  const between = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const chance = (p: number) => rng() < p;
  const log = options.log ?? (() => undefined);
  const checkEvery = Math.max(1, options.checkEvery ?? 10);
  const weights = options.weights ? { ...options.weights } : { ...DEFAULT_WEIGHTS };
  const allowDiscount = options.features?.discounts !== false;
  const allowForeign = options.features?.foreignCurrency !== false;
  const allowZeroPrice = options.features?.zeroPriceReceipts !== false;
  const opTable = (Object.entries(weights) as Array<[SimOperation, number]>).filter(([, w]) => (w ?? 0) > 0);
  const totalWeight = opTable.reduce((sum, [, w]) => sum + w, 0);
  const pickOp = (): SimOperation => {
    let r = rng() * totalWeight;
    for (const [op, w] of opTable) {
      r -= w;
      if (r < 0) return op;
    }
    return opTable[opTable.length - 1][0];
  };

  const scope: InvariantScope = {
    itemIds: [],
    documentIdAfter: await maxId('documents'),
    voucherIdAfter: await maxId('journal_vouchers'),
    treasuryIdAfter: await maxId('treasury_transactions'),
    chequeIdAfter: await maxId('cheques'),
    payrollIdAfter: await maxId('piecework_payrolls'),
  };

  // ---- داده پایه شبیه‌سازی ----
  const tag = `SIM${options.seed}_${Date.now().toString(36)}`;
  const mainWh = (await getDefaultWarehouseCode(orm)) ?? '';
  const secondWh = (await createTestWarehouse({ code: `${tag}_WH2`, name: `انبار شبیه‌ساز ${tag}` })).code;
  const warehouses = [mainWh, secondWh];
  const customer = await createTestCustomer({ name: `مشتری شبیه‌ساز ${tag}`, partyType: 'customer' });
  const supplier = await createTestCustomer({ name: `تامین‌کننده شبیه‌ساز ${tag}`, partyType: 'supplier' });
  const items: SimItem[] = [];
  for (let i = 0; i < (options.rawMaterials ?? 4); i++) {
    const it = await createTestItem({ type: 'raw_material', code: `${tag}_RM${i}`, category: 'مواد اولیه', stocks: {}, weightedAverageCost: 0 });
    items.push({ id: it.id, type: 'raw_material' });
  }
  for (let i = 0; i < (options.products ?? 4); i++) {
    const it = await createTestItem({ type: 'product', code: `${tag}_P${i}`, category: 'دستبند', stocks: {}, weightedAverageCost: 0 });
    items.push({ id: it.id, type: 'product' });
  }
  // project items are made by the first purchases of the project operations (`purchaseItem`) and join the scope then
  const projectItems: SimItem[] = [];
  scope.itemIds = items.map(i => i.id);
  const finance = await setupFinance(tag);
  const projectWorld = await setupProjectWorld(tag);
  Object.assign(scope, { bankAccountIds: [finance.bankAccountId], partyIds: [customer.id], projectIds: [projectWorld.projectId] });

  const docs: SimDoc[] = [];
  const ops = createSimulationOperations(
    { rng, pick, between, chance },
    { scope, items, warehouses, mainWh, customer, supplier, docs, features: { allowDiscount, allowForeign, allowZeroPrice } }
  );
  const { snapshot, purchase, sale, salesReturn, issue, stockCount, transfer, voidDoc, productionReceipt } = ops;
  const random = { rng, pick, between, chance };
  const fin10 = createFinanceOperations(random, { tag, customer, supplier, treasuryIds: [], chequeIds: [], payrollPayments: [] }, finance);
  const proj = createProjectOperations(random, { tag, onItem: id => { scope.itemIds = [...(scope.itemIds ?? []), id]; }, projectItems, mainWh, customer, supplier, allocationIds: [] }, projectWorld);
  const steps: SimStepRecord[] = [];
  const findings = new Map<string, SimulationFinding>();
  let day = 0;

  const addFinding = (v: InvariantViolation, step: number, op: SimOperation | 'setup') => {
    const k = `${v.invariant}|${v.key}`;
    if (!findings.has(k)) findings.set(k, { ...v, firstStep: step, firstOp: op });
  };

  await ops.openingReceipt();
  for (const v of await checkBusinessInvariants(scope)) addFinding(v, 0, 'setup');
  let lastGap: FinancialDecimal = (await inventoryValueGap(scope)).gap;
  const gapBySignature = new Map<string, { count: number; total: FinancialDecimal; firstStep: number }>();

  for (let step = 1; step <= options.steps; step++) {
    day = Math.min(YEAR_DAYS - 1, day + (chance(0.6) ? 1 : 0) + (chance(0.1) ? 2 : 0));
    const op = pickOp();
    const backDay = Math.max(0, day - between(5, 40));
    // v8.0.4 (TD-257): نیمی از عملیات‌های با تاریخ گذشته با مجوز «ثبت سند انبار با تاریخ گذشته» اجرا می‌شوند؛ بی‌مجوز
    // رد می‌شوند و با مجوز فقط وقتی پذیرفته می‌شوند که موجودی تا آن تاریخ و پس از آن منفی نشود
    const backdatePermitted = op.startsWith('backdated_') && chance(0.5);
    const before = await snapshot();
    let record: SimStepRecord;
    try {
      let outcome: OpOutcome;
      switch (op) {
        case 'purchase': outcome = await purchase(day); break;
        case 'backdated_purchase': outcome = await purchase(backDay, backdatePermitted); break;
        case 'sale': outcome = await sale(day); break;
        case 'backdated_sale': outcome = await sale(backDay, backdatePermitted); break;
        case 'sales_return': outcome = await salesReturn(day, false); break;
        case 'over_return': outcome = await salesReturn(day, true); break;
        case 'remittance': outcome = await issue(day, 'remittance'); break;
        case 'waste': outcome = await issue(day, 'waste'); break;
        case 'stock_count': outcome = await stockCount(day); break;
        case 'transfer': outcome = await transfer(day); break;
        case 'void': outcome = await voidDoc(); break;
        case 'production_receipt': outcome = await productionReceipt(day); break;
        case 'treasury_receipt': outcome = await fin10.treasuryReceipt(day); break;
        case 'treasury_payment': outcome = await fin10.treasuryPayment(day); break;
        case 'treasury_void': outcome = await fin10.treasuryVoid(); break;
        case 'cheque_received': outcome = await fin10.chequeReceived(day); break;
        case 'cheque_step': outcome = await fin10.chequeStep(day); break;
        case 'payroll': outcome = await fin10.payroll(day); break;
        case 'payroll_payment_void': outcome = await fin10.payrollPaymentVoid(); break;
        case 'procurement': outcome = await proj.procurement(); break;
        case 'bom_allocation': outcome = await proj.bomAllocation(); break;
        case 'bom_release': outcome = await proj.bomRelease(); break;
        case 'proforma_approval': outcome = await proj.proformaApproval(); break;
      }
      const tags = op.startsWith('backdated_') ? [...outcome.tags, 'backdated', ...(backdatePermitted ? ['permitted'] : [])] : outcome.tags;
      record = { step, op, date: isoDay(day), outcome: outcome.detail.startsWith('skip:') ? 'skipped' : 'ok', detail: outcome.detail, tags };
      if (record.outcome === 'ok') {
        const now = await inventoryValueGap(scope);
        const delta = now.gap.subtract(lastGap);
        if (delta.abs().greaterThan(GAP_STEP_TOLERANCE)) {
          record.inventoryGapDelta = delta.round(2).toString();
          // ردیف‌های ارزی سند حسابداری تا ۴ رقم اعشار ارز گرد می‌شوند (تا نرخ/۲۰۰۰۰ ریال در هر ردیف)؛ اختلاف کوچک
          // این عملیات‌ها یک یافته جدا (گرد کردن ارزی) است تا با علت‌های اصلی اختلاف قاطی نشود
          const sig = tags.includes('usd') && delta.abs().lessThanOrEqual(USD_ROUNDING_TOLERANCE) ? 'usd-rounding' : opSignature(op, tags);
          const agg = gapBySignature.get(sig) ?? { count: 0, total: fin(0), firstStep: step };
          gapBySignature.set(sig, { count: agg.count + 1, total: agg.total.add(delta), firstStep: agg.firstStep });
        }
        lastGap = now.gap;
      }
      if (RESERVATION_GUARDED.has(op) && record.outcome === 'ok') {
        for (const v of await checkReservationWithinStock(scope.itemIds)) addFinding(v, step, op);
      }
      if (op === 'over_return' && record.outcome === 'ok') {
        addFinding({
          invariant: 'I14_return_within_sold',
          key: 'over-return',
          message: 'برگشت از فروش بیش از مقدار فروخته‌شده (منهای برگشت‌های قبلی) فاکتور مرجع پذیرفته شد',
          actual: outcome.detail,
        }, step, op);
      }
    } catch (err) {
      const message = getErrorMessage(err);
      record = { step, op, date: isoDay(day), outcome: 'rejected', detail: message.slice(0, 300), tags: [] };
      if (!(err instanceof AppError)) {
        addFinding({
          invariant: 'I0_unexpected_error',
          key: `${op}:${message.slice(0, 80)}`,
          message: `عملیات ${op} با خطای غیرکسب‌وکاری شکست خورد: ${message.slice(0, 200)}`,
        }, step, op);
      }
      const after = await snapshot();
      if (after !== before) {
        addFinding({
          invariant: 'I0_atomic_rejection',
          key: `${op}`,
          message: `عملیات ردشده ${op} اثر نیمه‌کاره به جا گذاشت`,
          expected: before.slice(0, 200),
          actual: after.slice(0, 200),
        }, step, op);
      }
    }
    steps.push(record);
    log(`#${step} ${record.date} ${opSignature(op, record.tags)} ${record.outcome}: ${record.detail}${record.inventoryGapDelta ? `  ⚠ gap Δ ${record.inventoryGapDelta}` : ""}`);

    if (step % checkEvery === 0 || step === options.steps) {
      const violations = await checkBusinessInvariants(scope);
      for (const v of violations) addFinding(v, step, op);
      if (options.stopOnFirstViolation && findings.size > 0) break;
    }
  }

  if (options.closeFiscalYear) {
    for (const v of await closeSimulatedYear(scope)) addFinding(v, options.steps, 'setup');
  }

  // I3 به تفکیک علت: هر امضای عملیاتی که اختلاف ارزش انبار و دفتر کل را تغییر داد یک یافته جداست
  for (const [sig, agg] of gapBySignature) {
    const firstRecord = steps.find(s => s.step === agg.firstStep);
    addFinding({
      invariant: 'I3_stock_value_equals_ledger',
      key: `gap:${sig}`,
      message: `عملیات ${sig} در ${agg.count} گام اختلاف ارزش انبار و دفتر کل را جمعاً ${agg.total.round(2).toString()} ریال تغییر داد`,
      actual: agg.total.round(2).toString(),
    }, agg.firstStep, firstRecord?.op ?? 'setup');
  }

  const counts = { ok: 0, rejected: 0, skipped: 0 };
  for (const s of steps) counts[s.outcome]++;
  return { seed: options.seed, steps, findings: [...findings.values()], counts, scope, finalInventoryGap: lastGap.round(2).toString() };
}
