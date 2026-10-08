import { createTestUser } from '../fixtures/factories.js';
import { runBusinessYearSimulation, type SimOperation } from '../simulation/businessYearSimulator.js';

/**
 * v10.0.11 (TD-982, I-01): the business-year simulator runs treasury, cheques, payroll, purchasing, material allocation and
 * the approval workflow through the application services, and a short run of them keeps every invariant: each new
 * operation succeeds at least once and the run reports no violation.
 */
const NEW_OPERATIONS: SimOperation[] = [
  'treasury_receipt', 'treasury_payment', 'treasury_void', 'cheque_received', 'cheque_step', 'payroll',
  'payroll_payment_void', 'procurement', 'bom_allocation', 'bom_release', 'proforma_approval',
];

export async function checkSimulatorRunsNewOperations(): Promise<string[]> {
  const weights: Partial<Record<SimOperation, number>> = { purchase: 6, sale: 6 };
  for (const op of NEW_OPERATIONS) weights[op] = 4;
  // the simulator signs approvals as an existing user and creates none
  await createTestUser({ role: 'admin' });
  const run = await runBusinessYearSimulation({ seed: 11, steps: 160, checkEvery: 20, weights });
  const problems = run.findings.map(f => `step ${f.firstStep} ${f.firstOp}: ${f.invariant} ${f.key}: ${f.message}`);
  for (const op of NEW_OPERATIONS) {
    const steps = run.steps.filter(s => s.op === op);
    if (!steps.some(s => s.outcome === 'ok')) {
      problems.push(`${op} never succeeded (${steps.map(s => `${s.outcome}: ${s.detail}`).slice(0, 3).join(' | ') || 'not picked'})`);
    }
  }
  const scope = run.scope;
  if (!scope.bankAccountIds?.length || !scope.partyIds?.length || !scope.projectIds?.length || scope.chequeIdAfter === undefined) {
    problems.push('the run scope carries no bank, party, project or cheque watermark, so I7, I8, I9 and I15 read nothing');
  }
  return problems;
}

export const SIMULATOR_COVERAGE_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_sim_new_operations', 'v10.0.11: the simulator runs treasury, cheques, payroll, purchasing, material allocation and approval, each succeeds and no invariant is violated (TD-982)',
    () => checkSimulatorRunsNewOperations(), 'every new operation succeeded and the run kept every invariant'],
];
