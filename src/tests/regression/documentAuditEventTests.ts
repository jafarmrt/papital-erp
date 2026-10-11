import { and, eq, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, documentItems, documents, items, itemWarehouseStocks, outboxEvents, workflowDefinitions } from '../../db/schema.js';

/**
 * Phase 3 lane L2, package B4 (TD-929, TD-930, TD-937, TD-939, TD-940): document audit rows of the workflow and WooCommerce
 * paths, the Kardex cost on stock events, the reorder monitor on free stock, the party kind of purchase and sales documents
 * and the requisition workflow start. Each case fails on v10.0.21.
 */
type ShouldRun = (id: string, ...extra: string[]) => boolean;

class Rollback extends Error {}

type Tx = Parameters<Parameters<typeof orm.transaction>[0]>[0];

async function inRolledBackTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await orm.transaction(async (tx) => {
      out = await fn(tx);
      throw new Rollback('rollback');
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return out as T;
}

/** TD-930: StockIssued / StockReceived carry the Kardex cost of the row, never the sale price */
async function stockEventCost(): Promise<string> {
  const { DocumentService } = await import('../../services/document.service.js');
  const { createTestItem } = await import('../fixtures/factories.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  return inRolledBackTx(async (tx) => {
    const today = await businessTodayIsoDate();
    const item = await createTestItem({ weightedAverageCost: 600000, currentStock: 10 }, tx);
    const def = await getDefaultWarehouseCode(tx) ?? '';
    await DocumentService.applyStockMovement(tx, {
      itemId: item.id, inOut: 'out', quantity: 1, price: 1000000, date: today, documentType: 'invoice', documentRef: 'TD930-OUT', user: 'test', targetLoc: def,
    });
    await DocumentService.applyStockMovement(tx, {
      itemId: item.id, inOut: 'in', quantity: 1, price: 0, date: today, documentType: 'receipt', documentRef: 'TD930-IN', user: 'test', targetLoc: def,
    });
    const rows = await tx.select({ type: outboxEvents.eventType, payload: outboxEvents.payload }).from(outboxEvents)
      .where(and(eq(outboxEvents.aggregateType, 'Item'), eq(outboxEvents.aggregateId, String(item.id)), sql`${outboxEvents.eventType} IN ('StockIssued', 'StockReceived')`));
    const priceOf = (type: string) => Number((rows.find((r: { type: string }) => r.type === type)?.payload as { unitPrice?: unknown } | undefined)?.unitPrice);
    const issued = priceOf('StockIssued');
    const received = priceOf('StockReceived');
    if (issued !== 600000) throw new Error(`StockIssued.unitPrice is ${issued}, expected the Kardex cost 600000 (sale price 1000000)`);
    if (received !== 600000) throw new Error(`StockReceived.unitPrice of a zero-price receipt is ${received}, expected the Kardex cost 600000`);
    return 'issued 600000, zero-price receipt 600000';
  });
}

type AuditDetails = { before?: { status?: string } | null; after?: { status?: string; docType?: string; refNumber?: string } | null; operation?: string };

