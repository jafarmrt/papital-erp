import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import request from 'supertest';
import sharp from 'sharp';
import type { TestCaseResult } from '../types.js';
import type { Harness, Session, ShouldRun } from '../security/workflowTestHarness.js';
import { runReservationCases } from './stockReservationTests.js';
import { createTestItem } from '../fixtures/factories.js';

/**
 * Series 10, N-05 PR 1 (v10.0.16+): the media library infrastructure. Uploads go through the real Express route as a raw
 * body with a real session and CSRF token; files land in a temporary MEDIA_DIR.
 */
export async function runMediaLibraryTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_media_upload_original_and_light_n05',
      'v10.0.16: an uploaded image keeps its original byte for byte, gets a light version and a thumbnail, and downloads in each variant (N-05)',
      ['n05', 'media'], uploadCase],
    ['reg_media_size_and_quality_rules_n05',
      'v10.0.16: a file above 50 MB is refused before any row, a small image is stored with the low quality warning (N-05)',
      ['n05', 'media'], sizeRulesCase],
    ['reg_media_format_duplicate_and_section_n05',
      'v10.0.16: content that is not the declared type, a HEIC photo, a second copy of a file and a product file without an item are refused (N-05)',
      ['n05', 'media'], formatCase],
    ['reg_media_permissions_and_ownership_n05',
      'v10.0.16: viewing, uploading and changing files follow media.view / media.upload / media.manage, an uploader changes only own files, with audit rows (N-05)',
      ['n05', 'media', 'permissions'], permissionCase],
    ['reg_media_video_poster_and_range_n05',
      'v10.0.16: a video keeps only its original, takes a poster thumbnail from the browser and streams with byte ranges (N-05)',
      ['n05', 'media'], videoCase],
  ]);
}

