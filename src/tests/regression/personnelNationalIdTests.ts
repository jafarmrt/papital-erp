import request from 'supertest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';
import { personnelVersion } from '../fixtures/personnelVersion.js';

/**
 * OBS-R2-56 (product-owner decision ت۴۰): a non-empty national ID is unique among active personnel. Red on the previous
 * code, which checked only the national ID's format.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/** a valid Iranian national ID built from nine digits and its check digit */
export function nationalIdWithCheckDigit(nineDigits: string): string {
  const digits = nineDigits.padStart(9, '1').slice(-9).split('').map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (10 - i), 0);
  const r = sum % 11;
  return `${digits.join('')}${r < 2 ? r : 11 - r}`;
}

export async function runPersonnelNationalIdTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_personnel_national_id_unique_obs_r2_56';
  if (!shouldRun(id, 'obs_r2_56', 'personnel', 'national', 'concurrency')) return results;

  const tStart = Date.now();
  const ids: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const send = (method: 'post' | 'put' | 'delete', url: string, body: object = {}) =>
      request(app)[method](url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const tag = String(Date.now()).slice(-7);
    const nationalId = nationalIdWithCheckDigit(`57${tag}`);
    const activeWithId = async () => (await orm.select({ id: personnel.id }).from(personnel)
      .where(and(sql`btrim(${personnel.nationalId}) = ${nationalId}::text`, eq(personnel.isDeleted, 0)))).map(r => r.id);
    const wrong: string[] = [];

    // 1) five concurrent creates with one national ID: one 201, four Persian 409
    const burst = await Promise.all([0, 1, 2, 3, 4].map(i => send('post', '/api/personnel', { firstName: 'کد ملی', lastName: `${tag} ${i}`, nationalId })));
    const made = await activeWithId();
    ids.push(...made);
    const statuses = burst.map(r => r.status).sort().join(',');
    if (made.length !== 1 || statuses !== '201,409,409,409,409') wrong.push(`concurrent create made ${made.length} active personnel with one national ID (statuses ${statuses})`);
    const refused = burst.find(r => r.status === 409);
    if (refused && (refused.body?.code !== 'PERSONNEL_NATIONAL_ID_TAKEN' || !String(refused.body?.error ?? '').includes('کد ملی'))) {
      wrong.push(`the duplicate answer: ${JSON.stringify(refused.body).slice(0, 160)}`);
    }

    // 2) another personnel cannot take it on edit; the holder keeps it on an unrelated edit
    const other = await send('post', '/api/personnel', { firstName: 'دیگر', lastName: tag });
    if (other.status === 201) ids.push(Number(other.body.id));
    const put = await send('put', `/api/personnel/${other.body.id}`, { version: await personnelVersion(other.body.id), firstName: 'دیگر', lastName: tag, nationalId });
    if (put.status !== 409) wrong.push(`edit to a duplicate national ID returned ${put.status}`);
    if (made[0]) {
      const keep = await send('put', `/api/personnel/${made[0]}`, { version: await personnelVersion(made[0]), firstName: 'کد ملی', lastName: `${tag} نگه‌داشته`, nationalId });
      if (keep.status !== 200) wrong.push(`the holder's own edit returned ${keep.status}`);
    }

    // 3) an Excel row of a new personnel with that national ID is a row error and makes nobody
    const imp = await send('post', '/api/personnel/bulk-import', { rows: [{ personnelCode: `NID-${tag}`, firstName: 'اکسل', lastName: tag, nationalId }] });
    if (imp.status !== 200 || imp.body?.createdCount !== 0 || !(imp.body?.errors ?? []).some((e: { message?: string }) => String(e.message).includes('کد ملی'))) {
      wrong.push(`Excel import with a taken national ID: ${JSON.stringify(imp.body).slice(0, 200)}`);
    }
    const imported = await orm.select({ id: personnel.id }).from(personnel).where(eq(personnel.personnelCode, `NID-${tag}`));
    ids.push(...imported.map(r => r.id));

    // 3b) two new rows of one file with one fresh national ID: the first is made, the second is a row error
    const twinId = nationalIdWithCheckDigit(`58${tag}`);
    const twins = await send('post', '/api/personnel/bulk-import', { rows: [
      { personnelCode: `NID2-${tag}`, firstName: 'دوقلو', lastName: `${tag} ۱`, nationalId: twinId },
      { personnelCode: `NID3-${tag}`, firstName: 'دوقلو', lastName: `${tag} ۲`, nationalId: twinId },
    ] });
    const twinRows = await orm.select({ id: personnel.id }).from(personnel)
      .where(and(sql`btrim(${personnel.nationalId}) = ${twinId}::text`, eq(personnel.isDeleted, 0)));
    ids.push(...twinRows.map(r => r.id));
    if (twins.body?.createdCount !== 1 || twinRows.length !== 1 || (twins.body?.errors ?? []).length !== 1) {
      wrong.push(`two rows of one file with one national ID: ${JSON.stringify(twins.body).slice(0, 200)} and ${twinRows.length} personnel`);
    }

    // 3c) the same national ID typed in Persian digits is the same ID
    const toPersian = (v: string) => v.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
    const persianDigits = await send('post', '/api/personnel', { firstName: 'ارقام فارسی', lastName: tag, nationalId: toPersian(nationalId) });
    if (persianDigits.status === 201) ids.push(Number(persianDigits.body.id));
    if (persianDigits.status !== 409) wrong.push(`the national ID in Persian digits returned ${persianDigits.status}`);

    // 4) a deleted personnel's national ID is free again
    if (made[0]) {
      await send('delete', `/api/personnel/${made[0]}`);
      const reuse = await send('post', '/api/personnel', { firstName: 'جانشین', lastName: tag, nationalId });
      if (reuse.status === 201) ids.push(Number(reuse.body.id));
      if (reuse.status !== 201) wrong.push(`the national ID of a deleted personnel returned ${reuse.status}`);
    }

    // 5) an old duplicate (a database where migration 0122 skipped the index) is listed by the health check
    const { findDuplicatePersonnelNationalIds, buildPersonnelNationalIdHealthTest } = await import('../../services/personnel/personnelNationalIdUnique.js');
    await orm.transaction(async (tx) => {
      await tx.execute(sql`DROP INDEX IF EXISTS uq_personnel_national_id_active`);
      const [dup] = await tx.insert(personnel).values({ fullName: `کد ملی تکراری قدیمی ${tag}`, nationalId }).returning({ id: personnel.id });
      const dups = await findDuplicatePersonnelNationalIds(tx);
      const health = buildPersonnelNationalIdHealthTest(dups, false);
      if (!dups.some(r => r.id === dup.id) || health.status !== 'warning' || health.count < 1) wrong.push(`the health check did not find the duplicate ${JSON.stringify({ n: dups.length, status: health.status })}`);
      if (!health.message.includes('قیدهای جاافتاده')) wrong.push('the health message does not point to the missing-constraints card');
      // the system admin builds the skipped index from the missing-constraints card once the data is clean
      const { findMissingConditionalConstraints } = await import('../../services/system/conditionalConstraints.js');
      const blocked = (await findMissingConditionalConstraints(tx)).find(e => e.name === 'uq_personnel_national_id_active');
      if (blocked?.state !== 'blocked' || blocked.blockers < 1) wrong.push(`missing-constraints card with a duplicate: ${JSON.stringify(blocked ?? null)}`);
      await tx.update(personnel).set({ isDeleted: 1 }).where(eq(personnel.id, dup.id));
      const ready = (await findMissingConditionalConstraints(tx)).find(e => e.name === 'uq_personnel_national_id_active');
      if (ready?.state !== 'ready') wrong.push(`missing-constraints card on clean data: ${JSON.stringify(ready ?? null)}`);
      tx.rollback();
    }).catch((err: unknown) => {
      if (!(err instanceof Error && err.message.toLowerCase().includes('rollback'))) wrong.push(`old duplicate: ${err instanceof Error ? err.message : String(err)}`);
    });

    // 6) on clean data the health check sees the index
    const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
    const report = await FinancialHealthService.runHealthCheck();
    const check = report.tests.find(t => t.id === 'personnel_national_id_uniqueness');
    if (!check || check.metrics?.uniqueIndexPresent !== 1) wrong.push(`national ID health test ${JSON.stringify(check?.metrics ?? null)}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name: 'OBS-R2-56: a national ID is unique among active personnel on create, edit and Excel import; a deleted personnel frees it; the health check lists old duplicates',
      layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'five concurrent creates made one personnel (four 409); edit to a taken ID 409; Excel row and a second row of one file refused; Persian digits are the same ID; deleted ID reused; old duplicate listed and buildable from the missing-constraints card',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name: 'OBS-R2-56: a national ID is unique among active personnel', layer: 'regression', executionType: 'real_database',
      passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (ids.length > 0) await orm.delete(personnel).where(inArray(personnel.id, ids)).catch(() => undefined);
  }
  return results;
}
