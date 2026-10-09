import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { documents, pendingMaterials, purchaseRequisitions, users } from '../../db/schema.js';

/**
 * TD-1132: the records that name who wrote them show the signed-in user's full name, never the username: the warehouse
 * transfer document, the purchase requisition's requester, the orders a conversion writes and the raw material request.
 * Red on the previous code (inventory routes read `user.name`, which no token carries; procurement wrote the username).
 */
export async function runActorDisplayNameTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_actor_full_name_on_records_td_1132';
  if (!shouldRun(id, 'td1132', 'procurement', 'inventory', 'pending_materials', 'package6', 'package10')) return results;

  const name = 'v10.0.47: transfers, purchase requisitions, their orders and raw material requests record the user\'s full name, not the username (TD-1132)';
  const tStart = Date.now();
  const docIds: number[] = [];
  const requisitionIds: number[] = [];
  const pendingIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestWarehouse, createTestCustomer } = await import('../fixtures/factories.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { DocumentService } = await import('../../services/document.service.js');

    const app = await getTestApp();
    const admin = await getAdminSession();
    const [me] = await orm.select({ username: users.username, fullName: users.fullName }).from(users).where(eq(users.username, 'pen_admin'));
    const fullName = String(me?.fullName ?? '').trim();
    if (!fullName || fullName === me?.username) throw new Error(`the test admin needs a full name other than its username (${JSON.stringify(me)})`);
    const post = (url: string, body: object) => request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const today = await businessTodayIsoDate();
    const main = (await getDefaultWarehouseCode(orm)) as string;
    const wrong: string[] = [];

    // 1) warehouse transfer: the transfer document's user
    const wh2 = await createTestWarehouse();
    const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
    const receiptId = await DocumentService.createDocument({
      docType: 'receipt', status: 'final', inOut: 'in', date: today, user: 'td1132', buyerName: 'td1132',
      location: main, items: [{ itemId: item.id, quantity: 5, unit_price: 1000, location: main }],
    });
    docIds.push(Number(receiptId));
    const transfer = await post('/api/inventory/transfer', { itemId: item.id, fromLocation: main, toLocation: wh2.code, quantity: 2, date: today, refNumber: 'auto' });
    const transferDocId = Number(transfer.body?.data?.transferDocId);
    if (transfer.status !== 200 || !transferDocId) throw new Error(`transfer answered ${transfer.status} ${JSON.stringify(transfer.body).slice(0, 200)}`);
    docIds.push(transferDocId);
    const [transferDoc] = await orm.select({ user: documents.user }).from(documents).where(eq(documents.id, transferDocId));
    if (transferDoc?.user !== fullName) wrong.push(`transfer document user is "${transferDoc?.user}", expected "${fullName}"`);

    // 2) purchase requisition: the requester
    const created = await post('/api/procurement/requisitions', { title: 'td1132 requisition', items: [{ itemId: item.id, itemName: item.name, requestedQty: 3 }] });
    const reqId = Number(created.body?.data?.id);
    if (created.status !== 201 || !reqId) throw new Error(`requisition answered ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
    requisitionIds.push(reqId);
    const [reqRow] = await orm.select({ by: purchaseRequisitions.requestedByName }).from(purchaseRequisitions).where(eq(purchaseRequisitions.id, reqId));
    if (reqRow?.by !== fullName) wrong.push(`requisition requester is "${reqRow?.by}", expected "${fullName}"`);

    // 3) its order: the order document's user
    const supplier = await createTestCustomer({ partyType: 'supplier' });
    const converted = await post(`/api/procurement/requisitions/${reqId}/convert-to-orders`, {
      orderGroups: [{ supplierId: supplier.id, supplierName: supplier.name, targetWarehouse: main, docType: 'receipt', status: 'draft',
        items: [{ itemId: item.id, itemName: item.name, quantity: 3, unitPrice: 1000 }] }],
    });
    const orderIds = (Array.isArray(converted.body?.data?.createdDocuments) ? converted.body.data.createdDocuments : []).map((d: { id: number }) => Number(d.id));
    if (converted.status !== 200 || orderIds.length !== 1) throw new Error(`convert answered ${converted.status} ${JSON.stringify(converted.body).slice(0, 200)}`);
    docIds.push(...orderIds);
    const [order] = await orm.select({ user: documents.user }).from(documents).where(eq(documents.id, orderIds[0]));
    if (order?.user !== fullName) wrong.push(`order document user is "${order?.user}", expected "${fullName}"`);

    // 4) raw material request: the requester
    const pending = await post('/api/pending-materials', { name: `td1132 material ${Date.now()}` });
    const pendingId = Number(pending.body?.data?.id ?? pending.body?.id);
    if (pending.status !== 201 || !pendingId) throw new Error(`pending material answered ${pending.status} ${JSON.stringify(pending.body).slice(0, 200)}`);
    pendingIds.push(pendingId);
    const [pendingRow] = await orm.select({ by: pendingMaterials.requestedBy }).from(pendingMaterials).where(eq(pendingMaterials.id, pendingId));
    if (pendingRow?.by !== fullName) wrong.push(`raw material request requester is "${pendingRow?.by}", expected "${fullName}"`);

    if (wrong.length) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'The transfer document, the requisition requester, its order and the raw material request carry the full name',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (pendingIds.length) await orm.update(pendingMaterials).set({ isDeleted: 1 }).where(inArray(pendingMaterials.id, pendingIds)).catch(() => undefined);
    if (requisitionIds.length) await orm.update(purchaseRequisitions).set({ isDeleted: 1 }).where(inArray(purchaseRequisitions.id, requisitionIds)).catch(() => undefined);
  }
  return results;
}
