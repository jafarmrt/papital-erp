import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { runReservationCases } from './stockReservationTests.js';
import {
  ACCOUNTS, allocate, deliver, delivered, kardexCosts, project, sameNet, voucherOf, wipOf, type CostRefusal,
} from './productionRealCostTests.js';

/**
 * v11 phase 6.1ث (review of S2): the edges of the real-cost receipt. A project's 1402 left below zero by receipts of before
 * this phase is closed by the receipt that completes the plan; a batch of several products that completes the plan with a
 * new product without any cost spreads 1402 by quantity instead of refusing the product; and a difference of the unit
 * cost's rounding alone does not need the variance account. Each is red on the first version of the change.
 */
export async function runProductionRealCostReviewTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_production_real_cost_review_v11_6_1th',
      'v11 6.1th review: a 1402 below zero is closed by the completing receipt against 6005; a completing batch with a product without cost spreads 1402 by quantity; a rounding difference alone posts without 6005',
      ['v11', 'phase6', 'projects', 'delivery', 'wip'], reviewCase],
  ]);
}

async function reviewCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);

  // 1) a 1402 below zero: a receipt of before this phase took 1,300 of the 1,000 allocated
  const material = await f.item(40, 1_000);
  const product = await f.item(0, 0);
  const legacyProject = await project(h, f, [[product, 2]]);
  await allocate(h, f, legacyProject, material, 1);
  const legacy = await delivered(h, f, legacyProject, [{ itemId: product, quantity: 1, unitPrice: 1_300 }], 'review: a dearer first unit');
  await h.q(`DELETE FROM production_receipt_costs WHERE document_id = $1`, [legacy]);
  await h.q(`UPDATE journal_voucher_items SET is_deleted = 1 WHERE voucher_id IN (SELECT id FROM journal_vouchers WHERE source_document_id = $1)`, [legacy]);
  await h.q(`UPDATE journal_vouchers SET is_deleted = 1 WHERE source_document_id = $1`, [legacy]);
  const { VoucherSyncService } = await import('../../services/accounting/voucherSync.service.js');
  await VoucherSyncService.autoCreateVoucherForInvoice(legacy, 1, 'review', undefined, { strict: true });
  if (await wipOf(h, legacyProject) !== -300) throw new Error(`setup: the legacy receipt left 1402 at ${await wipOf(h, legacyProject)}, expected -300`);
  const unasked = await deliver(h, f, legacyProject, [{ itemId: product, quantity: 1 }]);
  if (unasked.status !== 422 || (unasked.body as CostRefusal).details?.kind !== 'no_wip') wrong.push(`the completing receipt of a 1402 below zero answered ${brief(unasked)} without a reason, expected 422 no_wip`);
  const closing = await delivered(h, f, legacyProject, [{ itemId: product, quantity: 1 }], 'review: the last unit');
  const vc = await voucherOf(h, closing, legacyProject);
  if (!vc.balanced || !vc.projectRows || !sameNet(vc.net, { [ACCOUNTS.finishedGoods]: 1_300, [ACCOUNTS.wip]: 300, [ACCOUNTS.variance]: -1_600 })) {
    wrong.push(`the closing receipt's voucher is ${JSON.stringify(vc)}, expected Dr 1403 1,300 / Dr 1402 300 / Cr 6005 1,600 with the project`);
  }
  if (await wipOf(h, legacyProject) !== 0) wrong.push(`1402 after the closing receipt is ${await wipOf(h, legacyProject)}, expected 0`);

  // 2) chairs (average cost 100) and a new table without any cost complete the plan together: 5,500 by quantity, 500 each
  const chair = await f.item(0, 100);
  const table = await f.item(0, 0);
  const batchProject = await project(h, f, [[chair, 10], [table, 1]]);
  const parts = await f.item(30, 500);
  await allocate(h, f, batchProject, parts, 11);
  const batch = await deliver(h, f, batchProject, [{ itemId: chair, quantity: 10 }, { itemId: table, quantity: 1 }]);
  if (batch.status !== 200) wrong.push(`the completing batch with a table without cost answered ${brief(batch)}, expected 200`);
  else {
    const costs = await kardexCosts(h, Number((batch.body as { documentId?: unknown }).documentId));
    if (costs[chair] !== 500 || costs[table] !== 500) wrong.push(`the batch entered a chair at ${costs[chair]} and the table at ${costs[table]}, expected 500 each`);
    if (await wipOf(h, batchProject) !== 0) wrong.push(`1402 after the completing batch is ${await wipOf(h, batchProject)}, expected 0`);
  }

  // 3) plan 3,000 on 1,000: 0.3333 a unit leaves 0.1 of rounding, which posts without the variance account
  const small = await f.item(0, 0);
  const roundingProject = await project(h, f, [[small, 3_000]]);
  await allocate(h, f, roundingProject, material, 1);
  const [variance] = await h.q(`SELECT id FROM accounts WHERE code = $1 AND is_deleted = 0`, [ACCOUNTS.variance]);
  await h.q(`UPDATE accounts SET is_deleted = 1 WHERE id = $1`, [variance?.id]);
  try {
    const rounded = await deliver(h, f, roundingProject, [{ itemId: small, quantity: 3_000 }]);
    if (rounded.status !== 200) wrong.push(`a rounding-only receipt without 6005 answered ${brief(rounded)}, expected 200`);
    else {
      const vr = await voucherOf(h, Number((rounded.body as { documentId?: unknown }).documentId), roundingProject);
      if (!vr.balanced || !sameNet(vr.net, { [ACCOUNTS.finishedGoods]: 999.9, [ACCOUNTS.wip]: -999.9 })) wrong.push(`the rounding-only voucher is ${JSON.stringify(vr)}, expected Dr 1403 999.9 / Cr 1402 999.9`);
    }
  } finally {
    await h.q(`UPDATE accounts SET is_deleted = 0 WHERE id = $1`, [variance?.id]);
  }
  return '1402 of -300 closed against 6005; a table without cost spread by quantity; rounding posted without 6005';
}
