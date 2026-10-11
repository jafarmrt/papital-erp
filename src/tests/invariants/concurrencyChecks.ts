import { checkMixedStockPathsNoDeadlock, checkVoidKardexOrderMatchesLive, checkVoidsOfSharedItemNoDeadlock } from './concurrencyScenarios.js';
import { checkReversalLifecycle, checkVoucherReversedOnce } from './voucherConcurrencyScenarios.js';
import { checkBankSyncFromTransactions, checkChequeStatusBankLockOrder, checkDeletedChequeFrozen, checkTransferVoidedTogether } from './treasuryConcurrencyScenarios.js';
import { checkRequisitionReceivedOnce } from './procurementConcurrencyScenarios.js';
import { checkProjectDeliveryCapped } from './projectConcurrencyScenarios.js';
import { checkDlqReplayedOnce } from './eventConcurrencyScenarios.js';
import { checkWorkLogFrozenInPayroll } from './payrollConcurrencyScenarios.js';
import { checkNoSecondConnectionInTransactions } from './poolScenarios.js';
import { checkBankAccountMaintenanceLocked } from './bankAccountScenarios.js';
import { checkIdempotencyKeyContract } from './idempotencyScenarios.js';
import { checkProjectCodesAtomic } from './projectCodeScenarios.js';
import { checkAllocationAndRemittanceShareStock, checkConcurrentSettlements, checkDeliveryAndReceiveShareItem, checkSimulatorWithConcurrentUsers } from './crossPathConcurrencyScenarios.js';

