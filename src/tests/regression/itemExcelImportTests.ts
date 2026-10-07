import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { activityLogs, itemPrices, items, roles, users, warehouses } from '../../db/schema.js';
import { withTestMarker } from '../fixtures/testMarker.js';
import { money } from '../../lib/money.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Row = Record<string, unknown>;

/**
 * Package 5 (items and pricing), PR A: the unified Excel import / export of items and the pricing page quick import.
 * Each case reproduces a finding of the package 5 review and failed on the version before its fix.
 */
export async function runItemExcelImportTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (ctx: Ctx) => Promise<string>]> = [
    ['reg_excel_roundtrip_no_cost_price_list_td_647',
      'v9.0.114: only configured price lists are prices in Excel import, the pricing quick import and the invoice price list; migration 0063 cleans the three non-price titles (TD-647)',
      ['td647', 'excel', 'price', 'package5'], priceListColumnsCase],
    ['reg_excel_reimport_keeps_price_history_td_662',
      'v9.0.115: re-importing an unchanged Excel file rewrites no price row (TD-662)',
      ['td662', 'excel', 'price', 'package5'], unchangedPriceCase],
    ['sec_item_import_respects_price_and_stock_permissions_td_648',
      'v9.0.116: the Excel import changes prices only with products.edit_price, stock only with warehouse.in / warehouse.out and creates items only with products.create (TD-648)',
      ['td648', 'excel', 'security', 'permission', 'package5'], importPermissionsCase],
    ['reg_excel_partial_row_keeps_fields_td_650',
      'v9.0.117: a missing column or blank cell leaves an existing item unchanged and its type comes from the item (TD-650)',
      ['td650', 'excel', 'package5'], partialRowCase],
    ['reg_excel_name_match_never_changes_code_td_651',
      'v9.0.118: the Excel import finds items by code only; a name used by another item is refused and the code never changes (TD-651)',
      ['td651', 'excel', 'package5'], codeOnlyMatchCase],
    ['inv_excel_total_stock_column_no_phantom_surplus_td_649',
      'v9.0.119: «موجودی کل» alone changes only an item whose stock is all in the default warehouse; otherwise per-warehouse columns are required and must add up (TD-649)',
      ['td649', 'excel', 'stock', 'inventory', 'package5'], totalStockCase],
    ['reg_excel_import_audit_snapshots_td_655',
      'v9.0.120: every item the Excel import creates or changes gets an audit row with before / after fields, stock and prices, plus one summary row, inside the import transaction (TD-655)',
      ['td655', 'excel', 'audit', 'package5'], importAuditCase],
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
      if (ctx.userIds.length > 0) await orm.update(users).set({ isDeleted: 1 }).where(inArray(users.id, ctx.userIds)).catch(() => undefined);
      if (ctx.warehouseIds.length > 0) await orm.update(warehouses).set({ isActive: 0 }).where(inArray(warehouses.id, ctx.warehouseIds)).catch(() => undefined);
      if (ctx.roleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, ctx.roleIds)).catch(() => undefined);
    }
  }
  return results;
}

interface Ctx {
  itemIds: number[];
  userIds: number[];
  roleIds: number[];
  warehouseIds: number[];
  post(url: string, body: unknown): Promise<request.Response>;
  /** a session of a new user whose role holds exactly these permissions */
  as(permissions: string[]): Promise<(url: string, body: unknown) => Promise<request.Response>>;
  get(url: string): Promise<request.Response>;
  serial(): string;
}

async function makeCtx(): Promise<Ctx> {
  const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
  const app = await getTestApp();
  const admin = await getAdminSession();
  const userIds: number[] = [];
  const roleIds: number[] = [];
  return {
    itemIds: [],
    userIds,
    roleIds,
    warehouseIds: [],
    as: async (permissions) => {
      const role = await createTestRole({ permissions });
      roleIds.push(role.id);
      const user = await createTestUser({ role: role.code });
      userIds.push(user.id);
      const session = await loginTestUserWithSession(app, user.username);
      return (url, body) => request(app).post(url).set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send(body as object);
    },
    post: (url, body) => request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body as object),
    get: (url) => request(app).get(url).set('Cookie', admin.cookie),
    serial: () => String(100 + Math.floor(Math.random() * 900)),
  };
}

