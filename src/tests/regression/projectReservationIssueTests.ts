import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { createProject, globalSection, reservedOf, runReservationCases, storedReservation } from './stockReservationTests.js';

/**
 * Series 10 phase 3, lane L3 (packages 11, 7, 8, 10), product-owner decision t10 of phase 5: a project finalized again
 * reserves only what it still needs, a sales invoice never consumes a project's reservation, and a project requisition's
 * procurement order carries the project. Through the real Express routes; each case is red on the code before its fix.
 */
export async function runProjectReservationIssueTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_project_refinalize_reserves_remaining_need_td_945',
      'v10.0.31: finalizing a project again reserves its need minus what its remittances and allocations already issued, never the whole need (TD-945)',
      ['td945', 'p5-m12', 'projects', 'reservation', 'package11'], refinalizeCase],
    ['reg_sales_invoice_keeps_project_reservation_td_947',
      'v10.0.32: a final sales invoice with a projectId neither consumes the project\'s reservation nor sells it (400 INSUFFICIENT_STOCK beyond free stock); a remittance of the project still consumes it (TD-947)',
      ['td947', 'p5-m14', 'projects', 'reservation', 'documents', 'package8', 'package11'], salesInvoiceCase],
    ['reg_project_procurement_order_carries_project_td_946',
      'v10.0.33: the procurement order of a project requisition is linked to the project (documents.project_id); an order of a requisition without a project has none (TD-946)',
      ['td946', 'p5-m13', 'projects', 'procurement', 'package10', 'package11'], procurementOrderCase],
  ]);
}

async function materialRow(h: Harness, itemId: number, requiredQty: number) {
  const [it] = await h.q('SELECT code, name FROM items WHERE id = $1', [itemId]);
  return { itemCode: it.code, name: it.name, unit: 'عدد', requiredQty };
}

async function putProject(h: Harness, projectId: number, body: Record<string, unknown>) {
  const [row] = await h.q('SELECT version FROM production_projects WHERE id = $1', [projectId]);
  return h.put(`/api/projects/${projectId}`, { ...body, version: Number(row?.version) });
}

const storedQty = async (h: Harness, projectId: number, itemId: number) =>
  (await storedReservation(h, projectId)).filter(r => Number(r.itemId) === itemId).reduce((s, r) => s + (Number(r.reservedQty) || 0), 0);

/** P5-M12 (TD-945): unfreezing and finalizing again reserved the whole need, the issued quantity a second time */
async function refinalizeCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(20, 1_000);
  const inv = { sections: globalSection([await materialRow(h, a, 10)]), manualPurchaseItems: [], isFinalized: true };
  const project = await createProject(h, inv);
  if (await storedQty(h, project, a) !== 10) throw new Error(`setup: the finalized project reserves ${await storedQty(h, project, a)}, expected 10`);
  const rem = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: a, quantity: 6, unit_price: 0, location: f.wh }], { projectId: project }));
  if (rem.status !== 200) throw new Error(`setup: the project's remittance of 6 answered ${brief(rem)}`);
  const unfreeze = await putProject(h, project, { inventory_control: { ...inv, isFinalized: false } });
  if (unfreeze.status !== 200) throw new Error(`setup: unfreeze answered ${brief(unfreeze)}`);
  const refreeze = await putProject(h, project, { inventory_control: inv });
  if (refreeze.status !== 200) throw new Error(`setup: finalizing again answered ${brief(refreeze)}`);
  const again = await storedQty(h, project, a);
  if (again !== 4) wrong.push(`finalizing again after a remittance of 6 of a need of 10 reserves ${again}, expected 4`);
  const view = await reservedOf(a);
  if (view.project !== 4) wrong.push(`the reservation report shows ${view.project} for the project, expected 4`);
  return 'a project finalized again reserves only its remaining need';
}

