import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import sharp from 'sharp';
import type { TestCaseResult } from '../types.js';
import type { Harness, Session, ShouldRun } from '../security/workflowTestHarness.js';
import { runReservationCases } from './stockReservationTests.js';
import { createTestCustomer } from '../fixtures/factories.js';
import { CRM_TEMP_PART_MAX_AGE_MS, sweepStaleUploadParts } from '../../services/crm/crmAttachments.service.js';

/**
 * v10.2 package 7 (N-02 §3.3, CRM plan decisions ت۶ / ت۷ / ت۸): image and PDF attachments of a sales file and of an
 * activity. Uploads go through the real route as a raw body with a session and CSRF token into a temporary
 * ATTACHMENTS_DIR. Also the activity list of package 7 (OBS-R2-24 / OBS-R2-28): paged on the server, by party and search,
 * and one activity by id. All red on v10.2.3, which had no attachment route, no `crm_lead` / `crm_activity` attachment
 * type, no light version and an activity list without paging or party.
 */
export async function runCrmAttachmentsTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const previousDir = process.env.ATTACHMENTS_DIR;
  try {
    return await runCases(shouldRun);
  } finally {
    // the temporary attachment folders go away and the suite after this one sees the folder it had
    if (previousDir === undefined) delete process.env.ATTACHMENTS_DIR;
    else process.env.ATTACHMENTS_DIR = previousDir;
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runCases(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_crm_attachment_upload_light_n02',
      'v10.2.5: an image attached to a sales file keeps its original and gets a light WEBP, a PDF on an activity has none, both listed and audited (N-02)',
      ['n02', 'crm', 'attachments'], uploadCase],
    ['reg_crm_attachment_rules_n02',
      'v10.2.5: a type other than JPG, PNG, WEBP or PDF, content unlike its type, a file above 10 MB and an eleventh file are refused (N-02)',
      ['n02', 'crm', 'attachments'], rulesCase],
    ['reg_crm_attachment_permissions_n02',
      'v10.2.5: reading and downloading attachments need crm.view, adding and removing crm.manage; a removal is audited (N-02)',
      ['n02', 'crm', 'attachments', 'permissions'], permissionCase],
    ['reg_crm_activities_paged_party_obs_r2_28',
      'v10.2.5: the activity list pages on the server by party (its own and its files\' activities) and search, and one activity reads by id (OBS-R2-24 / OBS-R2-28)',
      ['n02', 'crm', 'obs-r2-28'], activityListCase],
    ['reg_customer_record_by_id_obs_r2_24',
      'v10.2.5: one party\'s full record (version, notes, tags) reads by id for customers.view, and a deleted or missing party is 404 (OBS-R2-24)',
      ['crm', 'customers', 'obs-r2-24'], customerByIdCase],
    ['reg_crm_attachment_download_rules_n02',
      'v10.2.5: a download name takes the stored type\'s extension, an extra query key is ignored, a deleted file\'s attachments no longer download and stale partial uploads are swept (N-02 review)',
      ['n02', 'crm', 'attachments'], downloadRulesCase],
  ]);
}

