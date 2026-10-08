import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { createProject, globalSection, postDoc, reservedOf, runReservationCases, storedReservation } from './stockReservationTests.js';

/**
 * Series 9 phase 5 (closing review), PR «الف»: the side paths that move project stock — material allocation, its release
 * and the project delivery — follow the rules of the stock documents. Through the real Express routes with real sessions;
 * each case reproduces a phase 5 finding and is red on the code before its fix.
 */
export async function runProjectStockGateTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_project_allocation_sellable_gate_td_905',
      'v9.0.451: allocating material to a project passes the sellable gate of a remittance; the reservations of another project and of a sales proforma are not consumed (TD-905)',
      ['td905', 'allocation', 'reservation', 'sellable', 'phase5'], allocationSellableGateCase],
    ['reg_project_allocation_reservation_td_918',
      'v9.0.452: allocating material deducts the project\'s reservation like its remittance and releasing the allocation gives back exactly what was deducted (TD-918)',
      ['td918', 'allocation', 'reservation', 'phase5'], allocationReservationCase],
    ['reg_incoming_without_cost_td_906',
      'v9.0.453: an item without a weighted average cost never enters stock at zero cost: a final receipt, its finalize, a procurement delivery and a project delivery without a price are 422; a priced line and a zero-price line of an item with a cost pass (TD-906, TD-916)',
      ['td906', 'td916', 'receipt', 'procurement', 'projects', 'cost', 'phase5'], incomingWithoutCostCase],
  ]);
}

const errorText = (body: unknown) => String((body as { error?: unknown; message?: unknown } | undefined)?.error ?? (body as { message?: unknown } | undefined)?.message ?? '');

/** One global control row of the item, needing `requiredQty` */
async function materialRow(h: Harness, itemId: number, requiredQty: number) {
  const [it] = await h.q('SELECT code, name FROM items WHERE id = $1', [itemId]);
  return { itemCode: it.code, name: it.name, unit: 'عدد', requiredQty };
}

/** A project frozen with these needs (it reserves them), or an open project without a reservation */
async function projectNeeding(h: Harness, needs: Array<[number, number]>): Promise<number> {
  const rows = await Promise.all(needs.map(([itemId, qty]) => materialRow(h, itemId, qty)));
  return createProject(h, { sections: rows.length > 0 ? globalSection(rows) : [], manualPurchaseItems: [], isFinalized: rows.length > 0 });
}

const allocationRows = async (h: Harness, projectId: number, itemId: number) => Number(
  (await h.q(`SELECT count(*)::int AS n FROM project_bom_allocations WHERE project_id = $1 AND item_id = $2 AND is_deleted = 0 AND status = 'allocated'`, [projectId, itemId]))[0]?.n,
);

/**
 * P5-M02 (TD-905): allocation moved stock out without the sellable gate (TD-775). With all 10 units of an item reserved for
 * project P1, a remittance of 6 for project P2 was refused but an allocation of 6 to P2 passed, and P1 could no longer
 * issue its own 10; a sales proforma's 5 units went to an allocation and the proforma could no longer be finalized.
 */
