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
      'v10.2.30: a project inventory control row quantity typed with Persian digits is stored and reserved as its number; text or a non-boolean finalize flag is 400 (TD-1326, OBS-R1-92)',
      ['td1326', 'obs-r1-92', 'projects', 'reservation', 'package11'], inventoryControlCase],
    ['reg_project_inventory_control_per_unit_td_1326',
      'v10.2.30: a quantity per unit (TD-1343) is checked like the other quantities: 2 in Persian digits is stored as 2 and reserved per unit, null keeps a total row, text, a negative or an empty text is 400 (TD-1326)',
      ['td1326', 'td1343', 'projects', 'reservation', 'package11'], perUnitCase],
    ['reg_project_inventory_control_legacy_row_td_1326',
      'v10.2.30: a row stored before the schema with an odd quantity makes the tab\'s save 400 naming its section and row; fixing that row saves, and odd fields the server does not read pass through (TD-1326)',
      ['td1326', 'projects', 'upgrade', 'package11'], legacyRowCase],
    ['reg_warehouse_dashboard_service_td_1326',
      'v10.2.30: the warehouse dashboard answers without the unused reorder alarm list, low-stock count and user count (TD-1326, OBS-R2-97)',
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
  // «٬» only between groups of three digits and no space between digits, the number field's own rule: never 12 or 125
  const misplaced: string[] = [];
  // v10.2.31: the invisible marks the number field drops (ZWNJ, LRM, RLM) between digits are refused like a space
  for (const typed of ['۱٬۲', '12,5', '1 2', '1\u200f2', '1\u200e2', '۱\u200c۲']) {
    const res = await h.post('/api/projects', { title: title(), products: [], inventory_control: { sections: globalSection([row(typed)]) } });
    if (res.status !== 400) wrong.push(`a quantity typed ${JSON.stringify(typed)} answered ${brief(res)}`);
    misplaced.push(`${JSON.stringify(typed)}→${res.status}`);
  }
  const grouped = await createProject(h, { sections: globalSection([row('۱٬۲۵۰')]) });
  const [groupedQty] = await h.q(`SELECT inventory_control->'sections'->0->'globalItems'->0->'requiredQty' AS q FROM production_projects WHERE id = $1`, [grouped]);
  if (groupedQty?.q !== 1250) wrong.push(`«۱٬۲۵۰» was stored as ${JSON.stringify(groupedQty?.q)}, not 1250`);
  // an empty quantity and fields the server does not read stay as the browser sent them
  const empty = await h.post('/api/projects', { title: title(), products: [], inventory_control: { sections: globalSection([{ ...row(''), note: 'x' }]), uiTab: 'global' } });
  if (empty.status !== 201) wrong.push(`an empty quantity answered ${brief(empty)}`);
  return `reserved ${reservedQty}; text ${text.status}, negative ${negative.status}, flag ${flag.status}, sections ${sections.status}, empty ${empty.status}; ${misplaced.join(', ')}; grouped ${groupedQty?.q}`;
}

const product = (id: string, itemId: number, quantity: number) =>
  ({ id, item_id: itemId, item_code: `C${itemId}`, item_name: `product ${itemId}`, quantity, unit: 'عدد' });

const perItemSection = (rows: Record<string, Record<string, unknown>>) =>
  [{ id: 'sec-code', title: 'کد به کد', checkType: 'per_item', perItemResults: { 'prod-a': rows } }];