/** TD-929: a document finalized by its workflow approval and a WooCommerce invoice each get their TD-785 audit row */
async function workflowAndWooAuditRows(): Promise<string> {
  const { finalizeApprovedDocument } = await import('../../services/documents/documentWorkflowAction.js');
  const { createTestItem, createTestDocument } = await import('../fixtures/factories.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  const { WooOrderSyncService } = await import('../../services/woocommerce/wooOrderSync.service.js');
  const { wooOrder, wooOrderId } = await import('../invariants/wooScenarios.js');
  const wrong: string[] = [];

  const workflow = await inRolledBackTx(async (tx) => {
    const today = await businessTodayIsoDate();
    const def = await getDefaultWarehouseCode(tx) ?? '';
    const item = await createTestItem({ weightedAverageCost: 5000, currentStock: 10 }, tx);
    const { document } = await createTestDocument({ type: 'receipt', status: 'draft', date: today }, [{ itemId: item.id, quantity: 2, unitPrice: 5000, location: def }], tx);
    await finalizeApprovedDocument(tx, {
      instanceId: 1, entityType: 'document', entityId: String(document.id), workflowCode: 'DOC_APPROVAL', fromStateKey: 'review',
      toStateKey: 'approved', actionKey: 'approve', autoActionKey: '', performedBy: undefined, performedByName: 'td929 approver', allowBackdate: false,
    });
    const rows = await tx.select({ action: activityLogs.action, entity: activityLogs.entity, username: activityLogs.username, details: activityLogs.details })
      .from(activityLogs).where(eq(activityLogs.entityId, String(document.id)));
    return { rows, docId: document.id };
  });
  const finalizeRow = workflow.rows.find((r: { action: string; entity: string }) => r.action === 'UPDATE' && r.entity === 'اسناد انبار');
  const fd = finalizeRow?.details as AuditDetails | undefined;
  if (!finalizeRow || fd?.before?.status !== 'draft' || fd?.after?.status !== 'final' || fd?.operation !== 'WORKFLOW_APPROVAL' || finalizeRow.username !== 'td929 approver') {
    wrong.push(`workflow finalize of document ${workflow.docId} wrote ${JSON.stringify(workflow.rows).slice(0, 240)}, expected one UPDATE row draft -> final by the approver`);
  }

  const item = await createTestItem({ code: `WC_TD929_${wooOrderId()}`, weightedAverageCost: 1000, stocks: { '': 10 } });
  const orderId = wooOrderId();
  const synced = await WooOrderSyncService.handleOrder(wooOrder(orderId, 'processing', item.code, 2, 2000));
  if (synced.status !== 'processed' || !synced.docId) throw new Error(`setup: WooCommerce order ${synced.status} ${synced.message.slice(0, 160)}`);
  const wooRows = await orm.select({ action: activityLogs.action, entity: activityLogs.entity, details: activityLogs.details })
    .from(activityLogs).where(eq(activityLogs.entityId, String(synced.docId)));
  const createRow = wooRows.find(r => r.action === 'CREATE' && r.entity === 'فاکتور فروش');
  const cd = createRow?.details as AuditDetails | undefined;
  if (!createRow || cd?.after?.status !== 'final' || cd?.after?.docType !== 'invoice' || !cd?.after?.refNumber) {
    wrong.push(`WooCommerce invoice ${synced.docId} wrote ${JSON.stringify(wooRows).slice(0, 240)}, expected one CREATE row with the stored final invoice`);
  }
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return `workflow finalize UPDATE row draft -> final; WooCommerce invoice ${synced.docId} CREATE row`;
}

/** TD-939: a purchase document takes only a supplier (or «both») party and a sales document only a customer (or «both») */
async function purchasePartyKind(): Promise<string> {
  const { resolveDocumentParty } = await import('../../services/documents/documentParty.js');
  const { createTestCustomer } = await import('../fixtures/factories.js');
  return inRolledBackTx(async (tx) => {
    const tag = `td939-${Date.now()}`;
    const customerOnly = await createTestCustomer({ name: `${tag} customer`, partyType: 'customer' }, tx);
    const supplier = await createTestCustomer({ name: `${tag} supplier`, partyType: 'supplier' }, tx);
    const both = await createTestCustomer({ name: `${tag} both`, partyType: 'both' }, tx);
    const wrong: string[] = [];
    const codeOf = async (docType: string, partyId: number) => {
      try {
        await tx.execute(sql`SAVEPOINT td939`);
        const r = await resolveDocumentParty(tx, { docType, partyId, buyerName: '' });
        await tx.execute(sql`RELEASE SAVEPOINT td939`);
        return `ok ${r.partyId}`;
      } catch (err) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT td939`);
        return (err as { code?: string }).code ?? String(err);
      }
    };
    const expectations: Array<[string, number, string]> = [
      ['receipt', customerOnly.id, 'DOCUMENT_PARTY_KIND_MISMATCH'],
      ['purchase', customerOnly.id, 'DOCUMENT_PARTY_KIND_MISMATCH'],
      ['invoice', supplier.id, 'DOCUMENT_PARTY_KIND_MISMATCH'],
      ['receipt', supplier.id, `ok ${supplier.id}`],
      ['receipt', both.id, `ok ${both.id}`],
      ['invoice', customerOnly.id, `ok ${customerOnly.id}`],
      ['return', both.id, `ok ${both.id}`],
    ];
    for (const [docType, partyId, expected] of expectations) {
      const got = await codeOf(docType, partyId);
      if (got !== expected) wrong.push(`${docType} with party ${partyId}: ${got}, expected ${expected}`);
    }
    // since v10.0.98 (TD-1194) a receipt named after a customer-only party is refused, never recorded without a party
    await tx.execute(sql`SAVEPOINT td939name`);
    const byName = await resolveDocumentParty(tx, { docType: 'receipt', partyId: undefined, buyerName: customerOnly.name })
      .then(r => `linked to ${r.partyId}`, (err: { code?: string }) => err.code ?? String(err));
    await tx.execute(sql`ROLLBACK TO SAVEPOINT td939name`);
    if (byName !== 'DOCUMENT_PARTY_KIND_MISMATCH') wrong.push(`a receipt named after a customer-only party: ${byName}, expected DOCUMENT_PARTY_KIND_MISMATCH`);
    const supplierByName = await resolveDocumentParty(tx, { docType: 'receipt', partyId: undefined, buyerName: supplier.name });
    if (supplierByName.partyId !== supplier.id) wrong.push(`a receipt named after a supplier was linked to ${supplierByName.partyId}`);
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return 'customer-only party refused on receipt and purchase, supplier refused on invoice; name match only among the right kind';
  });
}

/** TD-940: a requisition whose workflow cannot start is refused, never created without a workflow and only logged */
async function requisitionWorkflowStart(): Promise<string> {
  const { ProcurementService } = await import('../../services/procurement.service.js');
  return inRolledBackTx(async (tx) => {
    const input = { title: 'ERP-TEST-MARKER TD-940', items: [{ itemName: 'td940', requestedQty: 1, unit: 'عدد' }] };
    const normal = await ProcurementService.insertRequisition(tx, input, { username: 'td940' });
    if (!normal.workflowInstanceId) throw new Error('setup: a requisition with the active workflow got no workflow instance');
    await tx.update(workflowDefinitions).set({ isActive: 0 }).where(eq(workflowDefinitions.code, 'PURCHASE_REQUISITION_WORKFLOW'));
    await tx.execute(sql`SAVEPOINT td940`);
    try {
      const orphan = await ProcurementService.insertRequisition(tx, input, { username: 'td940' });
      throw new Error(`requisition ${orphan.code} was created with workflow instance ${orphan.workflowInstanceId ?? 'none'} while its workflow could not start`);
    } catch (err) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT td940`);
      if (err instanceof Error && err.message.startsWith('requisition ')) throw err;
      return `refused: ${(err as { code?: string }).code ?? (err as Error).constructor.name}`;
    }
  });
}

