import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * OBS-R1-04, v10.0.259: `/uploads` serves without a session only image files and the public asset folders. On
 * v10.0.258 any file whose name contained «logo» or «favicon» (a text or HTML file too) was served to anyone.
 */
export async function runPublicUploadPathTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_public_upload_path_obs_r1_04';
  if (!shouldRun(id, 'obs-r1-04', 'uploads', 'logo', 'package1')) return results;

  const name = 'v10.0.259: /uploads serves only images without a session, not any file named logo (OBS-R1-04)';
  const tStart = Date.now();
  const dir = path.join(process.cwd(), 'public', 'uploads');
  const stamp = String(Date.now());
  const textFile = `logo-obs-r1-04-${stamp}.html`;
  const iconText = `favicon-obs-r1-04-${stamp}.txt`;
  const imageFile = `logo-obs-r1-04-${stamp}.png`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, textFile), '<script>alert(1)</script>');
    fs.writeFileSync(path.join(dir, iconText), 'not an icon');
    fs.writeFileSync(path.join(dir, imageFile), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { getTestApp } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const wrong: string[] = [];
    for (const file of [textFile, iconText]) {
      const res = await request(app).get(`/uploads/${file}`);
      if (res.status !== 401) wrong.push(`${file} without a session answered ${res.status}, expected 401`);
    }
    const image = await request(app).get(`/uploads/${imageFile}`);
    if (image.status !== 200) wrong.push(`${imageFile} without a session answered ${image.status}, expected 200`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'logo-*.html and favicon-*.txt without a session -> 401; logo-*.png -> 200',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    for (const file of [textFile, iconText, imageFile]) fs.rmSync(path.join(dir, file), { force: true });
  }
  return results;
}