async function perUnitCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const itemId = await f.item(20);
  const [it] = await h.q('SELECT code, name FROM items WHERE id = $1', [itemId]);
  const row = (qtyPerUnit: unknown, extra: Record<string, unknown> = {}) => ({ itemId: `m${itemId}`, itemCode: it.code, name: it.name, unit: 'عدد', qtyPerUnit, ...extra });
  const products = [product('prod-a', await f.item(0), 3)];

  // «۲» per unit × an order of 3 reserves 6, and the row stays per unit (a text would read as a «کل» row)
  const project = await createProject(h, { sections: perItemSection({ m: row('۲') }), isFinalized: true }, { products });
  const [stored] = await h.q(`SELECT inventory_control->'sections'->0->'perItemResults'->'prod-a'->'m'->'qtyPerUnit' AS q FROM production_projects WHERE id = $1`, [project]);
  if (stored?.q !== 2) wrong.push(`«۲» per unit was stored as ${JSON.stringify(stored?.q)}, not the number 2`);
  const reserved = (await storedReservation(h, project)).filter(r => Number(r.itemId) === itemId).reduce((s, r) => s + (Number(r.reservedQty) || 0), 0);
  if (reserved !== 6) wrong.push(`«۲» per unit with an order of 3 reserved ${reserved}, not 6`);

  // null is a «کل» row and keeps its stored total
  const total = await createProject(h, { sections: perItemSection({ m: row(null, { requiredQty: 4 }) }) }, { products });
  const [kept] = await h.q(`SELECT inventory_control->'sections'->0->'perItemResults'->'prod-a'->'m' AS r FROM production_projects WHERE id = $1`, [total]);
  const keptRow = (kept?.r ?? {}) as Record<string, unknown>;
  if (keptRow.qtyPerUnit !== null || keptRow.requiredQty !== 4) wrong.push(`a «کل» row was stored as ${JSON.stringify(kept?.r)}`);

  const refused: string[] = [];
  for (const bad of ['abc', -2, '']) {
    const res = await h.post('/api/projects', { title: `TD-1326 ${h.tag} ${Math.floor(Math.random() * 1e6)}`, products, inventory_control: { sections: perItemSection({ m: row(bad) }) } });
    if (res.status !== 400) wrong.push(`a quantity per unit of ${JSON.stringify(bad)} answered ${brief(res)}`);
    else if (!String(res.body?.message ?? '').includes('مقدار برای هر عدد')) wrong.push(`the 400 for ${JSON.stringify(bad)} does not name the quantity per unit: ${brief(res)}`);
    refused.push(`${JSON.stringify(bad)}→${res.status}`);
  }
  return `stored ${stored?.q}, reserved ${reserved}; «کل» ${JSON.stringify(keptRow.qtyPerUnit)}; ${refused.join(', ')}`;
}

/** A row stored before v10.2.30 (written straight to the table, as the old route stored any body) */
async function legacyRowCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const itemId = await f.item(10);
  const [it] = await h.q('SELECT code, name FROM items WHERE id = $1', [itemId]);
  const itemName = String(it?.name ?? '');
  const good = { itemCode: it.code, name: it.name, unit: 'عدد', requiredQty: 1, stockQty: 'نامعلوم', conversionRate: 'x' };
  const odd = { itemCode: 'OLD-7', name: 'ورق قدیمی', unit: 'عدد', requiredQty: 'دو' };
  const project = await createProject(h, { sections: globalSection([good]) });
  const legacy = { sections: [{ id: 'sec-1', title: 'مواد', checkType: 'global', globalItems: [good, odd] }], manualPurchaseItems: [{ id: 'manual_1', itemName: 'پیچ دستی', totalRequiredQty: -1 }] };
  await h.q(`UPDATE production_projects SET inventory_control = $2::jsonb WHERE id = $1`, [project, JSON.stringify(legacy)]);

  // the tab resends every section on each save: the answer names each odd row so the user can fix it in the tab
  const put = async (control: Record<string, unknown>) => {
    const [row] = await h.q('SELECT version FROM production_projects WHERE id = $1', [project]);
    return h.put(`/api/projects/${project}`, { inventory_control: { ...control, isFinalized: false }, version: Number(row?.version) });
  };
  const refused = await put(legacy);
  const message = String(refused.body?.message ?? '');
  if (refused.status !== 400) wrong.push(`resending the stored odd rows answered ${brief(refused)}`);
  else {
    for (const part of ['بخش «مواد»', '«ورق قدیمی» (کد OLD-7)', 'مقدار لازم', 'اقلام دستی', '«پیچ دستی»', 'مقدار کل لازم']) {
      if (!message.includes(part)) wrong.push(`the 400 does not name ${part}: ${message}`);
    }
    if (itemName && message.includes(itemName)) wrong.push(`the 400 names the good row too: ${message}`);
  }

  // fixing those two rows in the tab saves; the odd stock and rate the server does not read pass through as stored
  const fixed = { ...legacy, sections: [{ ...legacy.sections[0], globalItems: [good, { ...odd, requiredQty: '۲' }] }], manualPurchaseItems: [{ ...legacy.manualPurchaseItems[0], totalRequiredQty: 1 }] };
  const saved = await put(fixed);
  if (saved.status !== 200) wrong.push(`the fixed rows answered ${brief(saved)}`);
  const [after] = await h.q(`SELECT inventory_control->'sections'->0->'globalItems' AS g FROM production_projects WHERE id = $1`, [project]);
  const rows = Array.isArray(after?.g) ? after.g : [];
  if (rows[1]?.requiredQty !== 2) wrong.push(`the fixed row was stored as ${JSON.stringify(rows[1]?.requiredQty)}, not 2`);
  if (rows[0]?.stockQty !== 'نامعلوم' || rows[0]?.conversionRate !== 'x') wrong.push(`fields the server does not read changed: ${JSON.stringify(rows[0])}`);
  return `odd rows ${refused.status}: ${message.slice(0, 160)}; fixed ${saved.status}`;
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
