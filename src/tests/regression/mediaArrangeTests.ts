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

/**
 * Series 10, N-05 PR 3 (v10.0.27+): the other sections of the media library, file tags, the order and cover of a
 * product's files, replacing a file's content and using a library image as the item's picture.
 */
export async function runMediaArrangeTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_media_sections_n05',
      'v10.0.27: media.manage creates, renames, reorders and deletes sections; the products section is fixed, a title is unique and a section with files is kept (N-05)',
      ['n05', 'media', 'permissions'], sectionsCase],
    ['reg_media_tags_n05',
      'v10.0.27: file tags are normalized and capped, filter and search the list and are listed per section (N-05)',
      ['n05', 'media'], tagsCase],
    ['reg_media_order_cover_n05',
      'v10.0.27: a product files order is set as a whole and one image is its cover; a video or a non-product file is never a cover (N-05)',
      ['n05', 'media', 'permissions'], orderCoverCase],
    ['reg_media_replace_n05',
      'v10.0.27: replacing a file keeps its card, order and cover, keeps the old original on disk and refuses the same content, a duplicate or another kind (N-05)',
      ['n05', 'media', 'permissions'], replaceCase],
    ['reg_media_item_image_n05',
      'v10.0.27: a product image becomes the item picture at the item version, with copied files and an item audit row (N-05)',
      ['n05', 'media', 'items', 'permissions'], itemImageCase],
  ]);
}

