import { pool } from '../../db/drizzle.js';
import { DocumentService } from '../../services/document.service.js';
import { InventoryIntegrityService } from '../../services/inventory/inventoryIntegrity.service.js';
import type { DocumentLineItemInput } from '../../services/documents/types.js';
import type { InvariantScope } from '../invariants/businessInvariants.js';

/**
 * v8.0.1 — عملیات کسب‌وکاری شبیه‌ساز «یک سال کاری» (businessYearSimulator.ts حلقه، بذر و نسبت دادن اختلاف‌ها را دارد).
 * هر عملیات فقط از مسیر سرویس‌های برنامه اجرا می‌شود و ویژگی‌هایش (تخفیف، ارز، قیمت صفر …) را به‌صورت tag برمی‌گرداند.
 */

export const YEAR_START = Date.UTC(2025, 2, 21); // ۱ فروردین ۱۴۰۴
export const YEAR_DAYS = 365;
export const USD_RATE = 600000;

export function isoDay(dayIndex: number): string {
  const d = new Date(YEAR_START + Math.max(0, Math.min(YEAR_DAYS - 1, dayIndex)) * 86400000);
  return d.toISOString().slice(0, 10);
}

export interface SimItem { id: number; type: 'raw_material' | 'product' }
export interface SimDoc { id: number; type: string; dayIndex: number }
export interface OpOutcome { detail: string; tags: string[] }
interface StockRow extends Record<string, unknown> { item_id: number; warehouse_code: string; current_stock: string }

export interface SimRandom {
  rng: () => number;
  pick: <T>(list: readonly T[]) => T;
  between: (min: number, max: number) => number;
  chance: (p: number) => boolean;
}

export interface SimWorld {
  scope: InvariantScope;
  items: SimItem[];
  warehouses: string[];
  mainWh: string;
  customer: { name: string };
  supplier: { name: string };
  docs: SimDoc[];
  features: { allowDiscount: boolean; allowForeign: boolean; allowZeroPrice: boolean };
}

