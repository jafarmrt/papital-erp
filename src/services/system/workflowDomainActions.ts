import { registerBankAccountWorkflowAction } from '../accounting/treasury/bankAccountWorkflowAction.js';
import { registerDocumentRemainingReader } from '../accounting/treasury/documentRemaining.js';
import { registerVoucherWorkflowAction } from '../accounting/voucherWorkflowAction.js';
import { registerDocumentWorkflowAction } from '../documents/documentWorkflowAction.js';
import { readDocumentPayableAndSettled } from '../documents/documentRemainingAmount.js';
import { registerReservedStocksReader } from '../events/domainEventHandlers.js';
import { ItemStockReservationService } from '../items/itemStockReservation.service.js';
import { registerItemOpeningWorkflowAction } from '../inventory/itemOpeningWorkflowAction.js';
import { registerPendingMaterialWorkflowAction } from '../inventory/pendingMaterialWorkflowAction.js';
import { registerRequisitionWorkflowAction } from '../procurement/requisitionWorkflowAction.js';
import { procurementOrderHooks } from '../procurement/requisitionOrderSync.js';
import { registerLinkedOrderHooks } from '../documents/linkedOrderHooks.js';
import { registerEntityWorkflowPort } from './entityWorkflowPort.js';
import { registerScheduleProgressSync } from '../piecework/scheduleProgressSync.js';
import { syncProjectsAfterScheduleWork } from '../projects/projectStatusSync.js';
import { WorkflowEngineService } from '../workflow/workflowEngineService.js';
import { terminateOpenWorkflows } from '../workflow/workflowTermination.js';

/**
 * v9.0.2 (TD-415): ریشه ترکیب اقدام‌های پس از انتقال گردش‌کار. server.ts هنگام راه‌اندازی و bootstrapTestMasterData برای
 * اجراکننده آزمون و شبیه‌ساز صدا می‌زنند؛ موتور گردش‌کار خودش هیچ دامنه‌ای را import نمی‌کند (workflowTransitionActions.ts).
 * جانشین registerWorkflowListeners (شنونده‌های workflowEventBus) است.
 */
export function registerWorkflowDomainActions(): void {
  registerDocumentWorkflowAction();
  registerItemOpeningWorkflowAction();
  registerBankAccountWorkflowAction();
  registerVoucherWorkflowAction();
  registerRequisitionWorkflowAction();
  // v9.0.398 (TD-826): approve or reject a raw material request
  registerPendingMaterialWorkflowAction();
  // v10.0.43 (TD-937): the reorder alert event compares free stock, so it reads the reservations through this root
  registerReservedStocksReader(itemIds => ItemStockReservationService.getReservedStocksMap({ itemIds }));
  // v10.0.59 (TD-938): a linked receipt or payment is capped at the document's remaining amount, read through this root
  registerDocumentRemainingReader(readDocumentPayableAndSettled);
  // v10.0.237 / v10.0.238 (TD-912 / TD-913): voiding or editing a procurement order updates its requisition (not a workflow
  // action, but the same composition root: the documents package may not import procurement)
  registerLinkedOrderHooks(procurementOrderHooks);
  // v10.0.250 (OBS-R2-02): the accounting, treasury and item cores start and close their entity workflows through this port
  registerEntityWorkflowPort({ maybeStart: params => WorkflowEngineService.maybeStartWorkflow(params), terminateOpen: terminateOpenWorkflows });
  // 10.2 package 12 (D6): a work log of a workshop schedule row syncs its project's progress (piecework may not import projects)
  registerScheduleProgressSync(syncProjectsAfterScheduleWork);
}
