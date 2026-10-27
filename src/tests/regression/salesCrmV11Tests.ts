import { and, desc, eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeadStageHistory, crmLeads, notifications, purchaseRequisitions } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { ProcurementService } from '../../services/procurement.service.js';
import { WorkflowEngineService } from '../../services/workflow/workflowEngineService.js';
import { createTestCustomer, createTestItem, testSupplier } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';
import { brief, codeOf, ok } from './receiptsOnInvoicesV11Tests.js';

/**
 * v11 phase 6.4: sales and CRM. A lead's status follows its stage (C4), a final invoice makes its lead a sale and keeps it
 * one until the invoice is voided (C3), the unpaged lead list takes the open files first (C6), and an order spreads over
 * the requisition rows of one item (C9). Real Express routes and services on PostgreSQL, each scenario in its own schema;
 * each case is red on v11.4.0.
 */

/** the activity a final invoice writes on its lead */
const SOLD_NOTE_TITLE = 'فروش موفق با فاکتور قطعی';

const leadOf = async (id: number) => (await orm.select().from(crmLeads).where(eq(crmLeads.id, id)))[0];
const historyOf = (id: number) => orm.select().from(crmLeadStageHistory).where(eq(crmLeadStageHistory.leadId, id)).orderBy(crmLeadStageHistory.id);

