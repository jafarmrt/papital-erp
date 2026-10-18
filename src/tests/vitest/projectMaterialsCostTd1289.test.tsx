import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import {
  buildMaterialAvailabilityView, materialAvailabilityReportOf, projectMaterialItemIds, rowIsShort,
  type AvailabilityStockItem, type MaterialAvailabilityReport,
} from '../../lib/projects/materialAvailability';
import {
  deliveryCostOutlook, deliveryCostReportOf, projectDeliverySuggestion, suggestedDeliveryUnitCost, type DeliveryCostReport,
} from '../../lib/projects/deliveryCostSuggestion';
import { issuedMaterialsReportOf } from '../../lib/projects/issuedMaterials';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
type Route = (url: string, opts?: FetchOpts) => unknown;
let route: Route = () => [];
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => route(url, opts));
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('../../hooks/queries/useSettingsQueries', () => ({ useSettingsQuery: () => ({ data: [] }), useWarehousesQuery: () => ({ data: [{ id: 1, code: 'WH1', name: 'test warehouse' }] }) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => true, useHasAnyPermission: () => true }));
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canDeliver: true, canRequestPurchase: true,
  }),
}));

import { useProjectInventory } from '../../hooks/useProjectInventory';
import { useProjectMaterialAvailability } from '../../hooks/useProjectMaterialReports';
import ProjectInventoryTab from '../../components/project/ProjectInventoryTab';
import ProjectStockEntryTab from '../../components/project/ProjectStockEntryTab';
import { ProjectIssuedMaterialsList } from '../../components/project/ProjectIssuedMaterialsList';
import type { Item, ProductionProject, ProjectInventoryControlSectionData } from '../../types';

afterEach(() => { cleanup(); vi.clearAllMocks(); route = () => []; });

// Persian text the screens show (kept in constants: terminal output stays English)
const SHORT_BADGE = '⚠ کسری';
const AVAILABLE_BADGE = '✓ موجود';
const UNIT_BADGE = '⚠ تبدیل واحد لازم';
const FREE_HEADER = 'آزاد برای این پروژه';
const PROJECT_SHORT = 'کسری کل پروژه: ۳ pcs';
const ISSUED_LIST = 'مواد گرفته‌شده از انبار';
const COST_HEADER = 'بها';
const COST_TOTAL = 'جمع بهای مواد داده‌شده به پروژه';
const DELIVER = 'ورود به انبار';
const PRICE_LABEL = 'بهای واحد:';
const MULTI_PRODUCT_WARNING = 'پروژهٔ چندمحصولی پیشنهاد خودکار ندارد';
const RESIDUE_WARNING = 'در کالای در جریان ساخت پروژه می‌ماند';

const GLUE: AvailabilityStockItem = { id: 3, code: 'G-1', name: 'glue', unit: 'pcs', current_stock: 8 };
const BEAD: AvailabilityStockItem = { id: 4, code: 'B-1', name: 'bead', unit: 'pcs', current_stock: 50 };
const globalSection = (requiredQty: number, unit = 'pcs') => [
  { id: 'secG', title: 'global', checkType: 'global', globalItems: [{ itemId: 'g1', itemCode: 'G-1', name: 'glue', unit, requiredQty, status: 'available' }] },
];
const report = (items: Array<Partial<MaterialAvailabilityReport['items'][number]> & { itemId: number }>): MaterialAvailabilityReport => ({
  projectId: 7,
  items: items.map(i => ({ stock: 0, reservedByOthers: 0, issuedToProject: 0, freeForProject: 0, ...i })),
});
const viewOf = (sections: unknown, r: MaterialAvailabilityReport | null, status: 'ready' | 'loading' | 'error' = 'ready') =>
  buildMaterialAvailabilityView({ sections, products: [], manualPurchaseItems: [], stockItems: [GLUE, BEAD], report: r, status });

