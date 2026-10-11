import { and, eq } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, documents, workflowInstances } from '../../db/schema.js';

/**
 * Phase 3 lane L2 (TD-1137, TD-1138; product-owner decisions 12, 13 and 14): a sales proforma whose approval workflow is
 * rejected goes back to draft and stops reserving, a document in a review step of its workflow is not edited, and a saved
 * proforma above the sellable stock is kept with one warning per item. Each case fails on v10.0.84.
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

async function salesProforma(tx: Tx, stock: number, quantity: number, status = 'proforma') {
  const { createTestItem, createTestDocument } = await import('../fixtures/factories.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  const today = await businessTodayIsoDate();
  const def = await getDefaultWarehouseCode(tx) ?? '';
  const item = await createTestItem({ weightedAverageCost: 5000, currentStock: stock }, tx);
  const { document } = await createTestDocument({ type: 'invoice', status, date: today }, [{ itemId: item.id, quantity, unitPrice: 9000, location: def }], tx);
  return { item, document };
}

/** TD-1137 (decision 12): the reject transition of the document workflow turns a sales proforma into a draft */
async function rejectedProformaToDraft(): Promise<string> {
  const { runWorkflowTransitionAction } = await import('../../services/workflow/workflowTransitionActions.js');
  const { isReservingDocument } = await import('../../lib/documents/reservingDocuments.js');
  return inRolledBackTx(async (tx) => {
    const { document } = await salesProforma(tx, 10, 2);
    await runWorkflowTransitionAction(tx, {
      instanceId: 1, entityType: 'document', entityId: String(document.id), workflowCode: 'DOC_APPROVAL_WORKFLOW',
      fromStateKey: 'warehouse_review', toStateKey: 'rejected', actionKey: 'reject', autoActionKey: '',
      performedBy: undefined, performedByName: 'td1137 reviewer', allowBackdate: false,
    });
    const [stored] = await tx.select({ type: documents.type, status: documents.status, version: documents.version })
      .from(documents).where(eq(documents.id, document.id));
    if (stored.status !== 'draft') throw new Error(`a rejected proforma stays "${stored.status}", expected draft`);
    if (isReservingDocument(stored.type, stored.status)) throw new Error('a rejected proforma still reserves stock');
    if (Number(stored.version) !== 2) throw new Error(`version is ${stored.version}, expected 2`);
    const rows = await tx.select({ details: activityLogs.details }).from(activityLogs)
      .where(eq(activityLogs.entityId, String(document.id)));
    const audit = rows.find(r => (r.details as { operation?: string } | null)?.operation === 'WORKFLOW_REJECT_TO_DRAFT');
    const details = audit?.details as { before?: { status?: string }; after?: { status?: string } } | undefined;
    if (details?.before?.status !== 'proforma' || details?.after?.status !== 'draft') {
      throw new Error('no audit row with the proforma before and the draft after');
    }
    // a final document is never touched by a rejection
    const { document: finalDoc } = await salesProforma(tx, 10, 1, 'final');
    await runWorkflowTransitionAction(tx, {
      instanceId: 1, entityType: 'document', entityId: String(finalDoc.id), workflowCode: 'DOC_APPROVAL_WORKFLOW',
      fromStateKey: 'accounting_review', toStateKey: 'rejected', actionKey: 'reject', autoActionKey: '',
      performedBy: undefined, performedByName: 'td1137 reviewer', allowBackdate: false,
    });
    const [finalStored] = await tx.select({ status: documents.status }).from(documents).where(eq(documents.id, finalDoc.id));
    if (finalStored.status !== 'final') throw new Error(`a final document became "${finalStored.status}" on rejection`);
    return 'rejected proforma: draft, version 2, audited; final document unchanged';
  });
}

