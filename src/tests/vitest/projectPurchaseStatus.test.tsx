import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ProductionProject, ProjectInventoryControlSectionData } from '../../types';
import { purchaseRowKey, withProcurementStatus } from '../../components/project/projectInventoryUtils';

type FetchOpts = { signal?: AbortSignal };
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => (url.startsWith('/items/options') ? { data: [] } : []));
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: { success: vi.fn(), error: vi.fn() } }));

import { useProjectInventory } from '../../hooks/useProjectInventory';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const sections = (): ProjectInventoryControlSectionData[] => ([
  {
    id: 'secCode', title: 'کاغذ', checkType: 'per_item',
    itemsSchema: [{ id: 'mPaper', name: 'کاغذ ترنسفر', itemCode: 'TP-1', unit: 'برگ' }],
    perItemResults: {
      p1: { mPaper: { itemId: 'mPaper', name: 'کاغذ ترنسفر', itemCode: 'TP-1', unit: 'برگ', requiredQty: 4, stockQty: 0, status: 'needs_procurement' } },
      p2: { mPaper: { itemId: 'mPaper', name: 'کاغذ ترنسفر', itemCode: 'TP-1', unit: 'برگ', requiredQty: 2, stockQty: 0, status: 'needs_procurement' } },
    },
  },
  {
    id: 'secAll', title: 'بسته‌بندی', checkType: 'global',
    globalItems: [
      { itemId: 'g_carton', name: 'کارتن', unit: 'عدد', requiredQty: 10, stockQty: 0, status: 'needs_procurement' },
      { itemId: 'g_glue', name: 'چسب', itemCode: 'GL-2', unit: 'لیتر', requiredQty: 3, stockQty: 0, status: 'needs_procurement' },
    ],
  },
] as unknown as ProjectInventoryControlSectionData[]);

const project = {
  id: 9, version: 1, title: 'پروژه خرید', status: 'planned',
  products: [{ id: 'p1', item_id: 1, item_name: 'الف', quantity: 1 }, { id: 'p2', item_id: 2, item_name: 'ب', quantity: 1 }],
  inventory_control: { sections: sections() },
} as unknown as ProductionProject;

// v9.0.390 (TD-750): the purchase list row id (code_… / name_…) never matched a section row, so a status change was lost
describe('purchase list procurement status (TD-750)', () => {
  it('keeps the status chosen on a code row and a name row, also for two rows changed one after the other', async () => {
    const { result } = renderHook(() => useProjectInventory(project));
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    await waitFor(() => expect(result.current.purchaseList).toHaveLength(3));
    const paper = purchaseRowKey('TP-1', 'کاغذ ترنسفر');
    const carton = purchaseRowKey('', ' کارتن ');
    expect(result.current.purchaseList.map(row => row.id).sort()).toEqual([carton, paper, 'code_GL-2'].sort());

    act(() => {
      result.current.handleUpdateProcurementStatus(paper, 'in_progress');
      result.current.handleUpdateProcurementStatus(carton, 'reserved');
    });
    const byId = Object.fromEntries(result.current.purchaseList.map(row => [row.id, row.procurementStatus]));
    expect(byId).toEqual({ [paper]: 'in_progress', [carton]: 'reserved', 'code_GL-2': 'pending' });
    const [code, global] = result.current.sections;
    expect(code.perItemResults?.p1?.mPaper?.procurementStatus).toBe('in_progress');
    expect(code.perItemResults?.p2?.mPaper?.procurementStatus).toBe('in_progress');
    expect(global.globalItems?.map(g => g.procurementStatus)).toEqual(['reserved', undefined]);
  });

  it('changes the sections without writing into the previous state', () => {
    const before = sections();
    const snapshot = JSON.stringify(before);
    const after = withProcurementStatus(before, 'code_TP-1', 'fulfilled');
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after[0].perItemResults?.p1?.mPaper?.procurementStatus).toBe('fulfilled');
    expect(after[1]).toBe(before[1]);
  });
});
