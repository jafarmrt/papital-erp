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
}