async function allocationSellableGateCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const allocate = (projectId: number, itemId: number, quantity: number) =>
    h.post('/api/inventory/allocations/allocate', { projectId, allocations: [{ itemId, quantity, location: f.wh }] });

  // 1) another project's reservation: P1 holds all 10 units of G
  const g = await f.item(10);
  const p1 = await projectNeeding(h, [[g, 10]]);
  const p2 = await projectNeeding(h, []);
  if ((await reservedOf(g)).project !== 10) throw new Error(`setup: P1 reserves ${(await reservedOf(g)).project} of 10, expected 10`);
  const remittance = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: g, quantity: 6, unit_price: 0, location: f.wh }], { projectId: p2 }));
  if (remittance.status !== 400) throw new Error(`setup: a remittance of 6 for P2 answered ${brief(remittance)}, expected 400`);
  const toP2 = await allocate(p2, g, 6);
  if (toP2.status !== 400 || toP2.body?.code !== 'INSUFFICIENT_STOCK') wrong.push(`allocating 6 of P1's reserved 10 to P2 answered ${brief(toP2)}, expected 400 INSUFFICIENT_STOCK like the remittance`);
  if (await f.stock(g) !== 10) wrong.push(`the refused allocation left stock ${await f.stock(g)}, expected 10`);
  if (await allocationRows(h, p2, g) !== 0) wrong.push('the refused allocation stored an allocation row for P2');
  const ownAllocation = await allocate(p1, g, 10);
  if (ownAllocation.status !== 200) wrong.push(`P1 allocating its own reserved 10 answered ${brief(ownAllocation)}, expected 200`);

  // 2) a sales proforma's reservation: 5 of H are held by a proforma, 2 of J's 10 by another
  const hItem = await f.item(5);
  const proforma = await postDoc(h, f, 'invoice', 'proforma', hItem, 5);
  if (proforma.status !== 200) throw new Error(`setup: the sales proforma answered ${brief(proforma)}`);
  const takeH = await allocate(p2, hItem, 5);
  if (takeH.status !== 400 || takeH.body?.code !== 'INSUFFICIENT_STOCK') wrong.push(`allocating the 5 units a sales proforma holds answered ${brief(takeH)}, expected 400 INSUFFICIENT_STOCK`);
  if (!errorText(takeH.body).includes('رزرو')) wrong.push(`the refusal does not name the reservation: ${errorText(takeH.body).slice(0, 160)}`);
  const finalize = await h.put(`/api/documents/${Number(proforma.body?.docId)}/finalize`, {});
  if (finalize.status !== 200) wrong.push(`finalizing the sales proforma after the refused allocation answered ${brief(finalize)}, expected 200`);

  const j = await f.item(10);
  if ((await postDoc(h, f, 'invoice', 'proforma', j, 2)).status !== 200) throw new Error('setup: the sales proforma of 2 J failed');
  const free = await allocate(p2, j, 8);
  if (free.status !== 200) wrong.push(`allocating the 8 free units of J answered ${brief(free)}, expected 200`);
  const beyond = await allocate(p2, j, 1);
  if (beyond.status !== 400) wrong.push(`allocating 1 more unit of J (only the proforma's 2 left) answered ${brief(beyond)}, expected 400`);
  if (await f.stock(j) !== 2) wrong.push(`J has stock ${await f.stock(j)} after the allocations, expected 2`);
  return 'allocation refused for the stock of another project and of a sales proforma; the project\'s own reservation and free stock allocate';
}

const storedQty = async (h: Harness, projectId: number, itemId: number) =>
  (await storedReservation(h, projectId)).filter(r => Number(r.itemId) === itemId).reduce((sum, r) => sum + Number(r.reservedQty ?? 0), 0);

/**
 * P5-M01 (TD-918): an allocation moved the reserved stock out but left the reservation in place: with 10 of A reserved and 6
 * allocated, the project still reserved 10, so after 6 new units arrived a sale of 1 was refused («رزرو سایر مصارف ۶»).
 */
