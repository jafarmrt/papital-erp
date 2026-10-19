import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, appSettings, formDrafts, transfers } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/**
 * v10.2.18 (OBS-R2-60, 10.2 package 13): «تصویرهای بی‌صاحب». Before, a replaced image (item, transfer design, avatar, raw
 * material request) stayed in public/uploads for ever and nothing could remove it. The run touches only image files no
 * row names, its UUID matched wherever it stands (a trailing period, an encoded or escaped slash, another letter case, a
 * bare name), and only those of the preview the admin confirmed: it moves them to `.orphaned/<day>/`, re-reads the rows
 * just before each move, removes a moved file only after thirty days and brings one back when a row names it again; a
 * young file, a file of another name and a sub-folder are left, and each chunk writes its audit row.
 */
export async function runOrphanUploadsTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const id = 'reg_orphan_uploads_cleanup_obs_r2_60';
  if (!shouldRun(id, 'obs_r2_60', 'uploads', 'cleanup', 'package13')) return [];
  const tStart = Date.now();
  const name = 'v10.2.18: orphan upload images are checked, then moved aside and removed after the hold only when no row names their UUID (OBS-R2-60)';
  try {
    const details = await orphanUploadsCase();
    return [makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details })];
  } catch (err: unknown) {
    return [makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart, details: err instanceof Error ? err.message : String(err) })];
  }
}

