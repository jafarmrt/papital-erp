import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import sharp from 'sharp';
import type { TestCaseResult } from '../types.js';
import type { Harness, Session, ShouldRun } from '../security/workflowTestHarness.js';
import { runReservationCases } from './stockReservationTests.js';
import { createTestItem } from '../fixtures/factories.js';
import { binaryParser, readZipEntries } from '../fixtures/zipReader.js';

/**
 * Series 10, N-05 PR 2 (v10.0.25+): the product side of the media library — the product card of an item (form, Excel
 * import, the library's product page), the product grid filtered in SQL and the zip download.
 */
export async function runMediaProductTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_media_product_card_item_form_n05',
      'v10.0.25: the item form saves collections, design year and transfer code; a new product takes year and transfer code from its code; an invalid year is 422 (N-05)',
      ['n05', 'media', 'items'], itemFormCase],
    ['reg_media_product_card_excel_n05',
      'v10.0.25: the Excel import reads the product card columns, keeps them on a blank cell and refuses a row with an invalid design year (N-05)',
      ['n05', 'media', 'items'], excelCase],
    ['reg_media_product_info_occ_n05',
      'v10.0.25: the library edits the product card with media.manage or products.edit at the item version, with an item audit row (N-05)',
      ['n05', 'media', 'permissions'], infoCase],
    ['reg_media_product_grid_filters_n05',
      'v10.0.25: the product grid filters by collection, design year, transfer code and missing images in SQL, with file counts and a cover (N-05)',
      ['n05', 'media'], gridCase],
    ['reg_media_zip_download_n05',
      'v10.0.25: several files download as one zip in their original or light version; an unknown id is 422 (N-05)',
      ['n05', 'media'], zipCase],
  ]);
}

