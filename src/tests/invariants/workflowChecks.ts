import { makeTestCase, type TestCaseResult } from '../types.js';
import { getErrorMessage } from '../../utils/formatters.js';
import {
  checkMultiSignTaskStaysOpen, checkRunningInstanceKeepsTasksAfterEdit, checkSignaturesResetOnReentry,
  checkTaskAndTransitionNoDeadlock, checkTaskRunsItsOwnTransition, checkViewPermissionCannotApprove,
} from './workflowScenarios.js';
import { checkReceiveApprovesInReceiverName, checkRequisitionActionFollowsWorkflow } from './workflowProcurementScenarios.js';
import { checkInitiatorExcludedStep, checkTransitionRequiredPermission } from './workflowPermissionScenarios.js';
import { checkRequisitionStepNotRewritten, checkWorkflowDocumentAmountInRials } from './workflowObservationScenarios.js';
import { checkAndAllNeedsEveryMember, checkDelegateActsForDelegatorRole, checkDelegationRevokedByDelegatorOnly } from './workflowDelegationScenarios.js';
import {
  checkDeliveryWithoutUserIdNotAttributedToUserOne, checkDocumentApprovalFinalizesInTransaction, checkOpeningApprovalsFollowTransaction,
  checkRefusedReceiveLeavesNoTrace, checkTransitionEffectsFollowCommit, checkVoucherApprovalRefusedWhenStatusCannotChange,
} from './workflowAutoActionScenarios.js';

