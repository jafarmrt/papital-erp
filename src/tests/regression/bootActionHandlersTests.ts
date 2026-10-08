import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Package 15 (events and integrations), TD-714 / B15-12 (decision t4 a): the server registers no demo action handler at
 * boot. On v9.0.375 `registerDomainEventHandlers` registered WorkflowInventorySyncActionHandler,
 * InvoiceAccountingSyncActionHandler and InventoryReorderAlertActionHandler, which only logged but wrote a «successful
 * action handler» audit row (`voucherGenerated: true`) and an idempotency row for every invoice and stock issue.
 */
export async function runBootActionHandlersTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_boot_registers_no_demo_action_handlers_td_714';
  if (!shouldRun(id, 'td714', 'b15-12', 'action-handler', 'package15')) return results;

  const name = 'v9.0.376: server boot registers no demo action handler (TD-714)';
  const tStart = Date.now();
  try {
    const { spawnSync } = await import('child_process');
    const path = await import('path');
    const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
    // port 1 is always closed: registering handlers must not query the database
    const child = spawnSync(tsxBin, ['src/tests/fixtures/bootHandlersProbe.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: 'postgresql://probe:probe@127.0.0.1:1/probe', NODE_ENV: 'test' },
      encoding: 'utf-8',
      timeout: 120_000,
    });
    const output = `${child.stdout || ''}${child.stderr || ''}`;
    const line = output.split('\n').find(l => l.startsWith('BOOT_HANDLERS_PROBE '));
    if (!line) throw new Error(`probe printed no result: status ${child.status}, tail ${output.slice(-600)}`);
    const { actionHandlers } = JSON.parse(line.slice('BOOT_HANDLERS_PROBE '.length)) as { actionHandlers: string[] };
    if (actionHandlers.length > 0) throw new Error(`boot registered action handlers: ${actionHandlers.join(', ')}`);
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_code', passed: true, durationMs: Date.now() - tStart,
      details: 'registerDomainEventHandlers in a separate process -> 0 action handlers',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_code', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
  return results;
}
