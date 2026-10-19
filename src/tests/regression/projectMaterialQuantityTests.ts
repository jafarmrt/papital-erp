import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { createProject, runReservationCases, storedReservation } from './stockReservationTests.js';

/**
 * TD-1343 (package 12 item 2, option الف of card t42): a material row of a code-by-code section holds its quantity for one
 * unit of the product (`qtyPerUnit`) and its need is that quantity times the product's order quantity, read again from the
 * order quantity of today by the finalize and the reservation reconcile; a row without `qtyPerUnit` (earlier projects) keeps
 * its stored total and a whole-order section is unchanged. A product stored without an id finds its rows under the key the
 * materials tab and the preset conversion write (`prod_<item id>`). Through the real Express routes on PostgreSQL; each
 * case is red on the code before the change (the finalize read the stored total of each row and the key of the product id).
 */
export async function runProjectMaterialQuantityTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_project_material_per_unit_finalize_td_1343',
      'v10.2.x: the finalize reserves a code-by-code row\'s quantity per unit times its product\'s order quantity, keeps a total row\'s stored total and a whole-order row as it was (TD-1343)',
      ['td1343', 'package12', 'projects', 'reservation'], perUnitFinalizeCase],
    ['reg_project_material_quantity_change_td_1343',
      'v10.2.x: after the order quantity of a finalized project changes, the reconcile previews and reserves the per-unit need of the new quantity; a total row stays at its total (TD-1343)',
      ['td1343', 'td1341', 'package12', 'projects', 'reservation'], quantityChangeCase],
    ['reg_project_material_product_key_td_1343',
      'v10.2.x: a product stored without an id finds its code-by-code rows under the key prod_<item id> the materials tab writes, instead of falling back to one unit of each schema material (TD-1343)',
      ['td1343', 'package12', 'projects', 'reservation'], productKeyCase],
  ]);
}

async function row(h: Harness, itemId: number, fields: Record<string, unknown>) {
  const [it] = await h.q('SELECT code, name FROM items WHERE id = $1', [itemId]);
  return { itemId: `m${itemId}`, itemCode: it.code, name: it.name, unit: 'عدد', ...fields };
}

const versionOf = async (h: Harness, projectId: number) =>
  Number((await h.q('SELECT version FROM production_projects WHERE id = $1', [projectId]))[0]?.version);

const storedQty = async (h: Harness, projectId: number, itemId: number) =>
  (await storedReservation(h, projectId)).filter(r => Number(r.itemId) === itemId).reduce((s, r) => s + (Number(r.reservedQty) || 0), 0);

const product = (id: string | undefined, itemId: number, quantity: number) =>
  ({ ...(id ? { id } : {}), item_id: itemId, item_code: `C${itemId}`, item_name: `product ${itemId}`, quantity, unit: 'عدد' });

/** One code-by-code section with these rows for each product key, and one whole-order section */
function sections(perProduct: Record<string, Array<Record<string, unknown>>>, globalRows: Array<Record<string, unknown>>) {
  const perItemResults = Object.fromEntries(Object.entries(perProduct).map(([key, rows]) => [key, Object.fromEntries(rows.map(r => [String(r.itemId), r]))]));
  return [
    { id: 'sec-code', title: 'کد به کد', checkType: 'per_item', perItemResults },
    { id: 'sec-all', title: 'کلی', checkType: 'global', globalItems: globalRows },
  ];
}

