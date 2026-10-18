import request from 'supertest';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items, itemWarehouseStocks, outboxEvents, personnel, productionProjects, projectBomAllocations, roles, users } from '../../db/schema.js';
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
const INVOICE_APPROVED_LABEL = 'صدور قطعی فاکتور فروش';

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

  if (shouldRun('reg_bom_allocation_paged_list_td_1322', 'td_1322', 'allocations', 'pagination', 'obs_r2_45', 'nul')) {
    const projectIds: number[] = [];
    const itemIds: number[] = [];
    await runCase(results, 'reg_bom_allocation_paged_list_td_1322',
      'OBS-R2-45 allocations pagination: the material allocation list is searched, filtered, counted and paged in SQL; without page it still answers every filtered allocation; a NUL in a search or status is dropped (TD-1322)',
      'GET /api/inventory/allocations?page= answers { allocations, total, page, limit, statusCounts }; the counts ignore the status picked; the search folds Arabic letters; no page = the whole filtered list; a NUL answers 200 here, in the personnel status and in the daily log search',
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

        // a NUL in a search answered 500 (SQLSTATE 22021): it is dropped like a space
        const nulPage = await get(`&page=1&limit=10&search=${encodeURIComponent('\u0000')}`);
        if (Number(nulPage.total) !== 4) wrong.push(`a search of only a NUL found ${nulPage.total} allocations, expected all 4`);
        const nulExport = await get(`&search=${encodeURIComponent(`${tag}\u0000`)}`);
        if (Number(nulExport.total) !== 4) wrong.push(`the export searched with a NUL after the tag found ${nulExport.total} allocations, expected 4`);
        for (const path of [`/api/personnel?page=1&status=${encodeURIComponent('\u0000')}`, `/api/personnel?status=${encodeURIComponent('a\u0000b')}`, `/api/daily-logs?search=${encodeURIComponent('a\u0000b')}`]) {
          const res = await request(app).get(path).set('Cookie', admin.cookie);
          if (res.status !== 200) wrong.push(`GET ${path.replace('%00', '<NUL>')} answered ${res.status}, expected 200`);
        }
      });
    if (projectIds.length > 0) {
      await orm.delete(projectBomAllocations).where(inArray(projectBomAllocations.projectId, projectIds)).catch(() => undefined);
      await orm.delete(productionProjects).where(inArray(productionProjects.id, projectIds)).catch(() => undefined);
    }
    if (itemIds.length > 0) await orm.delete(items).where(inArray(items.id, itemIds)).catch(() => undefined);
  }

  if (shouldRun('reg_finalize_item_match_like_whole_list_td_1322', 'td_1322', 'finalize', 'reservation', 'preset', 'obs_r2_45')) {
    const itemIds: number[] = [];
    await runCase(results, 'reg_finalize_item_match_like_whole_list_td_1322',
      'OBS-R2-45 finalize reservation and preset: the narrowed item read reserves and prices every item reading all items did, codes and names with a tab, newline, no-break space, BOM or «ß» included (TD-1322)',
      'resolveServerInventoryControl finalizing a global section reserves items stored as code «X\\t», «X\\n», «xß» (row «XSS»), name «Y\\u00a0», «\\ufeffY» and a plain code; a preset section gets their stock, never needs_procurement',
      async (wrong) => {
        const { createTestItem } = await import('../fixtures/factories.js');
        const { resolveServerInventoryControl } = await import('../../services/projects/serverInventoryControl.js');
        const tag = `FM${Date.now().toString(36).toUpperCase()}`;
        const stored = [
          { code: `${tag}A\t`, name: `${tag} a`, row: { itemCode: `${tag}A` } },
          { code: `${tag}B`, name: `${tag} b\u00a0`, row: { name: `${tag} b` } },
          { code: `${tag}C\n`, name: `${tag} c`, row: { itemCode: `${tag}C` } },
          { code: `${tag}D`, name: `\ufeff${tag} d`, row: { name: `${tag} d` } },
          { code: `x${tag}ß`, name: `${tag} e`, row: { itemCode: `X${tag}SS` } },
          { code: `${tag}F`, name: `${tag} f`, row: { itemCode: `${tag}F` } },
        ];
        for (const it of stored) {
          const item = await createTestItem({ type: 'raw_material', code: it.code, name: it.name, unit: 'عدد' });
          itemIds.push(Number(item.id));
        }
        const rows = stored.map((it, i) => ({ itemId: `row-${i}`, itemCode: '', name: '', unit: 'عدد', requiredQty: 2, ...it.row }));
        const finalized = await resolveServerInventoryControl(
          { isFinalized: true, manualPurchaseItems: [], sections: [{ id: 'sec-1', title: 'materials', checkType: 'global', globalItems: rows }] },
          {}, [], orm, null,
        ) as Row & { reservedItems?: Row[] };
        const reserved = new Map((finalized.reservedItems ?? []).map(r => [Number(r.itemId), Number(r.reservedQty)]));
        stored.forEach((it, i) => {
          if (reserved.get(itemIds[i]) !== 2) wrong.push(`the row for ${JSON.stringify(it.code)} / ${JSON.stringify(it.name)} reserved ${reserved.get(itemIds[i]) ?? 'nothing'}, expected 2`);
        });

        const preset = await resolveServerInventoryControl(
          { isFinalized: false, sections: [{ id: 'sec-p', title: 'preset', checkType: 'global', items: stored.map(it => ({ itemCode: it.row.itemCode, name: it.row.name ?? '', unit: 'عدد' })) }] },
          {}, [], orm, null,
        ) as Row & { sections?: Array<Row & { globalItems?: Row[] }> };
        const presetRows = preset.sections?.[0]?.globalItems ?? [];
        stored.forEach((it, i) => {
          const row = presetRows[i];
          if (!row || Number(row.stockQty) !== 100 || row.status !== 'available') {
            wrong.push(`the preset row for ${JSON.stringify(it.code)} / ${JSON.stringify(it.name)} got stock ${row?.stockQty} and ${row?.status}, expected 100 and available`);
          }
        });
      });
    if (itemIds.length > 0) {
      await orm.delete(itemWarehouseStocks).where(inArray(itemWarehouseStocks.itemId, itemIds)).catch(() => undefined);
      await orm.delete(items).where(inArray(items.id, itemIds)).catch(() => undefined);
    }
  }

  if (shouldRun('reg_finalize_case_mapping_pair_td_1322', 'td_1322', 'finalize', 'reservation', 'obs_r2_45')) {
    const itemIds: number[] = [];
    await runCase(results, 'reg_finalize_case_mapping_pair_td_1322',
      'OBS-R2-45 finalize reservation: of two items whose codes differ only by a case mapping PostgreSQL lacks («xß» and «XSS»), the narrowed read reserves the one the whole item list matches (TD-1322)',
      'items «x<tag>ß» (lower id) and «X<tag>SS», a row naming «X<tag>SS»: the reservation goes to findProjectItemMatch over every live item',
      async (wrong) => {
        const { createTestItem } = await import('../fixtures/factories.js');
        const { resolveServerInventoryControl } = await import('../../services/projects/serverInventoryControl.js');
        const { findProjectItemMatch } = await import('../../lib/projects/projectItemMatch.js');
        const tag = `CM${Date.now().toString(36).toUpperCase()}`;
        for (const code of [`x${tag}ß`, `X${tag}SS`]) {
          const item = await createTestItem({ type: 'raw_material', code, name: `${code} pair`, unit: 'عدد' });
          itemIds.push(Number(item.id));
        }
        const live = await orm.select({ id: items.id, code: items.code, name: items.name }).from(items).where(eq(items.isDeleted, 0)).orderBy(asc(items.id));
        const expected = findProjectItemMatch({ code: `X${tag}SS`, name: '' }, live)?.id;
        if (expected !== itemIds[0]) wrong.push(`the whole list matched item ${expected}, expected the lower id ${itemIds[0]} (test setup)`);
        const finalized = await resolveServerInventoryControl(
          { isFinalized: true, manualPurchaseItems: [], sections: [{ id: 'sec-1', title: 'materials', checkType: 'global', globalItems: [
            { itemId: 'row-0', itemCode: `X${tag}SS`, name: '', unit: 'عدد', requiredQty: 2 },
          ] }] },
          {}, [], orm, null,
        ) as Row & { reservedItems?: Row[] };
        const reserved = (finalized.reservedItems ?? []).map(r => `${Number(r.itemId)}:${Number(r.reservedQty)}`);
        if (reserved.join(',') !== `${expected}:2`) wrong.push(`reserved ${JSON.stringify(reserved)}, expected ${expected}:2`);
      });
    if (itemIds.length > 0) {
      await orm.delete(itemWarehouseStocks).where(inArray(itemWarehouseStocks.itemId, itemIds)).catch(() => undefined);
      await orm.delete(items).where(inArray(items.id, itemIds)).catch(() => undefined);
    }
  }

  if (shouldRun('reg_outbox_server_search_td_1323', 'td_1323', 'events', 'outbox', 'pagination', 'obs_r2_86')) {
    const eventIds: string[] = [];
    await runCase(results, 'reg_outbox_server_search_td_1323',
      'OBS-R2-86: the outbox list is searched on the server, by id, payload text and the Persian event name, and paged with its total (TD-1323)',
      'GET /api/events/outbox ignored search, so the screen searched only the newest 100 rows it had read',
      async (wrong) => {
        const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
        const app = await getTestApp();
        const admin = await getAdminSession();
        const tag = `ob${Date.now().toString(36)}`;
        const rows = [
          { eventId: `${tag}-a`, eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: `${tag}A`, payload: {} },
          { eventId: `${tag}-b`, eventType: 'StockIssued', aggregateType: 'Item', aggregateId: '1', payload: { memo: tag.toUpperCase() } },
          { eventId: `c-${Date.now()}`, eventType: 'StockIssued', aggregateType: 'Item', aggregateId: '2', payload: {} },
        ];
        await orm.insert(outboxEvents).values(rows.map(r => ({ ...r, status: 'completed' })));
        eventIds.push(...rows.map(r => r.eventId));
        const get = async (query: string) => {
          const res = await request(app).get(`/api/events/outbox?${query}`).set('Cookie', admin.cookie);
          if (res.status !== 200) throw new Error(`GET /api/events/outbox?${query} returned ${res.status}`);
          const events = Array.isArray(res.body?.events) ? res.body.events as Row[] : [];
          return { ids: events.map(e => String(e.eventId)), total: Number(res.body?.total) };
        };
        const byTag = await get(`search=${tag}&page=1&limit=50`);
        if (byTag.total !== 2 || !byTag.ids.includes(`${tag}-a`) || !byTag.ids.includes(`${tag}-b`)) {
          wrong.push(`search by the tag answered total ${byTag.total} with ${byTag.ids.length} rows, expected the two tagged rows (one by id, one by payload text)`);
        }
        const byLabel = await get(`search=${encodeURIComponent(INVOICE_APPROVED_LABEL)}&page=1&limit=1000`);
        if (!byLabel.ids.includes(`${tag}-a`) || byLabel.ids.includes(`${tag}-b`)) wrong.push('a search by the Persian event name did not find exactly that type');
        const second = await get(`search=${tag}&page=2&limit=1`);
        if (second.ids.length !== 1 || second.total !== 2) wrong.push(`page 2 of 1 answered ${second.ids.length} rows, total ${second.total}`);
      });
    if (eventIds.length > 0) await orm.delete(outboxEvents).where(inArray(outboxEvents.eventId, eventIds)).catch(() => undefined);
  }

  if (shouldRun('reg_event_timeline_aggregate_limit_td_1323', 'td_1323', 'events', 'timeline', 'pagination')) {
    const projectIds: number[] = [];
    await runCase(results, 'reg_event_timeline_aggregate_limit_td_1323',
      'The entity picker of the event timeline reads a bounded number of rows: a malformed or negative limit is 20, a larger one 50 (TD-1323)',
      'GET /api/events/timeline/aggregates?limit=-1 answered no rows (the query failed and was swallowed) and limit=100000 read every row',
      async (wrong) => {
        const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
        const app = await getTestApp();
        const admin = await getAdminSession();
        const tag = `TL${Date.now().toString(36)}`;
        const rows = await orm.insert(productionProjects).values(Array.from({ length: 60 }, (_, i) => ({ projectCode: `${tag}-${i}`, title: `${tag} ${i}` })))
          .returning({ id: productionProjects.id });
        projectIds.push(...rows.map(r => r.id));
        const count = async (limit: string) => {
          const res = await request(app).get(`/api/events/timeline/aggregates?type=project&search=${tag}&limit=${limit}`).set('Cookie', admin.cookie);
          if (res.status !== 200) throw new Error(`GET /api/events/timeline/aggregates?limit=${limit} returned ${res.status}`);
          return Array.isArray(res.body?.data) ? res.body.data.length : -1;
        };
        for (const [limit, want] of [['-1', 20], ['abc', 20], ['100000', 50], ['5', 5]] as const) {
          const got = await count(limit);
          if (got !== want) wrong.push(`limit=${limit} answered ${got} rows, expected ${want}`);
        }
      });
    if (projectIds.length > 0) await orm.delete(productionProjects).where(inArray(productionProjects.id, projectIds)).catch(() => undefined);
  }

  return results;
}