async function activeTitles(itemId: number): Promise<string[]> {
  const rows = await orm.select({ title: itemPrices.title }).from(itemPrices)
    .where(and(eq(itemPrices.itemId, itemId), eq(itemPrices.isDeleted, 0)));
  return rows.map(r => r.title).sort();
}

async function priceRowCount(itemId: number): Promise<number> {
  return (await orm.select({ id: itemPrices.id }).from(itemPrices).where(eq(itemPrices.itemId, itemId))).length;
}

async function itemState(itemId: number): Promise<{ unit: string; stock: number; prices: string }> {
  const [it] = await orm.select({ unit: items.unit, stock: items.currentStock }).from(items).where(eq(items.id, itemId));
  const prices = await orm.select({ title: itemPrices.title, price: itemPrices.price }).from(itemPrices)
    .where(and(eq(itemPrices.itemId, itemId), eq(itemPrices.isDeleted, 0)));
  return { unit: it.unit, stock: Number(it.stock), prices: prices.map(p => `${p.title}:${Number(p.price)}`).sort().join(',') };
}

function errorText(res: request.Response): string {
  return ((res.body?.errors ?? []) as Array<{ message: string }>).map(e => e.message).join(' | ');
}

/**
 * TD-648 / B05-02: on v9.0.115 a role with only products.view + products.edit set a sale price to 1 rial and cut the stock
 * from 10 to 2 (with a stock-count voucher) through one Excel row, while POST /items/:id/prices answered 403.
 */
async function importPermissionsCase(ctx: Ctx): Promise<string> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const wrong: string[] = [];
  const it = await createTestItem({ code: `1404-N-${ctx.serial()}-03`, name: withTestMarker('گردنبند مجوز td648'), category: 'گردنبند', unit: 'عدد', weightedAverageCost: 300000, stocks: { '': 10 } });
  ctx.itemIds.push(it.id);
  const seed = await ctx.post('/api/items/prices/batch-update', { updates: [{ itemId: it.id, title: 'عمده', price: 2000000 }] });
  if (seed.status !== 200) throw new Error(`seed prices ${seed.status}`);

  // a) products.edit only: the unit changes, the price and the stock do not, both are reported; a new item is refused
  const editor = await ctx.as(['products.view', 'products.edit']);
  const newCode = `1404-N-${ctx.serial()}-04`;
  const res = await editor('/api/items/unified-import', { rows: [
    { 'کد کالا': it.code, 'نام محصول': it.name, 'واحد': 'جفت', 'قیمت عمده': 1, 'موجودی کل': 2 },
    { 'کد کالا': newCode, 'نام محصول': withTestMarker('کالای تازه td648'), 'موجودی کل': 3 },
  ] });
  const afterEditor = await itemState(it.id);
  if (res.status !== 200) wrong.push(`editor import ${res.status}`);
  if (afterEditor.unit !== 'جفت') wrong.push(`unit ${afterEditor.unit}`);
  if (afterEditor.prices !== 'عمده:2000000') wrong.push(`editor changed prices to ${afterEditor.prices}`);
  if (afterEditor.stock !== 10) wrong.push(`editor changed stock to ${afterEditor.stock}`);
  const text = errorText(res);
  for (const label of ['ویرایش قیمت‌ها', 'ثبت خروج کالا', 'تعریف کالای جدید']) {
    if (!text.includes(label)) wrong.push(`no error naming «${label}»: ${text}`);
  }
  const created = await orm.select({ id: items.id }).from(items).where(and(eq(items.code, newCode), eq(items.isDeleted, 0)));
  if (created.length > 0) { ctx.itemIds.push(created[0].id); wrong.push('editor created a new item'); }

  // b) the unchanged export round trip raises no permission error for the same user
  const exp = await ctx.get('/api/items/unified-export?type=product');
  const row = (exp.body.rows as Row[]).find(r => r['کد کالا'] === it.code);
  const roundTrip = await editor('/api/items/unified-import', { rows: [row] });
  if (errorText(roundTrip)) wrong.push(`unchanged round trip errors: ${errorText(roundTrip)}`);

  // c) edit_price + warehouse.in: a price and an increase go through, a decrease is refused
  const keeper = await ctx.as(['products.view', 'products.edit', 'products.edit_price', 'warehouse.view', 'warehouse.in']);
  const up = await keeper('/api/items/unified-import', { rows: [{ 'کد کالا': it.code, 'نام محصول': it.name, 'قیمت عمده': 2100000, 'موجودی کل': 12 }] });
  const afterUp = await itemState(it.id);
  if (errorText(up) || afterUp.prices !== 'عمده:2100000' || afterUp.stock !== 12) wrong.push(`keeper increase: ${afterUp.prices} stock ${afterUp.stock} ${errorText(up)}`);
  const down = await keeper('/api/items/unified-import', { rows: [{ 'کد کالا': it.code, 'نام محصول': it.name, 'موجودی کل': 5 }] });
  if ((await itemState(it.id)).stock !== 12 || !errorText(down).includes('ثبت خروج کالا')) wrong.push(`keeper decrease: stock ${(await itemState(it.id)).stock} ${errorText(down)}`);

  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'price and stock columns follow products.edit_price / warehouse.in / warehouse.out; new items need products.create';
}

