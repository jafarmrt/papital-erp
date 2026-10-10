import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ProductionProject, ProjectInventoryControlSectionData } from '../../types';

const fetchJson = vi.fn(async (_url: string): Promise<unknown> => []);
vi.mock('../../api', () => ({ fetchJson: (url: string) => fetchJson(url) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: { success: vi.fn(), error: vi.fn() } }));

import { useProjectInventory } from '../../hooks/useProjectInventory';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const SECTIONS = [
  {
    id: 'secA', title: 'per item', checkType: 'per_item',
    itemsSchema: [{ id: 'mBox', name: 'box', unit: 'pack' }],
    perItemResults: { p1: { mBox: { itemId: 'mBox', name: 'box', unit: 'pack', requiredQty: 2, status: 'available' } } },
  },
  { id: 'secB', title: 'global', checkType: 'global', globalItems: [{ itemId: 'mGlue', name: 'glue', unit: 'pack', requiredQty: 2, status: 'available' }] },
] as unknown as ProjectInventoryControlSectionData[];

const project = {
  id: 7, version: 1, title: 'unit project', status: 'planned',
  products: [{ id: 'p1', item_id: 50, item_name: 'necklace', item_code: 'NK-1', quantity: 3, unit: 'pcs' }],
  inventory_control: { sections: SECTIONS },
} as unknown as ProductionProject;

const submit = { preventDefault: () => undefined } as unknown as React.FormEvent;

// v10.0.90 (TD-1212): applying a unit conversion keeps all three fields, so the finalize converts the requirement
describe('project unit conversion keeps every field (TD-1212)', () => {
  it('stores the converted unit, the rate and the converted quantity on a per-item row', async () => {
    const { result } = renderHook(() => useProjectInventory(project));
    await waitFor(() => expect(result.current.sections[0]?.perItemResults?.p1?.mBox).toBeTruthy());
    act(() => result.current.handleOpenUnitConversionModal(0, 'mBox', 'p1', undefined, 'box', undefined, 2, 'pack', 'pcs', 'pcs', 0.1));
    act(() => result.current.handleApplyUnitConversion(submit));
    expect(result.current.sections[0].perItemResults?.p1?.mBox).toMatchObject({ convertedUnit: 'pcs', conversionRate: 0.1, convertedQty: 20 });
  });

  it('stores the converted unit, the rate and the converted quantity on a global row', async () => {
    const { result } = renderHook(() => useProjectInventory(project));
    await waitFor(() => expect(result.current.sections[1]?.globalItems?.[0]).toBeTruthy());
    act(() => result.current.handleOpenUnitConversionModal(1, 'mGlue', undefined, 0, 'glue', undefined, 2, 'pack', 'pcs', 'pcs', 0.1));
    act(() => result.current.handleApplyUnitConversion(submit));
    expect(result.current.sections[1].globalItems?.[0]).toMatchObject({ convertedUnit: 'pcs', conversionRate: 0.1, convertedQty: 20 });
  });
});
