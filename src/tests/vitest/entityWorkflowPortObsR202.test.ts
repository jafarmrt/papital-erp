import fs from 'fs';
import { describe, expect, it } from 'vitest';
import { maybeStartEntityWorkflow, registerEntityWorkflowPort, terminateEntityWorkflows } from '../../services/system/entityWorkflowPort';
import type { DbExecutor } from '../../db/drizzle';

/**
 * v10.0.249 (OBS-R2-02, phase-2 decision t3 A): the accounting, treasury and item cores start and close their entity
 * workflows through the port the composition root registers, never by importing the workflow engine (statically or with
 * a dynamic `import()`, which hid the bank account's dependency on the engine).
 */
const CORE_FILES = [
  'src/services/accounting/treasury/bankAccount.service.ts',
  'src/services/accounting/voucher.service.ts',
  'src/services/items/itemCatalog.service.ts',
];

describe('entity workflow port (OBS-R2-02)', () => {
  it('core services import neither the workflow engine nor its termination helper', () => {
    for (const file of CORE_FILES) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/workflow\/workflowEngineService/);
      expect(source, file).not.toMatch(/workflow\/workflowTermination/);
    }
  });

  it('the composition root wires the engine into the port', () => {
    const root = fs.readFileSync('src/services/system/workflowDomainActions.ts', 'utf8');
    expect(root).toMatch(/registerEntityWorkflowPort\(/);
  });

  it('delegates to the registered implementation', async () => {
    const tx = {} as DbExecutor;
    const calls: string[] = [];
    registerEntityWorkflowPort({
      maybeStart: async p => { calls.push(`start ${p.entityType}:${p.entityId}`); return { id: 7 }; },
      terminateOpen: async (_tx, p) => { calls.push(`end ${p.entityType}:${p.entityId}`); return [7]; },
    });
    await expect(maybeStartEntityWorkflow({ entityType: 'bank_account', entityId: 3, tx })).resolves.toEqual({ id: 7 });
    await expect(terminateEntityWorkflows(tx, { entityType: 'item', entityId: 4, actionKey: 'terminate', actionTitle: 't', comment: 'c' })).resolves.toEqual([7]);
    expect(calls).toEqual(['start bank_account:3', 'end item:4']);
  });
});