/**
 * TD-650 / B05-04: on v9.0.116 a «code, name, price» file turned the unit «جفت» into «عدد», the reorder point 7 into 0
 * and refused the raw-material row with «فرمت کد محصول نهایی» because the type defaulted to product.
 */
async function partialRowCase(ctx: Ctx): Promise<string> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const wrong: string[] = [];
  const product = await createTestItem({ code: `1404-E-${ctx.serial()}-05`, name: withTestMarker('گوشواره ناقص td650'), category: 'گوشواره میخی', unit: 'جفت', reorderPoint: 7, color: 'طلایی', stocks: { '': 3 } });
  const raw = await createTestItem({ type: 'raw_material', code: `B-H-${ctx.serial()}`, name: withTestMarker('ماده اولیه ناقص td650'), category: 'زنجیر', unit: 'ریسه', reorderPoint: 40, stocks: { '': 50 } });
  const legacy = await createTestItem({ code: `N-${ctx.serial()}`, name: withTestMarker('کد قدیمی td650'), category: 'گردنبند', stocks: { '': 1 } });
  ctx.itemIds.push(product.id, raw.id, legacy.id);
  const res = await ctx.post('/api/items/unified-import', { rows: [
    { 'کد کالا': product.code, 'نام محصول': product.name, 'قیمت عمده': 500000 },
    { 'کد کالا': raw.code, 'نام محصول': raw.name, 'قیمت عمده': 20000, 'واحد': '' },
    { 'کد کالا': legacy.code, 'نام محصول': legacy.name, 'قیمت عمده': 90000 },
  ] });
  if (res.status !== 200 || errorText(res)) wrong.push(`import ${res.status}: ${errorText(res)}`);
  const rows = await orm.select({ id: items.id, type: items.type, unit: items.unit, reorderPoint: items.reorderPoint, color: items.color, category: items.category })
    .from(items).where(inArray(items.id, [product.id, raw.id, legacy.id]));
  const byId = new Map(rows.map(r => [r.id, r]));
  const p = byId.get(product.id)!;
  const r = byId.get(raw.id)!;
  if (p.unit !== 'جفت' || Number(p.reorderPoint) !== 7 || p.color !== 'طلایی' || p.category !== 'گوشواره میخی') wrong.push(`product fields ${JSON.stringify(p)}`);
  if (r.type !== 'raw_material' || r.unit !== 'ریسه' || Number(r.reorderPoint) !== 40) wrong.push(`raw material fields ${JSON.stringify(r)}`);
  for (const it of [product, raw, legacy]) {
    if (!(await activeTitles(it.id)).includes('عمده')) wrong.push(`no price for ${it.code}`);
  }
  // an explicit type column and an explicit cell still change the item
  await ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': product.code, 'نام محصول': product.name, 'واحد': 'عدد', 'حد نقطه سفارش (آلارم کسری)': 0 }] });
  const [p2] = await orm.select({ unit: items.unit, reorderPoint: items.reorderPoint }).from(items).where(eq(items.id, product.id));
  if (p2.unit !== 'عدد' || Number(p2.reorderPoint) !== 0) wrong.push(`explicit cells not applied ${JSON.stringify(p2)}`);
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'a partial file kept unit, reorder point, type and colour; prices were set; explicit cells still apply';
}

