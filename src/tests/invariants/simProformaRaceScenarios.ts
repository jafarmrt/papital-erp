import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { createTestCustomer, createTestItem } from '../fixtures/factories.js';
import { createProjectOperations, setupProjectWorld } from '../simulation/simulationProjectOperations.js';
import type { SimItem, SimRandom } from '../simulation/simulationOperations.js';
import { overReservedItems } from './reservationInvariants.js';
import { receive } from './scenarioHelpers.js';

/**
 * v10.0.88 (TD-1148): the simulator's proforma step reads the item's free stock and then saves a sales proforma sized to
 * it. Saving a proforma passes no sellable gate (product-owner decision ت۱۴: a warning only), so two concurrent steps on
 * one item that both read the same free stock reserved up to twice it, and the concurrent rounds reported I19. The step
 * now reads free stock and saves the proforma under the item's row lock, as one simulated user would.
 */
export async function checkConcurrentProformaSteps(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const tag = `PFR${Date.now() % 1000000}`;
  const ids = await setupProjectWorld(tag);
  if (ids.approverId === null) return ['no user to approve the proformas'];
  const it = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const item: SimItem = { id: it.id, type: 'raw_material' };
  await receive(item.id, 4, 100000, wh, await businessTodayIsoDate());
  const customer = await createTestCustomer({ name: `مشتری آزمون پیش‌فاکتور همزمان ${tag}`, partyType: 'customer' });
  const supplier = await createTestCustomer({ name: `تامین‌کننده آزمون پیش‌فاکتور همزمان ${tag}`, partyType: 'supplier' });
  // every step asks for the whole free stock, so two steps that both read it cannot both fit
  const random: SimRandom = { rng: () => 0.5, pick: list => list[0], between: (_min, max) => max, chance: () => false };
  const ops = createProjectOperations(random, {
    tag, onItem: () => undefined, projectItems: [item], mainWh: wh, customer, supplier, allocationIds: [],
  }, ids);

  const outcomes = await Promise.allSettled([ops.proformaApproval(), ops.proformaApproval()]);
  const over = await overReservedItems([item.id]);
  if (over.length > 0) {
    const detail = outcomes.map(o => (o.status === 'fulfilled' ? o.value.detail : `error: ${o.reason instanceof Error ? o.reason.message : String(o.reason)}`));
    problems.push(`two concurrent proforma steps left item ${item.id} with reservations ${over[0].reserved} over stock ${over[0].stock} (${detail.join('; ')})`);
  }
  return problems;
}

export const SIM_PROFORMA_RACE_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_1148_concurrent_proforma_steps', 'v10.0.88: two concurrent simulator proforma steps on one item keep its reservations within stock (TD-1148)',
    checkConcurrentProformaSteps, 'the second step sees the first proforma reservation and asks only for what is left'],
];