/** P5-M14 (TD-947): a final sales invoice with projectId consumed the project's reservation (API only) */
async function salesInvoiceCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const b = await f.item(10, 1_000);
  const project = await createProject(h, { sections: globalSection([await materialRow(h, b, 8)]), manualPurchaseItems: [], isFinalized: true });
  if (await storedQty(h, project, b) !== 8) throw new Error(`setup: the finalized project reserves ${await storedQty(h, project, b)}, expected 8`);
  const sale = (qty: number) => h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: b, quantity: qty, unit_price: 5_000, location: f.wh }], { projectId: project }));
  const over = await sale(5);
  const code = (over.body as { code?: unknown } | undefined)?.code;
  if (over.status !== 400 || code !== 'INSUFFICIENT_STOCK') wrong.push(`a sales invoice of 5 with the project's id (2 free) answered ${brief(over)}, expected 400 INSUFFICIENT_STOCK`);
  const within = await sale(2);
  if (within.status !== 200) wrong.push(`a sales invoice of the 2 free units with the project's id answered ${brief(within)}, expected 200`);
  if (await storedQty(h, project, b) !== 8) wrong.push(`after the sales invoices the project reserves ${await storedQty(h, project, b)}, expected 8`);
  const rem = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: b, quantity: 3, unit_price: 0, location: f.wh }], { projectId: project }));
  if (rem.status !== 200 || await storedQty(h, project, b) !== 5) wrong.push(`a project remittance of 3 answered ${brief(rem)} leaving ${await storedQty(h, project, b)} reserved, expected 200 and 5`);
  return 'a sales invoice with a projectId keeps the project reservation; a remittance consumes it';
}

/** P5-M13 (TD-946): the receipt order of a project requisition had no project_id */
async function procurementOrderCase(h: Harness, wrong: string[]): Promise<string> {
  const { fixture: procurementFixture, formRow } = await import('./procurementRequisitionTests.js');
  const pf = await procurementFixture(h);
  const raw = await pf.item();
  const project = await createProject(h, { sections: [], manualPurchaseItems: [], isFinalized: false });
  const [p] = await h.q('SELECT project_code, title FROM production_projects WHERE id = $1', [project]);
  const orderOf = async (body: Record<string, unknown>) => {
    const created = await pf.create({ title: `P3 t10 ${h.tag}`, priority: 'normal', requiredDate: pf.jalaliDate, notes: '', items: [formRow(raw, 4, 1_500)], ...body });
    if (created.status !== 201) throw new Error(`setup: the requisition answered ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);
    const approved = await pf.action(created.id, 'approve_request');
    if (approved.status !== 200) throw new Error(`setup: approve answered ${approved.status}`);
    const converted = await h.post(`/api/procurement/requisitions/${created.id}/convert-to-orders`, {
      orderGroups: [{ supplierName: `P3 supplier ${h.tag}`, targetWarehouse: pf.wh, docType: 'receipt', status: 'draft',
        items: [{ itemId: raw.id, quantity: 4, unitPrice: 1_500, unit: 'عدد' }] }],
    });
    const orderId = Number(((converted.body as { data?: { createdDocuments?: Array<{ id?: unknown }> } })?.data?.createdDocuments ?? [])[0]?.id);
    if (converted.status !== 200 || !Number.isInteger(orderId)) throw new Error(`setup: convert to orders answered ${brief(converted)}`);
    const [doc] = await h.q('SELECT project_id FROM documents WHERE id = $1', [orderId]);
    return doc?.project_id == null ? null : Number(doc.project_id);
  };
  const linked = await orderOf({ projectId: project, projectCode: p.project_code, projectName: p.title });
  if (linked !== project) wrong.push(`the order of the project requisition has project_id ${String(linked)}, expected ${project}`);
  const plain = await orderOf({});
  if (plain !== null) wrong.push(`the order of a requisition without a project has project_id ${plain}, expected none`);
  return 'a project requisition\'s procurement order carries the project; another order has none';
}
