import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { transferStockSchema } from '../../routes/inventory.routes';
import { SETTINGS_TAB_ACCESS } from '../../lib/permissions/pageAccess';
import { SETTINGS_GROUPS } from '../../components/settings/settingsNavigationConfig';

/**
 * Package 6 observations of the series 9 ledger (TD-988), each proven here before its fix.
 */
const SRC = resolve(__dirname, '../..');
const source = (path: string) => readFileSync(join(SRC, path), 'utf8');

describe('v10.0.157: Kardex maintenance locks items in id order without FOR UPDATE (OBS-R1-80)', () => {
  const files = [
    'services/inventory/kardexBackfill.service.ts',
    'services/inventory/kardexWacRecalculator.service.ts',
    'services/inventory/warehouseStockReconciliation.service.ts',
  ];
  it.each(files)('%s never locks an item row FOR UPDATE', path => {
    const text = source(path);
    const itemLocks = text.match(/from\(items\)[\s\S]{0,400}?\.for\('([a-z ]+)'\)/g) ?? [];
    for (const lock of itemLocks) expect(lock).not.toMatch(/\.for\('update'\)/);
  });
  it('the backfill locks its candidate items at once in id order', () => {
    const text = source('services/inventory/kardexBackfill.service.ts');
    expect(text).toMatch(/ORDER BY i\.id/);
    expect(text).toMatch(/lockStockItems\(tx,/);
  });
});

describe('v10.0.158: a transfer quantity is read like every stock quantity (OBS-R1-85)', () => {
  const body = (quantity: unknown) => ({ body: { itemId: 1, fromLocation: 'A', toLocation: 'B', quantity } });
  it('reads Persian digits and the Persian decimal separator', () => {
    expect(transferStockSchema.parse(body('۲')).body.quantity).toBe(2);
    expect(transferStockSchema.parse(body('۱٫۵')).body.quantity).toBe(1.5);
  });
  it('refuses text, empty, zero and negative quantities', () => {
    for (const q of ['abc', '', 0, '-1']) expect(transferStockSchema.safeParse(body(q)).success).toBe(false);
  });
});

describe('v10.0.159: the unused stock rebuild and allocation wrappers are gone (OBS-R1-84, refactor)', () => {
  it('no facade keeps a second entry to the Kardex rebuild or the project allocation list', () => {
    expect(source('services/document.service.ts')).not.toMatch(/reconcileAndRebuildStock/);
    expect(source('services/documents/documentStockEngine.service.ts')).not.toMatch(/reconcileAndRebuildStock/);
    expect(source('services/inventory/inventoryIntegrity.service.ts')).not.toMatch(/getProjectAllocations/);
  });
});

describe('v10.0.160: negative stock has no policy layer to read or change (OBS-R1-83)', () => {
  it('no settings tab, route or service reads or writes the fixed policy', () => {
    expect(Object.keys(SETTINGS_TAB_ACCESS)).not.toContain('inventory_integrity');
    expect(SETTINGS_GROUPS.flatMap(g => g.tabs.map(t => t.id))).not.toContain('inventory_integrity');
    expect(source('routes/inventory.routes.ts')).not.toMatch(/negative-stock-policy/);
    const service = source('services/inventory/negativeStockPolicy.service.ts');
    expect(service).not.toMatch(/catch\s*\{\s*\}|catch\s*\{\s*\/\//);
    expect(service).not.toMatch(/getPolicy|setPolicy|checkStockDeduction/);
  });
});