/** A per-unit row reserves its quantity per unit times the order quantity; a total row and a whole-order row keep their totals */
async function perUnitFinalizeCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const perUnit = await f.item(40);
  const total = await f.item(40);
  const whole = await f.item(40);
  // a stale stored total beside the per-unit quantity: the need comes from the quantity per unit, never from that total
  const project = await createProject(h, {
    sections: sections(
      { 'prod-a': [await row(h, perUnit, { qtyPerUnit: 2, requiredQty: 2 }), await row(h, total, { requiredQty: 3 })] },
      [await row(h, whole, { requiredQty: 4 })],
    ),
    manualPurchaseItems: [], isFinalized: true,
  }, { products: [product('prod-a', await f.item(0), 5)] });
  const got = [await storedQty(h, project, perUnit), await storedQty(h, project, total), await storedQty(h, project, whole)];
  if (got[0] !== 10) wrong.push(`the per-unit row reserved ${got[0]}, expected 2 per unit × 5 = 10`);
  if (got[1] !== 3) wrong.push(`the total row reserved ${got[1]}, expected its stored total 3`);
  if (got[2] !== 4) wrong.push(`the whole-order row reserved ${got[2]}, expected 4`);
  return `reserved ${got.join(', ')}`;
}

/** A finalized project's order quantity changes; the reconcile brings the per-unit need to the new quantity */
async function quantityChangeCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const perUnit = await f.item(30);
  const total = await f.item(30);
  const productItem = await f.item(0);
  const project = await createProject(h, {
    sections: sections({ 'prod-a': [await row(h, perUnit, { qtyPerUnit: 2, requiredQty: 10 }), await row(h, total, { requiredQty: 3 })] }, []),
    manualPurchaseItems: [], isFinalized: true,
  }, { products: [product('prod-a', productItem, 5)] });
  if (await storedQty(h, project, perUnit) !== 10) throw new Error(`setup: the finalize reserved ${await storedQty(h, project, perUnit)}, expected 10`);

  const edit = await h.put(`/api/projects/${project}`, { products: [product('prod-a', productItem, 8)], version: await versionOf(h, project) });
  if (edit.status !== 200) throw new Error(`setup: changing the order quantity answered ${brief(edit)}`);
  if (await storedQty(h, project, perUnit) !== 10) wrong.push('saving the new order quantity changed the reservation by itself');

  const previewed = await h.get(`/api/projects/${project}/reservation-reconcile`);
  if (previewed.status !== 200) throw new Error(`the reconcile preview answered ${brief(previewed)}`);
  const p = previewed.body as { lines: Array<{ itemId: number; requiredQty: number; currentQty: number; targetQty: number }>; planToken: string };
  const line = p.lines.find(l => l.itemId === perUnit);
  if (line?.requiredQty !== 16 || line?.currentQty !== 10 || line?.targetQty !== 16) wrong.push(`the per-unit row previews ${JSON.stringify(line)}, expected 10 → 16 of a need of 2 × 8`);
  const totalLine = p.lines.find(l => l.itemId === total);
  if (totalLine?.requiredQty !== 3 || totalLine?.targetQty !== 3) wrong.push(`the total row previews ${JSON.stringify(totalLine)}, expected to keep 3`);

  const res = await h.post(`/api/projects/${project}/reservation-reconcile`, { version: await versionOf(h, project), planToken: p.planToken });
  if (res.status !== 200) {
    wrong.push(`the reconcile answered ${brief(res)}, expected 200`);
    return 'reconcile refused';
  }
  if (await storedQty(h, project, perUnit) !== 16) wrong.push(`the per-unit row is reserved ${await storedQty(h, project, perUnit)} after the reconcile, expected 16`);
  if (await storedQty(h, project, total) !== 3) wrong.push(`the total row is reserved ${await storedQty(h, project, total)} after the reconcile, expected 3`);
  return 'the reconcile follows the new order quantity';
}

/** A product without an id reads its rows under prod_<item id>, the key the materials tab and the preset conversion write */
async function productKeyCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const material = await f.item(40);
  const productItem = await f.item(0);
  const project = await createProject(h, {
    sections: sections({ [`prod_${productItem}`]: [await row(h, material, { qtyPerUnit: 2, requiredQty: 6 })] }, []),
    manualPurchaseItems: [], isFinalized: true,
  }, { products: [product(undefined, productItem, 3)] });
  const got = await storedQty(h, project, material);
  if (got !== 6) wrong.push(`the row of the product without an id reserved ${got}, expected 2 per unit × 3 = 6`);
  return `reserved ${got}`;
}