const brief = (res: { status: number; body?: unknown }) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 200)}`;
const codeOf = (res: { body?: unknown }) => (res.body as { code?: string } | undefined)?.code;
const digits = (n: number) => String(crypto.randomInt(10 ** (n - 1), 10 ** n));
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

type AssetBody = { id: number; isCover: boolean; tags: string[]; sortOrder: number; title: string; version: number };

function withTempMediaDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-media-test-'));
  process.env.MEDIA_DIR = dir;
  return dir;
}

async function noisyJpeg(width: number, height: number): Promise<Buffer> {
  const raw = crypto.randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

function fakeMp4(bytes: number): Buffer {
  const buf = Buffer.alloc(bytes, crypto.randomInt(1, 250));
  buf.writeUInt32BE(24, 0);
  buf.write('ftypisom', 4, 'latin1');
  buf.writeUInt32BE(crypto.randomInt(1, 2 ** 31), 40);
  return buf;
}

function send(h: Harness, s: Session, method: 'post' | 'put', url: string, body: Buffer, type: string, name: string) {
  return request(h.app as Parameters<typeof request>[0])[method](url)
    .set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken)
    .set('Content-Type', type).set('X-File-Name', encodeURIComponent(name))
    .send(body);
}

async function sectionId(h: Harness, kind = 'products'): Promise<number> {
  const [row] = await h.q(`SELECT id FROM media_sections WHERE kind = $1 AND is_deleted = 0 ORDER BY id LIMIT 1`, [kind]);
  return Number(row.id);
}

async function uploadTo(h: Harness, s: Session, query: string, body: Buffer, type = 'image/jpeg', name = 'p.jpg'): Promise<AssetBody> {
  const res = await send(h, s, 'post', `/api/media/assets?${query}`, body, type, name);
  if (res.status !== 201) throw new Error(`upload answered ${brief(res)}`);
  return (res.body as { data: AssetBody }).data;
}

async function liveSectionIds(h: Harness): Promise<number[]> {
  const rows = await h.q(`SELECT id FROM media_sections WHERE is_deleted = 0 ORDER BY sort_order, id`);
  return rows.map(r => Number(r.id));
}

async function sectionsCase(h: Harness, wrong: string[]): Promise<string> {
  withTempMediaDir();
  const uploader = await h.sessionWith(['media.view', 'media.upload']);
  const manager = await h.sessionWith(['media.view', 'media.upload', 'media.manage']);
  const title = `همکاران ${digits(6)}`;

  const denied = await h.post('/api/media/sections', { title }, uploader);
  if (denied.status !== 403) wrong.push(`media.upload created a section: ${brief(denied)}`);
  const created = await h.post('/api/media/sections', { title: `  ${title} `, description: 'عکس‌های تیم' }, manager);
  const section = (created.body as { data?: { id: number; kind: string; title: string; version: number; sortOrder: number } }).data;
  if (created.status !== 201 || !section || section.kind !== 'custom' || section.title !== title) {
    wrong.push(`create answered ${brief(created)}`);
    return 'create failed';
  }
  const others = await h.q(`SELECT max(sort_order) AS m FROM media_sections WHERE is_deleted = 0 AND id <> $1`, [section.id]);
  if (section.sortOrder <= Number(others[0].m)) wrong.push(`new section order ${section.sortOrder}, expected after every other section`);

  const twin = await h.post('/api/media/sections', { title: title.toUpperCase() + ' ' }, manager);
  if (twin.status !== 409 || codeOf(twin) !== 'MEDIA_SECTION_TITLE_TAKEN') wrong.push(`a repeated title answered ${brief(twin)}, expected 409 MEDIA_SECTION_TITLE_TAKEN`);

  const renamed = await h.put(`/api/media/sections/${section.id}`, { version: section.version, title: `${title} تازه` }, manager);
  if (renamed.status !== 200) wrong.push(`rename answered ${brief(renamed)}`);
  const stale = await h.put(`/api/media/sections/${section.id}`, { version: section.version, title: `${title} کهنه` }, manager);
  if (stale.status !== 409 || codeOf(stale) !== 'OCC_CONFLICT') wrong.push(`a stale rename answered ${brief(stale)}, expected 409 OCC_CONFLICT`);
  const products = await sectionId(h);
  const [productsRow] = await h.q(`SELECT version FROM media_sections WHERE id = $1`, [products]);
  const fixed = await h.put(`/api/media/sections/${products}`, { version: Number(productsRow.version), title: 'محصولات دیگر' }, manager);
  if (fixed.status !== 409 || codeOf(fixed) !== 'MEDIA_SECTION_SYSTEM') wrong.push(`renaming the products section answered ${brief(fixed)}`);
  const fixedDelete = await h.del(`/api/media/sections/${products}`, manager);
  if (fixedDelete.status !== 409 || codeOf(fixedDelete) !== 'MEDIA_SECTION_SYSTEM') wrong.push(`deleting the products section answered ${brief(fixedDelete)}`);

  const ids = await liveSectionIds(h);
  const partial = await h.put('/api/media/sections/order', { ids: ids.slice(1) }, manager);
  if (partial.status !== 422 || codeOf(partial) !== 'MEDIA_ORDER_INVALID') wrong.push(`an incomplete order answered ${brief(partial)}, expected 422 MEDIA_ORDER_INVALID`);
  const reversed = [...ids].reverse();
  const ordered = await h.put('/api/media/sections/order', { ids: reversed }, manager);
  if (ordered.status !== 200 || JSON.stringify(await liveSectionIds(h)) !== JSON.stringify(reversed)) wrong.push(`reorder answered ${brief(ordered)} or did not stick`);

  const file = await uploadTo(h, uploader, `sectionId=${section.id}`, await noisyJpeg(900, 700));
  const full = await h.del(`/api/media/sections/${section.id}`, manager);
  if (full.status !== 409 || codeOf(full) !== 'MEDIA_SECTION_NOT_EMPTY') wrong.push(`deleting a section with a file answered ${brief(full)}`);
  const removedFile = await h.del(`/api/media/assets/${file.id}`, uploader);
  if (removedFile.status !== 200) wrong.push(`the uploader could not delete own file: ${brief(removedFile)}`);
  const removed = await h.del(`/api/media/sections/${section.id}`, manager);
  if (removed.status !== 200) wrong.push(`deleting the empty section answered ${brief(removed)}`);
  const listed = await h.get('/api/media/sections', uploader);
  if (((listed.body as { data?: Array<{ id: number }> }).data ?? []).some(s => s.id === section.id)) wrong.push('the deleted section is still listed');
  // a deleted title is free again
  const again = await h.post('/api/media/sections', { title }, manager);
  if (again.status !== 201) wrong.push(`the title of a deleted section could not be used again: ${brief(again)}`);
  else await h.del(`/api/media/sections/${(again.body as { data: { id: number } }).data.id}`, manager);

  const audit = await h.q(`SELECT action FROM activity_logs WHERE entity = 'کتابخانه تصاویر' AND entity_id = $1 AND 'custom' IN (details->'after'->>'kind', details->'before'->>'kind')`, [String(section.id)]);
  const actions = audit.map(r => String(r.action)).sort().join(',');
  if (actions !== 'CREATE,DELETE,UPDATE') wrong.push(`section audit rows ${actions}, expected CREATE,DELETE,UPDATE`);
  return `create ${created.status}; twin ${twin.status}; rename ${renamed.status}; order ${ordered.status}; full ${full.status}; removed ${removed.status}`;
}

async function tagsCase(h: Harness, wrong: string[]): Promise<string> {
  withTempMediaDir();
  const manager = await h.sessionWith(['media.view', 'media.upload', 'media.manage']);
  const title = `بازاریابی ${digits(6)}`;
  const created = await h.post('/api/media/sections', { title }, manager);
  const section = (created.body as { data: { id: number } }).data;
  const a = await uploadTo(h, manager, `sectionId=${section.id}`, await noisyJpeg(900, 700));
  const b = await uploadTo(h, manager, `sectionId=${section.id}`, await noisyJpeg(900, 700));
  const tag = `نوروز${digits(4)}`;

  const tagged = await h.put(`/api/media/assets/${a.id}`, { version: a.version, tags: [` #${tag} `, tag.toUpperCase(), 'اینستاگرام  پست', ''] }, manager);
  const tags = (tagged.body as { data?: AssetBody }).data?.tags;
  if (tagged.status !== 200 || JSON.stringify(tags) !== JSON.stringify([tag, 'اینستاگرام پست'])) wrong.push(`tags saved as ${brief(tagged)}`);
  const many = Array.from({ length: 21 }, (_, i) => `t${i}`);
  const tooMany = await h.put(`/api/media/assets/${b.id}`, { version: b.version, tags: many }, manager);
  if (tooMany.status !== 422 || codeOf(tooMany) !== 'MEDIA_TAGS_INVALID') wrong.push(`21 tags answered ${brief(tooMany)}, expected 422 MEDIA_TAGS_INVALID`);
  const tooLong = await h.put(`/api/media/assets/${b.id}`, { version: b.version, tags: ['x'.repeat(41)] }, manager);
  if (tooLong.status !== 422 || codeOf(tooLong) !== 'MEDIA_TAGS_INVALID') wrong.push(`a 41-letter tag answered ${brief(tooLong)}`);

  const byTag = await h.get(`/api/media/assets?sectionId=${section.id}&tag=${encodeURIComponent(tag)}`, manager);
  const byTagIds = ((byTag.body as { data?: Array<{ id: number }> }).data ?? []).map(r => r.id);
  if (JSON.stringify(byTagIds) !== JSON.stringify([a.id])) wrong.push(`tag filter gave ${JSON.stringify(byTagIds)}`);
  const bySearch = await h.get(`/api/media/assets?sectionId=${section.id}&search=${encodeURIComponent('اینستاگرام')}`, manager);
  const bySearchIds = ((bySearch.body as { data?: Array<{ id: number }> }).data ?? []).map(r => r.id);
  if (JSON.stringify(bySearchIds) !== JSON.stringify([a.id])) wrong.push(`search by tag gave ${JSON.stringify(bySearchIds)}`);
  const listed = await h.get(`/api/media/tags?sectionId=${section.id}`, manager);
  const tagList = (listed.body as { data?: string[] }).data ?? [];
  if (listed.status !== 200 || !tagList.includes(tag) || !tagList.includes('اینستاگرام پست') || tagList.length !== 2) wrong.push(`tag list ${brief(listed)}`);
  const [row] = await h.q(`SELECT tags FROM media_assets WHERE id = $1`, [a.id]);
  if (JSON.stringify(row.tags) !== JSON.stringify([tag, 'اینستاگرام پست'])) wrong.push(`stored tags ${JSON.stringify(row.tags)}`);
  return `tags ${JSON.stringify(tags)}; too many ${tooMany.status}; filter ${byTagIds.length}; search ${bySearchIds.length}; list ${tagList.length}`;
}

