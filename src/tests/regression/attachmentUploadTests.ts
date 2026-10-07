import fs from 'fs';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { fileAttachments, transfers, users } from '../../db/schema.js';
import { makeDailyLogTestCtx, type DailyLogTestCtx } from './dailyLogAccessTests.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/**
 * Package 13 (daily logs and attachments), PR C: attachment download, request body limits, image uploads, orphan
 * cleanup and the length caps of a daily log. Each case reproduces a finding of the package 13 review.
 */
export async function runAttachmentUploadTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (ctx: DailyLogTestCtx) => Promise<string>]> = [
    ['reg_attachment_stream_error_no_crash_td_627',
      'v9.0.242: an attachment file that cannot be read answers 404 and raises no uncaught exception that would stop the server (TD-627)',
      ['td627', 'attachment', 'package13'], streamErrorCase],
    ['reg_attachment_body_limit_413_persian_td_641',
      'v9.0.243: routes with attachments accept a body up to 14 MB, other routes refuse more than 5 MB with a Persian 413 (TD-641)',
      ['td641', 'attachment', 'body_limit', 'package13'], bodyLimitCase],
    ['reg_image_upload_validation_422_td_642',
      'v9.0.244: an invalid image data URL is a Persian 422 and is never stored as it is (TD-642)',
      ['td642', 'attachment', 'image', 'package13'], imageValidationCase],
    ['reg_orphan_cleanup_min_age_floor_td_643',
      'v9.0.245: the orphan attachment cleanup never removes files younger than 5 minutes (TD-643)',
      ['td643', 'attachment', 'cleanup', 'package13'], orphanFloorCase],
    ['reg_daily_log_length_caps_td_644',
      'v9.0.246: a daily log\'s title, content and tags have length caps (TD-644)',
      ['td644', 'daily_log', 'validation', 'package13'], lengthCapsCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    const ctx = await makeDailyLogTestCtx();
    try {
      const details = await run(ctx);
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      await ctx.cleanup();
    }
  }
  return results;
}

async function adminRequest() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const session = await getAdminSession();
  return (method: 'get' | 'post' | 'put', url: string) =>
    request(app)[method](url).set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken);
}

const NO_RECORD_ID = 2_147_400_000;
const isPersian = (text: unknown) => typeof text === 'string' && /[؀-ۿ]/.test(text);

async function streamErrorCase(): Promise<string> {
  const { AttachmentStorageService } = await import('../../services/attachments/attachmentStorage.service.js');
  const send = await adminRequest();
  const caught: unknown[] = [];
  const onUncaught = (err: unknown) => { caught.push(err); };
  process.on('uncaughtException', onUncaught);
  const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');
  const [att] = await AttachmentStorageService.attachToNewRecord(orm, 'document', NO_RECORD_ID, [{ name: 'p13.png', url: png }], 'p13');
  const row = await AttachmentStorageService.findActive(String(att.id));
  const absolute = AttachmentStorageService.absolutePath(row!.storagePath);
  const wrong: string[] = [];
  try {
    const ok = await send('get', `/api/attachments/${att.id}`).timeout(5000);
    if (ok.status !== 200 || ok.headers['content-length'] !== '7') wrong.push(`readable file answered ${ok.status} with length ${ok.headers['content-length']}`);
    // a path that passes existsSync but cannot be read (a directory; in production a file with the wrong owner)
    fs.rmSync(absolute);
    fs.mkdirSync(absolute);
    const broken = await send('get', `/api/attachments/${att.id}`).timeout(3000)
      .catch((e: Error) => ({ status: `client error: ${e.message}`, body: {} as Record<string, unknown> }));
    await new Promise(r => setTimeout(r, 300));
    if (broken.status !== 404) wrong.push(`unreadable file answered ${broken.status}, expected 404`);
    if (caught.length > 0) wrong.push(`uncaught exceptions: ${caught.map(e => (e as Error)?.message).join(' | ')}`);
    fs.rmSync(absolute, { recursive: true, force: true });
    const missing = await send('get', `/api/attachments/${att.id}`).timeout(3000);
    if (missing.status !== 404) wrong.push(`missing file answered ${missing.status}, expected 404`);
  } finally {
    process.off('uncaughtException', onUncaught);
    fs.rmSync(absolute, { recursive: true, force: true });
    await orm.delete(fileAttachments).where(eq(fileAttachments.id, String(att.id)));
  }
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'readable file 200 with Content-Length; a directory or a missing file 404; no uncaught exception';
}

async function bodyLimitCase(): Promise<string> {
  const { MAX_ATTACHMENT_FILE_MB } = await import('../../lib/attachments/attachmentBodyLimit.js');
  const { MAX_ATTACHMENT_BYTES } = await import('../../services/attachments/attachmentStorage.service.js');
  const send = await adminRequest();
  const wrong: string[] = [];
  // a 10 MB file as a data URL is about 13.98 MB of JSON; it must reach a route with attachments
  const tenMb = 'data:application/pdf;base64,' + Buffer.alloc(MAX_ATTACHMENT_FILE_MB * 1024 * 1024, 7).toString('base64');
  const doc = await send('post', '/api/documents').send({ attachments: [{ name: 'big.pdf', url: tenMb }] });
  if (doc.status === 413) wrong.push('a document with a 10 MB attachment was refused by the body limit');
  if (MAX_ATTACHMENT_BYTES !== MAX_ATTACHMENT_FILE_MB * 1024 * 1024) wrong.push(`service limit ${MAX_ATTACHMENT_BYTES} differs from the form's ${MAX_ATTACHMENT_FILE_MB} MB`);
  const daily = await send('post', '/api/daily-logs').send({ title: 'p13 big', content: 'x'.repeat(6 * 1024 * 1024) });
  if (daily.status !== 413) wrong.push(`a 6 MB daily log body answered ${daily.status}, expected 413`);
  else {
    if (!isPersian(daily.body?.error)) wrong.push(`413 message is not Persian: ${JSON.stringify(daily.body?.error)}`);
    if (daily.body?.code !== 'PAYLOAD_TOO_LARGE') wrong.push(`413 code ${daily.body?.code}`);
  }
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return `document with a 10 MB attachment passed the body parser (${doc.status}); a 6 MB daily log body is a Persian 413`;
}