export async function runSalesCrmV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const status = 'reg_crm_lead_status_follows_stage_v11_6_4_c4';
  if (shouldRun(status, 'v11', 'phase6', 'c4', 'crm', 'lead')) {
    await runCase(results, status, 'v11 phase 6.4 (C4): a lead status sent alone moves its stage the same way: «lost» asks its reason and writes the stage history; a stage and a status that disagree, and «active» on a closed lead, are refused; «archived» keeps the stage and a stage change reopens it', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const [lead] = await orm.insert(crmLeads).values({ title: `پرونده وضعیت ${Date.now()}`, stage: 'lead', status: 'active', hasProforma: 0, isDeleted: 0 }).returning();
      const [other] = await orm.insert(crmLeads).values({ title: `پرونده بایگانی ${Date.now()}`, stage: 'qualified', status: 'active', hasProforma: 0, isDeleted: 0 }).returning();

      const noReason = await admin.put(`/api/crm/leads/${lead.id}`, { status: 'lost' });
      const untouched = await leadOf(lead.id);
      if (noReason.status !== 422 || codeOf(noReason) !== 'CRM_LEAD_LOST_REASON_REQUIRED' || untouched.stage !== 'lead' || untouched.status !== 'active') {
        problems.push(`status lost without a reason returned ${brief(noReason)} and left ${untouched.stage}/${untouched.status}, expected 422 CRM_LEAD_LOST_REASON_REQUIRED and lead/active`);
      }
      const lost = await admin.put(`/api/crm/leads/${lead.id}`, { status: 'lost', lostReason: 'price' });
      const afterLost = await leadOf(lead.id);
      const history = await historyOf(lead.id);
      if (!ok(lost) || afterLost.stage !== 'lost' || afterLost.status !== 'lost' || afterLost.lostReason !== 'price') {
        problems.push(`status lost with a reason returned ${brief(lost)} and left ${afterLost.stage}/${afterLost.status}/${afterLost.lostReason}, expected lost/lost/price`);
      }
      if (!history.some(h => h.fromStage === 'lead' && h.toStage === 'lost' && h.lostReason === 'price')) {
        problems.push(`no stage history row lead → lost: ${JSON.stringify(history.map(h => [h.fromStage, h.toStage, h.lostReason]))}`);
      }
      const reopenByStatus = await admin.put(`/api/crm/leads/${lead.id}`, { status: 'active' });
      if (reopenByStatus.status !== 422 || codeOf(reopenByStatus) !== 'CRM_LEAD_STATUS_STAGE_MISMATCH') problems.push(`status active on a lost lead returned ${brief(reopenByStatus)}, expected 422 CRM_LEAD_STATUS_STAGE_MISMATCH`);
      const mismatch = await admin.put(`/api/crm/leads/${lead.id}`, { stage: 'qualified', status: 'won' });
      if (mismatch.status !== 422 || codeOf(mismatch) !== 'CRM_LEAD_STATUS_STAGE_MISMATCH') problems.push(`stage qualified with status won returned ${brief(mismatch)}, expected 422 CRM_LEAD_STATUS_STAGE_MISMATCH`);
      if ((await leadOf(lead.id)).stage !== 'lost') problems.push('a refused change moved the lead');

      const archived = await admin.put(`/api/crm/leads/${other.id}`, { status: 'archived' });
      const afterArchive = await leadOf(other.id);
      if (!ok(archived) || afterArchive.stage !== 'qualified' || afterArchive.status !== 'archived') problems.push(`archiving returned ${brief(archived)} and left ${afterArchive.stage}/${afterArchive.status}, expected qualified/archived`);
      const moved = await admin.put(`/api/crm/leads/${other.id}`, { stage: 'proposal' });
      const afterMove = await leadOf(other.id);
      if (!ok(moved) || afterMove.stage !== 'proposal' || afterMove.status !== 'active') problems.push(`a stage change of an archived lead returned ${brief(moved)} and left ${afterMove.stage}/${afterMove.status}, expected proposal/active`);

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'status lost asks its reason and writes history; mismatches are refused; archived keeps the stage';
    }));
  }

  const sale = 'reg_crm_lead_won_by_final_invoice_v11_6_4_c3';
  if (shouldRun(sale, 'v11', 'phase6', 'c3', 'crm', 'lead', 'documents', 'finalize')) {
    await runCase(results, sale, 'v11 phase 6.4 (C3): finalizing a lead\'s proforma into an invoice moves the lead to won in the same transaction with its stage history row, an activity note and the won notice; the sold lead refuses lost or any other stage until the invoice is voided, after which it is back at proposal and may be lost', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const main = String(await getDefaultWarehouseCode(orm));
      const item = await createTestItem({ type: 'product', stocks: { [main]: 5 } });
      const customer = await createTestCustomer();
      const [lead] = await orm.insert(crmLeads).values({ title: `پرونده فروش قطعی ${Date.now()}`, customerName: customer.name, customerId: customer.id, stage: 'qualified', status: 'active', hasProforma: 0, isDeleted: 0 }).returning();
      const issued = await admin.post('/api/documents', {
        docType: 'invoice', status: 'proforma', refNumber: 'auto', date: today, location: main, buyer_name: customer.name, partyId: customer.id,
        inOut: 'out', crmLeadId: lead.id, items: [{ itemId: item.id, quantity: 1, unit_price: 100_000 }],
      });
      const docId = Number(issued.body?.docId);
      if (!ok(issued) || !docId) throw new Error(`the proforma was not issued: ${brief(issued)}`);
      if ((await leadOf(lead.id)).stage !== 'proposal') problems.push('the proforma did not move the lead to proposal');

      const finalized = await admin.put(`/api/documents/${docId}/finalize`, {});
      if (!ok(finalized)) throw new Error(`finalize returned ${brief(finalized)}`);
      const won = await leadOf(lead.id);
      if (won.stage !== 'won' || won.status !== 'won') problems.push(`after the final invoice the lead is ${won.stage}/${won.status}, expected won/won`);
      if (!(await historyOf(lead.id)).some(h => h.fromStage === 'proposal' && h.toStage === 'won')) problems.push('no stage history row proposal → won');
      const notes = await orm.select().from(crmActivities).where(and(eq(crmActivities.leadId, lead.id), eq(crmActivities.title, SOLD_NOTE_TITLE)));
      if (notes.length !== 1) problems.push(`expected one sold-by-invoice activity, got ${notes.length}`);
      const bell = await orm.select().from(notifications).where(eq(notifications.link, `/crm?leadId=${lead.id}`)).orderBy(desc(notifications.id));
      if (bell.length === 0) problems.push('no won notice in the bell of the crm.manage holders');

      for (const body of [{ stage: 'lost', lostReason: 'price' }, { status: 'lost', lostReason: 'price' }, { stage: 'proposal' }]) {
        const refused = await admin.put(`/api/crm/leads/${lead.id}`, body);
        if (refused.status !== 422 || codeOf(refused) !== 'CRM_LEAD_SOLD') problems.push(`${JSON.stringify(body)} on a sold lead returned ${brief(refused)}, expected 422 CRM_LEAD_SOLD`);
      }
      const edited = await admin.put(`/api/crm/leads/${lead.id}`, { notes: 'یادداشت پس از فروش' });
      if (!ok(edited) || (await leadOf(lead.id)).stage !== 'won') problems.push(`editing a sold lead's note returned ${brief(edited)}`);

      const voided = await admin.del(`/api/documents/${docId}`);
      if (!ok(voided)) throw new Error(`void returned ${brief(voided)}`);
      const released = await leadOf(lead.id);
      if (released.stage !== 'proposal' || released.status !== 'active') problems.push(`after the void the lead is ${released.stage}/${released.status}, expected proposal/active`);
      const lostAfter = await admin.put(`/api/crm/leads/${lead.id}`, { stage: 'lost', lostReason: 'price' });
      if (!ok(lostAfter) || (await leadOf(lead.id)).stage !== 'lost') problems.push(`lost after the void returned ${brief(lostAfter)}, expected 200`);

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'the final invoice makes its lead won with history, note and notice; the sold lead stays won until the void';
    }));
  }

  const board = 'reg_crm_unpaged_leads_open_first_v11_6_4_c6';
  if (shouldRun(board, 'v11', 'phase6', 'c6', 'crm', 'lead')) {
    await runCase(results, board, 'v11 phase 6.4 (C6): the unpaged lead list (board and dashboard) takes the open files before the closed and archived ones, so a cut list drops old closed files and never an open deal; the paged table keeps the newest first', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const tag = String(Date.now()).slice(-6);
      const at = (minute: number) => `2026-01-01T10:${String(minute).padStart(2, '0')}:00.000Z`;
      const [open] = await orm.insert(crmLeads).values({ title: `باز ${tag}`, stage: 'proposal', status: 'active', hasProforma: 0, isDeleted: 0, updatedAt: at(1) }).returning();
      const closed = await orm.insert(crmLeads).values([
        { title: `بسته ${tag} ۱`, stage: 'lost', status: 'lost', lostReason: 'price', hasProforma: 0, isDeleted: 0, updatedAt: at(5) },
        { title: `بسته ${tag} ۲`, stage: 'won', status: 'won', hasProforma: 0, isDeleted: 0, updatedAt: at(6) },
        { title: `بایگانی ${tag}`, stage: 'lead', status: 'archived', hasProforma: 0, isDeleted: 0, updatedAt: at(7) },
      ]).returning();
      const unpaged = await admin.get(`/api/crm/leads?search=${encodeURIComponent(tag)}&limit=2`);
      const ids = (Array.isArray(unpaged.body) ? unpaged.body : []).map((l: { id: number }) => Number(l.id));
      if (unpaged.status !== 200 || ids.length !== 2 || ids[0] !== open.id || ids[1] !== closed[2].id) {
        problems.push(`the unpaged list cut at 2 returned ${JSON.stringify(ids)} (${unpaged.status}), expected the open file ${open.id} then the newest closed ${closed[2].id}`);
      }
      const paged = await admin.get(`/api/crm/leads?search=${encodeURIComponent(tag)}&page=1&limit=10`);
      const pagedIds = ((paged.body?.data ?? []) as Array<{ id: number }>).map(l => Number(l.id));
      if (pagedIds[0] !== closed[2].id || pagedIds[pagedIds.length - 1] !== open.id) problems.push(`the paged table order changed: ${JSON.stringify(pagedIds)}`);

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'open files first in the unpaged list; the table keeps newest first';
    }));
  }

  const rows = 'reg_requisition_duplicate_item_rows_order_v11_6_4_c9';
  if (shouldRun(rows, 'v11', 'phase6', 'c9', 'procurement', 'requisition')) {
    await runCase(results, rows, 'v11 phase 6.4 (C9): ordering a requisition with two rows of one item spreads the quantity over both rows in order, so 10 for rows 5 + 5 orders both fully, 7 orders 5 and 2 and the rest 3 orders without an over-order reason; an over-order sits on the last row', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      await WorkflowEngineService.seedDefaultWorkflows();
      const main = String(await getDefaultWarehouseCode(orm));
      const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
      const supplier = await testSupplier(`تامین‌کننده C9 ${Date.now()}`);
      const user = { username: 'c9', role: 'admin' };
      const group = (quantity: number) => ({ supplierName: supplier, targetWarehouse: main, items: [{ itemId: item.id, quantity, unitPrice: 1000 }] });
      const rowsOf = async (id: number) => {
        const [req] = await orm.select({ items: purchaseRequisitions.items }).from(purchaseRequisitions).where(inArray(purchaseRequisitions.id, [id]));
        return ((req?.items ?? []) as Array<{ orderedQty?: number; remainingQty?: number; status?: string; overOrders?: unknown[] }>);
      };
      const twoRows = [{ itemId: item.id, requestedQty: 5, unitPriceEstimate: 1000 }, { itemId: item.id, requestedQty: 5, unitPriceEstimate: 1000 }];

      const whole = await ProcurementService.createRequisition({ title: 'درخواست دو ردیف C9', items: twoRows as never }, user);
      await ProcurementService.convertToPurchaseOrders({ requisitionId: whole.id, orderGroups: [group(10)] as never }, user);
      const wholeRows = await rowsOf(whole.id);
      if (wholeRows.length !== 2 || wholeRows.some(r => r.orderedQty !== 5 || r.remainingQty !== 0 || r.status !== 'ordered')) {
        problems.push(`ordering 10 for rows 5 + 5 left ${JSON.stringify(wholeRows.map(r => [r.orderedQty, r.remainingQty, r.status]))}, expected both 5/0/ordered`);
      }

      const part = await ProcurementService.createRequisition({ title: 'درخواست دو ردیف C9 بخشی', items: twoRows as never }, user);
      await ProcurementService.convertToPurchaseOrders({ requisitionId: part.id, orderGroups: [group(7)] as never }, user);
      let partRows = await rowsOf(part.id);
      if (partRows[0]?.orderedQty !== 5 || partRows[1]?.orderedQty !== 2 || partRows[1]?.remainingQty !== 3) {
        problems.push(`ordering 7 left ${JSON.stringify(partRows.map(r => [r.orderedQty, r.remainingQty]))}, expected 5/0 and 2/3`);
      }
      try {
        await ProcurementService.convertToPurchaseOrders({ requisitionId: part.id, orderGroups: [group(3)] as never }, user);
      } catch (err) {
        problems.push(`ordering the remaining 3 was refused: ${String((err as Error).message)}`);
      }
      await ProcurementService.convertToPurchaseOrders({ requisitionId: part.id, orderGroups: [group(2)] as never, overOrderReason: 'بسته‌بندی' }, user);
      partRows = await rowsOf(part.id);
      if (partRows[0]?.orderedQty !== 5 || partRows[1]?.orderedQty !== 7 || (partRows[1]?.overOrders ?? []).length !== 1 || (partRows[0]?.overOrders ?? []).length !== 0) {
        problems.push(`after the over-order the rows are ${JSON.stringify(partRows.map(r => [r.orderedQty, (r.overOrders ?? []).length]))}, expected 5/0 and 7/1`);
      }

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'orders spread over the rows of one item; the remaining quantity orders without a reason';
    }));
  }

  return results;
}
