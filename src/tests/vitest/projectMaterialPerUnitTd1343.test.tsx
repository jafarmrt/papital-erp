import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { Item, ProductionProject, ProjectInventoryControlItemResult, ProjectInventoryControlSectionData } from '../../types';
import {
  isPerUnitRow, perItemRowRequiredQty, perUnitQtyFromTotal, perUnitRowFields, productOrderQuantity, rowConvertedQty,
} from '../../lib/projects/materialQuantity';
import { perItemProductKey, projectSectionsFromPreset } from '../../lib/projects/inventoryControlSections';
import { planProjectReservation } from '../../lib/projects/projectReservation';
import { buildConsolidatedPurchaseList } from '../../components/project/projectInventoryUtils';
import { PerItemQtyCell } from '../../components/project/PerItemQtyCell';
import { ProductTreeInventoryCards } from '../../components/project/ProductTreeInventoryCards';
import { buildMaterialAvailabilityView } from '../../lib/projects/materialAvailability';

/**
 * TD-1343 (package 12 item 2, option الف of card t42): a code-by-code material row holds its quantity per unit of the
 * product, its need is that quantity × the product's order quantity of today, a row without it keeps its stored total
 * («کل»), a new row starts at one per unit, and the finalize planner, the purchase list and the materials tab read the
 * same need. Red on the code before the change: the planner and the purchase list read the stored total only, a new row
 * was 1 in all and the cell had no per-unit field.
 */

type FetchOpts = { signal?: AbortSignal };
let stockItems: Item[] = [];
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => {
  if (url.startsWith('/items/options')) return { data: stockItems };
  if (url.startsWith('/projects/7/material-availability')) {
    const ids = new Set((new URL(url, 'http://local').searchParams.get('itemIds') ?? '').split(',').map(Number));
    return {
      projectId: 7,
      items: stockItems.filter(i => ids.has(i.id)).map(i => ({ itemId: i.id, stock: i.current_stock, reservedByOthers: 0, issuedToProject: 0, freeForProject: i.current_stock })),
    };
  }
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: { success: vi.fn(), error: vi.fn() } }));

import { useProjectInventory } from '../../hooks/useProjectInventory';

afterEach(() => { cleanup(); vi.clearAllMocks(); stockItems = []; });

const stock = (id: number, name: string, qty: number): Item =>
  ({ id, code: `M-${id}`, name, current_stock: qty, unit: 'عدد', type: 'raw_material' }) as Item;

const row = (itemCode: string, name: string, fields: Partial<ProjectInventoryControlItemResult>): ProjectInventoryControlItemResult =>
  ({ itemId: `r_${itemCode}`, itemCode, name, unit: 'عدد', status: 'needs_procurement', ...fields });

const codeSection = (rows: Record<string, ProjectInventoryControlItemResult[]>): ProjectInventoryControlSectionData => ({
  id: 'sec-code', title: 'کد به کد', checkType: 'per_item',
  perItemResults: Object.fromEntries(Object.entries(rows).map(([key, list]) => [key, Object.fromEntries(list.map(r => [r.itemId, r]))])),
});