/** TD-1204 (decision t19 «خودکار»): resending a proforma that the rejection turned into a draft makes it a proforma again */
async function resentProformaReservesAgain(): Promise<string> {
  const { runWorkflowTransitionAction } = await import('../../services/workflow/workflowTransitionActions.js');
  const { isReservingDocument } = await import('../../lib/documents/reservingDocuments.js');
  const transition = (documentId: number, instanceId: number, fromStateKey: string, toStateKey: string, actionKey: string) => ({
    instanceId, entityType: 'document', entityId: String(documentId), workflowCode: 'DOC_APPROVAL_WORKFLOW',
    fromStateKey, toStateKey, actionKey, autoActionKey: '', performedBy: undefined, performedByName: 'td1204 user', allowBackdate: false,
  });
  return inRolledBackTx(async (tx) => {
    const instanceId = 900000 + (Date.now() % 90000);
    const { document } = await salesProforma(tx, 10, 2);
    await runWorkflowTransitionAction(tx, transition(document.id, instanceId, 'warehouse_review', 'rejected', 'reject'));
    await runWorkflowTransitionAction(tx, transition(document.id, instanceId, 'rejected', 'draft', 'reopen'));
    const [reopened] = await tx.select({ status: documents.status }).from(documents).where(eq(documents.id, document.id));
    if (reopened.status !== 'draft') throw new Error(`a reopened rejected proforma is "${reopened.status}", expected draft`);
    await runWorkflowTransitionAction(tx, transition(document.id, instanceId, 'draft', 'warehouse_review', 'submit_to_warehouse'));
    const [stored] = await tx.select({ type: documents.type, status: documents.status, version: documents.version })
      .from(documents).where(eq(documents.id, document.id));
    if (stored.status !== 'proforma') throw new Error(`a resent rejected proforma stays "${stored.status}", expected proforma`);
    if (!isReservingDocument(stored.type, stored.status)) throw new Error('a resent proforma does not reserve');
    if (Number(stored.version) !== 3) throw new Error(`version is ${stored.version}, expected 3`);
    const rows = await tx.select({ details: activityLogs.details }).from(activityLogs).where(eq(activityLogs.entityId, String(document.id)));
    const audit = rows.find(r => (r.details as { operation?: string } | null)?.operation === 'WORKFLOW_RESEND_TO_PROFORMA');
    const details = audit?.details as { before?: { status?: string }; after?: { status?: string } } | undefined;
    if (details?.before?.status !== 'draft' || details?.after?.status !== 'proforma') throw new Error('no audit row of the resend');

    // a draft that was never a proforma, or rejected in another instance, stays a draft when it is sent
    const { document: plainDraft } = await salesProforma(tx, 10, 1, 'draft');
    await runWorkflowTransitionAction(tx, transition(plainDraft.id, instanceId, 'draft', 'warehouse_review', 'submit_to_warehouse'));
    const { document: otherRun } = await salesProforma(tx, 10, 1);
    await runWorkflowTransitionAction(tx, transition(otherRun.id, instanceId + 1, 'warehouse_review', 'rejected', 'reject'));
    await runWorkflowTransitionAction(tx, transition(otherRun.id, instanceId + 2, 'draft', 'warehouse_review', 'submit_to_warehouse'));
    for (const id of [plainDraft.id, otherRun.id]) {
      const [row] = await tx.select({ status: documents.status }).from(documents).where(eq(documents.id, id));
      if (row.status !== 'draft') throw new Error(`document ${id} became "${row.status}" on a send, expected draft`);
    }

    // the stock was sold meanwhile: the resend is refused and the document stays a draft
    const short = await salesProforma(tx, 3, 3);
    await runWorkflowTransitionAction(tx, transition(short.document.id, instanceId + 3, 'warehouse_review', 'rejected', 'reject'));
    const { createTestDocument } = await import('../fixtures/factories.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const def = await getDefaultWarehouseCode(tx) ?? '';
    await createTestDocument({ type: 'invoice', status: 'proforma', date: await businessTodayIsoDate() },
      [{ itemId: short.item.id, quantity: 2, unitPrice: 9000, location: def }], tx);
    let code = '';
    try {
      await tx.transaction(async (sp) => {
        await runWorkflowTransitionAction(sp, transition(short.document.id, instanceId + 3, 'draft', 'warehouse_review', 'submit_to_warehouse'));
      });
    } catch (err) {
      code = String((err as { code?: unknown }).code ?? '');
      if (!String((err as Error).message).includes(short.item.code)) throw new Error('the refused resend does not name the item');
    }
    if (code !== 'INSUFFICIENT_STOCK') throw new Error(`a resend above the sellable stock was accepted (code "${code}")`);
    const [kept] = await tx.select({ status: documents.status }).from(documents).where(eq(documents.id, short.document.id));
    if (kept.status !== 'draft') throw new Error(`a refused resend left the document "${kept.status}"`);
    return 'resent rejected proforma: proforma, version 3, audited; plain draft and other run stay drafts; short resend refused';
  });
}

/** TD-1138 (decision 13): a document in a review step of its workflow is not edited; the initial step stays editable */
async function documentLockedInReview(): Promise<string> {
  const { DocumentService } = await import('../../services/document.service.js');
  const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
  return inRolledBackTx(async (tx) => {
    const { document } = await salesProforma(tx, 10, 2);
    const instance = await WorkflowTransitionExecutor.startInstance({
      workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: String(document.id), userName: 'td1138', tx,
    });
    if (!instance) throw new Error('the document approval workflow did not start');
    const [row] = await tx.select({ snapshotDsl: workflowInstances.snapshotDsl, currentStateId: workflowInstances.currentStateId })
      .from(workflowInstances).where(eq(workflowInstances.id, instance.id));
    const states = ((row.snapshotDsl as { states?: Array<{ id: number; stateKey: string }> } | null)?.states ?? []);
    const review = states.find(s => s.stateKey === 'warehouse_review');
    if (!review) throw new Error('no warehouse_review step in the snapshot');

    // initial step: editable
    await DocumentService.updateDocument(document.id, { notes: 'td1138 draft edit' }, tx);

    await tx.update(workflowInstances).set({ currentStateId: review.id })
      .where(and(eq(workflowInstances.id, instance.id)));
    let code = '';
    try {
      await tx.transaction(async (sp) => {
        await DocumentService.updateDocument(document.id, { notes: 'td1138 review edit' }, sp);
      });
    } catch (err) {
      code = String((err as { code?: unknown }).code ?? '');
      if ((err as { statusCode?: unknown }).statusCode !== 409) throw err;
    }
    if (code !== 'DOCUMENT_IN_REVIEW') throw new Error(`an edit during review was accepted (code "${code}"), expected 409 DOCUMENT_IN_REVIEW`);

    await tx.update(workflowInstances).set({ status: 'REJECTED' }).where(eq(workflowInstances.id, instance.id));
    await DocumentService.updateDocument(document.id, { notes: 'td1138 after rejection' }, tx);
    return 'initial step editable, review step 409, rejected editable';
  });
}

/** TD-1138 (decision 14): a saved sales proforma above the sellable stock gets one warning per item and is kept */
async function proformaStockWarning(): Promise<string> {
  const { proformaStockWarnings } = await import('../../services/documents/documentSellableGate.js');
  return inRolledBackTx(async (tx) => {
    const short = await salesProforma(tx, 2, 5);
    const warnings = await proformaStockWarnings(tx, short.document.id);
    if (warnings.length !== 1) throw new Error(`a proforma of 5 against stock 2 gave ${warnings.length} warnings, expected 1`);
    if (!warnings[0].includes(short.item.code)) throw new Error('the warning does not name the item code');
    const enough = await salesProforma(tx, 10, 5);
    const none = await proformaStockWarnings(tx, enough.document.id);
    if (none.length !== 0) throw new Error(`a proforma within stock gave ${none.length} warnings (its own reservation counted?)`);
    const draft = await salesProforma(tx, 2, 5, 'draft');
    if ((await proformaStockWarnings(tx, draft.document.id)).length !== 0) throw new Error('a draft got a stock warning');
    return 'short proforma: 1 warning; within stock and draft: none';
  });
}

/** TD-1199: a shortage names the warehouse by its name, never by its code */
async function shortageNamesWarehouse(): Promise<string> {
  const { proformaStockWarnings, assertOutflowWithinSellable } = await import('../../services/documents/documentSellableGate.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  const { warehouses } = await import('../../db/schema.js');
  return inRolledBackTx(async (tx) => {
    const code = await getDefaultWarehouseCode(tx) ?? '';
    const whName = `انبار نمایش ${Date.now() % 100000}`;
    await tx.update(warehouses).set({ name: whName }).where(eq(warehouses.code, code));
    const short = await salesProforma(tx, 2, 5);
    const [warning] = await proformaStockWarnings(tx, short.document.id);
    if (!warning?.includes(`«${whName}»`)) throw new Error(`the proforma warning does not name the warehouse "${whName}": ${warning}`);
    if (warning.includes(`«${code}»`)) throw new Error(`the proforma warning names the warehouse code "${code}"`);
    let message = '';
    try {
      await assertOutflowWithinSellable(tx, [{ itemId: short.item.id, quantity: 5, location: code }]);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    if (!message.includes(`«${whName}»`)) throw new Error(`the shortage error does not name the warehouse "${whName}"`);
    if (message.includes(`«${code}»`)) throw new Error(`the shortage error names the warehouse code "${code}"`);
    return 'proforma warning and shortage error name the warehouse';
  });
}

export async function runProformaReviewTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], () => Promise<string>]> = [
    ['reg_proforma_reject_to_draft_td_1137', 'v10.0.85: a rejected sales proforma returns to draft and stops reserving (TD-1137)', ['td1137'], rejectedProformaToDraft],
    ['reg_proforma_resend_reserves_td_1204', 'v10.0.191: a rejected proforma resent for review is a proforma again and reserves (TD-1204)', ['td1204'], resentProformaReservesAgain],
    ['reg_document_locked_in_review_td_1138', 'v10.0.86: a document in a workflow review step is not edited (TD-1138)', ['td1138'], documentLockedInReview],
    ['reg_shortage_warehouse_name_td_1199', 'v10.0.114: a stock shortage names the warehouse by its name, not its code (TD-1199)', ['td1199'], shortageNamesWarehouse],
    ['reg_proforma_stock_warning_td_1138', 'v10.0.86: a saved proforma above the sellable stock gets a warning per item (TD-1138)', ['td1138'], proformaStockWarning],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, 'package8', ...tags)) continue;
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
