import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items, pendingMaterials, productionProjects } from '../../db/schema.js';
import { createTestItem } from '../fixtures/factories.js';

/**
 * Package 7 observations of the series 9 ledger (TD-989), each proven here before its fix.
 */
export async function runInventoryPlanningLedgerTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const record = async (id: string, name: string, details: string, body: () => Promise<void>) => {
    const tStart = Date.now();
    try {
      await body();
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  if (shouldRun('reg_reservation_date_server_clock_obs_r1_88', 'td989', 'obs-r1-88', 'reservation', 'package7')) {
    await record(
      'reg_reservation_date_server_clock_obs_r1_88',
      'v10.0.169: a project reservation is dated by its UTC registration time, never the server clock (OBS-R1-88)',
      'a finalized project reservation row carries the project registration time as UTC ISO with Z',
      async () => {
        const { ItemStockReservationService } = await import('../../services/items/itemStockReservation.service.js');
        const item = await createTestItem({ currentStock: 0 });
        const [project] = await orm.insert(productionProjects).values({
          projectCode: `R188-${Date.now()}`, title: 'obs-r1-88 project', status: 'in_progress',
          inventoryControl: { isFinalized: true, reservedItems: [{ itemId: item.id, reservedQty: 2 }] },
        }).returning({ id: productionProjects.id, createdAt: productionProjects.createdAt });
        try {
          const report = await ItemStockReservationService.getReservedStockDetails(orm, true, { itemIds: [item.id] });
          const entry = report.allReservationEntries.find(e => e.sourceType === 'project' && Number(e.sourceId) === project.id);
          if (!entry) throw new Error('the project reservation is missing from the report');
          const expected = `${String(project.createdAt).trim().replace(' ', 'T').replace(/\.\d+$/, '')}`;
          if (!/Z$/.test(entry.date) || !entry.date.startsWith(expected.slice(0, 19))) {
            throw new Error(`reservation date must be the UTC registration time with Z (stored ${project.createdAt}, got ${entry.date})`);
          }
        } finally {
          await orm.delete(productionProjects).where(eq(productionProjects.id, project.id));
          await orm.update(items).set({ isDeleted: 1 }).where(eq(items.id, item.id));
        }
      },
    );
  }

  if (shouldRun('reg_sellable_default_warehouse_obs_r1_89', 'td989', 'obs-r1-89', 'sellable', 'package7')) {
    await record(
      'reg_sellable_default_warehouse_obs_r1_89',
      'v10.0.170: sellable stock is never computed for a guessed «main» warehouse (OBS-R1-89)',
      'computeSellable without a warehouse is refused with SELLABLE_LOCATION_REQUIRED instead of reading «main»',
      async () => {
        const { ItemStockReservationService } = await import('../../services/items/itemStockReservation.service.js');
        let code = '';
        try {
          const info = ItemStockReservationService.computeSellable(undefined, { main: 5, shop: 3 }, { location: '' });
          code = `returned locationStock ${info.locationStock}`;
        } catch (err) {
          code = (err as { code?: string }).code ?? String(err);
        }
        if (code !== 'SELLABLE_LOCATION_REQUIRED') throw new Error(`expected SELLABLE_LOCATION_REQUIRED, got ${code}`);
      },
    );
  }

  if (shouldRun('reg_pending_material_list_paged_obs_r1_90', 'td989', 'obs-r1-90', 'pending', 'package7')) {
    await record(
      'reg_pending_material_list_paged_obs_r1_90',
      'v10.0.171: the raw material request queue answers one page with its status counts (OBS-R1-90)',
      'GET /pending-materials filters by status and search, pages with limit and counts every status in SQL',
      async () => {
        const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
        const app = await getTestApp();
        const admin = await getAdminSession();
        const tag = `R190${Date.now()}`;
        const inserted = await orm.insert(pendingMaterials).values([
          { code: '', unit: 'عدد', name: `${tag} a`, status: 'pending' },
          { code: '', unit: 'عدد', name: `${tag} b`, status: 'pending' },
          { code: '', unit: 'عدد', name: `${tag} c`, status: 'rejected' },
        ]).returning({ id: pendingMaterials.id });
        try {
          const res = await request(app).get(`/api/pending-materials?status=pending&search=${tag}&limit=1&page=2`).set('Cookie', admin.cookie);
          const body = res.body as { data?: Array<{ name: string }>; total?: number; page?: number; limit?: number; statusCounts?: Record<string, number> };
          if (res.status !== 200 || !Array.isArray(body.data)) throw new Error(`expected a page object, got ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
          if (body.data.length !== 1 || body.total !== 2 || body.page !== 2 || body.limit !== 1) {
            throw new Error(`expected page 2 of 2 pending rows with one row, got ${JSON.stringify({ n: body.data.length, total: body.total, page: body.page, limit: body.limit })}`);
          }
          const c = body.statusCounts ?? {};
          if (c.pending !== 2 || c.rejected !== 1 || c.approved !== 0) throw new Error(`status counts under the search are wrong: ${JSON.stringify(c)}`);
          const bad = await request(app).get('/api/pending-materials?status=lost').set('Cookie', admin.cookie);
          if (bad.status !== 400) throw new Error(`an unknown status must be 400, got ${bad.status}`);
        } finally {
          await orm.delete(pendingMaterials).where(inArray(pendingMaterials.id, inserted.map(r => r.id)));
        }
      },
    );
  }

  return results;
}