export function createSimulationOperations(random: SimRandom, world: SimWorld) {
  const { rng, pick, between, chance } = random;
  const { scope, items, warehouses, mainWh, customer, supplier, docs } = world;
  const { allowDiscount, allowForeign, allowZeroPrice } = world.features;

  const stockRows = async (): Promise<StockRow[]> => {
    const res = await pool.query<StockRow>(
      `SELECT item_id, warehouse_code, current_stock::text AS current_stock FROM item_warehouse_stocks
        WHERE item_id = ANY($1::int[]) AND current_stock > 0 ORDER BY item_id, warehouse_id`,
      [scope.itemIds]
    );
    return res.rows;
  };
  const snapshot = async (): Promise<string> => {
    const res = await pool.query<{ s: string }>(
      `SELECT string_agg(id || ':' || COALESCE(current_stock, 0) || ':' || COALESCE(weighted_average_cost, 0), ',' ORDER BY id) AS s
         FROM items WHERE id = ANY($1::int[])`,
      [scope.itemIds]
    );
    const counts = await pool.query<{ c: string }>(
      `SELECT (SELECT COUNT(*) FROM journal_vouchers WHERE id > $1)::text || '/' ||
              (SELECT COUNT(*) FROM documents WHERE id > $2 AND is_deleted = 0)::text AS c`,
      [scope.voucherIdAfter, scope.documentIdAfter]
    );
    return `${res.rows[0]?.s ?? ''}|${counts.rows[0]?.c ?? ''}`;
  };
  const priceFor = async (itemId: number, markup: boolean): Promise<number> => {
    const res = await pool.query<{ wac: string }>(`SELECT COALESCE(weighted_average_cost, 0)::text AS wac FROM items WHERE id = $1`, [itemId]);
    const wac = Number(res.rows[0]?.wac ?? 0);
    const base = wac > 0 ? wac : between(50, 400) * 1000;
    return Math.round(base * (markup ? 1.2 + rng() : 0.7 + rng() * 0.6));
  };
  const createDoc = async (input: {
    docType: string; inOut?: 'in' | 'out'; lines: DocumentLineItemInput[]; dayIndex: number;
    buyerName?: string; currency?: string; exchangeRate?: number; vatPercent?: number; returnOfDocumentId?: number;
    /** v8.0.4 (TD-257): کاربر شبیه‌سازی‌شده مجوز «ثبت سند انبار با تاریخ گذشته» دارد */
    allowBackdate?: boolean;
  }): Promise<number> => {
    const { docId: id } = await DocumentService.createDocumentWithDetails({
      docType: input.docType,
      inOut: input.inOut,
      status: 'final',
      date: isoDay(input.dayIndex),
      user: 'sim',
      buyerName: input.buyerName ?? '',
      currency: input.currency ?? 'IRR',
      exchangeRate: input.exchangeRate,
      vatPercent: input.vatPercent,
      returnOfDocumentId: input.returnOfDocumentId,
      items: input.lines,
    }, { allowBackdate: input.allowBackdate === true });
    docs.push({ id, type: input.docType, dayIndex: input.dayIndex });
    return id;
  };

  const purchase = async (dayIndex: number, allowBackdate = false): Promise<OpOutcome> => {
    const lines: DocumentLineItemInput[] = [];
    const foreign = chance(0.15) && allowForeign;
    for (let n = between(1, 3); n > 0; n--) {
      const it = pick(items);
      const irrPrice = await priceFor(it.id, false);
      const unitPrice = foreign ? Number((irrPrice / USD_RATE).toFixed(2)) || 0.5 : irrPrice;
      const quantity = between(2, 20);
      const discount = chance(0.3) && allowDiscount ? Math.round(unitPrice * quantity * 0.05 * 100) / 100 : 0;
      lines.push({ itemId: it.id, quantity, unitPrice, discount, location: pick(warehouses) });
    }
    const id = await createDoc({
      docType: 'receipt', inOut: 'in', lines, dayIndex, buyerName: supplier.name, allowBackdate,
      currency: foreign ? 'USD' : 'IRR', exchangeRate: foreign ? USD_RATE : undefined,
    });
    const tags = [foreign ? 'usd' : '', lines.some(l => Number(l.discount) > 0) ? 'discount' : ''].filter(Boolean);
    return { detail: `receipt #${id} ${foreign ? 'USD' : 'IRR'} ${lines.map(l => `${l.itemId}x${l.quantity}@${l.unitPrice}-${l.discount}`).join(' ')}`, tags };
  };

  const sale = async (dayIndex: number, allowBackdate = false): Promise<OpOutcome> => {
    const stock = await stockRows();
    if (stock.length === 0) return { detail: 'skip:no-stock', tags: [] };
    const lines: DocumentLineItemInput[] = [];
    const used = new Set<string>();
    const foreign = chance(0.1) && allowForeign;
    for (let n = between(1, 3); n > 0; n--) {
      const row = pick(stock);
      const key = `${row.item_id}:${row.warehouse_code}`;
      if (used.has(key)) continue;
      used.add(key);
      const available = Math.floor(Number(row.current_stock));
      if (available < 1) continue;
      const irrPrice = await priceFor(row.item_id, true);
      const unitPrice = foreign ? Number((irrPrice / USD_RATE).toFixed(2)) || 0.5 : irrPrice;
      const quantity = between(1, Math.max(1, Math.min(available, 8)));
      const discount = chance(0.3) && allowDiscount ? Math.round(unitPrice * quantity * 0.1 * 100) / 100 : 0;
      lines.push({ itemId: row.item_id, quantity, unitPrice, discount, location: row.warehouse_code });
    }
    if (lines.length === 0) return { detail: 'skip:no-line', tags: [] };
    const vat = chance(0.4);
    const id = await createDoc({
      docType: 'invoice', inOut: 'out', lines, dayIndex, buyerName: customer.name, allowBackdate,
      currency: foreign ? 'USD' : 'IRR', exchangeRate: foreign ? USD_RATE : undefined,
      vatPercent: vat ? 10 : undefined,
    });
    const tags = [foreign ? 'usd' : '', vat ? 'vat' : '', lines.some(l => Number(l.discount) > 0) ? 'discount' : ''].filter(Boolean);
    return { detail: `invoice #${id} ${foreign ? 'USD' : 'IRR'} ${lines.map(l => `${l.itemId}x${l.quantity}@${l.unitPrice}-${l.discount}`).join(' ')}`, tags };
  };

  const salesReturn = async (dayIndex: number, over: boolean): Promise<OpOutcome> => {
    const invoices = docs.filter(d => d.type === 'invoice');
    if (invoices.length === 0) return { detail: 'skip:no-invoice', tags: [] };
    const inv = pick(invoices);
    const res = await pool.query<{ item_id: number; quantity: string; unit_price: string; location: string; is_deleted: number; currency: string; exchange_rate: string | null; returned: string }>(
      `SELECT di.item_id, di.quantity::text AS quantity, di.unit_price::text AS unit_price, di.location, d.is_deleted,
              COALESCE(d.currency, 'IRR') AS currency, d.exchange_rate::text AS exchange_rate,
              COALESCE((SELECT SUM(ri.quantity) FROM documents r JOIN document_items ri ON ri.document_id = r.id AND ri.is_deleted = 0
                         WHERE r.return_of_document_id = d.id AND r.is_deleted = 0 AND r.status = 'final' AND ri.item_id = di.item_id), 0)::text AS returned
         FROM documents d JOIN document_items di ON di.document_id = d.id AND di.is_deleted = 0
        WHERE d.id = $1`,
      [inv.id]
    );
    const line = res.rows[0];
    if (!line || line.is_deleted === 1) return { detail: 'skip:invoice-voided', tags: [] };
    // یک کالا ممکن است از دو انبار در دو ردیف فاکتور فروخته شده باشد؛ سقف برگشت سرور (TD-253) برای کل کالاست
    const sold = res.rows.filter(r => r.item_id === line.item_id).reduce((sum, r) => sum + Number(r.quantity), 0);
    const remaining = sold - Number(line.returned);
    if (!over && remaining < 1) return { detail: 'skip:fully-returned', tags: [] };
    const quantity = over ? Math.max(1, remaining) + between(1, 3) : between(1, Math.floor(remaining));
    const id = await createDoc({
      docType: 'return', inOut: 'in', dayIndex, buyerName: customer.name, returnOfDocumentId: inv.id,
      currency: line.currency, exchangeRate: line.currency !== 'IRR' ? Number(line.exchange_rate) || USD_RATE : undefined,
      lines: [{ itemId: line.item_id, quantity, unitPrice: line.unit_price, location: line.location }],
    });
    return {
      detail: `return #${id} of #${inv.id} item ${line.item_id} x${quantity} (sold ${sold}, returned before ${line.returned})`,
      tags: [line.currency !== 'IRR' ? 'usd' : ''].filter(Boolean),
    };
  };

  const issue = async (dayIndex: number, docType: 'remittance' | 'waste'): Promise<OpOutcome> => {
    const stock = await stockRows();
    if (stock.length === 0) return { detail: 'skip:no-stock', tags: [] };
    const row = pick(stock);
    const quantity = between(1, Math.max(1, Math.min(Math.floor(Number(row.current_stock)), 5)));
    if (Number(row.current_stock) < 1) return { detail: 'skip:fraction', tags: [] };
    const id = await createDoc({ docType, inOut: 'out', dayIndex, lines: [{ itemId: row.item_id, quantity, unitPrice: 0, location: row.warehouse_code }] });
    return { detail: `${docType} #${id} item ${row.item_id} x${quantity} from ${row.warehouse_code}`, tags: [] };
  };

  const stockCount = async (dayIndex: number): Promise<OpOutcome> => {
    const stock = await stockRows();
    if (stock.length === 0) return { detail: 'skip:no-stock', tags: [] };
    const row = pick(stock);
    const physical = Math.max(0, Math.floor(Number(row.current_stock)) + between(-2, 2));
    const id = await createDoc({
      docType: 'audit', dayIndex,
      lines: [{ itemId: row.item_id, quantity: physical, physical_stock: physical, location: row.warehouse_code }],
    });
    const diff = physical - Number(row.current_stock);
    return {
      detail: `stock count #${id} item ${row.item_id} ${row.current_stock} -> ${physical} in ${row.warehouse_code}`,
      tags: [diff > 0 ? 'surplus' : diff < 0 ? 'shortage' : 'no-change'],
    };
  };

  const transfer = async (dayIndex: number): Promise<OpOutcome> => {
    const stock = await stockRows();
    if (stock.length === 0) return { detail: 'skip:no-stock', tags: [] };
    const row = pick(stock);
    const to = warehouses.find(w => w !== row.warehouse_code) ?? mainWh;
    const quantity = between(1, Math.max(1, Math.floor(Number(row.current_stock))));
    await InventoryIntegrityService.executeWarehouseTransfer({
      itemId: row.item_id, fromLocation: row.warehouse_code, toLocation: to, quantity, date: isoDay(dayIndex), user: 'sim',
    });
    return { detail: `transfer item ${row.item_id} x${quantity} ${row.warehouse_code} -> ${to}`, tags: [] };
  };

  const voidDoc = async (): Promise<OpOutcome> => {
    const active = docs.filter(d => d.type !== 'audit');
    if (active.length === 0) return { detail: 'skip:no-doc', tags: [] };
    const target = pick(active);
    const res = await pool.query<{ is_deleted: number; currency: string; wac_moved: boolean; had_discount: boolean; zero_price: boolean }>(
      `SELECT d.is_deleted, COALESCE(d.currency, 'IRR') AS currency,
              EXISTS (SELECT 1 FROM transactions t JOIN items i ON i.id = t.item_id
                       WHERE t.document_id = d.id AND t.is_deleted = 0 AND t.type = 'out'
                         AND ABS(COALESCE(i.weighted_average_cost, 0) - COALESCE(t.unit_price, 0)) > 0.01) AS wac_moved,
              EXISTS (SELECT 1 FROM document_items di WHERE di.document_id = d.id AND di.is_deleted = 0 AND di.discount > 0) AS had_discount,
              EXISTS (SELECT 1 FROM document_items di WHERE di.document_id = d.id AND di.is_deleted = 0
                         AND d.type IN ('receipt', 'purchase', 'production_receipt') AND COALESCE(di.unit_price, 0) = 0) AS zero_price
         FROM documents d WHERE d.id = $1`,
      [target.id]
    );
    const row = res.rows[0];
    if (!row || row.is_deleted === 1) return { detail: 'skip:already-void', tags: [] };
    await DocumentService.deleteDocument(target.id, 'sim');
    const tags = [
      target.type,
      row.currency !== 'IRR' ? 'usd' : '',
      row.wac_moved ? 'wac-moved-since' : '',
      row.had_discount && ['receipt', 'purchase'].includes(target.type) ? 'had-discount' : '',
      row.zero_price ? 'zero-price' : '',
    ].filter(Boolean);
    return { detail: `void ${target.type} #${target.id}`, tags };
  };

  const productionReceipt = async (dayIndex: number): Promise<OpOutcome> => {
    const product = pick(items.filter(i => i.type === 'product'));
    const quantity = between(1, 10);
    const unitPrice = chance(0.5) && allowZeroPrice ? 0 : await priceFor(product.id, false);
    const id = await createDoc({
      docType: 'production_receipt', inOut: 'in', dayIndex,
      lines: [{ itemId: product.id, quantity, unitPrice, location: pick(warehouses) }],
    });
    return { detail: `production receipt #${id} item ${product.id} x${quantity} @${unitPrice}`, tags: [unitPrice === 0 ? 'zero-price' : 'priced'] };
  };

  return { snapshot, purchase, sale, salesReturn, issue, stockCount, transfer, voidDoc, productionReceipt };
}