async function productCover(h: Harness, item: { id: number; code: string }): Promise<number | null | undefined> {
  const res = await h.get(`/api/media/products?search=${encodeURIComponent(item.code)}&limit=50`);
  const rows = (res.body as { data?: Array<{ itemId: number; coverAssetId: number | null }> }).data ?? [];
  return rows.find(r => r.itemId === item.id)?.coverAssetId;
}

async function orderCoverCase(h: Harness, wrong: string[]): Promise<string> {
  withTempMediaDir();
  const products = await sectionId(h);
  const item = await createTestItem({ type: 'product' });
  const uploader = await h.sessionWith(['media.view', 'media.upload']);
  const manager = await h.sessionWith(['media.view', 'media.upload', 'media.manage']);
  const scope = `sectionId=${products}&itemId=${item.id}`;
  const first = await uploadTo(h, manager, `${scope}&shotType=white_background`, await noisyJpeg(900, 700));
  const second = await uploadTo(h, manager, `${scope}&shotType=side`, await noisyJpeg(900, 700));
  const video = await uploadTo(h, manager, `${scope}&shotType=detail`, fakeMp4(250_000), 'video/mp4', 'v.mp4');

  const wrongIds = await h.put('/api/media/assets/order', { sectionId: products, itemId: item.id, ids: [second.id, first.id] }, manager);
  if (wrongIds.status !== 422 || codeOf(wrongIds) !== 'MEDIA_ORDER_INVALID') wrong.push(`an order missing a file answered ${brief(wrongIds)}`);
  const noItem = await h.put('/api/media/assets/order', { sectionId: products, ids: [video.id, second.id, first.id] }, manager);
  if (noItem.status !== 422) wrong.push(`a products order without an item answered ${brief(noItem)}, expected 422`);
  const byUploader = await h.put('/api/media/assets/order', { sectionId: products, itemId: item.id, ids: [video.id, second.id, first.id] }, uploader);
  if (byUploader.status !== 403) wrong.push(`media.upload reordered files: ${brief(byUploader)}`);
  const ordered = await h.put('/api/media/assets/order', { sectionId: products, itemId: item.id, ids: [video.id, second.id, first.id] }, manager);
  const orderedIds = ((ordered.body as { data?: AssetBody[] }).data ?? []).map(a => a.id);
  if (ordered.status !== 200 || JSON.stringify(orderedIds) !== JSON.stringify([video.id, second.id, first.id])) wrong.push(`reorder answered ${brief(ordered)}`);
  const listed = await h.get(`/api/media/assets?itemId=${item.id}`, uploader);
  const listedIds = ((listed.body as { data?: Array<{ id: number }> }).data ?? []).map(a => a.id);
  if (JSON.stringify(listedIds) !== JSON.stringify([video.id, second.id, first.id])) wrong.push(`the list after reorder is ${JSON.stringify(listedIds)}`);

  const byUploaderCover = await h.put(`/api/media/assets/${second.id}/cover`, { cover: true }, uploader);
  if (byUploaderCover.status !== 403) wrong.push(`media.upload set a cover: ${brief(byUploaderCover)}`);
  const coverSecond = await h.put(`/api/media/assets/${second.id}/cover`, { cover: true }, manager);
  if (coverSecond.status !== 200) wrong.push(`setting a cover answered ${brief(coverSecond)}`);
  if (await productCover(h, item) !== second.id) wrong.push('the grid cover does not follow the chosen cover');
  const coverFirst = await h.put(`/api/media/assets/${first.id}/cover`, { cover: true }, manager);
  const covers = ((coverFirst.body as { data?: AssetBody[] }).data ?? []).filter(a => a.isCover).map(a => a.id);
  if (JSON.stringify(covers) !== JSON.stringify([first.id])) wrong.push(`covers after moving it ${JSON.stringify(covers)}, expected only the first image`);
  const videoCover = await h.put(`/api/media/assets/${video.id}/cover`, { cover: true }, manager);
  if (videoCover.status !== 422 || codeOf(videoCover) !== 'MEDIA_COVER_INVALID') wrong.push(`a video cover answered ${brief(videoCover)}`);
  const custom = await h.post('/api/media/sections', { title: `جلد ${digits(6)}` }, manager);
  const customId = (custom.body as { data: { id: number } }).data.id;
  const loose = await uploadTo(h, manager, `sectionId=${customId}`, await noisyJpeg(900, 700));
  const looseCover = await h.put(`/api/media/assets/${loose.id}/cover`, { cover: true }, manager);
  if (looseCover.status !== 422 || codeOf(looseCover) !== 'MEDIA_COVER_INVALID') wrong.push(`a cover outside products answered ${brief(looseCover)}`);
  const cleared = await h.put(`/api/media/assets/${first.id}/cover`, { cover: false }, manager);
  const [count] = await h.q(`SELECT count(*)::int AS n FROM media_assets WHERE item_id = $1 AND is_cover = 1 AND is_deleted = 0`, [item.id]);
  if (cleared.status !== 200 || Number(count.n) !== 0) wrong.push(`clearing the cover answered ${brief(cleared)} and left ${count.n} covers`);
  return `order ${ordered.status}; cover ${coverSecond.status}/${coverFirst.status}; video ${videoCover.status}; loose ${looseCover.status}; cleared ${cleared.status}`;
}

