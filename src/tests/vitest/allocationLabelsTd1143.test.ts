import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ALLOCATION_RELEASE_PLACE, BOM_ALLOCATIONS_TAB_LABEL, STOCK_COUNT_PAGE_LABEL } from '../../lib/projects/allocationLabels';

const source = (file: string) => readFileSync(resolve(process.cwd(), 'src', file), 'utf8');

// v10.0.63 (TD-1143): the refusal pointed to «زبانه مواد پروژه», which no project screen has
describe('where an open allocation is released (TD-1143)', () => {
  it('names the stock count page and its allocation tab, as the menu and the tab show them', () => {
    expect(ALLOCATION_RELEASE_PLACE).toContain(STOCK_COUNT_PAGE_LABEL);
    expect(ALLOCATION_RELEASE_PLACE).toContain(BOM_ALLOCATIONS_TAB_LABEL);
    expect(source('components/layout/menuConfig.ts')).toContain(`name: '${STOCK_COUNT_PAGE_LABEL}', path: '/audit'`);
    expect(source('components/inventory/InventoryAuditHeader.tsx')).toContain("label: BOM_ALLOCATIONS_TAB_LABEL");
  });

  it('is the place the delete and cancel refusal names', () => {
    const guard = source('services/projects/projectOpenAllocations.ts');
    expect(guard).not.toContain('زبانه مواد پروژه');
    expect(guard).toContain('${ALLOCATION_RELEASE_PLACE}');
  });
});