/** آزمون‌های سخت‌گیرانه حوزه J در جدول سوئیت business_invariants: [شناسه، نام، بررسی، شرح موفقیت] */
export const CONCURRENCY_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_320_void_shared_item_no_deadlock', 'v8.0.67: eight concurrent voids of invoices of one item run one after another without deadlock and stock and weighted average cost (WAC) come back exactly (TD-320)',
    checkVoidsOfSharedItemNoDeadlock, 'all eight voids done; stock 20 and WAC 100,000 restored; no violation'],
  ['inv_td_320_stock_paths_no_deadlock', 'v8.0.67: concurrent invoice, receipt, void, finalize and sales return on two items with opposite row order do not deadlock (TD-320)',
    checkMixedStockPathsNoDeadlock, 'nine concurrent operations without deadlock; invariants hold'],
  ['inv_td_320_void_kardex_order', 'v8.0.67: the reversal Kardex row of a void waiting behind the item lock is numbered after the intermediate sale and the Kardex rebuild gives the same live WAC (TD-320)',
    checkVoidKardexOrderMatchesLive, 'stock 11; Kardex rebuild matches the live WAC (I13)'],
  ['inv_td_321_voucher_reversed_once', 'v8.0.68: each journal voucher is reversed only once; of two corrections and one void running concurrently only one is accepted, and void-and-repost after a void or before a correction is refused (TD-321)',
    () => checkVoucherReversedOnce(), 'of three concurrent reversals one was accepted and the second sequential reversal was refused; each voucher has one active reversal voucher'],
  ['inv_td_322_deleted_cheque_frozen', 'v8.0.69: a deleted cheque is not cleared or deleted again, and of a concurrent delete and clear only one is accepted (TD-322)',
    () => checkDeletedChequeFrozen(), 'clearing and deleting a deleted cheque again gave "not found"; in three rounds of concurrent delete and clear only one was accepted and the bank balance stayed correct'],
  ['inv_td_1217_cheque_status_bank_lock_order', 'v10.0.196: sending a cheque to collection with a bank account and clearing the same cheque concurrently do not deadlock; the bank is locked before the cheque on every status change (TD-1217)',
    () => checkChequeStatusBankLockOrder(), 'in three rounds both changes ran in turn without deadlock and the cheque was cleared once into the bank'],
  ['inv_td_323_reversal_lifecycle', 'v8.0.70: a draft voucher is not reversed or corrected, and a voucher with an active reversal voucher does not go back to draft and is not deleted (TD-323)',
    checkReversalLifecycle, 'draft void and correction refused; the manual voucher and the voided invoice voucher did not go back to draft and were not deleted'],
  ['inv_td_326_requisition_received_once', 'v8.0.71: "receive goods" of a purchase requisition brings the goods into the warehouse only once: concurrent with conversion to orders, before it, twice concurrently, and with a partial order or an order that was not finalized (TD-326)',
    checkRequisitionReceivedOnce, 'in all five cases stock equals the received quantity of the requisition; a second receive and order were refused; one workflow instance'],
  ['inv_td_327_project_delivery_capped', 'v8.0.72: a project "receive into warehouse" never exceeds the planned quantity without a reason (concurrent or sequential), is recorded with a reason, and a cancelled project or an item outside the project is not delivered (TD-327)',
    checkProjectDeliveryCapped, 'of two concurrent deliveries one was accepted; an extra delivery was refused without a reason and recorded with one; a cancelled project and an outside item were refused'],
  ['inv_td_341_transfer_voided_together', 'v8.0.73: voiding either side of a bank-to-bank transfer reverses both rows, both balances and the shared voucher together; of a concurrent void of both sides one is accepted and an old half-voided transfer can be repaired (TD-341)',
    () => checkTransferVoidedTogether(), 'in all four cases both balances returned to 5000 and zero, both sides were voided and the shared voucher had no effect'],
  ['inv_td_340_bank_sync_from_transactions', 'v8.0.74: "sync bank balances" builds the balance under lock from the opening balance, treasury transactions and cleared cheques; a draft voucher and a concurrent payment do not corrupt the balance (TD-340)',
    () => checkBankSyncFromTransactions(), 'balances stayed 700, 300 and 7000; the report showed the treasury balance'],
  ['inv_td_342_dlq_replayed_once', 'v8.0.75: a dead letter queue (DLQ) event is replayed once; replay, dismiss and bulk requeue concurrent with a replay stand aside and a replayed event is not replayed again (TD-342)',
    () => checkDlqReplayedOnce(), 'the handler ran once; the concurrent action and the second replay were refused; the dismissed event was replayed once'],
  ['inv_td_328_work_log_frozen_in_payroll', 'v8.0.76: editing or deleting a work log concurrently with issuing a payslip does not leave the payslip inconsistent with its linked work logs; a change after the payslip is refused and the work log of a deleted payslip is free (TD-328)',
    () => checkWorkLogFrozenInPayroll(), 'in all four orders the payslip matched its linked work logs; a change after the payslip was refused; the work log of a deleted payslip was edited'],
  ['inv_td_324_no_second_pool_connection', 'v8.0.77: the first voucher of a new fiscal year, a document void, a purchase requisition and a bank account complete with one free pool connection (no second connection inside the transaction) and an audit error inside the transaction is not swallowed (TD-324)',
    checkNoSecondConnectionInTransactions, 'all four paths completed without waiting; workflow and audit log recorded; the audit error rolled back the transaction'],
  ['inv_td_325_bank_account_maintenance_locked', 'v8.0.78: editing the opening balance, the account code and deleting a bank account run under lock; a concurrent edit does not add the balance twice, no duplicate code is created and an account with transactions or cheques is not deleted (TD-325)',
    () => checkBankAccountMaintenanceLocked(), 'balance 150 and one correction voucher; five unique codes and the duplicate code refused; deleting an account with a transaction and a cheque refused'],
  ['inv_td_329_idempotency_key_contract', 'v8.0.79: the idempotency key keeps only a successful response, gives no stale response for another body or path, and its lock is extended during a long request (TD-329)',
    () => checkIdempotencyKeyContract(), 'the refused payment ran after the deposit; the repeated key with another body and path was refused; the long request ran once'],
  ['inv_td_350_project_code_atomic', 'v8.0.80: the automatic project code comes from the atomic year counter; concurrent projects get unique codes and a concurrent manual code or a taken next number gives no uniqueness error (TD-350)',
    () => checkProjectCodesAtomic(), 'five concurrent projects got five unique codes; the concurrent manual code got a suffix; the taken number was skipped'],
  // v10.0.36 (I-03): races between two different paths over the same rows
  ['inv_i03_delivery_and_receive_share_item', 'v10.0.36: a project delivery and a purchase requisition receive of the same item at the same moment are both recorded, without deadlock, and the weighted average cost holds both entries (I-03)',
    checkDeliveryAndReceiveShareItem, 'both entries recorded; stock 9 and WAC 200,000; invariants hold'],
  ['inv_i03_allocation_and_remittance_share_stock', 'v10.0.36: a material allocation and a remittance drawing on the same stock at the same moment never both leave it, and a project allocates its own reserved stock while a remittance is refused (I-03)',
    checkAllocationAndRemittanceShareStock, 'one of allocation and remittance accepted over 10 units; the reserved units went to the project only; invariants hold'],
  ['inv_i03_concurrent_settlements', 'v10.0.36: two receipts settling one invoice through two banks at the same moment are both recorded, and of a receipt and the invoice void exactly one wins (I-03)',
    checkConcurrentSettlements, 'both receipts recorded in their banks; one of receipt and void accepted; invariants hold'],
  ['inv_i03_simulator_concurrent_users', 'v10.0.36: the business-year simulator with twelve concurrent users runs 144 operations in rounds without a deadlock or a non-business error and keeps every invariant (I-03)',
    () => checkSimulatorWithConcurrentUsers(), '144 operations in 12 rounds of 12; no deadlock, no unexpected error, no violation'],
];
