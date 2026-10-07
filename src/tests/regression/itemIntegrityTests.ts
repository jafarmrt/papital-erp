import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { items, transactions, journalVouchers, warehouses } from '../../db/schema.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Row = Record<string, unknown>;

/**
 * Package 5 (items and pricing), PR B: item integrity (opening voucher, unique code and name, optimistic lock, code
 * counter, numeric input, delete under a concurrent receipt). Each case reproduces a finding of the package 5 review.
 */
export async function runItemIntegrityTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (ctx: Ctx) => Promise<string>]> = [
    ['inv_item_create_opening_voucher_atomic_td_652',
      'v9.0.159: a new item with opening stock is refused when its opening voucher cannot be issued; no item and no Kardex row remain (TD-652)',
      ['td652', 'item', 'voucher', 'inventory', 'package5'], openingVoucherAtomicCase],
    ['conc_item_code_and_name_unique_td_653',
      'v9.0.160: concurrent requests never create two active items with one code (any letter case) or one name (TD-653)',
      ['td653', 'item', 'concurrency', 'package5'], uniqueCodeNameCase],
    ['sec_item_version_lock_td_654',
      'v9.0.161: editing an item needs its current version (400 without, 409 when stale) and a missing field keeps its value (TD-654)',
      ['td654', 'item', 'occ', 'package5'], versionLockCase],
    ['reg_item_code_peek_after_save_td_656',
      'v9.0.162: saving an item moves its code series counter, so the next suggested code is free (TD-656)',
      ['td656', 'item', 'code', 'package5'], codePeekCase],
    ['reg_item_numeric_input_validation_td_657',
      'v9.0.163: item numbers go through decimalInput: text is refused, Persian digits are read and negatives are refused (TD-657, item part)',
      ['td657', 'item', 'validation', 'package5'], numericInputCase],
    ['conc_item_delete_vs_receipt_td_661',
      'v9.0.164: deleting an item while a receipt of it is being committed is refused after the receipt (TD-661)',
      ['td661', 'item', 'concurrency', 'inventory', 'package5'], deleteVsReceiptCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    const ctx = await makeCtx();
    try {
      const details = await run(ctx);
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      if (ctx.itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, ctx.itemIds)).catch(() => undefined);
    }
  }
  return results;
}

interface Ctx {
  /** random digits that keep the codes and names of one run apart */
  tag: string;
  /** items created through POST /api/items, soft-deleted after the case */
  itemIds: number[];
  post(url: string, body: unknown): Promise<request.Response>;
  put(url: string, body: unknown): Promise<request.Response>;
  get(url: string): Promise<request.Response>;
}

async function makeCtx(): Promise<Ctx> {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const admin = await getAdminSession();
  const itemIds: number[] = [];
  return {
    tag: String(100 + Math.floor(Math.random() * 900)),
    itemIds,
    post: async (url, body) => {
      const res = await request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body as object);
      if (url === '/api/items' && res.status === 200 && typeof res.body?.id === 'number') itemIds.push(res.body.id);
      return res;
    },
    put: (url, body) => request(app).put(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body as object),
    get: (url) => request(app).get(url).set('Cookie', admin.cookie),
  };
}