const brief = (res: { status: number; body?: unknown }) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 200)}`;
const digits = (n: number) => String(crypto.randomInt(10 ** (n - 1), 10 ** n));

/** A product code «YYYY-N-TTT-SS» no other test uses */
function productCode(year: number): { code: string; transfer: string } {
  const transfer = digits(3);
  return { code: `${year}-Z-${transfer}-${digits(2)}`, transfer };
}

async function itemRow(h: Harness, id: number) {
  const [row] = await h.q(`SELECT collections, design_year, transfer_code, product_description, technical_notes, version FROM items WHERE id = $1`, [id]);
  return row;
}

async function itemFormCase(h: Harness, wrong: string[]): Promise<string> {
  const { code, transfer } = productCode(1404);
  const created = await h.post('/api/items', {
    type: 'product', name: `کارت ${digits(6)}`, code, unit: 'عدد', category: 'گردنبند',
    collections: ['  لوتوس ', 'بهار', 'لوتوس'], technical_notes: 'آبکاری دولایه',
  });
  const id = Number((created.body as { id?: number; data?: { id?: number } }).id ?? (created.body as { data?: { id?: number } }).data?.id);
  if (created.status >= 300 || !id) {
    wrong.push(`item create answered ${brief(created)}`);
    return 'create failed';
  }
  const row = await itemRow(h, id);
  if (JSON.stringify(row.collections) !== JSON.stringify(['لوتوس', 'بهار'])) wrong.push(`collections ${JSON.stringify(row.collections)}, expected trimmed and without the repeat`);
  if (Number(row.design_year) !== 1404) wrong.push(`design year ${row.design_year}, expected 1404 from the code`);
  if (row.transfer_code !== transfer) wrong.push(`transfer code ${row.transfer_code}, expected ${transfer} from the code`);
  if (row.technical_notes !== 'آبکاری دولایه') wrong.push(`technical notes ${row.technical_notes}`);

  const edited = await h.put(`/api/items/${id}`, {
    name: `کارت ویرایش ${digits(6)}`, code, unit: 'عدد', version: Number(row.version), design_year: '۱۴۰۳',
  });
  if (edited.status !== 200) wrong.push(`item edit answered ${brief(edited)}`);
  const after = await itemRow(h, id);
  if (Number(after.design_year) !== 1403) wrong.push(`design year after edit ${after.design_year}, expected 1403 from Persian digits`);
  if (JSON.stringify(after.collections) !== JSON.stringify(['لوتوس', 'بهار'])) wrong.push(`an edit without collections changed them: ${JSON.stringify(after.collections)}`);

  const bad = await h.put(`/api/items/${id}`, { name: `کارت بد ${digits(6)}`, code, unit: 'عدد', version: Number(after.version), design_year: '2026' });
  const badCode = (bad.body as { code?: string }).code;
  if (bad.status !== 422 || badCode !== 'PRODUCT_CARD_INVALID') wrong.push(`design year 2026 answered ${brief(bad)}, expected 422 PRODUCT_CARD_INVALID`);
  return `create ${created.status}; edit ${edited.status}; bad year ${bad.status} ${badCode}`;
}

async function excelCase(h: Harness, wrong: string[]): Promise<string> {
  const { importItemsFromExcel } = await import('../../services/items/itemExcelImport.js');
  const perms = { createItems: true, editItems: true, editPrices: true, stockIn: true, stockOut: true };
  const actor = { username: 'admin' };
  const first = productCode(1402);
  const second = productCode(1402);
  const name = `اکسل کارت ${digits(6)}`;
  const result = await importItemsFromExcel([
    { 'کد کالا': first.code, 'نام محصول': name, 'نوع کالا': 'محصول نهایی', 'کالکشن': 'لوتوس، بهار', 'توضیح محصول': 'گردنبند بلند' },
    { 'کد کالا': second.code, 'نام محصول': `اکسل بد ${digits(6)}`, 'نوع کالا': 'محصول نهایی', 'سال طراحی': 'سال نو' },
  ], 'product', actor, perms);
  const [made] = await h.q(`SELECT id FROM items WHERE code = $1 AND is_deleted = 0`, [first.code]);
  if (!made) {
    wrong.push(`the valid row was not imported: ${JSON.stringify(result.errors)}`);
    return 'import failed';
  }
  const row = await itemRow(h, Number(made.id));
  if (JSON.stringify(row.collections) !== JSON.stringify(['لوتوس', 'بهار'])) wrong.push(`imported collections ${JSON.stringify(row.collections)}`);
  if (Number(row.design_year) !== 1402 || row.transfer_code !== first.transfer) wrong.push(`imported year/transfer ${row.design_year}/${row.transfer_code}, expected from the code`);
  if (row.product_description !== 'گردنبند بلند') wrong.push(`imported description ${row.product_description}`);
  const [refused] = await h.q(`SELECT id FROM items WHERE code = $1`, [second.code]);
  if (refused) wrong.push('a row with an invalid design year was imported');
  if (!result.errors.some(e => e.row === 3)) wrong.push(`no row error for the invalid design year: ${JSON.stringify(result.errors)}`);

  // a blank cell keeps the stored value; a filled one replaces it
  await importItemsFromExcel([
    { 'کد کالا': first.code, 'نام محصول': name, 'کالکشن': '', 'کد ترنسفر': 'T-9' },
  ], 'product', actor, perms);
  const again = await itemRow(h, Number(made.id));
  if (JSON.stringify(again.collections) !== JSON.stringify(['لوتوس', 'بهار'])) wrong.push(`a blank collection cell changed them: ${JSON.stringify(again.collections)}`);
  if (again.transfer_code !== 'T-9') wrong.push(`transfer code after the second import ${again.transfer_code}, expected T-9`);
  return `errors ${result.errors.length}; collections ${JSON.stringify(again.collections)}; transfer ${again.transfer_code}`;
}

async function infoCase(h: Harness, wrong: string[]): Promise<string> {
  const item = await createTestItem({ type: 'product' });
  const viewer = await h.sessionWith(['media.view']);
  const editor = await h.sessionWith(['products.view', 'products.edit']);
  const manager = await h.sessionWith(['media.view', 'media.manage']);
  const url = `/api/media/products/${item.id}/info`;

  const denied = await h.put(url, { version: 1, collections: ['X'] }, viewer);
  if (denied.status !== 403) wrong.push(`media.view alone edited the card: ${brief(denied)}`);
  const byEditor = await h.put(url, { version: 1, collections: ['پاییز'], designYear: 1401 }, editor);
  if (byEditor.status !== 200) wrong.push(`products.edit could not edit the card: ${brief(byEditor)}`);
  const stale = await h.put(url, { version: 1, technicalNotes: 'کهنه' }, manager);
  if (stale.status !== 409 || (stale.body as { code?: string }).code !== 'OCC_CONFLICT') wrong.push(`a stale version answered ${brief(stale)}, expected 409 OCC_CONFLICT`);
  const byManager = await h.put(url, { version: 2, technicalNotes: 'نکته مدیر' }, manager);
  if (byManager.status !== 200) wrong.push(`media.manage could not edit the card: ${brief(byManager)}`);
  const row = await itemRow(h, item.id);
  if (JSON.stringify(row.collections) !== JSON.stringify(['پاییز']) || Number(row.design_year) !== 1401 || row.technical_notes !== 'نکته مدیر') {
    wrong.push(`card after edits ${JSON.stringify(row)}`);
  }
  if (Number(row.version) !== 3) wrong.push(`item version ${row.version}, expected 3 (each edit advances it)`);
  const audit = await h.q(`SELECT action FROM activity_logs WHERE entity = 'کالا' AND entity_id = $1 AND action = 'UPDATE'`, [String(item.id)]);
  if (audit.length !== 2) wrong.push(`${audit.length} item audit rows, expected 2`);
  const detail = await h.get(`/api/media/products/${item.id}`, viewer);
  const card = (detail.body as { item?: { version?: number; collections?: string[] } }).item;
  if (detail.status !== 200 || card?.version !== 3) wrong.push(`the product page answered ${brief(detail)}`);
  return `viewer ${denied.status}; editor ${byEditor.status}; stale ${stale.status}; manager ${byManager.status}; audit ${audit.length}`;
}

function binary(res: request.Response, done: (err: Error | null, body: Buffer) => void): void {
  binaryParser(res as unknown as NodeJS.ReadableStream, done);
}

function withTempMediaDir(): void {
  process.env.MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-media-test-'));
}

async function noisyJpeg(width: number, height: number): Promise<Buffer> {
  const raw = crypto.randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

async function uploadImage(h: Harness, s: Session, itemId: number, shotType: string, body: Buffer): Promise<number> {
  const [section] = await h.q(`SELECT id FROM media_sections WHERE kind = 'products' AND is_deleted = 0`);
  const res = await request(h.app as Parameters<typeof request>[0])
    .post(`/api/media/assets?sectionId=${section.id}&itemId=${itemId}&shotType=${shotType}`)
    .set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken)
    .set('Content-Type', 'image/jpeg').set('X-File-Name', 'p.jpg').send(body);
  if (res.status !== 201) throw new Error(`upload answered ${brief(res)}`);
  return Number((res.body as { data: { id: number } }).data.id);
}

async function gridCase(h: Harness, wrong: string[]): Promise<string> {
  withTempMediaDir();
  const collection = `گرید ${digits(6)}`;
  const transfer = `G${digits(5)}`;
  const withImage = await createTestItem({ type: 'product', collections: [collection], designYear: 1399, transferCode: transfer });
  const without = await createTestItem({ type: 'product', collections: [collection.toUpperCase()], designYear: 1398 });
  const assetId = await uploadImage(h, h.admin, withImage.id, 'side', await noisyJpeg(1200, 1000));

  const byCollection = await h.get(`/api/media/products?collection=${encodeURIComponent(collection)}&limit=50`);
  const rows = (byCollection.body as { data?: Array<{ itemId: number; imageCount: number; coverAssetId: number | null }>; total?: number }).data ?? [];
  const ids = rows.map(r => r.itemId).sort((a, b) => a - b);
  if (JSON.stringify(ids) !== JSON.stringify([withImage.id, without.id].sort((a, b) => a - b))) wrong.push(`collection filter gave ${JSON.stringify(ids)}`);
  const imaged = rows.find(r => r.itemId === withImage.id);
  if (imaged?.imageCount !== 1 || imaged.coverAssetId !== assetId) wrong.push(`counts of the imaged product ${JSON.stringify(imaged)}`);

  const byYear = await h.get(`/api/media/products?collection=${encodeURIComponent(collection)}&designYear=1398`);
  const yearIds = ((byYear.body as { data?: Array<{ itemId: number }> }).data ?? []).map(r => r.itemId);
  if (JSON.stringify(yearIds) !== JSON.stringify([without.id])) wrong.push(`design year filter gave ${JSON.stringify(yearIds)}`);
  const byTransfer = await h.get(`/api/media/products?transferCode=${transfer.toLowerCase()}`);
  const transferIds = ((byTransfer.body as { data?: Array<{ itemId: number }> }).data ?? []).map(r => r.itemId);
  if (JSON.stringify(transferIds) !== JSON.stringify([withImage.id])) wrong.push(`transfer code filter gave ${JSON.stringify(transferIds)}`);
  const noImages = await h.get(`/api/media/products?collection=${encodeURIComponent(collection)}&withoutImages=1`);
  const noImageIds = ((noImages.body as { data?: Array<{ itemId: number }> }).data ?? []).map(r => r.itemId);
  if (JSON.stringify(noImageIds) !== JSON.stringify([without.id])) wrong.push(`without-images filter gave ${JSON.stringify(noImageIds)}`);
  const noWhite = await h.get(`/api/media/products?collection=${encodeURIComponent(collection)}&withoutWhiteBackground=1`);
  if (((noWhite.body as { total?: number }).total ?? 0) !== 2) wrong.push(`without-white-background filter gave ${brief(noWhite)}, expected both`);

  const filters = await h.get('/api/media/products/filters');
  const options = filters.body as { collections?: string[]; designYears?: number[]; transferCodes?: string[] };
  const sameName = (options.collections ?? []).filter(c => c.toLowerCase() === collection.toLowerCase());
  if (sameName.length !== 1) wrong.push(`filters list ${sameName.length} entries for one collection (letter case ignored)`);
  if (!options.designYears?.includes(1399) || !options.transferCodes?.includes(transfer)) wrong.push(`filters miss the year or transfer code: ${brief(filters)}`);

  const outsider = await h.sessionWith(['products.view']);
  const hidden = await h.get('/api/media/products', outsider);
  if (hidden.status !== 403) wrong.push(`a user without media.view read the grid: ${brief(hidden)}`);
  return `collection ${ids.length}; year ${yearIds.length}; transfer ${transferIds.length}; without images ${noImageIds.length}; outsider ${hidden.status}`;
}

async function zipCase(h: Harness, wrong: string[]): Promise<string> {
  withTempMediaDir();
  const item = await createTestItem({ type: 'product' });
  const a = await noisyJpeg(2400, 1600);
  const b = await noisyJpeg(1300, 1100);
  const idA = await uploadImage(h, h.admin, item.id, 'white_background', a);
  const idB = await uploadImage(h, h.admin, item.id, 'detail', b);
  const viewer = await h.sessionWith(['media.view']);

  const get = (url: string) => request(h.app as Parameters<typeof request>[0]).get(url)
    .set('Cookie', viewer.cookie).buffer(true).parse(binary);
  const original = await get(`/api/media/zip?ids=${idA},${idB}&variant=original`);
  if (original.status !== 200 || !String(original.headers['content-type']).includes('zip')) {
    wrong.push(`original zip answered ${original.status} ${original.headers['content-type']}`);
    return 'zip failed';
  }
  const entries = readZipEntries(original.body as Buffer);
  const contents = [...entries.values()];
  if (entries.size !== 2 || !contents.some(c => c.equals(a)) || !contents.some(c => c.equals(b))) {
    wrong.push(`the original zip has ${entries.size} entries, not the two originals byte for byte`);
  }
  if (![...entries.keys()].every(n => n.startsWith(item.code))) wrong.push(`entry names ${[...entries.keys()].join(', ')} do not start with the product code`);

  const light = await get(`/api/media/zip?ids=${idA}&variant=light`);
  const lightEntries = light.status === 200 ? readZipEntries(light.body as Buffer) : new Map<string, Buffer>();
  const [lightName, lightData] = [...lightEntries.entries()][0] ?? ['', Buffer.alloc(0)];
  if (!lightName.endsWith('.webp') || lightData.length === 0 || lightData.length >= a.length) {
    wrong.push(`light zip gave ${lightName} of ${lightData.length} bytes, expected a smaller webp`);
  }

  const unknown = await get(`/api/media/zip?ids=${idA},999999999`);
  const unknownBody = JSON.parse((unknown.body as Buffer).toString('utf8') || '{}') as { code?: string };
  if (unknown.status !== 422 || unknownBody.code !== 'MEDIA_ZIP_ASSETS_INVALID') wrong.push(`an unknown id answered ${unknown.status} ${unknownBody.code}`);
  const outsider = await h.sessionWith(['products.view']);
  const hidden = await request(h.app as Parameters<typeof request>[0]).get(`/api/media/zip?ids=${idA}`).set('Cookie', outsider.cookie);
  if (hidden.status !== 403) wrong.push(`a user without media.view downloaded a zip: ${hidden.status}`);
  return `original ${entries.size} entries; light ${lightName}; unknown ${unknown.status}; outsider ${hidden.status}`;
}