// v10.2.0 (TD-1289, package 3 of 10.2, finding D1): the materials tab judged rows against total stock with a manual status,
// so it said «available» while the finalize reserved less because a sales proforma or another project held the stock
describe('free stock for the project (TD-1289 D1)', () => {
  it('marks a row short when other reservations take the stock the total covered', () => {
    const view = viewOf(globalSection(5), report([{ itemId: 3, stock: 8, reservedByOthers: 6 }]));
    const row = globalSection(5)[0].globalItems[0];
    expect(view.rowState(row)).toEqual({ kind: 'short', itemId: 3, free: 2, issued: 0, shortQty: 3, unit: 'pcs' });
    expect(view.coverOf(row)).toBe(2);
  });

  it('counts what the project already received toward its need', () => {
    const view = viewOf(globalSection(5), report([{ itemId: 3, stock: 8, reservedByOthers: 6, issuedToProject: 3 }]));
    expect(view.rowState(globalSection(5)[0].globalItems[0])).toMatchObject({ kind: 'available', free: 2, issued: 3 });
  });

  it('flags a row in another unit without a conversion, judged by the earlier rule for purchases', () => {
    const view = viewOf(globalSection(5, 'box'), report([{ itemId: 3, stock: 8 }]));
    const state = view.rowState(globalSection(5, 'box')[0].globalItems[0]);
    expect(state.kind).toBe('unit_mismatch');
    expect(rowIsShort(state, false)).toBe(false);
    expect(rowIsShort(state, true)).toBe(true);
  });

  it('shows no row as available before the figures arrive, and falls back to the earlier rule for purchases', () => {
    const view = viewOf(globalSection(5), null, 'loading');
    const state = view.rowState(globalSection(5)[0].globalItems[0]);
    expect(state).toEqual({ kind: 'unknown' });
    expect(view.coverOf(globalSection(5)[0].globalItems[0])).toBeNull();
    expect(rowIsShort(state, true)).toBe(true);
    expect(rowIsShort({ kind: 'unmatched' }, false)).toBe(true);
  });

  it('asks the server only for the items the rows reach, once each', () => {
    const sections = [
      ...globalSection(5),
      { id: 'secP', checkType: 'per_item', perItemResults: { p1: { a: { itemCode: 'B-1', name: 'bead' } }, p2: { a: { itemCode: 'B-1', name: 'bead' } } } },
    ];
    expect(projectMaterialItemIds(sections, [{ itemName: 'glue' }, { itemName: 'unknown' }], [GLUE, BEAD])).toEqual([3, 4]);
  });

  it('refuses a malformed availability answer', () => {
    expect(materialAvailabilityReportOf([])).toBeNull();
    expect(materialAvailabilityReportOf({ items: [{ itemId: 0 }] })).toBeNull();
    expect(materialAvailabilityReportOf({ projectId: 7, items: [{ itemId: 3, stock: '8' }] })?.items[0].stock).toBe(8);
  });

  it('does not ask the server without items and reports an error for an invalid project', () => {
    const empty = renderHook(() => useProjectMaterialAvailability(7, [], 'loaded', 1));
    expect(empty.result.current.status).toBe('ready');
    expect(empty.result.current.report?.items).toEqual([]);
    const invalid = renderHook(() => useProjectMaterialAvailability('x', [3], 'loaded', 1));
    expect(invalid.result.current.status).toBe('error');
    expect(fetchJson).not.toHaveBeenCalled();
  });
});

const inventoryProject = (requiredQty = 5) => ({
  id: 7, version: 1, title: 'materials', status: 'planned', products: [],
  inventory_control: { sections: globalSection(requiredQty) as unknown as ProjectInventoryControlSectionData[] },
}) as unknown as ProductionProject;
const inventoryRoute = (figures: { reservedByOthers: number; issuedToProject: number }, issued: unknown = { projectId: 7, costVisible: false, rows: [], total: 0, totalCost: null }): Route => url => {
  if (url.startsWith('/items/options')) return { data: [{ ...GLUE, type: 'raw_material' }] };
  if (url.startsWith('/projects/7/material-availability')) return { projectId: 7, items: [{ itemId: 3, stock: 8, freeForProject: 8 - figures.reservedByOthers, ...figures }] };
  if (url === '/projects/7/issued-materials') return issued;
  return [];
};