async function replaceCase(h: Harness, wrong: string[]): Promise<string> {
  const dir = withTempMediaDir();
  const products = await sectionId(h);
  const item = await createTestItem({ type: 'product' });
  const owner = await h.sessionWith(['media.view', 'media.upload']);
  const other = await h.sessionWith(['media.view', 'media.upload']);
  const manager = await h.sessionWith(['media.view', 'media.upload', 'media.manage']);
  const scope = `sectionId=${products}&itemId=${item.id}`;
  const oldJpeg = await noisyJpeg(900, 700);
  const asset = await uploadTo(h, owner, `${scope}&shotType=side`, oldJpeg);
  const neighbour = await uploadTo(h, owner, `${scope}&shotType=detail`, await noisyJpeg(900, 700));
  const neighbourBytes = await h.q(`SELECT sha256 FROM media_assets WHERE id = $1`, [neighbour.id]);
  const titled = await h.put(`/api/media/assets/${asset.id}`, { version: asset.version, title: 'نمای کنار', tags: ['ویترین'] }, owner);
  if (titled.status !== 200) wrong.push(`card edit answered ${brief(titled)}`);
  await h.put('/api/media/assets/order', { sectionId: products, itemId: item.id, ids: [neighbour.id, asset.id] }, manager);
  await h.put(`/api/media/assets/${asset.id}/cover`, { cover: true }, manager);

  const url = `/api/media/assets/${asset.id}/content`;
  const byOther = await send(h, other, 'put', url, await noisyJpeg(900, 700), 'image/jpeg', 'x.jpg');
  if (byOther.status !== 403) wrong.push(`another uploader replaced the file: ${brief(byOther)}`);
  const same = await send(h, owner, 'put', url, oldJpeg, 'image/jpeg', 'same.jpg');
  if (same.status !== 409 || codeOf(same) !== 'MEDIA_REPLACE_SAME') wrong.push(`the same content answered ${brief(same)}`);
  const neighbourFile = fs.readFileSync(path.join(dir, 'originals', String(neighbourBytes[0].sha256).slice(0, 2), `${neighbourBytes[0].sha256}.jpg`));
  const duplicate = await send(h, owner, 'put', url, neighbourFile, 'image/jpeg', 'dup.jpg');
  if (duplicate.status !== 409 || codeOf(duplicate) !== 'MEDIA_DUPLICATE') wrong.push(`another file's content answered ${brief(duplicate)}`);
  const video = await send(h, owner, 'put', url, fakeMp4(250_000), 'video/mp4', 'v.mp4');
  if (video.status !== 422 || codeOf(video) !== 'MEDIA_REPLACE_KIND') wrong.push(`a video for an image answered ${brief(video)}`);

  const newJpeg = await noisyJpeg(1400, 1000);
  const replaced = await send(h, owner, 'put', url, newJpeg, 'image/jpeg', 'بهتر.jpg');
  const after = (replaced.body as { data?: AssetBody & { width: number; hasLight: boolean; hasThumb: boolean; originalName: string } }).data;
  if (replaced.status !== 200 || !after) {
    wrong.push(`replace answered ${brief(replaced)}`);
    return 'replace failed';
  }
  if (after.title !== 'نمای کنار' || JSON.stringify(after.tags) !== JSON.stringify(['ویترین']) || !after.isCover || after.sortOrder !== 2) {
    wrong.push(`the card after replace ${JSON.stringify({ title: after.title, tags: after.tags, isCover: after.isCover, sortOrder: after.sortOrder })}`);
  }
  if (after.width !== 1400 || !after.hasLight || !after.hasThumb || after.originalName !== 'بهتر.jpg') wrong.push(`the new file facts ${JSON.stringify(after).slice(0, 200)}`);
  const [row] = await h.q(`SELECT sha256 FROM media_assets WHERE id = $1`, [asset.id]);
  if (row.sha256 !== sha(newJpeg)) wrong.push('the stored sha256 is not the new content');
  const oldDigest = sha(oldJpeg);
  if (!fs.existsSync(path.join(dir, 'originals', oldDigest.slice(0, 2), `${oldDigest}.jpg`))) wrong.push('the old original was removed from disk');
  const audit = await h.q(`SELECT details FROM activity_logs WHERE entity = 'کتابخانه تصاویر' AND entity_id = $1 AND action = 'UPDATE' ORDER BY id DESC LIMIT 1`, [String(asset.id)]);
  const details = audit[0]?.details as { operation?: string; before?: { sha256?: string }; after?: { sha256?: string } } | undefined;
  if (details?.operation !== 'replace' || details.before?.sha256 !== oldDigest || details.after?.sha256 !== sha(newJpeg)) wrong.push(`replace audit ${JSON.stringify(details).slice(0, 200)}`);
  const byManager = await send(h, manager, 'put', url, await noisyJpeg(1000, 800), 'image/jpeg', 'm.jpg');
  if (byManager.status !== 200) wrong.push(`media.manage could not replace another user's file: ${brief(byManager)}`);
  return `other ${byOther.status}; same ${same.status}; duplicate ${duplicate.status}; video ${video.status}; replaced ${replaced.status}; manager ${byManager.status}`;
}

