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
 * Series 10, N-05 PR 4 (v10.0.248): operating the media library: the command that rebuilds light versions and the media
 * library card of the health page.
 */
export async function runMediaOpsTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_media_light_rebuild_n05',
      'v10.0.248: the light rebuild previews by default, rebuilds missing or failed light versions once per content for every row holding it, and audits the run (N-05)',
      ['n05', 'media'], lightRebuildCase],
    ['reg_media_health_n05',
      'v10.0.248: the health page shows the media library directory, the size of its files, the images without a light version and the free disk space (N-05)',
      ['n05', 'media', 'health'], healthCase],
  ]);
}

const brief = (res: { status: number; body?: unknown }) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 200)}`;

function withTempMediaDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-media-ops-test-'));
  process.env.MEDIA_DIR = dir;
  return dir;
}

async function noisyJpeg(width: number, height: number): Promise<Buffer> {
  const raw = crypto.randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

async function uploadImage(h: Harness, s: Session): Promise<{ id: number; sha256: string }> {
  const [section] = await h.q(`SELECT id FROM media_sections WHERE kind = 'products' AND is_deleted = 0 ORDER BY id LIMIT 1`);
  const item = await createTestItem({ type: 'product' });
  const res = await request(h.app as Parameters<typeof request>[0]).post(`/api/media/assets?sectionId=${section.id}&itemId=${item.id}&shotType=other`)
    .set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken)
    .set('Content-Type', 'image/jpeg').set('X-File-Name', encodeURIComponent('ops.jpg'))
    .send(await noisyJpeg(900, 700));
  if (res.status !== 201) throw new Error(`upload answered ${brief(res)}`);
  const id = Number((res.body as { data: { id: number } }).data.id);
  const [row] = await h.q(`SELECT sha256 FROM media_assets WHERE id = $1`, [id]);
  return { id, sha256: String(row.sha256) };
}

/** A second live row holding the same content (rows share one copy on disk) */
async function twinRow(h: Harness, id: number): Promise<number> {
  const [row] = await h.q(`
    INSERT INTO media_assets (section_id, item_id, kind, shot_type, title, original_name, mime_type, size_bytes, sha256, width, height,
      light_bytes, thumb_bytes, light_error, created_by)
    SELECT section_id, item_id, kind, shot_type, title || ' twin', original_name, mime_type, size_bytes, sha256, width, height,
      light_bytes, thumb_bytes, light_error, created_by
    FROM media_assets WHERE id = $1 RETURNING id`, [id]);
  return Number(row.id);
}

async function lightState(h: Harness, ids: number[]) {
  return h.q(`SELECT id, light_bytes, thumb_bytes, light_error FROM media_assets WHERE id = ANY($1::int[]) ORDER BY id`, [ids]);
}

async function lightRebuildCase(h: Harness, wrong: string[]): Promise<string> {
  const dir = withTempMediaDir();
  const { MediaLightRebuildService } = await import('../../services/media/mediaLightRebuild.js');
  const uploader = await h.sessionWith(['media.view', 'media.upload']);
  const healthy = await uploadImage(h, uploader);
  const broken = await uploadImage(h, uploader);
  const twin = await twinRow(h, broken.id);
  const lightFile = path.join(dir, 'light', broken.sha256.slice(0, 2), `${broken.sha256}.webp`);
  const thumbFile = path.join(dir, 'thumbs', broken.sha256.slice(0, 2), `${broken.sha256}.webp`);
  if (!fs.existsSync(lightFile)) wrong.push('the upload made no light file');
  // the light version of one content is lost: no file and no size on either row holding it
  fs.rmSync(lightFile, { force: true });
  fs.rmSync(thumbFile, { force: true });
  await h.q(`UPDATE media_assets SET light_bytes = NULL, thumb_bytes = NULL, light_error = 'Input file is missing' WHERE id = ANY($1::int[])`, [[broken.id, twin]]);
  // another content keeps its light row but its file went missing from disk: still a candidate
  const healthyLight = path.join(dir, 'light', healthy.sha256.slice(0, 2), `${healthy.sha256}.webp`);
  fs.rmSync(healthyLight, { force: true });

  const preview = await MediaLightRebuildService.rebuild({ apply: false, scope: 'missing', actor: `test:${h.tag}` });
  if (!preview.acquired) throw new Error('the preview did not take the lock');
  const after = await lightState(h, [broken.id, twin]);
  if (after.some(r => r.light_bytes !== null)) wrong.push('the preview wrote a light size');
  if (fs.existsSync(lightFile)) wrong.push('the preview made a light file');
  if (preview.report.candidates < 2 || preview.report.candidateAssets < 3) {
    wrong.push(`preview listed ${preview.report.candidates} contents / ${preview.report.candidateAssets} files (expected the two contents, three files)`);
  }

  const run = await MediaLightRebuildService.rebuild({ apply: true, scope: 'missing', actor: `test:${h.tag}` });
  if (!run.acquired) throw new Error('the run did not take the lock');
  const rebuiltRows = await lightState(h, [broken.id, twin]);
  if (rebuiltRows.some(r => !(Number(r.light_bytes) > 0) || !(Number(r.thumb_bytes) > 0) || r.light_error !== '')) {
    wrong.push(`rows of the rebuilt content: ${JSON.stringify(rebuiltRows)}`);
  }
  if (!fs.existsSync(lightFile) || !fs.existsSync(thumbFile) || !fs.existsSync(healthyLight)) wrong.push('the run left a light file missing');
  const mine = new Set([healthy.id, broken.id, twin]);
  const myFailures = run.report.failures.filter(f => f.assetIds.some(id => mine.has(id)));
  if (myFailures.length > 0) wrong.push(`failures of this test's files: ${JSON.stringify(myFailures)}`);
  const audit = await h.q(`SELECT details FROM activity_logs WHERE entity = 'کتابخانه تصاویر' AND entity_id = 'light_rebuild' AND username = $1`, [`test:${h.tag}`]);
  if (audit.length !== 1) wrong.push(`${audit.length} audit rows for the run (the preview writes none, the run one)`);

  // a second run finds nothing of this test left to do
  const again = await MediaLightRebuildService.rebuild({ apply: false, scope: 'missing' });
  if (again.acquired) {
    const stillMine = again.report.candidates > 0 ? await lightState(h, [...mine]) : [];
    if (stillMine.some(r => r.light_bytes === null)) wrong.push('a rebuilt file is still a candidate');
  }
  // `all` takes every live image, complete ones included
  const all = await MediaLightRebuildService.rebuild({ apply: false, scope: 'all' });
  if (all.acquired && all.report.candidateAssets < 3) wrong.push(`scope all listed ${all.report.candidateAssets} files`);
  return `preview ${preview.report.candidates} contents, rebuilt ${run.report.rebuilt}, one audit row`;
}