/** TD-651 / B05-05: on v9.0.117 a row with a new code and an existing item's name found that item by name and changed its code. */
async function codeOnlyMatchCase(ctx: Ctx): Promise<string> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const wrong: string[] = [];
  const serial = ctx.serial();
  const it = await createTestItem({ code: `1404-N-${serial}-01`, name: withTestMarker(`گردنبند کد td651 ${serial}`), category: 'گردنبند', stocks: { '': 2 } });
  ctx.itemIds.push(it.id);
  const codeOf = async () => (await orm.select({ code: items.code, name: items.name }).from(items).where(eq(items.id, it.id)))[0];

  // a) a new code with this item's name: refused as a duplicate name, nothing created, the code stays
  const newCode = `1404-N-${serial}-99`;
  const dup = await ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': newCode, 'نام محصول': it.name, 'قیمت عمده': 700000 }] });
  if (!errorText(dup).includes('نام تکراری')) wrong.push(`duplicate name not reported: ${errorText(dup)}`);
  if ((await codeOf()).code !== it.code) wrong.push(`code changed to ${(await codeOf()).code}`);
  const created = await orm.select({ id: items.id }).from(items).where(and(eq(items.code, newCode), eq(items.isDeleted, 0)));
  if (created.length > 0) { ctx.itemIds.push(created[0].id); wrong.push('a new item was created with the duplicate name'); }
  if ((await activeTitles(it.id)).length > 0) wrong.push('the refused row set a price');

  // b) the same code in other letter case finds the item and keeps its stored code
  const lower = await ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': it.code.toLowerCase(), 'نام محصول': it.name, 'قیمت عمده': 710000 }] });
  if (errorText(lower) || (await codeOf()).code !== it.code || !(await activeTitles(it.id)).includes('عمده')) {
    wrong.push(`case-insensitive code: ${errorText(lower)} code ${(await codeOf()).code}`);
  }

  // c) the exact code with a new name renames the item and keeps the code
  const renamed = withTestMarker(`گردنبند نام تازه td651 ${serial}`);
  await ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': it.code, 'نام محصول': renamed }] });
  const after = await codeOf();
  if (after.name !== renamed || after.code !== it.code) wrong.push(`rename ${JSON.stringify(after)}`);
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'matched by code only; duplicate name refused; code kept in every case';
}

async function stockByWarehouse(itemId: number): Promise<Record<string, number>> {
  const { ItemWarehouseStockService } = await import('../../services/inventory/itemWarehouseStock.service.js');
  return (await ItemWarehouseStockService.getStockSnapshot(orm, itemId)).byCode;
}

/**
 * TD-649 / B05-03: on v9.0.118 an item with 10 units only in a second warehouse and a «موجودی کل = 10» row (unchanged) got
 * 10 more units in the default warehouse (total 20) and a 3,000,000 surplus voucher, with no error.
 */
