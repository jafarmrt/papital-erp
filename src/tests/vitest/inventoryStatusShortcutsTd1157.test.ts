import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inventoryStatusShortcutsFor } from '../../lib/inventory/inventoryStatusShortcuts';

// TD-1157: the «وضعیت انبار» quick links follow the page access table, and their labels name lists, not forms

describe('inventory status quick links (TD-1157)', () => {
  it('shows a warehouse reader only the pages it may open', () => {
    expect(inventoryStatusShortcutsFor({ permissions: ['warehouse.view'], isAdmin: false }).map(s => s.path)).toEqual(['/reorder-alerts']);
    expect(inventoryStatusShortcutsFor({ permissions: ['reports.view'], isAdmin: false })).toEqual([]);
  });

  it('shows the system admin every link', () => {
    expect(inventoryStatusShortcutsFor({ permissions: [], isAdmin: true })).toHaveLength(6);
  });

  it('is what the page renders, and the transactions link is gated too', () => {
    const page = readFileSync('src/pages/InventoryStatusPage.tsx', 'utf8');
    expect(page).toContain('inventoryStatusShortcutsFor(');
    expect(page).not.toContain('تعریف کالا');
    expect(page).not.toContain('صدور فاکتور');
    expect(page).toContain("canOpenPage('/transactions'");
  });
});
