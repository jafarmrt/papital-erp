import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { Item, ProductionProject, ProjectInventoryControlSectionData } from '../../types';
import { DEFAULT_INVENTORY_CONTROL_SECTIONS } from '../../constants/inventoryControlPresets';
import { isPresetShapedSection, projectSectionsFromPreset } from '../../lib/projects/inventoryControlSections';

type FetchOpts = { signal?: AbortSignal };
let stockItems: Item[] = [];
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => {
  if (url.startsWith('/items/options')) return { data: stockItems };
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: { success: vi.fn(), error: vi.fn() } }));

import { useProjectInventory } from '../../hooks/useProjectInventory';

afterEach(() => { cleanup(); vi.clearAllMocks(); stockItems = []; });

const stock = (id: number, name: string, qty: number): Item =>
  ({ id, code: `M-${id}`, name, current_stock: qty, unit: 'عدد', type: 'raw_material' }) as Item;

const project = (inventoryControl?: ProductionProject['inventory_control']): ProductionProject => ({
  id: 7, version: 1, title: 'پروژه الگو', status: 'planned',
  products: [{ id: 'p1', item_id: 50, item_name: 'گردنبند', item_code: 'NK-1', quantity: 3, unit: 'عدد' }],
  ...(inventoryControl ? { inventory_control: inventoryControl } : {}),
} as unknown as ProductionProject);

const presetMaterialCount = DEFAULT_INVENTORY_CONTROL_SECTIONS.reduce((n, s) => n + s.items.length, 0);

// v9.0.413 (TD-748): preset sections keep their materials in `items`, which the project inventory screens never read
describe('inventory control presets in a project (TD-748)', () => {
  it('puts every material of the default preset on the purchase list with zero material progress', async () => {
    const p = project();
    const { result } = renderHook(() => useProjectInventory(p));
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    await waitFor(() => expect(result.current.purchaseList).toHaveLength(presetMaterialCount));
    expect(presetMaterialCount).toBe(10);
    expect(result.current.materialProgress).toBe(0);
    expect(result.current.purchaseList.map(row => row.itemName)).toContain('کاغذ ترنسفر');
    expect(result.current.sections.some(isPresetShapedSection)).toBe(false);
  });

  it('marks a material the warehouse holds as available and leaves it off the purchase list', async () => {
    stockItems = [stock(1, 'کاغذ ترنسفر', 20), stock(2, 'کارتن بسته‌بندی', 40)];
    const p = project();
    const { result } = renderHook(() => useProjectInventory(p));
    await waitFor(() => expect(result.current.purchaseList).toHaveLength(presetMaterialCount - 2));
    expect(result.current.purchaseList.map(row => row.itemName)).not.toContain('کاغذ ترنسفر');
    expect(result.current.materialProgress).toBe(20);
  });

  it('converts preset-shaped sections a project saved earlier', async () => {
    const saved = [{ id: 'secGlue', title: 'چسب', checkType: 'global', items: [{ id: 'mGlue', name: 'چسب حرارتی', unit: 'لیتر' }] }];
    const p = project({ sections: saved as unknown as ProjectInventoryControlSectionData[] });
    const { result } = renderHook(() => useProjectInventory(p));
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    await waitFor(() => expect(result.current.purchaseList.map(row => row.itemName)).toEqual(['چسب حرارتی']));
    expect(result.current.materialProgress).toBe(0);
  });
});

describe('preset section conversion (TD-748)', () => {
  const products = [{ id: 'p1' }, { id: 'p2' }];

  it('gives a per-item preset one row per product and a global preset one global row per material', () => {
    const sections = projectSectionsFromPreset(DEFAULT_INVENTORY_CONTROL_SECTIONS, products, ({ name }) => (name === 'کیلر (چاپ ترنسفر)' ? 2 : undefined));
    const [paper, , general] = sections;
    expect(Object.keys(paper.perItemResults ?? {})).toEqual(['p1', 'p2']);
    expect(paper.perItemResults?.p1?.item_paper_transfer).toMatchObject({ name: 'کاغذ ترنسفر', requiredQty: 1, stockQty: 0, status: 'needs_procurement' });
    expect(paper.itemsSchema?.map(m => m.id)).toEqual(['item_paper_transfer']);
    expect(general.globalItems?.map(row => row.status)).toEqual(['available', 'needs_procurement', 'needs_procurement', 'needs_procurement']);
    expect(sections.every(s => !('items' in s))).toBe(true);
  });

  it('leaves a section that already has project rows unchanged and converts only once', () => {
    const own = { id: 's', title: 'خودم', checkType: 'global', globalItems: [{ itemId: 'r', name: 'نخ', unit: 'متر', requiredQty: 4 }] };
    const once = projectSectionsFromPreset([own, ...DEFAULT_INVENTORY_CONTROL_SECTIONS], products);
    expect(once[0]).toBe(own);
    expect(projectSectionsFromPreset(once, products)).toEqual(once);
  });
});