async function totalStockCase(ctx: Ctx): Promise<string> {
  const { createTestItem, createTestWarehouse } = await import('../fixtures/factories.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  const main = (await getDefaultWarehouseCode(orm)) as string;
  const wrong: string[] = [];
  const w2 = await createTestWarehouse();
  ctx.warehouseIds.push(w2.id);
  const split = await createTestItem({ code: `1404-B-${ctx.serial()}-06`, name: withTestMarker('دستبند دو انبار td649'), category: 'دستبند', weightedAverageCost: 300000, stocks: { [w2.code]: 10 } });
  const single = await createTestItem({ code: `1404-B-${ctx.serial()}-07`, name: withTestMarker('دستبند یک انبار td649'), category: 'دستبند', weightedAverageCost: 300000, stocks: { '': 4 } });
  ctx.itemIds.push(split.id, single.id);
  const run = (row: Row) => ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': split.code, 'نام محصول': split.name, ...row }] });

  const same = await run({ 'موجودی کل': 10 });
  if (errorText(same) || JSON.stringify(await stockByWarehouse(split.id)) !== JSON.stringify({ [w2.code]: 10 })) wrong.push(`unchanged total: ${errorText(same)} ${JSON.stringify(await stockByWarehouse(split.id))}`);
  const more = await run({ 'موجودی کل': 12 });
  if (!errorText(more).includes('موجودی هر انبار لازم است') || (await itemState(split.id)).stock !== 10) wrong.push(`total alone on a second-warehouse item: ${errorText(more)} stock ${(await itemState(split.id)).stock}`);
  const mismatch = await run({ [`موجودی انبار ${w2.name}`]: 8, 'موجودی کل': 9 });
  if (!errorText(mismatch).includes('برابر نیست') || (await itemState(split.id)).stock !== 10) wrong.push(`mismatched total: ${errorText(mismatch)}`);
  const perWarehouse = await run({ [`موجودی انبار ${w2.name}`]: 8 });
  if (errorText(perWarehouse) || JSON.stringify(await stockByWarehouse(split.id)) !== JSON.stringify({ [w2.code]: 8 })) wrong.push(`per-warehouse column: ${errorText(perWarehouse)} ${JSON.stringify(await stockByWarehouse(split.id))}`);

  const singleRes = await ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': single.code, 'نام محصول': single.name, 'موجودی کل': 6 }] });
  if (errorText(singleRes) || (await stockByWarehouse(single.id))[main] !== 6) wrong.push(`default-only item: ${errorText(singleRes)} ${JSON.stringify(await stockByWarehouse(single.id))}`);
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'unchanged total kept; total alone refused for a second-warehouse item; mismatch refused; per-warehouse and default-only rows applied';
}

/**
 * TD-655 / B05-09: on v9.0.119 an import that changed the unit, the stock and a price left only two rows with counts and
 * `details: {}` (one written by the route), outside the transaction.
 */
async function importAuditCase(ctx: Ctx): Promise<string> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  const main = (await getDefaultWarehouseCode(orm)) as string;
  const wrong: string[] = [];
  const it = await createTestItem({ code: `1404-R-${ctx.serial()}-08`, name: withTestMarker('انگشتر ممیزی td655'), category: 'انگشتر', unit: 'عدد', weightedAverageCost: 200000, stocks: { '': 5 } });
  ctx.itemIds.push(it.id);
  const [{ maxId }] = await orm.select({ maxId: sql<number>`coalesce(max(${activityLogs.id}), 0)::int` }).from(activityLogs);
  const newCode = `1404-R-${ctx.serial()}-09`;
  const res = await ctx.post('/api/items/unified-import', { rows: [
    { 'کد کالا': it.code, 'نام محصول': it.name, 'واحد': 'جفت', 'موجودی کل': 2, 'قیمت عمده': 450000 },
    { 'کد کالا': newCode, 'نام محصول': withTestMarker('انگشتر تازه td655'), 'موجودی کل': 3, 'میانگین موزون بها': 100000 },
  ] });
  if (errorText(res)) wrong.push(`import errors ${errorText(res)}`);
  const created = await orm.select({ id: items.id }).from(items).where(and(eq(items.code, newCode), eq(items.isDeleted, 0)));
  if (created[0]) ctx.itemIds.push(created[0].id);
  const logs = await orm.select().from(activityLogs).where(gt(activityLogs.id, maxId));
  type Details = { before?: Row; after?: Row; changes?: Record<string, { before: unknown; after: unknown }>; createdCount?: number };
  const update = logs.find(l => l.entity === 'کالا' && l.action === 'UPDATE' && l.entityId === String(it.id));
  const changes = (update?.details as Details | undefined)?.changes ?? {};
  const expected: Record<string, [unknown, unknown]> = { unit: ['عدد', 'جفت'], [`موجودی ${main}`]: [5, 2], 'قیمت عمده': [undefined, '450000 IRR'] };
  for (const [key, [b, a]] of Object.entries(expected)) {
    const c = changes[key];
    if (!c || (c.before ?? undefined) !== b || !String(c.after).startsWith(String(a).split(' ')[0])) wrong.push(`change ${key}: ${JSON.stringify(c)}`);
  }
  const create = logs.find(l => l.entity === 'کالا' && l.action === 'CREATE' && created[0] && l.entityId === String(created[0].id));
  if (!create || (create.details as Details).after?.[`موجودی ${main}`] !== 3) wrong.push(`create row ${JSON.stringify(create?.details)}`);
  const summary = logs.filter(l => l.action === 'IMPORT');
  if (summary.length !== 1 || (summary[0].details as Details).createdCount !== 1) wrong.push(`summary rows ${JSON.stringify(summary.map(l => [l.entity, l.details]))}`);
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'one UPDATE row with unit, stock and price changes, one CREATE row and one summary row';
}