async function allocationReservationCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const allocate = (projectId: number, itemId: number, quantity: number) =>
    h.post('/api/inventory/allocations/allocate', { projectId, allocations: [{ itemId, quantity, location: f.wh }] });
  const release = (allocationId: number) => h.post(`/api/inventory/allocations/${allocationId}/release`, { reason: 'TD-918' });
  const allocationIdOf = (res: { body?: unknown }) => Number((res.body as { data?: { allocations?: Array<{ id?: unknown }> } })?.data?.allocations?.[0]?.id);

  // 1) 10 of A reserved; the project allocates 6: its reservation drops to 4, so the 6 units that arrive later are free
  const a = await f.item(10);
  const p = await projectNeeding(h, [[a, 10]]);
  const allocation = await allocate(p, a, 6);
  const allocationId = allocationIdOf(allocation);
  if (allocation.status !== 200 || !Number.isInteger(allocationId)) throw new Error(`setup: the allocation of 6 answered ${brief(allocation)}`);
  if (await storedQty(h, p, a) !== 4) wrong.push(`after allocating 6 of its reserved 10 the project stores a reservation of ${await storedQty(h, p, a)}, expected 4`);
  if ((await reservedOf(a)).project !== 4) wrong.push(`the reservation report shows ${(await reservedOf(a)).project} reserved for the project, expected 4`);
  const [deduction] = await h.q('SELECT document_id, quantity::float8 AS q, restored_at FROM project_reservation_releases WHERE bom_allocation_id = $1', [allocationId]);
  if (!deduction || deduction.document_id !== null || Number(deduction.q) !== 6 || deduction.restored_at !== null) wrong.push(`the deduction of the allocation is recorded as ${JSON.stringify(deduction ?? null)}, expected 6 without a document`);
  const [audit] = await h.q(
    `SELECT details FROM activity_logs WHERE entity = 'کنترل موجودی پروژه' AND entity_id = $1 AND (details->>'bomAllocationId')::int = $2`, [String(p), allocationId]);
  if (!audit) wrong.push('the reservation deduction of the allocation has no audit row naming the allocation');

  const receipt = await postDoc(h, f, 'receipt', 'final', a, 6);
  if (receipt.status !== 200) throw new Error(`setup: the receipt of 6 answered ${brief(receipt)}`);
  const sale = await postDoc(h, f, 'invoice', 'final', a, 6);
  if (sale.status !== 200) wrong.push(`selling the 6 new units (stock 10, reservation 4) answered ${brief(sale)}, expected 200`);
  const more = await postDoc(h, f, 'invoice', 'final', a, 1);
  if (more.status !== 400) wrong.push(`selling 1 more unit (stock 4, all reserved) answered ${brief(more)}, expected 400`);

  // 2) the release gives the 6 back to the stock and to the reservation, once
  const released = await release(allocationId);
  if (released.status !== 200) wrong.push(`releasing the allocation answered ${brief(released)}, expected 200`);
  if (await storedQty(h, p, a) !== 10) wrong.push(`after the release the project stores a reservation of ${await storedQty(h, p, a)}, expected 10 again`);
  if (await f.stock(a) !== 10) wrong.push(`after the release the stock is ${await f.stock(a)}, expected 10`);
  const [restored] = await h.q('SELECT restored_at FROM project_reservation_releases WHERE bom_allocation_id = $1', [allocationId]);
  if (!restored?.restored_at) wrong.push('the deduction of the released allocation is not marked restored');

  // 3) an allocation above the reservation deducts only what was reserved and its release restores only that
  const b = await f.item(10);
  const pb = await projectNeeding(h, [[b, 4]]);
  const over = await allocate(pb, b, 6);
  const overId = allocationIdOf(over);
  if (over.status !== 200) throw new Error(`setup: the allocation of 6 with 4 reserved answered ${brief(over)}`);
  if (await storedQty(h, pb, b) !== 0) wrong.push(`allocating 6 with 4 reserved leaves a reservation of ${await storedQty(h, pb, b)}, expected 0`);
  if ((await release(overId)).status !== 200) wrong.push('releasing the larger allocation failed');
  if (await storedQty(h, pb, b) !== 4) wrong.push(`releasing the allocation of 6 restores a reservation of ${await storedQty(h, pb, b)}, expected exactly the 4 deducted`);
  return 'an allocation deducts the project reservation with its own record; the release restores exactly that';
}

const kardexRows = async (h: Harness, itemId: number) => Number((await h.q('SELECT count(*)::int AS n FROM transactions WHERE item_id = $1', [itemId]))[0]?.n);
const wacOf = async (h: Harness, itemId: number) => Number((await h.q('SELECT weighted_average_cost::float8 AS w FROM items WHERE id = $1', [itemId]))[0]?.w);

/**
 * P5-M04 / P5-P09 (TD-906 / TD-916, decision ت۲ الف): a project delivery without a price, a final receipt at zero and a
 * procurement order estimated at zero brought an item without a weighted average cost into stock at zero cost (Kardex 0,
 * voucher without rows); after that every sale and remittance of the item was refused. The reorder form (TD-830) was the
 * only place that refused it.
 */