describe('materials tab and purchase list use the free stock (TD-1289 D1)', () => {
  it('shows the free stock and an automatic shortage where total stock covered the need', async () => {
    route = inventoryRoute({ reservedByOthers: 6, issuedToProject: 0 });
    render(<ProjectInventoryTab project={inventoryProject()} />);
    expect(await screen.findByText(SHORT_BADGE)).toBeTruthy();
    expect(screen.getAllByText(FREE_HEADER).length).toBeGreaterThan(0);
    expect(screen.getByText(PROJECT_SHORT)).toBeTruthy();
    expect(screen.queryByText(AVAILABLE_BADGE)).toBeNull();
    expect(screen.getByRole('combobox', { name: 'وضعیت سفارش' })).toBeTruthy();
    expect(fetchJson).toHaveBeenCalledWith('/projects/7/material-availability?itemIds=3', expect.anything());
  });

  it('puts the row on the purchase list with the free stock and the remaining need', async () => {
    route = inventoryRoute({ reservedByOthers: 6, issuedToProject: 1 });
    const project = inventoryProject();
    const { result } = renderHook(() => useProjectInventory(project));
    await waitFor(() => expect(result.current.availability.status).toBe('ready'));
    expect(result.current.purchaseList).toHaveLength(1);
    expect(result.current.purchaseList[0]).toMatchObject({ itemName: 'glue', warehouseStockQty: 2, issuedQty: 1, toPurchaseQty: 2 });
    expect(result.current.materialProgress).toBe(0);
  });

  it('leaves a covered row off the purchase list and counts it ready', async () => {
    route = inventoryRoute({ reservedByOthers: 0, issuedToProject: 0 });
    const project = inventoryProject();
    const { result } = renderHook(() => useProjectInventory(project));
    await waitFor(() => expect(result.current.availability.status).toBe('ready'));
    expect(result.current.materialProgress).toBe(100);
    expect(result.current.purchaseList).toHaveLength(0);
  });

  it('shows the progress as unknown when the free stock cannot be read', async () => {
    route = url => (url.startsWith('/projects/7/material-availability') ? [] : inventoryRoute({ reservedByOthers: 0, issuedToProject: 0 })(url));
    const project = inventoryProject();
    const { result } = renderHook(() => useProjectInventory(project));
    await waitFor(() => expect(result.current.availability.status).toBe('error'));
    expect(result.current.materialProgress).toBeNull();
    expect(result.current.purchaseList).toHaveLength(0);
  });

  it('flags a unit mismatch instead of «available»', async () => {
    route = inventoryRoute({ reservedByOthers: 0, issuedToProject: 0 });
    const p = { ...inventoryProject(), inventory_control: { sections: globalSection(5, 'box') } } as unknown as ProductionProject;
    render(<ProjectInventoryTab project={p} />);
    expect(await screen.findByText(UNIT_BADGE)).toBeTruthy();
    expect(screen.queryByText(AVAILABLE_BADGE)).toBeNull();
  });
});

const issuedRow = { key: 'allocation-1', source: 'allocation', sourceId: 1, refNumber: null, date: '2026-10-01T08:00:00Z', itemId: 3, itemCode: 'G-1', itemName: 'glue', unit: 'pcs', quantity: 2, status: 'allocated', cost: 1500 };

// v10.2.0 (TD-1289, finding D3): the materials tab did not say what the project had already taken from stock
describe('materials taken from stock (TD-1289 D3)', () => {
  it('lists what was taken and hides the cost from a reader without the cost permission', async () => {
    route = () => ({ projectId: 7, costVisible: false, rows: [{ ...issuedRow, cost: 1500 }], total: 1, totalCost: 1500 });
    render(<ProjectIssuedMaterialsList projectId={7} />);
    const list = await screen.findByRole('region', { name: ISSUED_LIST });
    expect(await within(list).findByText('glue')).toBeTruthy();
    expect(within(list).queryByText(COST_HEADER)).toBeNull();
    expect(within(list).queryByText(COST_TOTAL)).toBeNull();
    expect(issuedMaterialsReportOf({ costVisible: false, rows: [issuedRow], total: 1, totalCost: 1500 })?.rows[0].cost).toBeNull();
  });

  it('shows each cost and the total to a cost reader', async () => {
    route = () => ({ projectId: 7, costVisible: true, rows: [issuedRow], total: 1, totalCost: 1500 });
    render(<ProjectIssuedMaterialsList projectId={7} />);
    expect(await screen.findByText(COST_TOTAL)).toBeTruthy();
    expect(screen.getByText(COST_HEADER)).toBeTruthy();
  });
});