type MediaHealth = {
  status?: string; path?: string; fileCount?: number | null; imageCount?: number | null; originalBytes?: number | null;
  lightBytes?: number | null; lightMissingCount?: number | null; lightFailedCount?: number | null;
  diskFreeBytes?: number | null; diskTotalBytes?: number | null; messages?: string[];
};

async function healthCase(h: Harness, wrong: string[]): Promise<string> {
  const dir = withTempMediaDir();
  const uploader = await h.sessionWith(['media.view', 'media.upload']);
  const health = async () => {
    const res = await h.get('/api/system/health', h.admin);
    if (res.status !== 200) throw new Error(`health answered ${brief(res)}`);
    return res.body as { mediaLibrary?: MediaHealth; storage?: { locations?: Array<{ kind: string; path: string; writable: boolean }> } };
  };
  const asset = await uploadImage(h, uploader);
  const before = await health();
  const media = before.mediaLibrary;
  if (!media) throw new Error('the health answer has no mediaLibrary');
  if (media.path !== dir) wrong.push(`media path ${media.path} (expected MEDIA_DIR ${dir})`);
  if (!(Number(media.fileCount) >= 1) || !(Number(media.imageCount) >= 1)) wrong.push(`counts ${JSON.stringify(media)}`);
  const [row] = await h.q(`SELECT size_bytes, light_bytes FROM media_assets WHERE id = $1`, [asset.id]);
  if (!(Number(media.originalBytes) >= Number(row.size_bytes)) || !(Number(media.lightBytes) >= Number(row.light_bytes))) {
    wrong.push(`sizes ${media.originalBytes} / ${media.lightBytes} below this file's ${row.size_bytes} / ${row.light_bytes}`);
  }
  if (!(Number(media.diskTotalBytes) > 0) || media.diskFreeBytes === null) wrong.push(`disk ${media.diskFreeBytes} / ${media.diskTotalBytes}`);
  const location = before.storage?.locations?.find(l => l.kind === 'media');
  if (!location || location.path !== dir || location.writable !== true) wrong.push(`storage location ${JSON.stringify(location)}`);

  await h.q(`UPDATE media_assets SET light_bytes = NULL, thumb_bytes = NULL, light_error = '' WHERE id = $1`, [asset.id]);
  const missing = (await health()).mediaLibrary;
  if (!(Number(missing?.lightMissingCount) >= 1) || missing?.status !== 'warning') {
    wrong.push(`an image without a light version: ${JSON.stringify({ status: missing?.status, lightMissingCount: missing?.lightMissingCount })}`);
  }
  if (!missing?.messages?.some(m => m.includes('نسخه سبک'))) wrong.push(`messages ${JSON.stringify(missing?.messages)}`);
  if (missing?.messages?.some(m => /[A-Za-z]/.test(m))) wrong.push('a Latin word reached the card messages');
  return `media card: ${media.fileCount} files, warning with ${missing?.lightMissingCount} images missing a light version`;
}
