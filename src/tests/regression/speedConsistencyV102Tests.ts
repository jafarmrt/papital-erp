import request from 'supertest';
import { eq, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items, personnel, productionProjects, projectBomAllocations, roles, users } from '../../db/schema.js';
import { deleteTestRoles } from '../fixtures/roleCleanup.js';
import { money } from '../../lib/money.js';

/**
 * 10.2 package 11 (speed and consistency): lists the browser used to read whole and filter itself are read one page at a
 * time from the server. Each case is red on the code before its fix.
 */
type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Row = Record<string, unknown>;

async function runCase(results: TestCaseResult[], id: string, name: string, details: string, body: (wrong: string[]) => Promise<void>) {
  const tStart = Date.now();
  const wrong: string[] = [];
  try {
    await body(wrong);
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

const TERMINATED = 'قطع همکاری';
/** typed with the Persian «ی»; the allocation stores the Arabic «ي» */
const PERSIAN_YEH_SEARCH = 'آبی';

/** A valid Iranian national ID not used by another test run */
function randomNationalId(): string {
  const body = Array.from({ length: 9 }, (_, i) => (i === 0 ? 1 + Math.floor(Math.random() * 9) : Math.floor(Math.random() * 10)));
  const r = body.reduce((sum, d, i) => sum + d * (10 - i), 0) % 11;
  return `${body.join('')}${r < 2 ? r : 11 - r}`;
}
const EXPORT_COLUMNS = ['ملیت', 'تاریخ پایان همکاری', 'علت قطع همکاری', 'نوع حقوق', 'حقوق ماهانه', 'مشمول بیمه', 'مشمول مالیات حقوق', 'مشمول عیدی'];

export async function runSpeedConsistencyV102Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('reg_personnel_paged_list_td_1321', 'td_1321', 'personnel', 'pagination', 'obs_r2_57', 'obs_r1_69')) {
    const personnelIds: number[] = [];
    const roleIds: number[] = [];
    const userIds: number[] = [];
    await runCase(results, 'reg_personnel_paged_list_td_1321',
      'OBS-R2-57 / OBS-R1-69 personnel pagination: the list is searched, filtered, counted and paged in SQL, the pick list honours its limit, and the export carries the whole dossier (TD-1321)',
      'GET /api/personnel?page= answers { data, total, page, limit, stats }; search folds Arabic letters and looks only at fields the reader sees; ?limit caps the array; the export has end date, salary and coverage columns',
      async (wrong) => {
        const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
        const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
        const app = await getTestApp();
        const admin = await getAdminSession();
        const tag = `PG${Date.now().toString(36)}`;
        const nationalId = randomNationalId();
        // «ي» and «ك» stored Arabic: a search typed with Persian letters must still find them
        const inserted = await orm.insert(personnel).values([
          { fullName: `علي ${tag} يك`, firstName: 'علي', lastName: `${tag} يك`, personnelCode: `${tag}-1`, employmentStatus: 'فعال', nationalId, monthlySalary: money('30000000'), salaryType: 'monthly_fixed', isInsuranceCovered: 1 },
          { fullName: `رضا ${tag} دو`, firstName: 'رضا', lastName: `${tag} دو`, personnelCode: `${tag}-2`, employmentStatus: 'فعال' },
          { fullName: `مریم ${tag} سه`, firstName: 'مریم', lastName: `${tag} سه`, personnelCode: `${tag}-3`, employmentStatus: TERMINATED, endDate: '2026-03-01', terminationReason: 'پایان قرارداد' },
        ]).returning({ id: personnel.id });
        personnelIds.push(...inserted.map(r => r.id));

        const get = async (cookie: string, query: string) => {
          const res = await request(app).get(`/api/personnel${query}`).set('Cookie', cookie);
          if (res.status !== 200) throw new Error(`GET /api/personnel${query} returned ${res.status}: ${JSON.stringify(res.body).slice(0, 160)}`);
          return res.body as Row & { data?: Row[]; stats?: Row };
        };

        const first = await get(admin.cookie, `?page=1&limit=2&search=${encodeURIComponent(tag)}`);
        if (Array.isArray(first) || !Array.isArray(first.data)) {
          wrong.push(`a paged request answered ${Array.isArray(first) ? 'the whole array' : JSON.stringify(first).slice(0, 120)}`);
          return;
        }
        if (first.data.length !== 2 || Number(first.total) !== 3 || Number(first.page) !== 1 || Number(first.limit) !== 2) {
          wrong.push(`page 1 of 2: ${first.data.length} rows, total ${first.total}, page ${first.page}, limit ${first.limit}`);
        }
        const second = await get(admin.cookie, `?page=2&limit=2&search=${encodeURIComponent(tag)}`);
        const seen = [...first.data, ...(second.data ?? [])].map(r => Number(r.id));
        if ((second.data ?? []).length !== 1 || new Set(seen).size !== 3 || !personnelIds.every(id => seen.includes(id))) {
          wrong.push(`the two pages did not hold the three personnel once each: ${seen.join(',')}`);
        }
        const [live] = await orm.select({
          total: sql<number>`count(*)::int`,
          terminated: sql<number>`(count(*) FILTER (WHERE ${personnel.employmentStatus} = ${TERMINATED}))::int`,
        }).from(personnel).where(eq(personnel.isDeleted, 0));
        const stats = first.stats ?? {};
        if (Number(stats.total) !== Number(live.total) || Number(stats.terminated) !== Number(live.terminated)) {
          wrong.push(`the cards counted ${stats.total}/${stats.terminated}, the table holds ${live.total}/${live.terminated}`);
        }

        const terminated = await get(admin.cookie, `?page=1&limit=10&status=${encodeURIComponent(TERMINATED)}&search=${encodeURIComponent(tag)}`);
        if (Number(terminated.total) !== 1 || terminated.data?.[0]?.personnelCode !== `${tag}-3`) wrong.push(`the status filter found ${terminated.total}`);
        const folded = await get(admin.cookie, `?page=1&limit=10&search=${encodeURIComponent(`علی ${tag} یک`)}`);
        if (Number(folded.total) !== 1) wrong.push(`a Persian-letter search found ${folded.total} of the Arabic-letter name`);
        const byNationalId = await get(admin.cookie, `?page=1&limit=10&search=${nationalId}`);
        if (!(byNationalId.data ?? []).some(r => Number(r.id) === personnelIds[0])) wrong.push('the admin did not find the personnel by national ID');

        // a pick-list reader searches only the fields it sees and never gets the dossier
        const role = await createTestRole({ permissions: ['projects.view'] });
        roleIds.push(role.id);
        const user = await createTestUser({ role: role.code });
        userIds.push(user.id);
        const picker = await loginTestUserWithSession(app, user.username);
        const hidden = await get(picker.cookie, `?page=1&limit=10&search=${nationalId}`);
        if ((hidden.data ?? []).some(r => Number(r.id) === personnelIds[0])) wrong.push('a pick-list reader found the personnel by national ID');
        const pickPage = await get(picker.cookie, `?page=1&limit=10&search=${encodeURIComponent(tag)}`);
        if (Number(pickPage.total) !== 3) wrong.push(`a pick-list reader found ${pickPage.total} by name`);
        if ((pickPage.data ?? []).some(r => 'nationalId' in r || 'monthlySalary' in r)) wrong.push('a pick-list reader got dossier or salary fields on a page');

        // OBS-R1-69: the array the pickers read is searched and capped on the server
        const capped = await get(admin.cookie, `?search=${encodeURIComponent(tag)}&limit=1`);
        if (!Array.isArray(capped) || capped.length !== 1) wrong.push(`?limit=1 answered ${Array.isArray(capped) ? capped.length : 'no array'} rows`);

        const exported = await request(app).get('/api/personnel/export').set('Cookie', admin.cookie);
        const exportRow = (exported.body?.rows ?? []).find((r: Row) => r['کد پرسنلی'] === `${tag}-3` || Object.values(r).includes(`${tag}-3`)) as Row | undefined;
        if (!exportRow) {
          wrong.push(`the export (${exported.status}) did not list the personnel`);
        } else {
          const missing = EXPORT_COLUMNS.filter(c => !(c in exportRow));
          if (missing.length > 0) wrong.push(`the export lacks ${missing.join('، ')}`);
          if (exportRow['علت قطع همکاری'] !== 'پایان قرارداد') wrong.push('the export lost the termination reason');
        }
        const salaryRow = (exported.body?.rows ?? []).find((r: Row) => Object.values(r).includes(`${tag}-1`)) as Row | undefined;
        if (salaryRow && (Number(salaryRow['حقوق ماهانه']) !== 30000000 || salaryRow['مشمول بیمه'] !== 'بله')) {
          wrong.push(`the export showed salary ${salaryRow['حقوق ماهانه']} and insurance ${salaryRow['مشمول بیمه']}`);
        }
      });
    if (personnelIds.length > 0) await orm.delete(personnel).where(inArray(personnel.id, personnelIds)).catch(() => undefined);
    if (userIds.length > 0) await orm.delete(users).where(inArray(users.id, userIds)).catch(() => undefined);
    if (roleIds.length > 0) await deleteTestRoles(inArray(roles.id, roleIds)).catch(() => undefined);
  }

  if (shouldRun('reg_personnel_search_cap_td_1321', 'td_1321', 'personnel', 'pagination')) {
    const personnelIds: number[] = [];
    await runCase(results, 'reg_personnel_search_cap_td_1321',
      'OBS-R1-69 personnel pagination: a search ignores spaces and zero-width marks, activeOnly leaves out leavers, and a pick list without a limit stays uncapped (TD-1321)',
      'a search with a space or without the zero-width non-joiner finds a name stored with it, ta marbuta reads as heh; ?activeOnly=1 drops terminated personnel; no limit answers every row, ?limit at most 5001',
      async (wrong) => {
        const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
        const app = await getTestApp();
        const admin = await getAdminSession();
        const tag = `ZW${Date.now().toString(36)}`;
        const inserted = await orm.insert(personnel).values([
          { fullName: `علی\u200cزاده ${tag}`, firstName: 'علی', lastName: `زاده ${tag}`, employmentStatus: 'فعال' },
          { fullName: `فاطمة ${tag}`, firstName: 'فاطمة', lastName: tag, employmentStatus: 'فعال' },
          { fullName: `رضا ${tag}`, firstName: 'رضا', lastName: tag, employmentStatus: TERMINATED },
        ]).returning({ id: personnel.id });
        personnelIds.push(...inserted.map(r => r.id));

        const rows = async (query: string): Promise<Row[]> => {
          const res = await request(app).get(`/api/personnel${query}`).set('Cookie', admin.cookie);
          if (res.status !== 200 || !Array.isArray(res.body)) throw new Error(`GET /api/personnel${query} returned ${res.status}`);
          return res.body as Row[];
        };
        for (const search of [`علی زاده ${tag}`, `علیزاده ${tag}`, `علی\u200cزاده${tag}`, `فاطمه ${tag}`]) {
          const found = await rows(`?search=${encodeURIComponent(search)}`);
          if (found.length !== 1) wrong.push(`the search ${JSON.stringify(search)} found ${found.length} rows`);
        }
        // a NUL in the search answered 500 (SQLSTATE 22021): it is dropped like a space
        const withNul = await rows(`?search=${encodeURIComponent(`علی\u0000زاده ${tag}`)}`);
        if (withNul.length !== 1) wrong.push(`the search with a NUL character found ${withNul.length} rows`);
        const everyone = await rows(`?search=${encodeURIComponent(tag)}`);
        const active = await rows(`?search=${encodeURIComponent(tag)}&activeOnly=1`);
        if (everyone.length !== 3) wrong.push(`the tagged search found ${everyone.length} of 3`);
        if (active.length !== 2 || active.some(r => r.employmentStatus === TERMINATED)) {
          wrong.push(`activeOnly answered ${active.length} rows, leavers included: ${active.some(r => r.employmentStatus === TERMINATED)}`);
        }

        const bulkTag = `BULK${Date.now().toString(36)}`;
        const bulk = await orm.insert(personnel).values(
          Array.from({ length: 5002 }, (_, i) => ({ fullName: `${bulkTag} ${i}`, employmentStatus: 'فعال' })),
        ).returning({ id: personnel.id });
        personnelIds.push(...bulk.map(r => r.id));
        const bulkSearch = `?search=${encodeURIComponent(bulkTag)}`;
        const counts: Array<[string, number]> = [['', 5002], ['&limit=0', 5002], ['&limit=abc', 5002], ['&limit=5001', 5001], ['&limit=999999', 5001], ['&limit=20', 20]];
        for (const [limit, expected] of counts) {
          const got = (await rows(`${bulkSearch}${limit}`)).length;
          if (got !== expected) wrong.push(`${limit || 'no limit'} answered ${got} rows, expected ${expected}`);
        }
      });
    if (personnelIds.length > 0) await orm.delete(personnel).where(inArray(personnel.id, personnelIds)).catch(() => undefined);
  }

  if (shouldRun('reg_bom_allocation_paged_list_td_1322', 'td_1322', 'allocations', 'pagination', 'obs_r2_45')) {
    const projectIds: number[] = [];
    const itemIds: number[] = [];
    await runCase(results, 'reg_bom_allocation_paged_list_td_1322',
      'OBS-R2-45: the material allocation list is searched, filtered, counted and paged in SQL; without page it still answers every filtered allocation (TD-1322)',
      'GET /api/inventory/allocations?page= answers { allocations, total, page, limit, statusCounts }; the counts ignore the status picked; the search folds Arabic letters; no page = the whole filtered list',
      async (wrong) => {
        const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
        const { createTestItem } = await import('../fixtures/factories.js');
        const app = await getTestApp();
        const admin = await getAdminSession();
        const tag = `AL${Date.now().toString(36)}`;
        const [project] = await orm.insert(productionProjects).values({ projectCode: `${tag}-P`, title: `پروژه ${tag}` }).returning({ id: productionProjects.id });
        projectIds.push(project.id);
        const item = await createTestItem({ type: 'raw_material' });
        itemIds.push(item.id);
        // «ي» stored Arabic: a search typed with the Persian «ی» must still find it
        const statuses = ['allocated', 'allocated', 'consumed', 'released'];
        await orm.insert(projectBomAllocations).values(statuses.map((status, i) => ({
          projectId: project.id, projectCode: `${tag}-P`, itemId: item.id, itemCode: item.code, itemName: i === 0 ? `مهره ${tag} آبي` : `سنگ ${tag}`,
          quantity: i + 1, status, username: 'admin',
        })));

        const get = async (query: string) => {
          const res = await request(app).get(`/api/inventory/allocations?projectId=${project.id}${query}`).set('Cookie', admin.cookie);
          if (res.status !== 200) throw new Error(`GET /api/inventory/allocations${query} returned ${res.status}: ${JSON.stringify(res.body).slice(0, 160)}`);
          return res.body as Row & { allocations?: Row[]; statusCounts?: Row };
        };

        const first = await get('&page=1&limit=3');
        if ((first.allocations ?? []).length !== 3 || Number(first.total) !== 4 || Number(first.page) !== 1 || Number(first.limit) !== 3) {
          wrong.push(`page 1 of 3: ${(first.allocations ?? []).length} rows, total ${first.total}, page ${first.page}, limit ${first.limit}`);
        }
        const counts = first.statusCounts ?? {};
        if (Number(counts.all) !== 4 || Number(counts.allocated) !== 2 || Number(counts.consumed) !== 1 || Number(counts.released) !== 1) {
          wrong.push(`status counts ${JSON.stringify(first.statusCounts)}, expected all 4, allocated 2, consumed 1, released 1`);
        }
        const second = await get('&page=2&limit=3');
        if ((second.allocations ?? []).length !== 1) wrong.push(`page 2 of 3 had ${(second.allocations ?? []).length} rows, expected 1`);
        const pagedIds = new Set([...(first.allocations ?? []), ...(second.allocations ?? [])].map(r => Number(r.id)));
        if (pagedIds.size !== 4) wrong.push(`the two pages held ${pagedIds.size} distinct allocations, expected 4`);

        const allocatedOnly = await get('&page=1&limit=10&status=allocated');
        if (Number(allocatedOnly.total) !== 2 || (allocatedOnly.allocations ?? []).some(r => r.status !== 'allocated')) {
          wrong.push(`the allocated filter answered total ${allocatedOnly.total} with statuses ${(allocatedOnly.allocations ?? []).map(r => r.status).join(',')}`);
        }
        if (Number(allocatedOnly.statusCounts?.all) !== 4) wrong.push(`the status counts followed the status filter: ${JSON.stringify(allocatedOnly.statusCounts)}`);

        const searched = await get(`&page=1&limit=10&search=${encodeURIComponent(PERSIAN_YEH_SEARCH)}`);
        if (Number(searched.total) !== 1) wrong.push(`a search with the Persian yeh found ${searched.total} allocations, expected the one stored with the Arabic yeh`);

        const whole = await get('');
        if ((whole.allocations ?? []).length !== 4 || Number(whole.total) !== 4 || 'statusCounts' in whole) {
          wrong.push(`without page the list answered ${(whole.allocations ?? []).length} rows, total ${whole.total}`);
        }
      });
    if (projectIds.length > 0) {
      await orm.delete(projectBomAllocations).where(inArray(projectBomAllocations.projectId, projectIds)).catch(() => undefined);
      await orm.delete(productionProjects).where(inArray(productionProjects.id, projectIds)).catch(() => undefined);
    }
    if (itemIds.length > 0) await orm.delete(items).where(inArray(items.id, itemIds)).catch(() => undefined);
  }

  return results;
}