const deliveryReport = (over: Partial<DeliveryCostReport> = {}): DeliveryCostReport => ({
  projectId: 1, costVisible: true, wipBalance: 8000,
  products: [{ itemId: 42, plannedQty: 10, deliveredQty: 0, weightedAverageCost: 5000 }],
  ...over,
});

// v10.2.0 (TD-1289, finding D2): the unit cost of a project's production receipt was typed by hand, so whatever did not
// match the project's materials stayed in its work in progress (1402)
describe('delivery unit cost from the project work in progress (TD-1289 D2)', () => {
  it('divides the balance over what is left of the plan, or over a larger delivery', () => {
    expect(suggestedDeliveryUnitCost(8000, 10, 0, 10)).toBe(800);
    expect(suggestedDeliveryUnitCost(8000, 10, 4, 2)).toBe(1333.3333);
    expect(suggestedDeliveryUnitCost(8000, 10, 0, 16)).toBe(500);
    expect(suggestedDeliveryUnitCost(0, 10, 0, 10)).toBeNull();
    expect(suggestedDeliveryUnitCost(8000, 10, 10, 0)).toBeNull();
  });

  it('suggests only for a single product the reader may see the cost of', () => {
    expect(projectDeliverySuggestion(deliveryReport(), 42, 10)).toBe(800);
    expect(projectDeliverySuggestion(deliveryReport(), 43, 10)).toBeNull();
    expect(projectDeliverySuggestion(deliveryReport({ costVisible: false, wipBalance: null }), 42, 10)).toBeNull();
    const two = deliveryReport({ products: [...deliveryReport().products, { itemId: 43, plannedQty: 5, deliveredQty: 0, weightedAverageCost: 100 }] });
    expect(projectDeliverySuggestion(two, 42, 10)).toBeNull();
    expect(deliveryCostReportOf({ costVisible: false, wipBalance: 8000, products: [{ itemId: 42, plannedQty: 10, deliveredQty: 0, weightedAverageCost: 5000 }] }))
      .toMatchObject({ wipBalance: null, products: [{ weightedAverageCost: null }] });
  });

  it('tells what the delivery takes from the balance and what is left', () => {
    expect(deliveryCostOutlook(deliveryReport(), [{ itemId: 42, quantity: 4, unitPrice: 800 }]))
      .toEqual({ wipBalance: 8000, credit: 3200, remaining: 4800, withoutCost: 0, completesPlan: false, multiProduct: false });
    // an empty price is the current average cost, as on the server
    expect(deliveryCostOutlook(deliveryReport(), [{ itemId: 42, quantity: 10, unitPrice: null }]))
      .toMatchObject({ credit: 50000, remaining: -42000, completesPlan: true });
    expect(deliveryCostOutlook(deliveryReport({ products: [{ itemId: 42, plannedQty: 10, deliveredQty: 0, weightedAverageCost: null }] }), [{ itemId: 42, quantity: 2, unitPrice: null }]))
      .toMatchObject({ credit: 0, withoutCost: 1 });
    expect(deliveryCostOutlook(deliveryReport({ costVisible: false, wipBalance: null }), [])).toBeNull();
  });
});

const PROJECT = {
  id: 1, project_code: 'PRJ-1', status: 'in_progress', item_id: 42, item_name: 'necklace', quantity: 10, unit: 'pcs',
  products: [{ id: 'prod-1', item_id: 42, item_code: 'N-1', item_name: 'necklace', customer_code: '', quantity: 10, unit: 'pcs', needs_assembly: false }],
} as unknown as ProductionProject;
const ITEMS = [{ id: 42, code: 'N-1', name: 'necklace', weightedAverageCost: 5000 }, { id: 43, code: 'N-2', name: 'ring', weightedAverageCost: 100 }] as unknown as Item[];
const deliveryRoute = (cost: unknown): Route => url => {
  if (url.endsWith('/product-progress')) return { summary: { total_matrix_cells: 0, completed_matrix_cells: 0, all_matrix_completed: false } };
  if (url.endsWith('/add-to-inventory')) return { success: true, addedCount: 1, refNumber: 'PR-9' };
  if (url === '/projects/1/delivery-cost') return cost;
  return {};
};
const deliveryCalls = () => fetchJson.mock.calls.filter(([url]) => url.endsWith('/add-to-inventory'));
const sentLines = (call = 0) => JSON.parse(deliveryCalls()[call][1]?.body ?? '{}').itemsToAdd as Array<{ unitPrice?: number; quantity: number }>;
const priceInput = async () => (await screen.findByText(PRICE_LABEL)).parentElement?.querySelector('input') as HTMLInputElement;

