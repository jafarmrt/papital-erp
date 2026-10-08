import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { findProjectItemMatch } from '../../lib/projects/projectItemMatch';
import { buildProjectReservation } from '../../lib/projects/projectReservation';
import { buildConsolidatedPurchaseList } from '../../components/project/projectInventoryUtils';
import type { Item, ProjectInventoryControlSectionData, ProjectProductItem } from '../../types';

const item = (id: number, code: string, name: string, stock: number): Item =>
  ({ id, code, name, current_stock: stock, unit: 'عدد', type: 'raw_material' }) as Item;

// v9.0.332 (TD-749, TD-768): one item-matching rule for the server reservation and the browser inventory screens
describe('project item matching (TD-749, TD-768)', () => {
  const stock = [item(1, 'BX-90', 'کارتن بسته‌بندی بزرگ', 50), item(2, 'mt-1', 'مهره طلایی', 7), item(3, 'CH-5', 'زنجیر', 4)];

  it('matches by warehouse item id, then code (case and spaces ignored), then the exact name', () => {
    expect(findProjectItemMatch({ itemId: 3, code: 'BX-90' }, stock)?.id).toBe(3);
    expect(findProjectItemMatch({ code: ' MT-1 ' }, stock)?.id).toBe(2);
    expect(findProjectItemMatch({ name: ' زنجیر ' }, stock)?.id).toBe(3);
    expect(findProjectItemMatch({ code: 'CH-5', name: 'مهره طلایی' }, stock)?.id).toBe(3);
  });

  it('never matches a name by substring and never matches an empty code or name', () => {
    expect(findProjectItemMatch({ name: 'کارتن' }, stock)).toBeUndefined();
    expect(findProjectItemMatch({ name: '' }, stock)).toBeUndefined();
    expect(findProjectItemMatch({ code: '  ', name: '   ' }, stock)).toBeUndefined();
    expect(findProjectItemMatch({}, stock)).toBeUndefined();
  });

  it('keeps a global material whose name is part of another item name on the purchase list', () => {
    const sections = [{
      id: 'sec-1', title: 'بسته‌بندی', checkType: 'global',
      globalItems: [{ itemId: 'row-1', name: 'کارتن', unit: 'عدد', requiredQty: 10 }],
    }] as unknown as ProjectInventoryControlSectionData[];
    const list = buildConsolidatedPurchaseList(sections, [] as ProjectProductItem[], stock, []);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ itemName: 'کارتن', warehouseStockQty: 0, toPurchaseQty: 10 });
  });

  it('does not give a material with an unknown code and no name the stock of the first item', () => {
    const sections = [{
      id: 'sec-1', title: 'سایر', checkType: 'global',
      globalItems: [{ itemId: 'row-1', itemCode: 'NEW-1', name: '', unit: 'عدد', requiredQty: 3 }],
    }] as unknown as ProjectInventoryControlSectionData[];
    const list = buildConsolidatedPurchaseList(sections, [] as ProjectProductItem[], stock, []);
    expect(list[0]).toMatchObject({ itemCode: 'NEW-1', warehouseStockQty: 0, toPurchaseQty: 3 });
  });

  it('reserves the item that holds the code, not another item with the same name', () => {
    const items = [
      { id: 10, code: 'OLD-7', name: 'مهره کریستالی', currentStock: 100 },
      { id: 11, code: 'cr-2', name: 'مهره کریستالی آبی', currentStock: 100 },
    ];
    const sections = [{ id: 's', title: 'مهره', checkType: 'global', globalItems: [{ itemCode: 'CR-2', name: 'مهره کریستالی', requiredQty: 5 }] }];
    const reserved = buildProjectReservation(sections, [], items, [], '2026-10-08');
    expect(reserved).toHaveLength(1);
    expect(reserved[0]).toMatchObject({ itemId: 11, reservedQty: 5 });
  });

  it('has no item-matching copy left in the project screens and reservation', () => {
    const roots = [
      'src/components/project', 'src/components/project-modal', 'src/components/ProjectDetailModal.tsx', 'src/components/ProjectModal.tsx',
      'src/components/inventory/ProjectBomAllocationsTab.tsx', 'src/hooks/useProjectInventory.ts', 'src/pages/ProjectsPage.tsx',
      'src/pages/ProjectInventoryPage.tsx', 'src/lib/projects',
    ];
    const files: string[] = [];
    const walk = (p: string) => {
      if (!fs.existsSync(p)) return;
      if (fs.statSync(p).isDirectory()) fs.readdirSync(p).forEach(f => walk(path.join(p, f)));
      else if (/\.tsx?$/.test(p) && !p.endsWith('projectItemMatch.ts')) files.push(p);
    };
    roots.forEach(walk);
    const copy = /\.code(\.trim\(\))?(\.toUpperCase\(\))?\s*===|\.name(\.trim\(\))?\.toLowerCase\(\)\s*===|\.includes\(\s*\w+\.(name|itemName)\b/;
    const offenders = files.filter(f => copy.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