async function itemImageCase(h: Harness, wrong: string[]): Promise<string> {
  withTempMediaDir();
  const products = await sectionId(h);
  const item = await createTestItem({ type: 'product' });
  const viewer = await h.sessionWith(['media.view']);
  const editor = await h.sessionWith(['media.view', 'products.view', 'products.edit']);
  const asset = await uploadTo(h, h.admin, `sectionId=${products}&itemId=${item.id}&shotType=white_background`, await noisyJpeg(2000, 1500));
  const [before] = await h.q(`SELECT version FROM items WHERE id = $1`, [item.id]);
  const version = Number(before.version);
  const url = `/api/media/assets/${asset.id}/item-image`;

  const denied = await h.post(url, { version }, viewer);
  if (denied.status !== 403) wrong.push(`media.view alone set the item picture: ${brief(denied)}`);
  const stale = await h.post(url, { version: version + 5 }, editor);
  if (stale.status !== 409 || codeOf(stale) !== 'OCC_CONFLICT') wrong.push(`a stale item version answered ${brief(stale)}`);
  const done = await h.post(url, { version }, editor);
  const data = (done.body as { data?: { image: string; thumbnail: string; version: number } }).data;
  if (done.status !== 200 || !data) {
    wrong.push(`item picture answered ${brief(done)}`);
    return 'item image failed';
  }
  const [row] = await h.q(`SELECT image, thumbnail, version FROM items WHERE id = $1`, [item.id]);
  if (row.image !== data.image || row.thumbnail !== data.thumbnail || Number(row.version) !== version + 1 || data.version !== version + 1) {
    wrong.push(`item after the picture ${JSON.stringify(row)} answer ${JSON.stringify(data)}`);
  }
  const { getImageUploadsDir } = await import('../../lib/storage.js');
  for (const ref of [String(row.image), String(row.thumbnail)]) {
    const file = path.join(getImageUploadsDir(), path.basename(ref));
    if (!ref.startsWith('/uploads/') || !fs.existsSync(file)) wrong.push(`picture ${ref} has no file`);
    else {
      const meta = await sharp(fs.readFileSync(file)).metadata();
      if (meta.format !== 'webp') wrong.push(`picture ${ref} is ${meta.format}, expected webp`);
    }
  }
  const audit = await h.q(`SELECT action FROM activity_logs WHERE entity = 'کالا' AND entity_id = $1 AND action = 'UPDATE'`, [String(item.id)]);
  if (audit.length !== 1) wrong.push(`${audit.length} item audit rows, expected 1`);
  const video = await uploadTo(h, h.admin, `sectionId=${products}&itemId=${item.id}&shotType=detail`, fakeMp4(250_000), 'video/mp4', 'v.mp4');
  const fromVideo = await h.post(`/api/media/assets/${video.id}/item-image`, { version: version + 1 }, editor);
  if (fromVideo.status !== 422 || codeOf(fromVideo) !== 'MEDIA_ITEM_IMAGE_INVALID') wrong.push(`a video as item picture answered ${brief(fromVideo)}`);
  return `viewer ${denied.status}; stale ${stale.status}; done ${done.status}; video ${fromVideo.status}; audit ${audit.length}`;
}