const brief = (res: { status: number; body?: unknown }) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 200)}`;

/** A GET as the admin whose body can be read as bytes (the harness `get` already awaits the response) */
function rawGet(h: Harness, url: string): request.Test {
  return request(h.app as Parameters<typeof request>[0]).get(url).set('Cookie', h.admin.cookie);
}

function withTempMediaDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-media-test-'));
  process.env.MEDIA_DIR = dir;
  return dir;
}

/** A noisy JPEG (noise keeps it large) of the given size */
async function noisyJpeg(width: number, height: number, quality = 92): Promise<Buffer> {
  const raw = crypto.randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer();
}

function upload(h: Harness, s: Session, query: string, body: Buffer, type: string, name: string) {
  return request(h.app as Parameters<typeof request>[0]).post(`/api/media/assets?${query}`)
    .set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken)
    .set('Content-Type', type).set('X-File-Name', encodeURIComponent(name))
    .send(body);
}

async function productsSection(h: Harness): Promise<number> {
  const [row] = await h.q(`SELECT id FROM media_sections WHERE kind = 'products' AND is_deleted = 0`);
  if (!row) throw new Error('the products section of migration 0096 is missing');
  return Number(row.id);
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

async function uploadCase(h: Harness, wrong: string[]): Promise<string> {
  const dir = withTempMediaDir();
  const sectionId = await productsSection(h);
  const item = await createTestItem();
  const jpeg = await noisyJpeg(3000, 2000);
  const res = await upload(h, h.admin, `sectionId=${sectionId}&itemId=${item.id}&shotType=white_background`, jpeg, 'image/jpeg', 'گردنبند پشت سفید.jpg');
  const asset = (res.body as { data?: { id?: number; width?: number; height?: number; hasLight?: boolean; hasThumb?: boolean; warnings?: string[] } }).data;
  if (res.status !== 201 || !asset?.id) {
    wrong.push(`upload answered ${brief(res)}, expected 201`);
    return 'upload failed';
  }
  if (asset.width !== 3000 || asset.height !== 2000) wrong.push(`stored size ${asset.width}x${asset.height}, expected 3000x2000`);
  if (!asset.hasLight || !asset.hasThumb) wrong.push(`light ${asset.hasLight} thumb ${asset.hasThumb}, expected both`);
  if ((asset.warnings ?? []).length !== 0) wrong.push(`a 3000 px image of ${jpeg.length} bytes got warnings ${JSON.stringify(asset.warnings)}`);

  const digest = sha(jpeg);
  const onDisk = path.join(dir, 'originals', digest.slice(0, 2), `${digest}.jpg`);
  if (!fs.existsSync(onDisk) || sha(fs.readFileSync(onDisk)) !== digest) wrong.push('the original on disk is missing or differs from the upload');

  const original = await rawGet(h, `/api/media/assets/${asset.id}/file?variant=original&download=1`).buffer(true).parse(binary);
  if (original.status !== 200 || sha(original.body as Buffer) !== digest) wrong.push(`original download answered ${original.status} with other bytes`);
  if (!String(original.headers['content-disposition'] ?? '').startsWith('attachment;')) wrong.push(`original download disposition ${String(original.headers['content-disposition'])}`);
  if (!String(original.headers['content-disposition'] ?? '').includes(encodeURIComponent(item.code))) wrong.push('the download name does not start with the product code');

  const light = await rawGet(h, `/api/media/assets/${asset.id}/file?variant=light`).buffer(true).parse(binary);
  const lightMeta = light.status === 200 ? await sharp(light.body as Buffer).metadata() : null;
  if (!lightMeta || lightMeta.format !== 'webp' || Math.max(lightMeta.width ?? 0, lightMeta.height ?? 0) !== 1600) {
    wrong.push(`light version answered ${light.status} ${lightMeta?.format} ${lightMeta?.width}x${lightMeta?.height}, expected webp with a 1600 px long side`);
  }
  const thumb = await rawGet(h, `/api/media/assets/${asset.id}/file?variant=thumb`).buffer(true).parse(binary);
  const thumbMeta = thumb.status === 200 ? await sharp(thumb.body as Buffer).metadata() : null;
  if (!thumbMeta || Math.max(thumbMeta.width ?? 0, thumbMeta.height ?? 0) !== 400) wrong.push(`thumbnail answered ${thumb.status}, expected a 400 px long side`);

  const list = await h.get(`/api/media/assets?itemId=${item.id}`);
  if (list.status !== 200 || (list.body as { total?: number }).total !== 1) wrong.push(`list of the item answered ${brief(list)}, expected one file`);
  const audit = await h.q(`SELECT action FROM activity_logs WHERE entity = 'کتابخانه تصاویر' AND entity_id = $1`, [String(asset.id)]);
  if (!audit.some(r => r.action === 'CREATE')) wrong.push('the upload has no CREATE audit row');
  return `asset ${asset.id}: original ${jpeg.length} bytes, light ${lightMeta?.width}x${lightMeta?.height}, thumb ${thumbMeta?.width}x${thumbMeta?.height}`;
}

function binary(res: request.Response, done: (err: Error | null, body: Buffer) => void) {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  stream.on('end', () => done(null, Buffer.concat(chunks)));
}

async function sizeRulesCase(h: Harness, wrong: string[]): Promise<string> {
  withTempMediaDir();
  const sectionId = await productsSection(h);
  const item = await createTestItem();
  const before = await h.q('SELECT count(*)::int AS n FROM media_assets');

  const big = Buffer.alloc(50 * 1024 * 1024 + 1, 0xff);
  big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
  const tooBig = await upload(h, h.admin, `sectionId=${sectionId}&itemId=${item.id}`, big, 'image/jpeg', 'big.jpg');
  if (tooBig.status !== 422 || (tooBig.body as { code?: string }).code !== 'MEDIA_FILE_TOO_LARGE') wrong.push(`a 50 MB + 1 byte file answered ${brief(tooBig)}, expected 422 MEDIA_FILE_TOO_LARGE`);

  // a body larger than the limit without a usable declared length stops while streaming and leaves no file
  const { receiveToTemp } = await import('../../services/media/mediaStorage.js');
  let streamed = 'accepted';
  try {
    await receiveToTemp(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), 1000);
  } catch (err) {
    streamed = (err as { code?: string }).code ?? String(err);
  }
  if (streamed !== 'MEDIA_FILE_TOO_LARGE') wrong.push(`a streamed body over the limit ended as ${streamed}, expected MEDIA_FILE_TOO_LARGE`);
  const leftovers = fs.readdirSync(path.join(String(process.env.MEDIA_DIR), 'tmp'));
  if (leftovers.length > 0) wrong.push(`refused uploads left ${leftovers.length} temporary files`);

  const small = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  const low = await upload(h, h.admin, `sectionId=${sectionId}&itemId=${item.id}&shotType=detail`, small, 'image/jpeg', 'small.jpg');
  const lowBody = low.body as { data?: { id?: number; isLowQuality?: boolean }; warnings?: string[] };
  if (low.status !== 201 || !lowBody.warnings?.includes('low_quality') || lowBody.data?.isLowQuality !== true) {
    wrong.push(`a 640 px image of ${small.length} bytes answered ${brief(low)}, expected 201 with the low quality warning`);
  }
  const after = await h.q('SELECT count(*)::int AS n FROM media_assets');
  if (Number(after[0].n) - Number(before[0].n) !== 1) wrong.push(`rows grew by ${Number(after[0].n) - Number(before[0].n)}, expected 1 (the refused file wrote one)`);
  return `too big ${tooBig.status}; streamed ${streamed}; small ${low.status} warnings ${JSON.stringify(lowBody.warnings)}`;
}

async function formatCase(h: Harness, wrong: string[]): Promise<string> {
  withTempMediaDir();
  const sectionId = await productsSection(h);
  const item = await createTestItem();
  const html = await upload(h, h.admin, `sectionId=${sectionId}&itemId=${item.id}`, Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg', 'fake.jpg');
  if (html.status !== 422 || (html.body as { code?: string }).code !== 'MEDIA_FORMAT_INVALID') wrong.push(`an HTML body declared as JPEG answered ${brief(html)}, expected 422 MEDIA_FORMAT_INVALID`);
  const heic = await upload(h, h.admin, `sectionId=${sectionId}&itemId=${item.id}`, Buffer.from('xxxxftypheic0000'), 'image/heic', 'IMG_0001.HEIC');
  if (heic.status !== 422 || (heic.body as { code?: string }).code !== 'MEDIA_FORMAT_HEIC') wrong.push(`a HEIC photo answered ${brief(heic)}, expected 422 MEDIA_FORMAT_HEIC`);

  const jpeg = await noisyJpeg(1200, 1200);
  const first = await upload(h, h.admin, `sectionId=${sectionId}&itemId=${item.id}`, jpeg, 'image/jpeg', 'a.jpg');
  const second = await upload(h, h.admin, `sectionId=${sectionId}&itemId=${item.id}`, jpeg, 'image/jpeg', 'copy of a.jpg');
  if (first.status !== 201) wrong.push(`the first copy answered ${brief(first)}, expected 201`);
  if (second.status !== 409 || (second.body as { code?: string }).code !== 'MEDIA_DUPLICATE') wrong.push(`the second copy answered ${brief(second)}, expected 409 MEDIA_DUPLICATE`);

  const other = await noisyJpeg(1100, 1100);
  const noItem = await upload(h, h.admin, `sectionId=${sectionId}`, other, 'image/jpeg', 'b.jpg');
  if (noItem.status !== 422 || (noItem.body as { code?: string }).code !== 'MEDIA_ITEM_REQUIRED') wrong.push(`a product file without an item answered ${brief(noItem)}, expected 422 MEDIA_ITEM_REQUIRED`);
  const [custom] = await h.q(`INSERT INTO media_sections (kind, title) VALUES ('custom', $1) RETURNING id`, [`ERP-TEST-MARKER همکاران ${h.tag}`]);
  const withItem = await upload(h, h.admin, `sectionId=${custom.id}&itemId=${item.id}`, other, 'image/jpeg', 'c.jpg');
  if (withItem.status !== 422 || (withItem.body as { code?: string }).code !== 'MEDIA_ITEM_NOT_ALLOWED') wrong.push(`a file of another section with an item answered ${brief(withItem)}, expected 422 MEDIA_ITEM_NOT_ALLOWED`);
  const ok = await upload(h, h.admin, `sectionId=${custom.id}`, other, 'image/jpeg', 'c.jpg');
  if (ok.status !== 201) wrong.push(`a file of another section answered ${brief(ok)}, expected 201`);
  return `html ${html.status}; heic ${heic.status}; copies ${first.status}/${second.status}; no item ${noItem.status}; other section ${withItem.status}/${ok.status}`;
}

async function permissionCase(h: Harness, wrong: string[]): Promise<string> {
  withTempMediaDir();
  const sectionId = await productsSection(h);
  const item = await createTestItem();
  const outsider = await h.sessionWith(['products.view']);
  const viewer = await h.sessionWith(['media.view']);
  const uploaderA = await h.sessionWith(['media.view', 'media.upload']);
  const uploaderB = await h.sessionWith(['media.view', 'media.upload']);
  const manager = await h.sessionWith(['media.view', 'media.manage']);

  const hidden = await h.get('/api/media/assets', outsider);
  if (hidden.status !== 403) wrong.push(`a user without media.view listed files: ${brief(hidden)}`);
  const jpeg = await noisyJpeg(1200, 1000);
  const denied = await upload(h, viewer, `sectionId=${sectionId}&itemId=${item.id}`, jpeg, 'image/jpeg', 'v.jpg');
  if (denied.status !== 403) wrong.push(`a user with media.view only uploaded: ${brief(denied)}`);
  const mine = await upload(h, uploaderA, `sectionId=${sectionId}&itemId=${item.id}`, jpeg, 'image/jpeg', 'a.jpg');
  const id = Number((mine.body as { data?: { id?: number } }).data?.id);
  if (mine.status !== 201 || !id) {
    wrong.push(`uploader A answered ${brief(mine)}, expected 201`);
    return 'upload failed';
  }
  const seen = await h.get(`/api/media/assets/${id}`, viewer);
  if (seen.status !== 200) wrong.push(`media.view could not read the file: ${brief(seen)}`);

  const byOther = await h.put(`/api/media/assets/${id}`, { version: 1, title: 'B' }, uploaderB);
  if (byOther.status !== 403 || (byOther.body as { code?: string }).code !== 'MEDIA_NOT_OWN') wrong.push(`uploader B edited A's file: ${brief(byOther)}, expected 403 MEDIA_NOT_OWN`);
  const own = await h.put(`/api/media/assets/${id}`, { version: 1, title: 'عنوان A' }, uploaderA);
  if (own.status !== 200) wrong.push(`uploader A could not edit the own file: ${brief(own)}`);
  const stale = await h.put(`/api/media/assets/${id}`, { version: 1, title: 'کهنه' }, manager);
  if (stale.status !== 409) wrong.push(`an edit at a stale version answered ${brief(stale)}, expected 409`);
  const managed = await h.put(`/api/media/assets/${id}`, { version: 2, description: 'توضیح مدیر' }, manager);
  if (managed.status !== 200) wrong.push(`media.manage could not edit another user's file: ${brief(managed)}`);
  const unknownKey = await h.put(`/api/media/assets/${id}`, { version: 3, sha256: 'x' }, manager);
  if (unknownKey.status !== 400) wrong.push(`an edit with an unknown key answered ${brief(unknownKey)}, expected 400`);
  const rebuildDenied = await h.post(`/api/media/assets/${id}/rebuild-light`, {}, uploaderA);
  if (rebuildDenied.status !== 403) wrong.push(`media.upload rebuilt a light version: ${brief(rebuildDenied)}`);

  const delOther = await h.del(`/api/media/assets/${id}`, uploaderB);
  if (delOther.status !== 403) wrong.push(`uploader B deleted A's file: ${brief(delOther)}`);
  const del = await h.del(`/api/media/assets/${id}`, uploaderA);
  if (del.status !== 200) wrong.push(`uploader A could not delete the own file: ${brief(del)}`);
  const gone = await h.get(`/api/media/assets/${id}`, viewer);
  if (gone.status !== 404) wrong.push(`a deleted file still reads: ${brief(gone)}`);
  const audit = await h.q(`SELECT action FROM activity_logs WHERE entity = 'کتابخانه تصاویر' AND entity_id = $1 ORDER BY id`, [String(id)]);
  const actions = audit.map(r => String(r.action)).join(',');
  if (actions !== 'CREATE,UPDATE,UPDATE,DELETE') wrong.push(`audit actions ${actions}, expected CREATE,UPDATE,UPDATE,DELETE`);
  return `outsider ${hidden.status}; viewer upload ${denied.status}; B edit ${byOther.status}; stale ${stale.status}; audit ${actions}`;
}