describe('quantity per unit of the product (TD-1343)', () => {
  it('reads a per-unit row as its quantity times the order quantity and a total row as its stored total', () => {
    expect(isPerUnitRow({ qtyPerUnit: 0 })).toBe(true);
    expect(isPerUnitRow({ qtyPerUnit: '2' })).toBe(false);
    expect(isPerUnitRow({ requiredQty: 4 })).toBe(false);
    expect(perItemRowRequiredQty({ qtyPerUnit: 2, requiredQty: 3 }, 5)).toBe(10);
    expect(perItemRowRequiredQty({ qtyPerUnit: 0.3333, requiredQty: 1 }, 3)).toBe(0.9999);
    expect(perItemRowRequiredQty({ requiredQty: 4 }, 5)).toBe(4);
    expect(perItemRowRequiredQty({}, 5)).toBe(1);
    expect(productOrderQuantity({ quantity: 12 })).toBe(12);
    expect(productOrderQuantity({ quantity: 0 })).toBe(1);
    expect(productOrderQuantity({ quantity: -3 })).toBe(1);
    expect(perUnitRowFields(1.5, 4)).toEqual({ qtyPerUnit: 1.5, requiredQty: 6 });
    expect(perUnitQtyFromTotal(10, 3)).toBe(3.3333);
    expect(perUnitQtyFromTotal('', 3)).toBe(0);
  });

  it('derives the converted quantity of a per-unit row from today\'s need and keeps a total row\'s stored one', () => {
    expect(rowConvertedQty({ qtyPerUnit: 2, conversionRate: 4, convertedQty: 2.5 }, 16)).toBe(4);
    expect(rowConvertedQty({ requiredQty: 10, conversionRate: 4, convertedQty: 2.5 }, 10)).toBe(2.5);
    expect(rowConvertedQty({ qtyPerUnit: 2 }, 16)).toBeUndefined();
  });

  it('makes a code-by-code preset row one per unit and a whole-order preset row one in all', () => {
    const preset = [
      { id: 's1', title: 'کد به کد', checkType: 'per_item', items: [{ id: 'm1', name: 'مهره', itemCode: 'M-1', unit: 'عدد' }] },
      { id: 's2', title: 'کلی', checkType: 'global', items: [{ id: 'm2', name: 'چسب', itemCode: 'M-2', unit: 'عدد' }] },
    ];
    const [code, whole] = projectSectionsFromPreset(preset, [{ id: 'p1', quantity: 4 }, { item_id: 9, quantity: 2 }]);
    expect(code.perItemResults?.p1?.m1).toMatchObject({ qtyPerUnit: 1, requiredQty: 4 });
    expect(code.perItemResults?.prod_9?.m1).toMatchObject({ qtyPerUnit: 1, requiredQty: 2 });
    expect(whole.globalItems?.[0]).toMatchObject({ requiredQty: 1 });
    expect(whole.globalItems?.[0]).not.toHaveProperty('qtyPerUnit');
  });

  it('plans the finalize with the per-unit need of today\'s order quantity, under the key of a product without an id', () => {
    const items = [{ id: 1, code: 'M-1', name: 'مهره', unit: 'عدد', currentStock: 100 }, { id: 2, code: 'M-2', name: 'سنگ', unit: 'عدد', currentStock: 100 }];
    expect(perItemProductKey({ item_id: 9 }, 0)).toBe('prod_9');
    const sections = [codeSection({ prod_9: [row('M-1', 'مهره', { qtyPerUnit: 3, requiredQty: 3 }), row('M-2', 'سنگ', { requiredQty: 5 })] })];
    const reserved = (qty: number) => planProjectReservation(sections, [{ item_id: 9, quantity: qty }], items, [], '').reserved
      .map(r => [r.itemCode, r.reservedQty]);
    expect(reserved(4)).toEqual([['M-1', 12], ['M-2', 5]]);
    expect(reserved(7)).toEqual([['M-1', 21], ['M-2', 5]]);
  });

  it('puts the per-unit need of each product on the purchase list', () => {
    const products = [{ id: 'p1', quantity: 5 }, { id: 'p2', quantity: 2 }] as never;
    const sections = [codeSection({
      p1: [row('M-1', 'مهره', { qtyPerUnit: 2, requiredQty: 2 })],
      p2: [row('M-1', 'مهره', { requiredQty: 3 })],
    })];
    const [line] = buildConsolidatedPurchaseList(sections, products, [], []);
    expect(line).toMatchObject({ itemCode: 'M-1', totalRequiredQty: 13, toPurchaseQty: 13 });
  });
});