describe('delivery tab fills the unit cost from the project balance (TD-1289 D2)', () => {
  it('prefills the suggestion for a single product and posts it', async () => {
    route = deliveryRoute(deliveryReport());
    render(<ProjectStockEntryTab project={PROJECT} itemsList={ITEMS} onUpdate={vi.fn()} />);
    await waitFor(async () => expect((await priceInput()).value).toBe('۸۰۰'));
    const panel = screen.getByTestId('project-delivery-cost');
    expect(panel.textContent).toContain('۸٬۰۰۰');
    fireEvent.click(screen.getByText(DELIVER));
    await vi.waitFor(() => expect(deliveryCalls()).toHaveLength(1));
    expect(sentLines()[0]).toMatchObject({ unitPrice: 800, quantity: 10 });
    await vi.waitFor(() => expect(fetchJson.mock.calls.filter(([url]) => url === '/projects/1/delivery-cost').length).toBe(2));
  });

  it('posts no price when the user clears the suggestion, so the server uses the average cost', async () => {
    route = deliveryRoute(deliveryReport());
    render(<ProjectStockEntryTab project={PROJECT} itemsList={ITEMS} onUpdate={vi.fn()} />);
    await waitFor(async () => expect((await priceInput()).value).toBe('۸۰۰'));
    fireEvent.change(await priceInput(), { target: { value: '' } });
    expect((await priceInput()).value).toBe('');
    fireEvent.click(screen.getByText(DELIVER));
    await vi.waitFor(() => expect(deliveryCalls()).toHaveLength(1));
    expect(sentLines()[0].unitPrice).toBeUndefined();
  });

  it('warns when a delivery that completes the plan leaves a balance', async () => {
    route = deliveryRoute(deliveryReport());
    render(<ProjectStockEntryTab project={PROJECT} itemsList={ITEMS} onUpdate={vi.fn()} />);
    await waitFor(async () => expect((await priceInput()).value).toBe('۸۰۰'));
    fireEvent.change(await priceInput(), { target: { value: '700' } });
    expect((await screen.findByTestId('project-delivery-cost')).textContent).toContain(RESIDUE_WARNING);
  });

  it('suggests nothing for several products and warns instead', async () => {
    const two = deliveryReport({ products: [deliveryReport().products[0], { itemId: 43, plannedQty: 5, deliveredQty: 0, weightedAverageCost: 100 }] });
    route = deliveryRoute(two);
    const p = { ...PROJECT, products: [PROJECT.products?.[0], { id: 'prod-2', item_id: 43, item_code: 'N-2', item_name: 'ring', customer_code: '', quantity: 5, unit: 'pcs', needs_assembly: false }] } as unknown as ProductionProject;
    render(<ProjectStockEntryTab project={p} itemsList={ITEMS} onUpdate={vi.fn()} />);
    expect(await screen.findByText(content => content.includes(MULTI_PRODUCT_WARNING))).toBeTruthy();
    const inputs = screen.getAllByText(PRICE_LABEL).map(label => label.parentElement?.querySelector('input') as HTMLInputElement);
    expect(inputs.map(i => i.value)).toEqual(['', '']);
  });

  it('shows no balance and suggests nothing to a reader without the cost permission', async () => {
    route = deliveryRoute({ projectId: 1, costVisible: false, wipBalance: null, products: [{ itemId: 42, plannedQty: 10, deliveredQty: 0, weightedAverageCost: null }] });
    render(<ProjectStockEntryTab project={PROJECT} itemsList={ITEMS} onUpdate={vi.fn()} />);
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/projects/1/delivery-cost', expect.anything()));
    await waitFor(() => expect(screen.queryByTestId('project-delivery-cost')).toBeNull());
    expect((await priceInput()).value).toBe('');
  });
});