/** آزمون‌های سخت‌گیرانه حوزه G (گردش‌کار و تأیید) در سوئیت workflow: [شناسه، نام، بررسی، شرح موفقیت] */
export const WORKFLOW_CHECKS: Array<[string, string, () => Promise<string[]>, string]> = [
  ['wf_td_370_task_runs_own_transition', 'v8.0.90: an inbox task runs its own transition and "reject" runs only a reject transition; a step without a reject transition does not accept "reject" (TD-370)',
    checkTaskRunsItsOwnTransition, 'Submissions by the admin and a regular user went to "review"; "reject" without a reject transition was refused; "reject" with a reject transition rejected the instance'],
  ['wf_td_371_multi_sign_task_stays_open', 'v8.0.91: a multi-signature (K_OF_N) task stays open in the inbox until the quorum is reached and the second signature from the inbox is accepted (TD-371)',
    checkMultiSignTaskStaysOpen, 'The task stayed open after the first signature; a repeated signature was not counted; the second signature completed the instance'],
  ['wf_td_372_running_instance_tasks_after_edit', 'v8.0.92: after a design edit a running instance takes the tasks and deadline of the next step from its own version snapshot (TD-372)',
    checkRunningInstanceKeepsTasksAfterEdit, 'The second step got one task with the transition of its own version and a 5-hour deadline, and the instance completed'],
  ['wf_td_373_signatures_reset_on_reentry', 'v8.0.93: step signatures are counted anew after the instance returns to the same step (TD-373)',
    checkSignaturesResetOnReentry, 'The signature of the previous round was not counted; two new signatures completed the quorum'],
  ['wf_td_374_view_permission_cannot_approve', 'v8.0.94: a view or treasury permission does not run a warehouse or accountant role step, nor does the production role run the manager step (TD-374); since v9.0.111 only the same role (TD-542)',
    checkViewPermissionCannotApprove, 'Nine wrong accesses were refused and five correct ones accepted; the transition API refused too'],
  ['wf_td_375_task_transition_no_deadlock', 'v8.0.95: executing an inbox task concurrently with a direct execution of the same step does not deadlock and the step runs once (TD-375)',
    checkTaskAndTransitionNoDeadlock, 'In three concurrent rounds without deadlock, the step ran once'],
  ['wf_td_376_and_all_every_member', 'v8.0.96: an "unanimous" (AND_ALL) step needs the signatures of all active users of the role, and a roleless step the K of the designer (TD-376)',
    checkAndAllNeedsEveryMember, 'The step passed for a three-member role with three signatures, a one-member role with one signature and a roleless step with K=2'],
  ['wf_td_377_delegate_acts_for_role', 'v8.0.97: within the delegation window and scope the delegate sees the tasks of the delegator role and signs in the delegator name, and one person never counts as two signatures (TD-377)',
    checkDelegateActsForDelegatorRole, 'The delegate saw the task and signed in the delegator name; the second signature was refused; a delegation of another scope and a revoked one were refused; the reminder arrived'],
  ['wf_td_378_delegation_revoked_by_delegator', 'v8.0.98: only the delegator or an admin revokes a delegation and invalid delegation input is 422, not 500 (TD-378)',
    checkDelegationRevokedByDelegatorOnly, 'Revoke by the delegate 403; the delegator and the admin revoked; invalid input 422 and missing 404'],
  ['wf_td_379_requisition_action_follows_workflow', 'v8.0.99: a purchase requisition workflow action runs only a transition of the current step; a received requisition is neither reopened nor received again (TD-379)',
    checkRequisitionActionFollowsWorkflow, 'Reopening the received requisition was refused; stock stayed 10'],
  ['wf_td_390_receive_approves_in_receiver_name', 'v8.0.101: "receive goods" on an unapproved requisition records the approval in the receiver name and is refused without approval rights (TD-390)',
    checkReceiveApprovesInReceiverName, 'The approval in the receiver name was recorded in the history; a receiver without the approval role got 403 and stock stayed 4'],
  ['wf_td_391_transition_required_permission', 'v8.0.100: a transition with a "required permission" is run and offered only for a holder of that permission or an admin (TD-391)',
    checkTransitionRequiredPermission, 'A user without the permission got 403 and was not offered the transition; a role with the permission, the own permission of a user and the admin ran it'],
  ['wf_td_392_initiator_excluded_step', 'v8.0.102: an "initiator may not approve" step is closed to the initiator and their delegate and does not appear in their inbox; a colleague and the admin run it (TD-392)',
    checkInitiatorExcludedStep, 'The initiator and their delegate got 403; the task appeared only in the colleague inbox; the colleague and the admin ran it; a step without the option stayed open'],
  ['wf_td_404_document_amount_in_rials', 'v8.0.123: the document workflow amount rule checks the payable amount in rials (with tax, service charge and currency conversion) and a foreign-currency document without a rate passes no amount condition (TD-404)',
    checkWorkflowDocumentAmountInRials, 'A 110-dollar invoice was evaluated as 55 million rials; a rial invoice as 1,150,000 without the deleted line; a document without a rate passed no amount condition'],
  ['wf_td_405_requisition_step_not_rewritten', 'v8.0.124: a purchase requisition action does not rewrite the workflow step from the requisition status and a received requisition accepts no action (TD-405)',
    checkRequisitionStepNotRewritten, 'Every step change was recorded in the history and the approval came before the receipt; an action on the received requisition got 409 and its step was untouched'],
  ['wf_td_415_refused_receive_leaves_no_trace', 'v9.0.2: a refused "receive goods" (order left in a closed fiscal year) leaves no item, Kardex, journal voucher or status change (TD-415)',
    checkRefusedReceiveLeavesNoTrace, 'The action was refused; both orders draft, stock and Kardex zero, no journal voucher; the requisition and the step stayed "ordered"'],
  ['wf_td_415_transition_effects_follow_commit', 'v9.0.2: a rolled-back transition leaves no effect outside and a committed transition is published only once and only from the outbox (TD-415)',
    checkTransitionEffectsFollowCommit, 'The rolled-back transition left no status, log, outbox row or publication; the committed transition had one outbox row and one log and was not published in-process'],
  ['wf_td_415_document_approval_finalizes_in_tx', 'v9.0.2: the final approval of the document workflow finalizes the document in the same transaction and an impossible finalize refuses the approval (TD-415)',
    checkDocumentApprovalFinalizesInTransaction, 'Approving the invoice without stock was refused and the step and document stayed; approving another invoice finalized it in the response'],
  ['wf_td_415_voucher_approval_refused', 'v9.0.2: workflow approval of a permanent journal voucher is refused and the step and voucher status stay untouched (TD-415)',
    checkVoucherApprovalRefusedWhenStatusCannotChange, 'The approval was refused; the step stayed "draft" and the voucher "permanent"'],
  ['wf_td_415_opening_approval_in_tx', 'v9.0.2: final approval of an item and a treasury account issues the opening voucher in the same transaction and an impossible issue refuses the approval (TD-415)',
    checkOpeningApprovalsFollowTransaction, 'The rolled-back item approval left no voucher and the committed approval had one opening voucher; approving a cash box without a ledger account was refused and the step stayed'],
  ['wf_td_415_delivery_not_attributed_to_user_one', 'v9.0.2: delivering an order without a user id does not record the "received" step and the delivery log in the name of user 1 (TD-415)',
    checkDeliveryWithoutUserIdNotAttributedToUserOne, 'The "received" step and the delivery log were recorded without a user'],
];

export async function runWorkflowChecks(shouldRun: (id: string) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  for (const [id, name, check, okDetail] of WORKFLOW_CHECKS) {
    if (!shouldRun(id)) continue;
    const start = Date.now();
    let problems: string[];
    try {
      problems = await check();
    } catch (err) {
      problems = [`خطای پیش‌بینی‌نشده: ${getErrorMessage(err)}`];
    }
    const passed = problems.length === 0;
    results.push(makeTestCase({
      id, name, layer: 'workflow', executionType: 'real_database', passed, durationMs: Date.now() - start,
      ...(passed ? { details: okDetail } : { error: problems.join(' | ') }),
    }));
  }
  return results;
}