const q = async (text: string, params: unknown[] = []): Promise<Row[]> => (await pool.query(text, params)).rows as Row[];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function defaultWarehouseCode(): Promise<string> {
  const [wh] = await orm.select({ code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(warehouses.id).limit(1);
  return wh.code;
}

async function activeItemsWhere(condition: string, params: unknown[]): Promise<number> {
  const rows = await q(`SELECT count(*)::int AS n FROM items WHERE is_deleted = 0 AND ${condition}`, params);
  return Number(rows[0].n);
}

async function openingVoucherAtomicCase(ctx: Ctx): Promise<string> {
  const prev = (await q(`SELECT value FROM app_settings WHERE key = 'accounting_account_mappings'`))[0]?.value ?? null;
  const code = `1404-N-${ctx.tag}-01`;
  try {
    await q(`INSERT INTO app_settings (key, value) VALUES ('accounting_account_mappings', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ ...(prev ? JSON.parse(String(prev)) : {}), openingCapitalAccountCode: '9999' })]);
    const def = await defaultWarehouseCode();
    const res = await ctx.post('/api/items', {
      type: 'product', code, name: `گردنبند بی‌سند ${ctx.tag}`, unit: 'عدد', category: 'گردنبند', weighted_average_cost: 1000000, [`stock_${def}`]: 10,
    });
    if (res.status < 400) throw new Error(`POST /items with an opening voucher that cannot be issued was accepted (${res.status}, opening_voucher_id ${res.body?.opening_voucher_id})`);
    const created = await orm.select({ id: items.id }).from(items).where(eq(items.code, code));
    if (created.length > 0) {
      const kardex = await orm.select({ id: transactions.id }).from(transactions).where(inArray(transactions.itemId, created.map(c => c.id)));
      throw new Error(`refused POST left ${created.length} item row(s) and ${kardex.length} Kardex row(s)`);
    }
    return `POST refused with ${res.status}: ${String(res.body?.error ?? '').slice(0, 120)}; no item and no Kardex row`;
  } finally {
    await q(prev === null ? `DELETE FROM app_settings WHERE key = 'accounting_account_mappings'`
      : `UPDATE app_settings SET value = $1 WHERE key = 'accounting_account_mappings'`, prev === null ? [] : [prev]);
  }
}

async function uniqueCodeNameCase(ctx: Ctx): Promise<string> {
  const code = `1404-E-${ctx.tag}-01`;
  const sameCode = await Promise.all(Array.from({ length: 5 }, (_, i) =>
    ctx.post('/api/items', { type: 'product', code, name: `گوشواره هم‌کد ${ctx.tag} ${i}`, unit: 'جفت', category: 'گوشواره میخی' })));
  const codeRows = await activeItemsWhere('code = $1', [code]);
  if (codeRows !== 1) throw new Error(`five concurrent POSTs with one code left ${codeRows} active items (statuses ${sameCode.map(r => r.status).join(',')})`);
  const refusedCode = sameCode.filter(r => r.status !== 200);
  if (refusedCode.some(r => r.status !== 409)) throw new Error(`duplicate code answered ${refusedCode.map(r => r.status).join(',')}, expected 409`);

  const name = `گوشواره هم‌نام ${ctx.tag}`;
  const sameName = await Promise.all(Array.from({ length: 5 }, (_, i) =>
    ctx.post('/api/items', { type: 'product', code: `1404-E-${ctx.tag}-1${i}`, name, unit: 'جفت', category: 'گوشواره میخی' })));
  const nameRows = await activeItemsWhere('lower(btrim(name)) = lower(btrim($1))', [name]);
  if (nameRows !== 1) throw new Error(`five concurrent POSTs with one name left ${nameRows} active items (statuses ${sameName.map(r => r.status).join(',')})`);

  const lower = await ctx.post('/api/items', { type: 'raw_material', code: `b-h-${ctx.tag}`, name: `مهره حروف کوچک ${ctx.tag}`, unit: 'ریسه', category: 'مهره حدید' });
  const upper = await ctx.post('/api/items', { type: 'raw_material', code: `B-H-${ctx.tag}`, name: `مهره حروف بزرگ ${ctx.tag}`, unit: 'ریسه', category: 'مهره حدید' });
  if (lower.status !== 200 || upper.status !== 409) throw new Error(`codes differing only by letter case: ${lower.status} then ${upper.status}, expected 200 then 409`);

  const other = await ctx.post('/api/items', { type: 'raw_material', code: `C-H-${ctx.tag}`, name: `مهره دیگر ${ctx.tag}`, unit: 'ریسه', category: 'مهره حدید' });
  const [otherRow] = await orm.select({ version: items.version }).from(items).where(eq(items.id, other.body.id));
  const rename = await ctx.put(`/api/items/${other.body.id}`, {
    code: `C-H-${ctx.tag}`, name: ` مهره حروف کوچک ${ctx.tag} `, unit: 'ریسه', category: 'مهره حدید', version: otherRow?.version,
  });
  if (rename.status !== 409) throw new Error(`renaming an item to another item's name (with spaces) answered ${rename.status}, expected 409`);

  const indexes = await q(`SELECT indexname FROM pg_indexes WHERE tablename = 'items' AND indexname IN ('uq_items_code_active', 'uq_items_name_active')`);
  if (indexes.length !== 2) throw new Error(`unique indexes present: ${indexes.map(r => r.indexname).join(', ') || 'none'}`);
  return `same code ${sameCode.map(r => r.status).join(',')}; same name ${sameName.map(r => r.status).join(',')}; case ${lower.status}/${upper.status}; rename ${rename.status}`;
}

async function versionLockCase(ctx: Ctx): Promise<string> {
  const code = `1404-B-${ctx.tag}-01`;
  const created = await ctx.post('/api/items', { type: 'product', code, name: `دستبند هم‌زمان ${ctx.tag}`, unit: 'عدد', category: 'دستبند', reorder_point: 5, color: 'طلایی' });
  if (created.status !== 200) throw new Error(`create ${created.status} ${JSON.stringify(created.body)}`);
  const id = created.body.id as number;
  const [{ version: v0 }] = await orm.select({ version: items.version }).from(items).where(eq(items.id, id));
  const base = { name: `دستبند هم‌زمان ${ctx.tag}`, code, unit: 'عدد', category: 'دستبند' };

  const noVersion = await ctx.put(`/api/items/${id}`, { ...base, reorder_point: 9 });
  if (noVersion.status !== 400) throw new Error(`PUT without version answered ${noVersion.status}, expected 400`);
  const a = await ctx.put(`/api/items/${id}`, { ...base, reorder_point: 25, version: v0 });
  if (a.status !== 200) throw new Error(`PUT with the current version answered ${a.status} ${JSON.stringify(a.body)}`);
  const stale = await ctx.put(`/api/items/${id}`, { ...base, color: 'نقره‌ای', version: v0 });
  if (stale.status !== 409 || stale.body?.code !== 'OCC_CONFLICT') throw new Error(`stale PUT answered ${stale.status} ${stale.body?.code}, expected 409 OCC_CONFLICT`);
  const [row] = await orm.select({ reorderPoint: items.reorderPoint, color: items.color, version: items.version }).from(items).where(eq(items.id, id));
  if (Number(row.reorderPoint) !== 25 || row.color !== 'طلایی') {
    throw new Error(`after A and stale B: reorder point ${row.reorderPoint}, colour ${row.color}; expected 25 and the unchanged colour`);
  }
  if (row.version === v0) throw new Error('a saved edit did not advance the version');
  return `no version ${noVersion.status}; current ${a.status}; stale ${stale.status}; row ${JSON.stringify(row)}`;
}

async function codePeekCase(ctx: Ctx): Promise<string> {
  const prefix = `Z${ctx.tag.replace(/\d/g, d => 'ABCDEFGHIJ'[Number(d)])}`;
  const peek = async () => (await ctx.get(`/api/items/next-code?type=raw_material&prefix=${prefix}`)).body.code as string;
  const reserved = await ctx.post('/api/items/next-code', { type: 'raw_material', prefix });
  const s1 = await ctx.post('/api/items', { type: 'raw_material', code: reserved.body.code, name: `بند چرمی ${ctx.tag} ۱`, unit: 'متر', category: 'سایر اقلام' });
  const p2 = await peek();
  const s2 = await ctx.post('/api/items', { type: 'raw_material', code: p2, name: `بند چرمی ${ctx.tag} ۲`, unit: 'متر', category: 'سایر اقلام' });
  const p3 = await peek();
  const s3 = await ctx.post('/api/items', { type: 'raw_material', code: p3, name: `بند چرمی ${ctx.tag} ۳`, unit: 'متر', category: 'سایر اقلام' });
  if (s1.status !== 200 || s2.status !== 200 || s3.status !== 200 || p2 === p3) {
    throw new Error(`reserved ${reserved.body.code} → ${s1.status}; suggested ${p2} → ${s2.status}; suggested ${p3} → ${s3.status} ${JSON.stringify(s3.body).slice(0, 100)}`);
  }
  return `reserved ${reserved.body.code}, then ${p2}, then ${p3}: all saved`;
}

async function numericInputCase(ctx: Ctx): Promise<string> {
  const make = (n: string, extra: Row) => ctx.post('/api/items', { type: 'raw_material', code: `N-${ctx.tag}${n}`, name: `کالای عددی ${ctx.tag} ${n}`, unit: 'عدد', category: 'سایر اقلام', ...extra });
  const text = await make('1', { reorder_point: 'abc' });
  const weight = await make('2', { weight: 'سبک' });
  const negative = await make('3', { reorder_point: -5 });
  const negWac = await make('4', { weighted_average_cost: '-100' });
  const textStock = await make('5', { stocks: { [await defaultWarehouseCode()]: 'abc' } });
  const refused = [text, weight, negative, negWac, textStock].map(r => r.status);
  if (refused.some(s => s !== 400)) throw new Error(`invalid numbers answered ${refused.join(',')}, expected 400 for each`);
  const persian = await make('6', { reorder_point: '۱۲', weight: '۲٫۵' });
  if (persian.status !== 200) throw new Error(`Persian digits answered ${persian.status} ${JSON.stringify(persian.body)}`);
  const [row] = await orm.select({ reorderPoint: items.reorderPoint, weight: items.weight }).from(items).where(eq(items.id, persian.body.id));
  if (Number(row.reorderPoint) !== 12 || Number(row.weight) !== 2.5) throw new Error(`Persian digits stored as ${JSON.stringify(row)}`);
  const alerts = await q(`SELECT count(*)::int AS n FROM items WHERE code LIKE $1 AND reorder_point::text = 'NaN'`, [`N-${ctx.tag}%`]);
  if (Number(alerts[0].n) !== 0) throw new Error('an item was stored with reorder point NaN');
  return `invalid ${refused.join(',')}; Persian digits stored ${JSON.stringify(row)}`;
}

async function deleteVsReceiptCase(ctx: Ctx): Promise<string> {
  const { DocumentService } = await import('../../services/document.service.js');
  const { ItemCatalogService } = await import('../../services/items/itemCatalog.service.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const created = await ctx.post('/api/items', { type: 'raw_material', code: `O-${ctx.tag}`, name: `کالای حذف هم‌زمان ${ctx.tag}`, unit: 'عدد', category: 'سایر اقلام', weighted_average_cost: 20000 });
  if (created.status !== 200) throw new Error(`create ${created.status} ${JSON.stringify(created.body)}`);
  const itemId = created.body.id as number;
  const def = await defaultWarehouseCode();
  const today = await businessTodayIsoDate();
  const receipt = orm.transaction(async (tx) => {
    await DocumentService.applyStockMovement(tx, {
      itemId, inOut: 'in', quantity: 5, price: 20000, date: today, documentType: 'audit', documentRef: `TD661-${ctx.tag}`, user: 'test', targetLoc: def,
    });
    await sleep(600);
  });
  await sleep(150);
  const deletion = ItemCatalogService.deleteItem(itemId).then(() => 'deleted', (e: unknown) => `refused: ${e instanceof Error ? e.message : String(e)}`);
  await receipt;
  const outcome = await deletion;
  const [row] = await orm.select({ isDeleted: items.isDeleted, stock: items.currentStock }).from(items).where(eq(items.id, itemId));
  const vouchers = await orm.select({ id: journalVouchers.id }).from(journalVouchers)
    .where(and(eq(journalVouchers.referenceModule, 'item_opening'), eq(journalVouchers.referenceId, itemId)));
  if (row.isDeleted !== 0) throw new Error(`item with ${row.stock} in stock was deleted (${outcome})`);
  // the receipt moved stock without a document; take it back out so the item can be cleaned up
  await orm.transaction(async (tx) => DocumentService.applyStockMovement(tx, {
    itemId, inOut: 'out', quantity: 5, price: 20000, date: today, documentType: 'audit', documentRef: `TD661-${ctx.tag}-undo`, user: 'test', targetLoc: def,
  }));
  return `${outcome.slice(0, 120)}; item kept with stock ${row.stock}; opening vouchers ${vouchers.length}`;
}
