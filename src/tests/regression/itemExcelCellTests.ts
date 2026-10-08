import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import { withTestMarker } from '../fixtures/testMarker.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/**
 * Series 10 D-01 (data migration from the spreadsheets): how the item Excel import reads its type and number cells.
 * Each case failed on the version before its fix.
 */
export async function runItemExcelCellTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (ctx: Ctx) => Promise<string>]> = [
    ['reg_excel_item_type_words_td_1010',
      'v10.0.1: the Excel import reads the plural and short type words and refuses an unknown type instead of making a product (TD-1010)',
      ['td1010', 'excel', 'migration'], typeWordsCase],
    ['reg_excel_text_numbers_td_1011',
      'v10.0.2: the Excel import reads stock and cost written as text with Persian digits or thousands separators and refuses text that is not a number (TD-1011)',
      ['td1011', 'excel', 'migration'], textNumbersCase],
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
      if (ctx.codes.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.code, ctx.codes)).catch(() => undefined);
    }
  }
  return results;
}

interface Ctx {
  codes: string[];
  importRows(rows: Array<Record<string, unknown>>): Promise<request.Response>;
  serial(): string;
}

async function makeCtx(): Promise<Ctx> {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const admin = await getAdminSession();
  const codes: string[] = [];
  return {
    codes,
    importRows: (rows) => {
      for (const r of rows) codes.push(String(r[CODE]));
      return request(app).post('/api/items/unified-import').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send({ rows });
    },
    serial: () => String(100 + Math.floor(Math.random() * 900)),
  };
}

const CODE = 'کد کالا';
const NAME = 'نام محصول';
const TYPE = 'نوع کالا';
const WAC = 'میانگین موزون بها';
const TOTAL_STOCK = 'موجودی کل';

function errorsOf(res: request.Response): Array<{ code?: string; message: string }> {
  return (res.body?.errors ?? []) as Array<{ code?: string; message: string }>;
}

async function typesByCode(codes: string[]): Promise<Map<string, string>> {
  const rows = await orm.select({ code: items.code, type: items.type, isDeleted: items.isDeleted }).from(items).where(inArray(items.code, codes));
  return new Map(rows.filter(r => r.isDeleted === 0).map(r => [r.code, r.type]));
}

/**
 * TD-1010: on v10.0.0 «مواد اولیه» (the warehouse sheet's word) made a product, so the raw-material code B-H-… was
 * refused with the product code format; an unknown word silently made a product.
 */
async function typeWordsCase(ctx: Ctx): Promise<string> {
  const s = ctx.serial();
  const raw = `B-H-${s}`;
  const product = `1404-N-${s}-01`;
  const unknown = `1404-N-${s}-02`;
  const res = await ctx.importRows([
    { [CODE]: raw, [NAME]: withTestMarker(`raw plural ${s}`), [TYPE]: 'مواد اولیه' },
    { [CODE]: product, [NAME]: withTestMarker(`product short ${s}`), [TYPE]: 'محصول' },
    { [CODE]: unknown, [NAME]: withTestMarker(`unknown type ${s}`), [TYPE]: 'کالای دیگر' },
  ]);
  const wrong: string[] = [];
  if (res.status !== 200) wrong.push(`import answered ${res.status}`);
  const types = await typesByCode([raw, product, unknown]);
  if (types.get(raw) !== 'raw_material') wrong.push(`plural raw-material word gave ${types.get(raw) ?? 'no item'}`);
  if (types.get(product) !== 'product') wrong.push(`short product word gave ${types.get(product) ?? 'no item'}`);
  if (types.has(unknown)) wrong.push(`unknown type word created a ${types.get(unknown)}`);
  const errors = errorsOf(res);
  if (!errors.some(e => e.code === unknown && e.message.includes(TYPE))) wrong.push(`no row error naming the type column for the unknown word: ${JSON.stringify(errors)}`);
  if (errors.some(e => e.code === raw || e.code === product)) wrong.push(`known words got row errors: ${JSON.stringify(errors)}`);
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'plural and short type words are read; an unknown word is a row error naming the column';
}

/**
 * TD-1011: on v10.0.1 a cost «۲۵٬۰۰۰» and a stock «۱۲» written as text were silently ignored, so the item was created
 * with no stock and no cost; a cost that was not a number at all created the item without an error.
 */
async function textNumbersCase(ctx: Ctx): Promise<string> {
  const s = ctx.serial();
  const readable = `B-M-${s}`;
  const unreadable = `B-S-${s}`;
  const res = await ctx.importRows([
    { [CODE]: readable, [NAME]: withTestMarker(`text numbers ${s}`), [TYPE]: 'ماده اولیه', [WAC]: '۲۵٬۰۰۰', [TOTAL_STOCK]: '۱۲' },
    { [CODE]: unreadable, [NAME]: withTestMarker(`bad number ${s}`), [TYPE]: 'ماده اولیه', [WAC]: 'حدود ده هزار', [TOTAL_STOCK]: 3 },
  ]);
  const wrong: string[] = [];
  if (res.status !== 200) wrong.push(`import answered ${res.status}`);
  const rows = await orm.select({ code: items.code, wac: items.weightedAverageCost, stock: items.currentStock, isDeleted: items.isDeleted })
    .from(items).where(inArray(items.code, [readable, unreadable]));
  const live = new Map(rows.filter(r => r.isDeleted === 0).map(r => [r.code, r]));
  const it = live.get(readable);
  if (!it) wrong.push('the row with text numbers created no item');
  else if (Number(it.wac) !== 25000 || Number(it.stock) !== 12) wrong.push(`text numbers read as cost ${Number(it.wac)} and stock ${Number(it.stock)}`);
  if (live.has(unreadable)) wrong.push('a cost that is not a number still created the item');
  const errors = errorsOf(res);
  if (!errors.some(e => e.code === unreadable && e.message.includes(WAC))) wrong.push(`no row error naming the cost column: ${JSON.stringify(errors)}`);
  if (errors.some(e => e.code === readable)) wrong.push(`readable numbers got row errors: ${JSON.stringify(errors)}`);
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'text numbers with Persian digits and separators are read; text that is not a number is a row error naming the column';
}
