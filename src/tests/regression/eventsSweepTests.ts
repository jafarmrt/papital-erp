import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { outboxEvents } from '../../db/schema.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase } from './fiscalClosingTests.js';

/**
 * Closing sweep, event observations of package 15 (OBS-R2-17): red on v10.1.55. Every case runs in its own isolated
 * schema.
 */

export async function runEventsSweepTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const reorderId = 'reg_reorder_alert_outbox_obs_r2_17';
  if (shouldRun(reorderId, 'obs-r2-17', 'reorder', 'outbox', 'events')) {
    await runCase(results, reorderId, 'closing sweep: the stock-issue reorder alert is written to the outbox once per stock event, never only published in process (OBS-R2-17)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const { recordReorderAlertOfIssue, reorderAlertEventId } = await import('../../services/events/domainEventHandlers.js');
      const { createDomainEvent, DomainEventType } = await import('../../services/events/domainEvents.js');
      const { createTestItem } = await import('../fixtures/factories.js');
      const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
      const def = await orm.transaction(async (tx) => getDefaultWarehouseCode(tx)) ?? '';
      const item = await createTestItem({ reorderPoint: 10, stocks: { '': 4 } });
      const stockEvent = createDomainEvent({
        eventType: DomainEventType.STOCK_ISSUED, aggregateType: 'Item', aggregateId: item.id,
        payload: {
          itemId: item.id, itemCode: item.code, itemName: item.name, movementType: 'out' as const, quantity: 1, unitPrice: 0,
          warehouseLocation: def, previousStock: 5, newStock: 4, referenceDocType: 'remittance', referenceDocNumber: 'OBS-R2-17',
        },
      });
      // the outbox worker retries a handler that failed after its write: the second run records nothing new
      await recordReorderAlertOfIssue(stockEvent);
      await recordReorderAlertOfIssue(stockEvent);
      const rows = await orm.select().from(outboxEvents).where(eq(outboxEvents.eventId, reorderAlertEventId(stockEvent.eventId)));
      if (rows.length !== 1) problems.push(`${rows.length} outbox rows for the reorder alert, expected exactly one`);
      const row = rows[0];
      if (row && row.eventType !== DomainEventType.INVENTORY_REORDER_ALERT) problems.push(`outbox row type ${row.eventType}`);
      if (row && row.status !== 'pending') problems.push(`outbox row status ${row.status}, expected pending`);
      const metadata = (row?.metadata ?? {}) as Record<string, unknown>;
      if (row && metadata.causationId !== stockEvent.eventId) problems.push(`the alert's causationId ${String(metadata.causationId)}, expected the stock event id`);
      if (row && Number((row.payload as Record<string, unknown>)?.itemId) !== item.id) problems.push('the alert payload names another item');
      assertNoProblems(problems);
      return 'one pending outbox row per stock issue event';
    }));
  }

  return results;
}