/** TD-662 / B05-16: on v9.0.114 each import of the same file soft-deleted and re-inserted every price (history 2 → 6). */
async function unchangedPriceCase(ctx: Ctx): Promise<string> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const it = await createTestItem({ code: `1404-B-${ctx.serial()}-02`, name: withTestMarker('دستبند تاریخچه td662'), category: 'دستبند', stocks: { '': 2 } });
  ctx.itemIds.push(it.id);
  const seed = await ctx.post('/api/items/prices/batch-update', { updates: [
    { itemId: it.id, title: 'عمده', price: 300000 }, { itemId: it.id, title: 'فروشگاه', price: 420000 }] });
  if (seed.status !== 200) throw new Error(`seed prices ${seed.status}`);
  const before = await priceRowCount(it.id);
  const row = { 'کد کالا': it.code, 'نام محصول': it.name, 'قیمت عمده': 300000, 'قیمت فروشگاه': 420000, 'واحد ارز': 'IRR' };
  const counts: number[] = [];
  for (let i = 0; i < 2; i++) {
    const imp = await ctx.post('/api/items/unified-import', { rows: [row] });
    if (imp.status !== 200) throw new Error(`import ${imp.status} ${JSON.stringify(imp.body)}`);
    counts.push(Number(imp.body.pricesCount));
  }
  const after = await priceRowCount(it.id);
  const changed = await ctx.post('/api/items/unified-import', { rows: [{ ...row, 'قیمت عمده': 310000 }] });
  const afterChange = await priceRowCount(it.id);
  if (after !== before || counts.some(c => c !== 0) || changed.body.pricesCount !== 1 || afterChange !== before + 1) {
    throw new Error(`price rows ${before} → ${after} after two unchanged imports (pricesCount ${counts.join(',')}); a changed price → ${afterChange} (pricesCount ${changed.body.pricesCount})`);
  }
  return `price rows stayed ${before} after two unchanged imports; one changed price added one row`;
}

