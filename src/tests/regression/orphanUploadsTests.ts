import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, appSettings, formDrafts, transfers } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/**
 * v10.2.17 (OBS-R2-60, 10.2 package 13): «پاک کردن تصویرهای بی‌صاحب». Before, a replaced image (item, transfer design,
 * avatar, raw material request, company logo) stayed in public/uploads for ever and nothing could remove it. The cleanup
 * removes only image files no row names: a live, soft-deleted or copied record, a setting or a draft keeps its file,
 * only the audit log's snapshots do not; a file younger than an hour, a file of another name and a sub-folder are left.
 */
export async function runOrphanUploadsTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const id = 'reg_orphan_uploads_cleanup_obs_r2_60';
  if (!shouldRun(id, 'obs_r2_60', 'uploads', 'cleanup', 'package13')) return [];
  const tStart = Date.now();
  try {
    const details = await orphanUploadsCase();
    return [makeTestCase({ id, name: 'v10.2.17: orphan upload images are counted, then removed only when no row names them (OBS-R2-60)', layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details })];
  } catch (err: unknown) {
    return [makeTestCase({ id, name: 'v10.2.17: orphan upload images are counted, then removed only when no row names them (OBS-R2-60)', layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart, details: err instanceof Error ? err.message : String(err) })];
  }
}

async function orphanUploadsCase(): Promise<string> {
  const { cleanupOrphanUploads, ORPHAN_UPLOAD_AUDIT_ENTITY } = await import('../../services/system/orphanUploadsCleanup.service.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-uploads-'));
  const name = (prefix = '', ext = 'png') => `${prefix ? `${prefix}-` : ''}${randomUUID()}.${ext}`;
  const files = {
    live: name(), deletedCopy: name('', 'webp'), inNotes: name(), setting: name('logo'), draft: name('', 'jpg'),
    auditOnly: name(), unnamed: name('', 'gif'), young: name(),
  };
  const old = (Date.now() - 2 * 3600_000) / 1000;
  for (const [key, file] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), 'x');
    if (key !== 'young') fs.utimesSync(path.join(dir, file), old, old);
  }
  // not a name the image fields write, and a sub-folder: never touched
  fs.writeFileSync(path.join(dir, 'brand.png'), 'x');
  fs.utimesSync(path.join(dir, 'brand.png'), old, old);
  fs.mkdirSync(path.join(dir, '.attachments'));
  fs.writeFileSync(path.join(dir, '.attachments', name()), 'x');

  const codes = [`P13-ORPHAN-${Date.now()}-A`, `P13-ORPHAN-${Date.now()}-B`];
  const settingKey = `p13_orphan_logo_${Date.now()}`;
  let draftId: number | undefined;
  const wrong: string[] = [];
  try {
    await orm.insert(transfers).values([
      { code: codes[0], title: 'p13 live', image: `/uploads/${files.live}`, notes: `copied from https://shop.example/uploads/${files.inNotes}` },
      { code: codes[1], title: 'p13 deleted copy', thumbnail: `/uploads/${files.deletedCopy}`, isDeleted: 1 },
    ]);
    await orm.insert(appSettings).values({ key: settingKey, value: `/uploads/${files.setting}` });
    [{ id: draftId }] = await orm.insert(formDrafts).values({
      entityType: 'p13', draftKey: settingKey, payload: { item: { image: `/uploads/${files.draft}` } },
    }).returning({ id: formDrafts.id });
    await logActivity({ action: 'UPDATE', entity: 'کالا', description: 'p13 replaced image', details: { before: { image: `/uploads/${files.auditOnly}` } } });

    const preview = await cleanupOrphanUploads({ apply: false, uploadsDir: dir });
    const expectedOrphans = [files.auditOnly, files.unnamed].sort();
    if (preview.scannedFiles !== 8) wrong.push(`scanned ${preview.scannedFiles}, expected 8`);
    if (preview.recentFiles !== 1) wrong.push(`recent ${preview.recentFiles}, expected 1`);
    if (JSON.stringify([...preview.orphans.names].sort()) !== JSON.stringify(expectedOrphans)) wrong.push(`preview orphans ${preview.orphans.names.join(',')}`);
    if (preview.orphans.removed !== 0 || !fs.existsSync(path.join(dir, files.unnamed))) wrong.push('the preview removed a file');

    const run = await cleanupOrphanUploads({ apply: true, uploadsDir: dir });
    if (run.orphans.removed !== 2) wrong.push(`removed ${run.orphans.removed}, expected 2`);
    const left = fs.readdirSync(dir).sort();
    for (const [key, file] of Object.entries(files)) {
      const shouldStay = key !== 'auditOnly' && key !== 'unnamed';
      if (left.includes(file) !== shouldStay) wrong.push(`${key} ${shouldStay ? 'was removed' : 'was kept'}`);
    }
    if (!left.includes('brand.png') || fs.readdirSync(path.join(dir, '.attachments')).length !== 1) wrong.push('a file outside the image names was touched');
    const audit = await orm.select({ id: activityLogs.id }).from(activityLogs)
      .where(and(eq(activityLogs.entity, ORPHAN_UPLOAD_AUDIT_ENTITY), eq(activityLogs.action, 'DELETE')));
    if (audit.length === 0) wrong.push('the removal wrote no audit row');

    // the route: system admin only, a strict body, a preview by default with a Persian sentence
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const session = await getAdminSession();
    const send = (body: unknown) => request(app).post('/api/system/orphan-uploads')
      .set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send(body as object);
    const extra = await send({ apply: false, minAgeMinutes: 0 });
    if (extra.status !== 400) wrong.push(`an unknown key answered ${extra.status}, expected 400`);
    const routePreview = await send({});
    if (routePreview.status !== 200 || routePreview.body?.dryRun !== true || !/[؀-ۿ]/.test(String(routePreview.body?.message))) {
      wrong.push(`route preview answered ${routePreview.status} ${JSON.stringify(routePreview.body)}`);
    }
  } finally {
    await orm.delete(transfers).where(inArray(transfers.code, codes)).catch(() => undefined);
    await orm.delete(appSettings).where(eq(appSettings.key, settingKey)).catch(() => undefined);
    if (draftId) await orm.delete(formDrafts).where(eq(formDrafts.id, draftId)).catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'live, soft-deleted, copied, setting and draft references keep their files; audit-only and unnamed old images are removed after a preview; young, other-name and sub-folder files stay';
}