const brief = (res: { status: number; body?: unknown }) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 200)}`;
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

const tempDirs: string[] = [];

function withTempAttachmentsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-crm-attach-test-'));
  tempDirs.push(dir);
  process.env.ATTACHMENTS_DIR = dir;
  return dir;
}

async function noisyJpeg(width: number, height: number): Promise<Buffer> {
  const raw = crypto.randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

function upload(h: Harness, s: Session, url: string, body: Buffer, type: string, name: string) {
  return request(h.app as Parameters<typeof request>[0]).post(`/api${url}`)
    .set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken)
    .set('Content-Type', type).set('X-File-Name', encodeURIComponent(name))
    .send(body);
}

function rawGet(h: Harness, url: string, s: Session = h.admin): request.Test {
  return request(h.app as Parameters<typeof request>[0]).get(url).set('Cookie', s.cookie);
}

function binary(res: request.Response, done: (err: Error | null, body: Buffer) => void) {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  stream.on('end', () => done(null, Buffer.concat(chunks)));
}

async function newLead(h: Harness, label: string, extra: Record<string, unknown> = {}): Promise<number> {
  const res = await h.post('/api/crm/leads', { title: `P7 ${label} ${h.tag}`, customerName: `P7 buyer ${label} ${h.tag}`, ...extra });
  if (res.status !== 201) throw new Error(`lead create answered ${brief(res)}`);
  return Number(res.body.id);
}

async function newActivity(h: Harness, body: Record<string, unknown>): Promise<number> {
  const res = await h.post('/api/crm/activities', { type: 'call', ...body });
  if (res.status !== 201) throw new Error(`activity create answered ${brief(res)}`);
  return Number(res.body.id ?? res.body.data?.id);
}

interface AttachmentBody { data?: { id?: string; hasLight?: boolean; lightUrl?: string | null; url?: string; size?: number; type?: string } }

async function uploadCase(h: Harness, wrong: string[]): Promise<string> {
  const dir = withTempAttachmentsDir();
  const leadId = await newLead(h, 'image');
  const activityId = await newActivity(h, { leadId, title: `P7 call ${h.tag}` });

  const jpeg = await noisyJpeg(3000, 2000);
  const res = await upload(h, h.admin, `/crm/leads/${leadId}/attachments`, jpeg, 'image/jpeg', 'نمونه گردنبند.jpg');
  const image = (res.body as AttachmentBody).data;
  if (res.status !== 201 || !image?.id) {
    wrong.push(`image upload answered ${brief(res)}, expected 201`);
    return 'upload failed';
  }
  if (!image.hasLight || image.lightUrl !== `/api/attachments/${image.id}?variant=light`) wrong.push(`image view ${JSON.stringify(image)} has no light url`);
  const [row] = await h.q('SELECT storage_path, light_storage_path, entity_type, sha256 FROM file_attachments WHERE id = $1', [image.id]);
  if (row?.entity_type !== 'crm_lead') wrong.push(`row entity type ${row?.entity_type}, expected crm_lead`);
  const onDisk = path.join(dir, String(row?.storage_path ?? ''));
  if (!fs.existsSync(onDisk) || sha(fs.readFileSync(onDisk)) !== sha(jpeg)) wrong.push('the original on disk is missing or differs from the upload');

  const original = await rawGet(h, `/api/attachments/${image.id}`).buffer(true).parse(binary);
  if (original.status !== 200 || sha(original.body as Buffer) !== sha(jpeg)) wrong.push(`original download ${original.status} differs from the upload`);
  const light = await rawGet(h, `/api/attachments/${image.id}?variant=light`).buffer(true).parse(binary);
  const lightMeta = light.status === 200 ? await sharp(light.body as Buffer).metadata() : null;
  if (lightMeta?.format !== 'webp' || Math.max(lightMeta.width ?? 0, lightMeta.height ?? 0) !== 1600) {
    wrong.push(`light download ${light.status} ${lightMeta?.format} ${lightMeta?.width}x${lightMeta?.height}, expected a 1600 px webp`);
  }

  const pdf = await upload(h, h.admin, `/crm/activities/${activityId}/attachments`, PDF, 'application/pdf', 'پیش‌فاکتور.pdf');
  const pdfView = (pdf.body as AttachmentBody).data;
  if (pdf.status !== 201 || pdfView?.hasLight !== false || pdfView?.type !== 'application/pdf') wrong.push(`pdf upload answered ${brief(pdf)}, expected 201 without light`);

  const list = await h.get(`/api/crm/leads/${leadId}/attachments`);
  if (list.status !== 200 || (list.body.data ?? []).length !== 1) wrong.push(`lead list answered ${brief(list)}, expected one file`);
  const detail = await h.get(`/api/crm/leads/${leadId}`);
  const act = (detail.body.activities ?? []).find((a: { id: number }) => Number(a.id) === activityId);
  if ((detail.body.attachments ?? []).length !== 1 || act?.attachmentCount !== 1 || (act?.attachments ?? []).length !== 1) {
    wrong.push(`lead detail carries ${detail.body.attachments?.length} lead files and activity ${JSON.stringify(act?.attachmentCount)}, expected 1 and 1`);
  }
  const acts = await h.get(`/api/crm/activities?leadId=${leadId}`);
  const listed = (Array.isArray(acts.body) ? acts.body : acts.body.data ?? []).find((a: { id: number }) => Number(a.id) === activityId);
  if (listed?.attachmentCount !== 1) wrong.push(`activity list attachment count ${JSON.stringify(listed?.attachmentCount)}, expected 1`);

  const audit = await h.q(`SELECT entity, details FROM activity_logs WHERE entity_id IN ($1, $2) AND details::text LIKE '%attachmentAdded%'`, [String(leadId), String(activityId)]);
  const entities = audit.map((r) => r.entity).sort();
  if (JSON.stringify(entities) !== JSON.stringify(['اقدام و تماس CRM', 'فرصت فروش CRM'].sort())) wrong.push(`audit rows of the uploads: ${JSON.stringify(entities)}`);
  const media = await h.q(`SELECT count(*)::int AS n FROM media_assets WHERE original_name IN ('نمونه گردنبند.jpg', 'پیش‌فاکتور.pdf')`).catch(() => [{ n: 0 }]);
  if (Number(media[0]?.n) !== 0) wrong.push('an attachment entered the media library');
  return `image ${jpeg.length} bytes with light ${lightMeta?.width}x${lightMeta?.height}; pdf on activity ${activityId}`;
}

async function rulesCase(h: Harness, wrong: string[]): Promise<string> {
  withTempAttachmentsDir();
  const leadId = await newLead(h, 'rules');
  const url = `/crm/leads/${leadId}/attachments`;
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
  const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');

  const refusals: Array<[string, request.Response, string]> = [
    ['gif', await upload(h, h.admin, url, gif, 'image/gif', 'a.gif'), 'CRM_ATTACHMENT_FORMAT'],
    ['png bytes as pdf', await upload(h, h.admin, url, png, 'application/pdf', 'a.pdf'), 'CRM_ATTACHMENT_FORMAT'],
    ['text as jpg', await upload(h, h.admin, url, Buffer.from('not an image'), 'image/jpeg', 'a.jpg'), 'CRM_ATTACHMENT_FORMAT'],
    ['above 10 MB', await upload(h, h.admin, url, Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]), 'application/pdf', 'big.pdf'), 'CRM_ATTACHMENT_TOO_LARGE'],
  ];
  for (const [label, res, code] of refusals) {
    if (res.status !== 422 || res.body?.code !== code) wrong.push(`${label} answered ${brief(res)}, expected 422 ${code}`);
  }
  for (let i = 0; i < 10; i++) {
    const ok = await upload(h, h.admin, url, PDF, 'application/pdf', `n${i}.pdf`);
    if (ok.status !== 201) {
      wrong.push(`file ${i + 1} answered ${brief(ok)}, expected 201`);
      break;
    }
  }
  const eleventh = await upload(h, h.admin, url, PDF, 'application/pdf', 'n10.pdf');
  if (eleventh.status !== 422 || eleventh.body?.code !== 'CRM_ATTACHMENT_LIMIT') wrong.push(`eleventh file answered ${brief(eleventh)}, expected 422 CRM_ATTACHMENT_LIMIT`);
  const [{ n }] = await h.q(`SELECT count(*)::int AS n FROM file_attachments WHERE entity_type = 'crm_lead' AND entity_id = $1 AND is_deleted = 0`, [leadId]);
  if (Number(n) !== 10) wrong.push(`${n} live files stored, expected 10`);
  const missing = await upload(h, h.admin, '/crm/leads/999999999/attachments', PDF, 'application/pdf', 'x.pdf');
  if (missing.status !== 404) wrong.push(`upload to a missing file answered ${brief(missing)}, expected 404`);
  return `4 refusals, 10 stored, eleventh refused`;
}

async function permissionCase(h: Harness, wrong: string[]): Promise<string> {
  withTempAttachmentsDir();
  const leadId = await newLead(h, 'perms');
  const url = `/crm/leads/${leadId}/attachments`;
  const outsider = await h.sessionWith(['products.view']);
  const viewer = await h.sessionWith(['crm.view']);
  const manager = await h.sessionWith(['crm.view', 'crm.manage']);

  const added = await upload(h, manager, url, PDF, 'application/pdf', 'قرارداد.pdf');
  const id = (added.body as AttachmentBody).data?.id;
  if (added.status !== 201 || !id) {
    wrong.push(`crm.manage upload answered ${brief(added)}, expected 201`);
    return 'upload failed';
  }
  const viewerUpload = await upload(h, viewer, url, PDF, 'application/pdf', 'x.pdf');
  if (viewerUpload.status !== 403) wrong.push(`crm.view upload answered ${viewerUpload.status}, expected 403`);
  if ((await h.get(`/api${url}`, outsider)).status !== 403) wrong.push('a user without crm.view read the list');
  if ((await rawGet(h, `/api/attachments/${id}`, outsider)).status !== 403) wrong.push('a user without crm.view downloaded the file');
  if ((await h.get(`/api${url}`, viewer)).status !== 200) wrong.push('crm.view could not read the list');
  if ((await rawGet(h, `/api/attachments/${id}`, viewer)).status !== 200) wrong.push('crm.view could not download the file');
  if ((await h.del(`/api${url}/${id}`, viewer)).status !== 403) wrong.push('crm.view removed a file');

  const removed = await h.del(`/api${url}/${id}`, manager);
  if (removed.status !== 200) wrong.push(`crm.manage remove answered ${brief(removed)}, expected 200`);
  const after = await h.get(`/api${url}`, viewer);
  if ((after.body.data ?? []).length !== 0) wrong.push('the removed file is still listed');
  if ((await rawGet(h, `/api/attachments/${id}`, viewer)).status !== 404) wrong.push('the removed file still downloads');
  const audit = await h.q(`SELECT 1 FROM activity_logs WHERE entity = 'فرصت فروش CRM' AND entity_id = $1 AND details::text LIKE '%attachmentRemoved%'`, [String(leadId)]);
  if (audit.length !== 1) wrong.push(`${audit.length} removal audit rows, expected 1`);
  return 'crm.view reads, crm.manage writes, outsider refused';
}

async function activityListCase(h: Harness, wrong: string[]): Promise<string> {
  const customer = await createTestCustomer({ name: `P7 party ${h.tag}` });
  const leadId = await newLead(h, 'party', { customerId: customer.id, customerName: customer.name });
  const onLead = await newActivity(h, { leadId, title: `P7 lead call ${h.tag}` });
  const direct = await newActivity(h, { customerId: customer.id, title: `P7 direct note ${h.tag}`, type: 'note' });
  const otherLead = await newLead(h, 'other');
  const other = await newActivity(h, { leadId: otherLead, title: `P7 searchable call ${h.tag}` });
  // the lead's own automatic activities count too; the other lead's never
  const expected = (await h.q('SELECT id FROM crm_activities WHERE is_deleted = 0 AND (lead_id = $1 OR customer_id = $2) ORDER BY id', [leadId, customer.id])).map((r) => Number(r.id));
  if (!expected.includes(onLead) || !expected.includes(direct)) throw new Error('setup: party activities missing');

  const page = await h.get(`/api/crm/activities?partyId=${customer.id}&page=1&limit=1`);
  if (page.status !== 200 || page.body.total !== expected.length || (page.body.data ?? []).length !== 1 || page.body.limit !== 1) {
    wrong.push(`party page answered ${brief(page)}, expected total ${expected.length} and one row`);
  }
  const all = await h.get(`/api/crm/activities?partyId=${customer.id}&page=1&limit=20`);
  const ids = (all.body.data ?? []).map((a: { id: number }) => Number(a.id)).sort((a: number, b: number) => a - b);
  if (JSON.stringify(ids) !== JSON.stringify(expected)) wrong.push(`party activities ${JSON.stringify(ids)}, expected ${JSON.stringify(expected)}`);
  const searched = await h.get(`/api/crm/activities?page=1&search=${encodeURIComponent(`P7 searchable call ${h.tag}`)}`);
  const found = (searched.body.data ?? []).map((a: { id: number }) => Number(a.id));
  if (searched.body.total !== 1 || found[0] !== other) wrong.push(`search answered ${brief(searched)}, expected only ${other}`);
  const legacy = await h.get(`/api/crm/activities?leadId=${leadId}`);
  if (!Array.isArray(legacy.body)) wrong.push('a list without page no longer answers an array');

  const one = await h.get(`/api/crm/activities/${direct}`);
  if (one.status !== 200 || Number(one.body.id) !== direct || one.body.customerId !== customer.id) wrong.push(`activity by id answered ${brief(one)}`);
  await h.del(`/api/crm/activities/${direct}`);
  const gone = await h.get(`/api/crm/activities/${direct}`);
  if (gone.status !== 404) wrong.push(`a deleted activity by id answered ${gone.status}, expected 404`);
  return `party ${customer.id}: ${ids.length} activities, search and by-id read`;
}

async function customerByIdCase(h: Harness, wrong: string[]): Promise<string> {
  const customer = await createTestCustomer({ name: `P7 record ${h.tag}` });
  await h.q('UPDATE customers SET notes = $1 WHERE id = $2', [`P7 note ${h.tag}`, customer.id]);
  const viewer = await h.sessionWith(['customers.view']);
  const crmOnly = await h.sessionWith(['crm.view']);

  const read = await h.get(`/api/customers/${customer.id}`, viewer);
  if (read.status !== 200 || Number(read.body.id) !== customer.id || read.body.notes !== `P7 note ${h.tag}` || !Number.isInteger(read.body.version) || !Array.isArray(read.body.tags)) {
    wrong.push(`customers.view read answered ${brief(read)}, expected the record with notes, version and tags`);
  }
  const refused = await h.get(`/api/customers/${customer.id}`, crmOnly);
  if (refused.status !== 403) wrong.push(`crm.view alone read the full record (${refused.status}), expected 403`);
  const missing = await h.get('/api/customers/987654321', viewer);
  if (missing.status !== 404) wrong.push(`a missing party answered ${missing.status}, expected 404`);
  await h.q('UPDATE customers SET is_deleted = 1 WHERE id = $1', [customer.id]);
  const deleted = await h.get(`/api/customers/${customer.id}`, viewer);
  if (deleted.status !== 404) wrong.push(`a deleted party answered ${deleted.status}, expected 404`);
  return `party ${customer.id} read by id; refused, missing and deleted checked`;
}

/** `filename*` of a Content-Disposition header, decoded */
function savedName(res: request.Response): string {
  const header = String(res.headers['content-disposition'] ?? '');
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(header)?.[1];
  return encoded ? decodeURIComponent(encoded) : header;
}

async function downloadRulesCase(h: Harness, wrong: string[]): Promise<string> {
  const dir = withTempAttachmentsDir();
  const leadId = await newLead(h, 'download');
  const activityId = await newActivity(h, { leadId, title: `P7 download ${h.tag}` });
  const jpeg = await noisyJpeg(40, 30);
  const image = (await upload(h, h.admin, `/crm/leads/${leadId}/attachments`, jpeg, 'image/jpeg', 'عکس.jpg')).body as AttachmentBody;
  const pdf = (await upload(h, h.admin, `/crm/activities/${activityId}/attachments`, PDF, 'application/pdf', 'قرارداد.pdf')).body as AttachmentBody;
  const imageId = image.data?.id;
  const pdfId = pdf.data?.id;
  if (!imageId || !pdfId) {
    wrong.push(`uploads answered ${JSON.stringify(image).slice(0, 120)} / ${JSON.stringify(pdf).slice(0, 120)}`);
    return 'upload failed';
  }

  // a stored name whose extension is not its type's (an older row, or a name changed later) is saved with the right one
  await h.q(`UPDATE file_attachments SET original_name = 'گزارش.pdf' WHERE id = $1`, [imageId]);
  const original = await rawGet(h, `/api/attachments/${imageId}`).buffer(true).parse(binary);
  if (savedName(original) !== 'گزارش.jpg') wrong.push(`image saved as «${savedName(original)}», expected «گزارش.jpg»`);
  const light = await rawGet(h, `/api/attachments/${imageId}?variant=light`).buffer(true).parse(binary);
  if (savedName(light) !== 'گزارش.webp') wrong.push(`light copy saved as «${savedName(light)}», expected «گزارش.webp»`);
  // 10.3 package 7: a dot inside the name is not an extension; only a known one is replaced
  await h.q(`UPDATE file_attachments SET original_name = 'Report v1.2 final' WHERE id = $1`, [pdfId]);
  const dotted = await rawGet(h, `/api/attachments/${pdfId}`).buffer(true).parse(binary);
  if (savedName(dotted) !== 'Report v1.2 final.pdf') wrong.push(`dotted PDF saved as «${savedName(dotted)}», expected «Report v1.2 final.pdf»`);
  const busted = await rawGet(h, `/api/attachments/${imageId}?v=2`).buffer(true).parse(binary);
  if (busted.status !== 200) wrong.push(`a download with an extra query key answered ${busted.status}, expected 200`);

  // the attachments of a deleted sales file, and of its activities, no longer download
  await h.q('UPDATE crm_leads SET is_deleted = 1 WHERE id = $1', [leadId]);
  const goneImage = await rawGet(h, `/api/attachments/${imageId}`);
  const gonePdf = await rawGet(h, `/api/attachments/${pdfId}`);
  if (goneImage.status !== 404 || gonePdf.status !== 404) wrong.push(`downloads after the file was deleted answered ${goneImage.status} / ${gonePdf.status}, expected 404 / 404`);

  // a partial upload older than an hour is swept, a fresh one is kept
  const tmp = path.join(dir, '.tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const stale = path.join(tmp, 'stale.part');
  const fresh = path.join(tmp, 'fresh.part');
  fs.writeFileSync(stale, 'x');
  fs.writeFileSync(fresh, 'x');
  const old = new Date(Date.now() - CRM_TEMP_PART_MAX_AGE_MS - 60_000);
  fs.utimesSync(stale, old, old);
  const removed = await sweepStaleUploadParts(tmp);
  if (removed !== 1 || fs.existsSync(stale) || !fs.existsSync(fresh)) wrong.push(`sweep removed ${removed}; stale ${fs.existsSync(stale)}, fresh ${fs.existsSync(fresh)}`);
  return 'names follow the type, extra key ignored, deleted owner 404, stale part swept';
}