describe('the quantity cell of a code-by-code row (TD-1343)', () => {
  const renderCell = (material: ProjectInventoryControlItemResult, orderQty: number) => {
    const onFields = vi.fn();
    render(<table><tbody><tr>
      <PerItemQtyCell material={material} orderQty={orderQty} unit="عدد" hasUnitMismatch={false} onFields={onFields} onOpenConversion={vi.fn()} />
    </tr></tbody></table>);
    return onFields;
  };

  it('takes the quantity per unit and shows the order total', () => {
    const onFields = renderCell(row('M-1', 'مهره', { qtyPerUnit: 2, requiredQty: 2 }), 5);
    expect(screen.getByText('۱۰')).toBeTruthy();
    expect(screen.queryByText('کل')).toBeNull();
    fireEvent.change(screen.getByLabelText('مقدار برای هر عدد محصول'), { target: { value: '۳' } });
    expect(onFields).toHaveBeenLastCalledWith({ qtyPerUnit: 3, requiredQty: 15 });
  });

  it('marks an earlier row as a total and turns it into a quantity per unit of the order', () => {
    const onFields = renderCell(row('M-1', 'مهره', { requiredQty: 12 }), 4);
    expect(screen.getByText('کل')).toBeTruthy();
    expect(screen.getByLabelText('مقدار کل این ردیف')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'برای هر عدد' }));
    expect(onFields).toHaveBeenCalledWith({ qtyPerUnit: 3, requiredQty: 12 });
  });
});

describe('the code-by-code cards (TD-1343)', () => {
  it('stores every schema material of a product with its name when one of them is edited', () => {
    const sections: ProjectInventoryControlSectionData[] = [{
      id: 'sec-code', title: 'کد به کد', checkType: 'per_item', perItemResults: {},
      itemsSchema: [{ id: 'm1', name: 'مهره', itemCode: 'M-1', unit: 'عدد' }, { id: 'm2', name: 'سنگ', itemCode: 'M-2', unit: 'عدد' }],
    }];
    const products = [{ id: 'p1', item_id: 50, item_name: 'گردنبند', item_code: 'NK-1', customer_code: '', quantity: 4, unit: 'عدد', needs_assembly: false }];
    const availability = buildMaterialAvailabilityView({ sections, products, manualPurchaseItems: [], stockItems: [], report: null, status: 'loading' });
    const handleUpdatePerItemFields = vi.fn();
    render(<ProductTreeInventoryCards
      products={products} sections={sections} warehouseItems={[]} activeStepTab={0} availability={availability}
      handleUpdatePerItemResult={vi.fn()} handleUpdatePerItemFields={handleUpdatePerItemFields}
      handleOpenChangeMaterialModal={vi.fn()} handleOpenUnitConversionModal={vi.fn()} handleRemoveItemFromSection={vi.fn()}
    />);
    fireEvent.click(screen.getAllByRole('button', { name: 'برای هر عدد' })[0]);
    expect(handleUpdatePerItemFields).toHaveBeenCalledTimes(2);
    expect(handleUpdatePerItemFields).toHaveBeenCalledWith(0, 'p1', 'm1', expect.objectContaining({ name: 'مهره', itemCode: 'M-1', qtyPerUnit: 0.25, requiredQty: 1 }));
    expect(handleUpdatePerItemFields).toHaveBeenCalledWith(0, 'p1', 'm2', expect.objectContaining({ name: 'سنگ', itemCode: 'M-2', requiredQty: 1 }));
    expect(handleUpdatePerItemFields.mock.calls.find(c => c[2] === 'm2')?.[3]).not.toHaveProperty('qtyPerUnit');
  });
});

describe('the materials tab with per-unit rows (TD-1343)', () => {
  const project = (sections: ProjectInventoryControlSectionData[]): ProductionProject => ({
    id: 7, version: 1, title: 'پروژه', status: 'planned',
    products: [{ id: 'p1', item_id: 50, item_name: 'گردنبند', item_code: 'NK-1', quantity: 3, unit: 'عدد' }],
    inventory_control: { sections },
  } as unknown as ProductionProject);

  it('adds a new code-by-code material at one per unit of the product', async () => {
    stockItems = [stock(1, 'مهره', 0)];
    const p = project([codeSection({ p1: [] })]);
    const { result } = renderHook(() => useProjectInventory(p));
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    act(() => result.current.handleOpenAddMaterialModal(0, 'p1'));
    act(() => result.current.handleSelectWarehouseItem(stockItems[0]));
    const added = Object.values(result.current.sections[0].perItemResults?.p1 ?? {});
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ itemCode: 'M-1', qtyPerUnit: 1, requiredQty: 3 });
    await waitFor(() => expect(result.current.purchaseList.find(l => l.itemCode === 'M-1')?.totalRequiredQty).toBe(3));
  });
});