/** TD-647 / B05-01: on v9.0.113 the unchanged export round trip added the price list «میانگین خرید (WAC)» and the quick import «موجودی کل». */
async function priceListColumnsCase(ctx: Ctx): Promise<string> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const { findUnknownPriceTitles } = await import('../../services/items/itemPriceTitles.js');
  const wrong: string[] = [];
  const it = await createTestItem({ code: `1404-N-${ctx.serial()}-01`, name: withTestMarker('گردنبند رفت‌وبرگشت td647'), category: 'گردنبند', weightedAverageCost: 1250000, stocks: { '': 4 } });
  ctx.itemIds.push(it.id);
  const seed = await ctx.post('/api/items/prices/batch-update', { updates: [
    { itemId: it.id, title: 'عمده', price: 2000000 }, { itemId: it.id, title: 'فروشگاه', price: 2600000 }] });
  if (seed.status !== 200) throw new Error(`seed prices ${seed.status} ${JSON.stringify(seed.body)}`);

  // a) unchanged round trip of the unified export
  const exp = await ctx.get('/api/items/unified-export?type=product');
  const row = (exp.body.rows as Row[]).find(r => r['کد کالا'] === it.code);
  if (!row) throw new Error('item missing from the unified export');
  if (Object.keys(row).some(k => k.includes('WAC'))) wrong.push(`export header still says WAC: ${Object.keys(row).filter(k => k.includes('WAC')).join(', ')}`);
  const imp = await ctx.post('/api/items/unified-import', { rows: [row], typeFilter: 'product' });
  if (imp.status !== 200) wrong.push(`round trip import ${imp.status}`);
  const titles = await activeTitles(it.id);
  if (JSON.stringify(titles) !== JSON.stringify(['عمده', 'فروشگاه'])) wrong.push(`active titles after the round trip ${JSON.stringify(titles)}`);
  const api = await ctx.get(`/api/items/${it.id}/prices`);
  const apiTitles = (api.body as Row[]).map(p => String(p.title)).sort();
  if (JSON.stringify(apiTitles) !== JSON.stringify(['عمده', 'فروشگاه'])) wrong.push(`GET /items/:id/prices titles ${JSON.stringify(apiTitles)}`);

  // b) an old export header and an unknown «قیمت …» column
  const imp2 = await ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': it.code, 'نام محصول': it.name, 'قیمت میانگین خرید (WAC)': 1250000, 'قیمت ویژه همکار': 900000 }] });
  const unknownErr = (imp2.body.errors as Array<{ message: string }> | undefined)?.some(e => e.message.includes('قیمت ویژه همکار'));
  if (!unknownErr) wrong.push(`unknown price column not reported: ${JSON.stringify(imp2.body.errors)}`);
  const titles2 = await activeTitles(it.id);
  if (titles2.some(t => t !== 'عمده' && t !== 'فروشگاه')) wrong.push(`unknown or WAC column became a price list: ${JSON.stringify(titles2)}`);

  // c) the pricing page quick import payload and the server guard
  const { buildQuickPriceUpdates } = await import('../../lib/items/quickPriceImport.js');
  const quick = buildQuickPriceUpdates([{ 'کد کالا': it.code, 'موجودی کل': 12, 'میانگین بهای خرید': 700000, 'قیمت عمده': 950000 }], [{ id: it.id, code: it.code }], ['فروشگاه', 'مصرف‌کننده', 'عمده']);
  if (quick.updates.length !== 1 || quick.updates[0].title !== 'عمده') wrong.push(`quick import updates ${JSON.stringify(quick.updates)}`);
  const stockAsPrice = await ctx.post('/api/items/prices/batch-update', { updates: [{ itemId: it.id, title: 'موجودی کل', price: 12 }] });
  if (stockAsPrice.status !== 422 || stockAsPrice.body?.code !== 'PRICE_LIST_NOT_CONFIGURED') wrong.push(`batch-update «موجودی کل» answered ${stockAsPrice.status} ${stockAsPrice.body?.code}`);
  const single = await ctx.post(`/api/items/${it.id}/prices`, { title: 'میانگین خرید (WAC)', price: 1250000 });
  if (single.status !== 422) wrong.push(`POST /items/:id/prices «میانگین خرید (WAC)» answered ${single.status}`);

  // d) legacy rows: hidden from the invoice price list, cleaned by migration 0063 or listed by the health check
  const legacy = await orm.insert(itemPrices).values([
    { itemId: it.id, title: 'میانگین خرید (WAC)', price: money(1250000), currency: 'IRR', isDeleted: 0 },
    { itemId: it.id, title: 'موجودی کل', price: money(12), currency: 'IRR', isDeleted: 0 },
    { itemId: it.id, title: 'تخفیف نمایشگاه td647', price: money(800000), currency: 'IRR', isDeleted: 0 },
  ]).returning({ id: itemPrices.id, title: itemPrices.title });
  const api2 = await ctx.get(`/api/items/${it.id}/prices`);
  const apiTitles2 = (api2.body as Row[]).map(p => String(p.title)).sort();
  if (JSON.stringify(apiTitles2) !== JSON.stringify(['عمده', 'فروشگاه'])) wrong.push(`legacy titles reach the invoice price list ${JSON.stringify(apiTitles2)}`);
  const sqlText = fs.readFileSync(path.resolve(process.cwd(), 'drizzle/0063_item_price_non_list_titles.sql'), 'utf8');
  for (const stmt of sqlText.split('--> statement-breakpoint').slice(1)) await pool.query(stmt);
  const after = await orm.select({ id: itemPrices.id, isDeleted: itemPrices.isDeleted }).from(itemPrices).where(inArray(itemPrices.id, legacy.map(l => l.id)));
  const deleted = after.filter(r => r.isDeleted === 1).map(r => legacy.find(l => l.id === r.id)?.title).sort();
  if (JSON.stringify(deleted) !== JSON.stringify(['موجودی کل', 'میانگین خرید (WAC)'].sort())) wrong.push(`migration 0063 soft-deleted ${JSON.stringify(deleted)}`);
  const recorded = await pool.query('SELECT item_price_id, price::text FROM item_price_title_cleanup WHERE item_id = $1 ORDER BY item_price_id', [it.id]);
  if (recorded.rowCount !== 2) wrong.push(`migration 0063 recorded ${recorded.rowCount} rows`);
  const unknown = await findUnknownPriceTitles();
  if (!unknown.some(u => u.title === 'تخفیف نمایشگاه td647')) wrong.push('health check does not list the unknown title');

  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return `round trip kept ${JSON.stringify(titles)}; unknown column reported; quick import 1 update; batch «موجودی کل» 422; migration cleaned 2, health lists the rest`;
}