/** The first bytes of an MP4 file: an ftyp box with the isom brand, then filler */
function fakeMp4(bytes: number): Buffer {
  const buf = Buffer.alloc(bytes, 0x11);
  buf.writeUInt32BE(24, 0);
  buf.write('ftypisom', 4, 'latin1');
  return buf;
}

async function videoCase(h: Harness, wrong: string[]): Promise<string> {
  withTempMediaDir();
  const sectionId = await productsSection(h);
  const item = await createTestItem();
  const mp4 = fakeMp4(300_000);
  const res = await upload(h, h.admin, `sectionId=${sectionId}&itemId=${item.id}&shotType=detail`, mp4, 'video/mp4', 'sample.mp4');
  const asset = (res.body as { data?: { id?: number; kind?: string; shotType?: string; hasLight?: boolean; hasThumb?: boolean } }).data;
  if (res.status !== 201 || !asset?.id) {
    wrong.push(`video upload answered ${brief(res)}, expected 201`);
    return 'upload failed';
  }
  if (asset.kind !== 'video' || asset.shotType !== 'video' || asset.hasLight || asset.hasThumb) {
    wrong.push(`video stored as ${asset.kind}/${asset.shotType} light ${asset.hasLight} thumb ${asset.hasThumb}, expected video/video without light or thumb`);
  }
  const light = await h.get(`/api/media/assets/${asset.id}/file?variant=light`);
  if (light.status !== 404) wrong.push(`the light version of a video answered ${light.status}, expected 404`);

  const poster = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#336699' } }).jpeg().toBuffer();
  const setPoster = await request(h.app as Parameters<typeof request>[0]).put(`/api/media/assets/${asset.id}/poster?durationSeconds=12.5`)
    .set('Cookie', h.admin.cookie).set('x-csrf-token', h.admin.csrfToken).set('Content-Type', 'image/jpeg').send(poster);
  const posterBody = setPoster.body as { data?: { hasThumb?: boolean; durationSeconds?: number } };
  if (setPoster.status !== 200 || !posterBody.data?.hasThumb || Number(posterBody.data?.durationSeconds) !== 12.5) {
    wrong.push(`the poster answered ${brief(setPoster)}, expected 200 with a thumbnail and 12.5 seconds`);
  }

  const range = await rawGet(h, `/api/media/assets/${asset.id}/file?variant=original`).set('Range', 'bytes=0-99').buffer(true).parse(binary);
  if (range.status !== 206 || (range.body as Buffer).length !== 100 || !(range.body as Buffer).equals(mp4.subarray(0, 100))) {
    wrong.push(`a range request answered ${range.status} with ${(range.body as Buffer).length} bytes, expected 206 with the first 100`);
  }
  return `video ${asset.id}; poster ${setPoster.status}; range ${range.status}`;
}
