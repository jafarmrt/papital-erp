import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { customers, items } from '../../db/schema.js';
import { PICK_LIST_IDS_MAX } from '../../lib/permissions/pickListCap.js';

/**
 * v11 phase 6.1ch (C13): a form's party or item pick list holds at most the cap, and a form that needs the row of a chosen
 * or stored party or item the cut list lacks reads it by id: `GET /customers/options?ids=` and `GET /items/options?ids=`
 * answer only those live rows, with the pick list's fields, whatever their place in the list; a malformed or too long id
 * list is a 400. Real Express routes on PostgreSQL; red on v11.4.0 (both routes refused `ids` as an unknown parameter or
 * answered every row).
 */

interface Session { cookie: string; csrfToken: string }
interface PickRow { id: number; name: string; notes?: unknown; version?: unknown; stocks?: Record<string, number> }

export async function runPickListCapV11Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_pick_list_rows_by_id_v11_6_1ch_c13';
  if (!shouldRun(id, 'v11', 'phase6', 'c13', 'pick-list', 'customers', 'items', 'paging')) return results;

  const name = 'v11 phase 6.1ch (C13): the party and item pick lists answer the rows of chosen ids (`ids=`), only live ones and only the pick fields, beside the capped list; a malformed or too long id list is refused with 400';
  const tStart = Date.now();
  const customerIds: number[] = [];
  const itemIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestCustomer, createTestItem } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin: Session = await getAdminSession();
    const get = (url: string) => request(app).get(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
    const rowsOf = (body: unknown): PickRow[] => {
      const data = (body as { data?: unknown } | null)?.data ?? body;
      return Array.isArray(data) ? (data as PickRow[]) : [];
    };
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];

    const parties = [];
    for (const label of ['الف', 'ب', 'پ']) parties.push(await createTestCustomer({ name: `فهرست انتخاب ${label} ${tag}`, notes: 'یادداشت درونی' }));
    customerIds.push(...parties.map(p => p.id));
    const gone = await createTestCustomer({ name: `فهرست انتخاب حذف‌شده ${tag}`, isDeleted: 1 });
    customerIds.push(gone.id);
    const goods = [];
    for (const label of ['A', 'B', 'C']) goods.push(await createTestItem({ name: `کالای فهرست انتخاب ${label} ${tag}`, code: `C13-${label}-${tag}` }));
    itemIds.push(...goods.map(g => g.id));

    // 1) the capped list: `limit` still cuts the list a form reads
    const capped = await get('/api/customers/options?limit=1');
    if (capped.status !== 200 || rowsOf(capped.body).length !== 1) wrong.push(`customers limit=1: ${capped.status}, ${rowsOf(capped.body).length} rows`);

    // 2) parties by id: only those, live ones only, the pick fields only (no notes or version)
    const byIds = await get(`/api/customers/options?ids=${parties[2].id},${parties[0].id},${gone.id}`);
    const partyRows = rowsOf(byIds.body);
    const partyIdsAnswered = partyRows.map(r => r.id).sort((a, b) => a - b);
    const partyIdsWanted = [parties[0].id, parties[2].id].sort((a, b) => a - b);
    if (byIds.status !== 200) wrong.push(`customers ids: ${byIds.status}`);
    if (JSON.stringify(partyIdsAnswered) !== JSON.stringify(partyIdsWanted)) {
      wrong.push(`customers ids answered ${JSON.stringify(partyIdsAnswered)}, not ${JSON.stringify(partyIdsWanted)} (the deleted party must stay out)`);
    }
    if (partyRows.some(r => 'notes' in r || 'version' in r)) wrong.push('customers ids answered notes or version, which the pick list never shows');

    // 3) items by id: only those, with their stock by warehouse
    const itemsByIds = await get(`/api/items/options?ids=${goods[0].id},${goods[1].id}`);
    const itemRows = rowsOf(itemsByIds.body);
    const itemIdsAnswered = itemRows.map(r => r.id).sort((a, b) => a - b);
    const itemIdsWanted = [goods[0].id, goods[1].id].sort((a, b) => a - b);
    if (itemsByIds.status !== 200) wrong.push(`items ids: ${itemsByIds.status}`);
    if (JSON.stringify(itemIdsAnswered) !== JSON.stringify(itemIdsWanted)) wrong.push(`items ids answered ${JSON.stringify(itemIdsAnswered)}, not ${JSON.stringify(itemIdsWanted)}`);
    if (itemRows.some(r => typeof r.stocks !== 'object' || r.stocks === null)) wrong.push('items ids answered a row without its stock by warehouse');

    // 4) malformed or too long id lists are 400, never a database error or every row
    const tooMany = Array.from({ length: PICK_LIST_IDS_MAX + 1 }, (_, i) => i + 1).join(',');
    for (const bad of ['abc', '0', '1,,2', '1,', '-3', '99999999999', tooMany]) {
      for (const path of ['customers', 'items']) {
        const res = await get(`/api/${path}/options?ids=${encodeURIComponent(bad)}`);
        if (res.status !== 400) wrong.push(`${path} ids=${bad.length > 20 ? `${PICK_LIST_IDS_MAX + 1} ids` : bad} returned ${res.status}, not 400`);
      }
    }
    const most = Array.from({ length: PICK_LIST_IDS_MAX }, (_, i) => i + 1).join(',');
    const atMost = await get(`/api/customers/options?ids=${most}`);
    if (atMost.status !== 200) wrong.push(`customers with ${PICK_LIST_IDS_MAX} ids returned ${atMost.status}, not 200`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `limit=1 cut the list; ids answered the 2 live parties of 3 asked (no notes or version) and the 2 items with their stock; 7 malformed id lists were 400 on both routes; ${PICK_LIST_IDS_MAX} ids were accepted`,
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
    if (customerIds.length > 0) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, customerIds)).catch(() => undefined);
  }
  return results;
}