async function orphanUploadsCase(): Promise<string> {
  const { cleanupOrphanUploads, ORPHAN_UPLOAD_AUDIT_ENTITY } = await import('../../services/system/orphanUploadsCleanup.service.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-uploads-'));
  const fileName = (prefix = '', ext = 'png') => `${prefix ? `${prefix}-` : ''}${randomUUID()}.${ext}`;
  const files = {
    live: fileName(), deletedCopy: fileName('', 'webp'), inNotes: fileName(), setting: fileName('logo'), draft: fileName('', 'jpg'),
    period: fileName(), underscore: fileName(), upperCase: fileName(), encoded: fileName(), escaped: fileName(), bare: fileName(),
    auditOnly: fileName(), unnamed: fileName('', 'gif'), unconfirmed: fileName(), namedLater: fileName(), young: fileName(),
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
  fs.writeFileSync(path.join(dir, '.attachments', fileName()), 'x');

  const stamp = Date.now();
  const codes = [`P13-ORPHAN-${stamp}-A`, `P13-ORPHAN-${stamp}-B`, `P13-ORPHAN-${stamp}-C`, `P13-ORPHAN-${stamp}-D`];
  const settingKey = `p13_orphan_logo_${stamp}`;
  let draftId: number | undefined;
  const wrong: string[] = [];
  const today = '2026-10-19';
  try {
    await orm.insert(transfers).values([
      { code: codes[0], title: 'p13 live', image: `/uploads/${files.live}`, notes: `copied from https://shop.example/uploads/${files.inNotes}` },
      { code: codes[1], title: 'p13 deleted copy', thumbnail: `/uploads/${files.deletedCopy}`, isDeleted: 1 },
      {
        code: codes[2], title: 'p13 reference forms',
        notes: [
          `دیدن /uploads/${files.period}.`, `/uploads/${files.underscore}_`, `/Uploads/${files.upperCase.toUpperCase()}`,
          `https%3A%2F%2Fx%2Fuploads%2F${files.encoded}`, `uploads\\/${files.escaped}`, `${files.bare}`,
        ].join(' | '),
      },
    ]);
    await orm.insert(appSettings).values({ key: settingKey, value: `/uploads/${files.setting}` });
    [{ id: draftId }] = await orm.insert(formDrafts).values({
      entityType: 'p13', draftKey: settingKey, payload: { item: { image: `/uploads/${files.draft}` } },
    }).returning({ id: formDrafts.id });
    await logActivity({ action: 'UPDATE', entity: 'کالا', description: 'p13 replaced image', details: { before: { image: `/uploads/${files.auditOnly}` } } });

    const orphanKeys = ['auditOnly', 'unnamed', 'unconfirmed', 'namedLater'] as const;
    const preview = await cleanupOrphanUploads({ apply: false, uploadsDir: dir, today });
    if (preview.scannedFiles !== 16) wrong.push(`scanned ${preview.scannedFiles}, expected 16`);
    if (preview.recentFiles !== 1) wrong.push(`recent ${preview.recentFiles}, expected 1`);
    const expectedOrphans = orphanKeys.map(k => files[k]).sort();
    if (JSON.stringify([...preview.orphans.names].sort()) !== JSON.stringify(expectedOrphans)) wrong.push(`preview orphans ${preview.orphans.names.join(',')}`);
    if (preview.orphans.moved !== 0 || !fs.existsSync(path.join(dir, files.unnamed))) wrong.push('the preview moved a file');

    // the admin confirms all but one; a row names another one between the scan and the move
    const run = await cleanupOrphanUploads({
      apply: true, uploadsDir: dir, today,
      confirmed: { quarantine: preview.orphans.names.filter(n => n !== files.unconfirmed), purge: [] },
      afterScan: async () => {
        await orm.insert(transfers).values({ code: codes[3], title: 'p13 named later', image: `/uploads/${files.namedLater}` });
      },
    });
    if (run.orphans.moved !== 2 || run.skipped !== 2) wrong.push(`moved ${run.orphans.moved} skipped ${run.skipped}, expected 2 and 2`);
    const held = path.join(dir, '.orphaned', today);
    const left = fs.readdirSync(dir);
    for (const [key, file] of Object.entries(files)) {
      const movedAside = key === 'auditOnly' || key === 'unnamed';
      if (left.includes(file) === movedAside) wrong.push(`${key} ${movedAside ? 'was not moved' : 'was moved'}`);
      if (movedAside && !fs.existsSync(path.join(held, file))) wrong.push(`${key} is not in the quarantine folder`);
    }
    if (!left.includes('brand.png') || fs.readdirSync(path.join(dir, '.attachments')).length !== 1) wrong.push('a file outside the image names was touched');

    // before the hold nothing is removed; a held file a row names again goes back
    await orm.update(transfers).set({ image: `/uploads/${files.unnamed}` }).where(eq(transfers.code, codes[3]));
    const early = await cleanupOrphanUploads({ apply: true, uploadsDir: dir, today: '2026-11-01', confirmed: { quarantine: [], purge: [] } });
    if (early.expired.files !== 0 || early.restored.moved !== 1 || !fs.existsSync(path.join(dir, files.unnamed))) {
      wrong.push(`before the hold: expired ${early.expired.files}, restored ${early.restored.moved}`);
    }
    // after thirty days the held, unnamed file is removed, only once confirmed
    const later = '2026-11-18';
    const latePreview = await cleanupOrphanUploads({ apply: false, uploadsDir: dir, today: later });
    const heldName = `${today}/${files.auditOnly}`;
    if (JSON.stringify(latePreview.expired.names) !== JSON.stringify([heldName])) wrong.push(`expired ${latePreview.expired.names.join(',')}`);
    const purged = await cleanupOrphanUploads({ apply: true, uploadsDir: dir, today: later, confirmed: { quarantine: [], purge: [heldName] } });
    if (purged.expired.removed !== 1 || fs.existsSync(path.join(held, files.auditOnly))) wrong.push(`removed ${purged.expired.removed}, expected 1`);

    // a held copy of a file already back with the same bytes is removed; a different one is a failure, never overwritten
    const later2 = '2026-11-20';
    const dupDir = path.join(dir, '.orphaned', later2);
    fs.mkdirSync(dupDir, { recursive: true });
    const same = fileName();
    const differs = fileName();
    for (const f of [same, differs]) {
      fs.writeFileSync(path.join(dir, f), 'top');
      fs.utimesSync(path.join(dir, f), old, old);
    }
    fs.writeFileSync(path.join(dupDir, same), 'top');
    fs.writeFileSync(path.join(dupDir, differs), 'other');
    await orm.update(transfers).set({ notes: `${same} ${differs}` }).where(eq(transfers.code, codes[3]));
    const dupRun = await cleanupOrphanUploads({ apply: true, uploadsDir: dir, today: later2, confirmed: { quarantine: [], purge: [] } });
    if (fs.existsSync(path.join(dupDir, same)) || fs.readFileSync(path.join(dir, same), 'utf8') !== 'top') wrong.push('the identical held copy was not removed');
    if (!fs.existsSync(path.join(dupDir, differs)) || fs.readFileSync(path.join(dir, differs), 'utf8') !== 'top') wrong.push('a different held copy was moved or overwritten');
    if (!dupRun.failures.some(f => f.name === `${later2}/${differs}` && f.code === 'TARGET_EXISTS_DIFFERENT')) wrong.push(`duplicate failures ${JSON.stringify(dupRun.failures)}`);

    // a day folder that is a link to another place is refused before any file moves
    const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-uploads-link-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-uploads-outside-'));
    try {
      const stray = fileName();
      fs.writeFileSync(path.join(linkDir, stray), 'x');
      fs.utimesSync(path.join(linkDir, stray), old, old);
      fs.mkdirSync(path.join(linkDir, '.orphaned'));
      fs.symlinkSync(outside, path.join(linkDir, '.orphaned', today));
      let code = '';
      await cleanupOrphanUploads({ apply: true, uploadsDir: linkDir, today, confirmed: { quarantine: [stray], purge: [] } })
        .catch((err: unknown) => { code = String((err as { code?: string }).code); });
      if (code !== 'ORPHAN_UPLOADS_QUARANTINE_INVALID' || !fs.existsSync(path.join(linkDir, stray)) || fs.readdirSync(outside).length > 0) {
        wrong.push(`a linked day folder answered ${code || 'success'}`);
      }
    } finally {
      fs.rmSync(linkDir, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }

    const audit = await orm.select({ details: activityLogs.details }).from(activityLogs)
      .where(eq(activityLogs.entity, ORPHAN_UPLOAD_AUDIT_ENTITY));
    const ops = audit.map(a => {
      const d = (typeof a.details === 'string' ? JSON.parse(a.details) : a.details) as { operation?: string; names?: string[] };
      return `${d.operation}:${(d.names ?? []).length}`;
    }).filter(o => o.startsWith('quarantine:2') || o.startsWith('restore:1') || o.startsWith('purge:1'));
    if (new Set(ops).size !== 3) wrong.push(`audit rows ${ops.join(',')}`);

    // the route: system admin only, a strict body, a run needs the confirmed lists, names must be image names
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const session = await getAdminSession();
    const send = (body: unknown) => request(app).post('/api/system/orphan-uploads')
      .set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send(body as object);
    for (const body of [{ apply: false, minAgeMinutes: 0 }, { apply: true }, { apply: true, quarantine: ['../etc/passwd'], purge: [] }]) {
      const res = await send(body);
      if (res.status !== 400) wrong.push(`${JSON.stringify(body)} answered ${res.status}, expected 400`);
    }
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
  return 'every reference form keeps its file; only confirmed, still unnamed orphans are moved aside, a file named again comes back, a held file is removed after thirty days, an identical held copy of a file already back is removed and a different one never overwrites it, a linked day folder is refused; young, other-name and sub-folder files stay; each chunk is audited';
}
