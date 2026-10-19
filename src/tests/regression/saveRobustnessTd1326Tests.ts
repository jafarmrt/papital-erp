import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { createProject, globalSection, runReservationCases, storedReservation } from './stockReservationTests.js';

/**
 * v10.2 package 11 part 4a (TD-1326): the project inventory control body has a schema (OBS-R1-92) and the warehouse
 * dashboard is read by a service without the unused, uncapped parts (OBS-R2-97). Through the real Express routes; each
 * case is red on the code before its fix.
 */
export async function runSaveRobustnessTd1326Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_project_inventory_control_schema_td_1326',
      'v10.2.28: a project inventory control row quantity typed with Persian digits is stored and reserved as its number; text or a non-boolean finalize flag is 400 (TD-1326, OBS-R1-92)',
      ['td1326', 'obs-r1-92', 'projects', 'reservation', 'package11'], inventoryControlCase],
    ['reg_warehouse_dashboard_service_td_1326',
      'v10.2.28: the warehouse dashboard answers without the unused reorder alarm list, low-stock count and user count (TD-1326, OBS-R2-97)',
      ['td1326', 'obs-r2-97', 'dashboard', 'inventory', 'package11'], dashboardCase],
  ]);
}

async function inventoryControlCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const itemId = await f.item(10);
  const [it] = await h.q('SELECT code, name FROM items WHERE id = $1', [itemId]);
  const row = (requiredQty: unknown) => ({ itemCode: it.code, name: it.name, unit: 'عدد', requiredQty });

  // «۲» typed in a row reaches the finalize as the number 2, never NaN
  const project = await createProject(h, { sections: globalSection([row('۲')]), isFinalized: true });
  const reserved = await storedReservation(h, project);
  const reservedQty = Number(reserved.find(r => Number(r.itemId) === itemId)?.reservedQty);
  if (reservedQty !== 2) wrong.push(`a Persian-digit quantity reserved ${JSON.stringify(reserved)}, not 2`);
  const [stored] = await h.q(`SELECT inventory_control->'sections'->0->'globalItems'->0->'requiredQty' AS q FROM production_projects WHERE id = $1`, [project]);
  if (stored?.q !== 2) wrong.push(`the stored row quantity is ${JSON.stringify(stored?.q)}, not the number 2`);

  const title = () => `TD-1326 ${h.tag} ${Math.floor(Math.random() * 1e6)}`;
  const text = await h.post('/api/projects', { title: title(), products: [], inventory_control: { sections: globalSection([row('دو عدد')]) } });
  if (text.status !== 400) wrong.push(`a text quantity answered ${brief(text)}`);
  const negative = await h.post('/api/projects', { title: title(), products: [], inventoryControl: { sections: globalSection([row(-3)]) } });
  if (negative.status !== 400) wrong.push(`a negative quantity answered ${brief(negative)}`);
  const flag = await h.post('/api/projects', { title: title(), products: [], inventory_control: { sections: [], isFinalized: 'yes' } });
  if (flag.status !== 400) wrong.push(`a text finalize flag answered ${brief(flag)}`);
  const sections = await h.post('/api/projects', { title: title(), products: [], inventory_control: { sections: 'all' } });
  if (sections.status !== 400) wrong.push(`sections given as text answered ${brief(sections)}`);
  // an empty quantity and fields the server does not read stay as the browser sent them
  const empty = await h.post('/api/projects', { title: title(), products: [], inventory_control: { sections: globalSection([{ ...row(''), note: 'x' }]), uiTab: 'global' } });
  if (empty.status !== 201) wrong.push(`an empty quantity answered ${brief(empty)}`);
  return `reserved ${reservedQty}; text ${text.status}, negative ${negative.status}, flag ${flag.status}, sections ${sections.status}, empty ${empty.status}`;
}

async function dashboardCase(h: Harness, wrong: string[]): Promise<string> {
  const { invalidateDashboardBiCache } = await import('../../services/inventory/warehouseDashboard.service.js');
  invalidateDashboardBiCache();
  const stats = await h.get('/api/stats');
  const bi = await h.get('/api/dashboard-bi-stats');
  if (stats.status !== 200 || bi.status !== 200) throw new Error(`dashboard answered ${stats.status} / ${bi.status}`);
  for (const key of ['lowStock', 'activeUsers']) if (key in stats.body) wrong.push(`/stats still carries ${key}`);
  for (const key of ['totalProducts', 'totalMaterials', 'recentTx']) if (typeof stats.body[key] !== 'number') wrong.push(`/stats lost ${key}`);
  if ('reorderAlarms' in bi.body) wrong.push('/dashboard-bi-stats still carries the uncapped reorderAlarms list');
  for (const key of ['locations', 'locationItemCounts', 'monthlyTrends', 'fastMoving']) if (!(key in bi.body)) wrong.push(`/dashboard-bi-stats lost ${key}`);
  return `stats ${Object.keys(stats.body).join(',')}; bi ${Object.keys(bi.body).join(',')}`;
}