/** TD-937: the stock-issue reorder monitor compares free stock (stock minus reservations), like the reorder alert page */
async function reorderMonitorFreeStock(): Promise<string> {
  const { reorderAlertForIssue } = await import('../../services/events/domainEventHandlers.js');
  const { listReorderAlerts } = await import('../../services/items/reorderAlerts.service.js');
  const { createTestItem, createTestDocument } = await import('../fixtures/factories.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  const def = await orm.transaction(async (tx) => getDefaultWarehouseCode(tx)) ?? '';
  const item = await createTestItem({ reorderPoint: 10, stocks: { '': 19 } });
  const { document } = await createTestDocument({ type: 'invoice', status: 'proforma' }, [{ itemId: item.id, quantity: 15, unitPrice: 1000, location: def }]);
  try {
    const page = await listReorderAlerts({ search: item.code });
    const onPage = page.some(r => r.id === item.id);
    const alert = await reorderAlertForIssue({
      itemId: item.id, itemCode: item.code, itemName: item.name, movementType: 'out', quantity: 1, unitPrice: 0,
      warehouseLocation: def, previousStock: 20, newStock: 19, referenceDocType: 'remittance', referenceDocNumber: 'TD937',
    });
    if (!onPage) throw new Error('setup: the reorder page does not list an item with free stock 4 below its reorder point 10');
    if (!alert) throw new Error('stock 19 with 15 reserved (free 4) is on the reorder page, but the stock-issue monitor raised no alert');
    return `free stock 4 <= 10: page and monitor agree (alert free stock ${(alert as { freeStock?: number }).freeStock})`;
  } finally {
    await orm.delete(documentItems).where(eq(documentItems.documentId, document.id));
    await orm.delete(documents).where(eq(documents.id, document.id));
    await orm.delete(itemWarehouseStocks).where(eq(itemWarehouseStocks.itemId, item.id));
    await orm.delete(items).where(inArray(items.id, [item.id])).catch(() => undefined);
  }
}

export async function runDocumentAuditEventTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], () => Promise<string>]> = [
    ['reg_document_audit_workflow_woo_td_929', 'v10.0.41: a document finalized by its workflow and a WooCommerce invoice write their audit rows (TD-929)', ['td929', 'p5-s-05'], workflowAndWooAuditRows],
    ['reg_document_party_kind_td_939', 'v10.0.44: a purchase document takes only a supplier party and a sales document only a customer (TD-939)', ['td939', 'p5-p12'], purchasePartyKind],
    ['reg_requisition_workflow_start_td_940', 'v10.0.45: a purchase requisition whose workflow cannot start is refused, not created without one (TD-940)', ['td940', 'p5-p13', 'obs-r2-34'], requisitionWorkflowStart],
    ['reg_reorder_monitor_free_stock_td_937', 'v10.0.43: the stock-issue reorder monitor compares free stock like the reorder page (TD-937)', ['td937', 'p5-s-14', 'obs-r2-17'], reorderMonitorFreeStock],
    ['reg_stock_event_kardex_cost_td_930', 'v10.0.42: stock events carry the Kardex cost, not the sale price (TD-930)', ['td930', 'p5-s-07'], stockEventCost],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, 'package8', 'b4', ...tags)) continue;
    const t = Date.now();
    try {
      const details = await run();
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - t, details }));
    } catch (err) {
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - t, error: err instanceof Error ? err.message : String(err) }));
    }
  }
  return results;
}