async function incomingWithoutCostCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const expectRefused = (label: string, res: { status: number; body?: unknown }) => {
    const code = (res.body as { code?: unknown } | undefined)?.code;
    if (res.status !== 422 || code !== 'INCOMING_LINE_WITHOUT_COST') wrong.push(`${label} answered ${brief(res)}, expected 422 INCOMING_LINE_WITHOUT_COST`);
  };
  const line = (itemId: number, quantity: number, unit_price: number, discount = 0) => [{ itemId, quantity, unit_price, discount, location: f.wh }];

  // 1) POST /documents: a final receipt at zero, and a line whose discount nets it to zero
  const n = await f.item(0, 0);
  expectRefused('a final receipt at zero of an item without cost', await h.post('/api/documents', f.doc('receipt', 'final', line(n, 4, 0))));
  expectRefused('a final receipt whose line discount nets the price to zero', await h.post('/api/documents', f.doc('receipt', 'final', line(n, 2, 500, 1000))));
  if (await f.stock(n) !== 0 || await kardexRows(h, n) !== 0) wrong.push(`the refused receipts left stock ${await f.stock(n)} and ${await kardexRows(h, n)} Kardex rows`);

  // 2) finalizing a draft receipt at zero is refused and the draft stays a draft
  const draft = await h.post('/api/documents', f.doc('receipt', 'draft', line(n, 3, 0)));
  if (draft.status !== 200) throw new Error(`setup: the draft receipt answered ${brief(draft)}`);
  const draftId = Number((draft.body as { docId?: unknown }).docId);
  expectRefused('finalizing a draft receipt at zero', await h.put(`/api/documents/${draftId}/finalize`, {}));
  const [draftRow] = await h.q('SELECT status FROM documents WHERE id = $1', [draftId]);
  if (draftRow?.status !== 'draft' || await f.stock(n) !== 0) wrong.push(`the refused finalize left the receipt ${String(draftRow?.status)} with stock ${await f.stock(n)}`);

  // 3) a priced receipt passes; after it the item has a cost and a zero line is the donated-goods case of TD-268
  const priced = await h.post('/api/documents', f.doc('receipt', 'final', line(n, 4, 2_000)));
  if (priced.status !== 200 || await wacOf(h, n) !== 2_000) wrong.push(`a priced receipt answered ${brief(priced)} with WAC ${await wacOf(h, n)}, expected 200 and 2000`);
  const donated = await h.post('/api/documents', f.doc('receipt', 'final', line(n, 1, 0)));
  if (donated.status !== 200 || await f.stock(n) !== 5) wrong.push(`a zero-price receipt of an item with a cost answered ${brief(donated)} (stock ${await f.stock(n)}), expected 200 as donated goods`);

  // 4) a procurement order estimated at zero is not delivered into stock
  const { approvedRequisition, fixture: procurementFixture, formRow } = await import('./procurementRequisitionTests.js');
  const pf = await procurementFixture(h);
  const raw = await pf.item();
  const requisition = await approvedRequisition(h, pf, [formRow(raw, 4, 0)]);
  const converted = await h.post(`/api/procurement/requisitions/${requisition.id}/convert-to-orders`, {
    orderGroups: [{ supplierName: `P5 supplier ${h.tag}`, targetWarehouse: pf.wh, docType: 'receipt', status: 'draft',
      items: [{ itemId: raw.id, quantity: 4, unitPrice: 0, unit: 'عدد' }] }],
  });
  const orderId = Number(((converted.body as { data?: { createdDocuments?: Array<{ id?: unknown }> } })?.data?.createdDocuments ?? [])[0]?.id);
  if (converted.status !== 200 || !Number.isInteger(orderId)) throw new Error(`setup: convert to orders answered ${brief(converted)}`);
  expectRefused('delivering a procurement order at zero of an item without cost', await pf.deliver(orderId));
  if (await pf.stock(raw.id) !== 0) wrong.push(`the refused delivery left stock ${await pf.stock(raw.id)}`);

  // 5) a project delivery without a price of a finished good without cost
  const product = await f.item(0, 0);
  const projectRes = await h.post('/api/projects', {
    title: `P5 delivery ${h.tag} ${Math.floor(Math.random() * 1e6)}`, start_date: f.today, end_date: f.today, quantity: 5,
    products: [{ item_id: product, item_code: '', item_name: '', quantity: 5, unit: 'عدد' }],
  });
  const projectId = Number((projectRes.body as { id?: unknown }).id);
  if (projectRes.status !== 201) throw new Error(`setup: project create answered ${brief(projectRes)}`);
  const receiptsOf = async () => Number((await h.q(`SELECT count(*)::int AS n FROM documents WHERE project_id = $1 AND type = 'production_receipt' AND is_deleted = 0`, [projectId]))[0]?.n);
  expectRefused('a project delivery without a price of an item without cost',
    await h.post(`/api/projects/${projectId}/add-to-inventory`, { itemsToAdd: [{ itemId: product, quantity: 5, location: f.wh }] }));
  if (await f.stock(product) !== 0 || await receiptsOf() !== 0) wrong.push(`the refused delivery left stock ${await f.stock(product)} and ${await receiptsOf()} production receipts`);
  const pricedDelivery = await h.post(`/api/projects/${projectId}/add-to-inventory`, { itemsToAdd: [{ itemId: product, quantity: 5, unitPrice: 400_000, location: f.wh }] });
  if (pricedDelivery.status !== 200 || await wacOf(h, product) !== 400_000) wrong.push(`a priced project delivery answered ${brief(pricedDelivery)} with WAC ${await wacOf(h, product)}, expected 200 and 400000`);
  return 'zero-cost entry of an item without cost refused on create, finalize, procurement delivery and project delivery; priced and donated lines pass';
}