async function imageValidationCase(ctx: DailyLogTestCtx): Promise<string> {
  const actor = await ctx.userWith(['products.view', 'products.create', 'products.edit']);
  const wrong: string[] = [];
  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
  const values: Array<[string, string]> = [
    ['svg image', svg],
    ['non-base64 png', 'data:image/png;base64,@@not-base64@@'],
    ['plain data url', 'data:image/png,rawbytes'],
    ['html data url', 'data:text/html,<b>x</b>'],
  ];
  const codes: string[] = [];
  for (const [label, image] of values) {
    // a transfer design image goes through uploadBase64ToStorage like item and avatar images
    const code = `P13-IMG-${Date.now()}-${codes.length}`;
    codes.push(code);
    const res = await ctx.send(actor, 'post', '/api/transfers', { code, title: 'p13 image', image });
    if (res.status !== 422) wrong.push(`${label} answered ${res.status}, expected 422`);
    else if (!isPersian(res.body?.error)) wrong.push(`${label} message is not Persian`);
  }
  const stored = await orm.select({ code: transfers.code }).from(transfers).where(inArray(transfers.code, codes));
  if (stored.length > 0) wrong.push(`${stored.length} transfer rows were stored with an invalid image`);
  await orm.delete(transfers).where(inArray(transfers.code, codes)).catch(() => undefined);
  // the profile avatar keeps its own Persian 400 (TD-533) and never stores a data URL
  const avatar = await ctx.send(actor, 'put', '/api/users/profile', { avatar: svg });
  if (avatar.status >= 500) wrong.push(`svg avatar answered ${avatar.status}`);
  const [user] = await orm.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, actor.id));
  if (user?.avatarUrl && user.avatarUrl.startsWith('data:')) wrong.push('a data URL was stored as the avatar');
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'svg, non-base64, non-base64-encoded and non-image data URLs are Persian 422 and nothing is stored';
}

async function orphanFloorCase(): Promise<string> {
  const { AttachmentOrphanCleanupService } = await import('../../services/attachments/attachmentOrphanCleanup.service.js');
  const send = await adminRequest();
  const wrong: string[] = [];
  const zero = await send('post', '/api/attachments/cleanup-orphans').send({ minAgeMinutes: 0 });
  if (zero.status !== 400) wrong.push(`minAgeMinutes 0 answered ${zero.status}, expected 400`);
  const report = await AttachmentOrphanCleanupService.cleanupOrphanFiles({ apply: false, actor: 'p13', minAgeMinutes: 0 });
  if (report.minAgeMinutes !== 5) wrong.push(`service ran with minAgeMinutes ${report.minAgeMinutes}, expected the floor 5`);
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'route refuses minAgeMinutes 0 with 400; the service raises it to 5';
}

async function lengthCapsCase(ctx: DailyLogTestCtx): Promise<string> {
  const author = await ctx.userWith(['daily_logs.view', 'daily_logs.create']);
  const base = { title: 'p13 caps', content: 'p13 content', start_time: '08:00', end_time: '12:00', visibility: 'private' };
  const wrong: string[] = [];
  const refused: Array<[string, Record<string, unknown>]> = [
    ['title of 201', { title: 't'.repeat(201) }],
    ['content of 20001', { content: 'c'.repeat(20_001) }],
    ['21 tags', { tags: Array.from({ length: 21 }, (_, i) => `tag${i}`) }],
    ['tag of 51', { tags: ['g'.repeat(51)] }],
  ];
  for (const [label, patch] of refused) {
    const res = await ctx.send(author, 'post', '/api/daily-logs', { ...base, ...patch });
    if (res.status !== 400) wrong.push(`${label} answered ${res.status}, expected 400`);
  }
  const atCap = await ctx.send(author, 'post', '/api/daily-logs', {
    ...base, title: 't'.repeat(200), content: 'c'.repeat(20_000), tags: Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(50, 'g')),
  });
  if (atCap.status !== 201 && atCap.status !== 200) wrong.push(`a log at every cap answered ${atCap.status}`);
  const created = await ctx.send(author, 'post', '/api/daily-logs', base);
  const id = Number(created.body?.id ?? created.body?.data?.id);
  if (Number.isSafeInteger(id) && id > 0) {
    const edit = await ctx.send(author, 'put', `/api/daily-logs/${id}`, { content: 'c'.repeat(20_001) });
    if (edit.status !== 400) wrong.push(`edit with content of 20001 answered ${edit.status}, expected 400`);
  } else wrong.push(`create answered ${created.status} without an id`);
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'title 200, content 20000, 20 tags of 50 accepted; one more of each refused with 400, on create and edit';
}
