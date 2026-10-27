import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryWrapper } from './helpers/queryWrapper';
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import {
  buildMaterialAvailabilityView, materialAvailabilityReportOf, projectMaterialItemIds, rowIsShort,
  type AvailabilityStockItem, type MaterialAvailabilityReport,
} from '../../lib/projects/materialAvailability';
import { deliveryCostOutlook, deliveryCostReportOf, type DeliveryCostReport } from '../../lib/projects/deliveryCostSuggestion';
import { issuedMaterialsReportOf } from '../../lib/projects/issuedMaterials';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
type Route = (url: string, opts?: FetchOpts) => unknown;
let route: Route = () => [];
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => route(url, opts));
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('../../hooks/queries/useSettingsQueries', () => ({ useSettingsQuery: () => ({ data: [] }), useWarehousesQuery: () => ({ data: [{ id: 1, code: 'WH1', name: 'test warehouse' }] }) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));
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
const MULTI_PRODUCT_NOTE = 'پروژهٔ چندمحصولی: تا پیش از تحویل آخر';
const MULTI_COMPLETE_NOTE = 'میان محصولات این ورود پخش می‌شود';
const QTY_LABEL = 'تعداد تحویلی:';
const REASON_NOTE = 'هنگام ثبت دلیل خواسته می‌شود';
const REAL_COST_HINT = 'بهای واقعی: ۸۰۰';
const COST_REASON = 'دلیل بهای تولید (الزامی):';
const SEND_WITH_REASON = 'ثبت با این دلیل';

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

// v10.2.3 (TD-1290, package 3 of 10.2, finding D1): the materials tab judged rows against total stock with a manual status,
// so it said «available» while the finalize reserved less because a sales proforma or another project held the stock
describe('free stock for the project (TD-1290 D1)', () => {
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
    const empty = renderHook(() => useProjectMaterialAvailability(7, [], 'loaded', 1), { wrapper: QueryWrapper });
    expect(empty.result.current.status).toBe('ready');
    expect(empty.result.current.report?.items).toEqual([]);
    const invalid = renderHook(() => useProjectMaterialAvailability('x', [3], 'loaded', 1), { wrapper: QueryWrapper });
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

describe('materials tab and purchase list use the free stock (TD-1290 D1)', () => {
  it('shows the free stock and an automatic shortage where total stock covered the need', async () => {
    route = inventoryRoute({ reservedByOthers: 6, issuedToProject: 0 });
    render(<ProjectInventoryTab project={inventoryProject()} />, { wrapper: QueryWrapper });
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
    const { result } = renderHook(() => useProjectInventory(project), { wrapper: QueryWrapper });
    await waitFor(() => expect(result.current.availability.status).toBe('ready'));
    expect(result.current.purchaseList).toHaveLength(1);
    expect(result.current.purchaseList[0]).toMatchObject({ itemName: 'glue', warehouseStockQty: 2, issuedQty: 1, toPurchaseQty: 2 });
    expect(result.current.materialProgress).toBe(0);
  });

  it('leaves a covered row off the purchase list and counts it ready', async () => {
    route = inventoryRoute({ reservedByOthers: 0, issuedToProject: 0 });
    const project = inventoryProject();
    const { result } = renderHook(() => useProjectInventory(project), { wrapper: QueryWrapper });
    await waitFor(() => expect(result.current.availability.status).toBe('ready'));
    expect(result.current.materialProgress).toBe(100);
    expect(result.current.purchaseList).toHaveLength(0);
  });

  it('shows the progress as unknown when the free stock cannot be read', async () => {
    route = url => (url.startsWith('/projects/7/material-availability') ? [] : inventoryRoute({ reservedByOthers: 0, issuedToProject: 0 })(url));
    const project = inventoryProject();
    const { result } = renderHook(() => useProjectInventory(project), { wrapper: QueryWrapper });
    await waitFor(() => expect(result.current.availability.status).toBe('error'));
    expect(result.current.materialProgress).toBeNull();
    expect(result.current.purchaseList).toHaveLength(0);
  });

  it('flags a unit mismatch instead of «available»', async () => {
    route = inventoryRoute({ reservedByOthers: 0, issuedToProject: 0 });
    const p = { ...inventoryProject(), inventory_control: { sections: globalSection(5, 'box') } } as unknown as ProductionProject;
    render(<ProjectInventoryTab project={p} />, { wrapper: QueryWrapper });
    expect(await screen.findByText(UNIT_BADGE)).toBeTruthy();
    expect(screen.queryByText(AVAILABLE_BADGE)).toBeNull();
  });
});

const issuedRow = { key: 'allocation-1', source: 'allocation', sourceId: 1, refNumber: null, date: '2026-10-01T08:00:00Z', itemId: 3, itemCode: 'G-1', itemName: 'glue', unit: 'pcs', quantity: 2, status: 'allocated', cost: 1500 };

// v10.2.3 (TD-1290, finding D3): the materials tab did not say what the project had already taken from stock
describe('materials taken from stock (TD-1290 D3)', () => {
  it('lists what was taken and hides the cost from a reader without the cost permission', async () => {
    route = () => ({ projectId: 7, costVisible: false, rows: [{ ...issuedRow, cost: 1500 }], total: 1, totalCost: 1500 });
    render(<ProjectIssuedMaterialsList projectId={7} />, { wrapper: QueryWrapper });
    const list = await screen.findByRole('region', { name: ISSUED_LIST });
    expect(await within(list).findByText('glue')).toBeTruthy();
    expect(within(list).queryByText(COST_HEADER)).toBeNull();
    expect(within(list).queryByText(COST_TOTAL)).toBeNull();
    expect(issuedMaterialsReportOf({ costVisible: false, rows: [issuedRow], total: 1, totalCost: 1500 })?.rows[0].cost).toBeNull();
  });

  it('shows each cost and the total to a cost reader', async () => {
    route = () => ({ projectId: 7, costVisible: true, rows: [issuedRow], total: 1, totalCost: 1500 });
    render(<ProjectIssuedMaterialsList projectId={7} />, { wrapper: QueryWrapper });
    expect(await screen.findByText(COST_TOTAL)).toBeTruthy();
    expect(screen.getByText(COST_HEADER)).toBeTruthy();
  });
});

const deliveryReport = (over: Partial<DeliveryCostReport> = {}): DeliveryCostReport => ({
  projectId: 1, costVisible: true, wipBalance: 8000,
  products: [{ itemId: 42, plannedQty: 10, deliveredQty: 0, weightedAverageCost: 5000 }],
  ...over,
});

// v10.2.3 (TD-1290, finding D2): the unit cost of a project's production receipt was typed by hand, so whatever did not
// match the project's materials stayed in its work in progress (1402). v11 phase 6.1ث (decision ت۵۲-۳): the server
// prices the receipt at the project's real cost, and the tab shows the same figures (`deliveryCostOutlook`)
describe('delivery cost from the project work in progress (TD-1290 D2, v11 6.1th)', () => {
  it('shows the real unit cost of a single product and what the delivery takes from the balance', () => {
    expect(deliveryCostOutlook(deliveryReport(), [{ itemId: 42, quantity: 4, typedUnitCost: null }]))
      .toMatchObject({ rule: 'share', wipBalance: 8000, credit: 3200, remaining: 4800, unitCosts: [800], reasonNeeded: null, completesPlan: false, multiProduct: false });
    expect(deliveryCostOutlook(deliveryReport(), [{ itemId: 42, quantity: 10, typedUnitCost: null }]))
      .toMatchObject({ rule: 'complete', credit: 8000, remaining: 0, completesPlan: true });
    expect(deliveryCostOutlook(deliveryReport(), [{ itemId: 42, quantity: 4, typedUnitCost: 900 }]))
      .toMatchObject({ reasonNeeded: 'cost_changed', credit: 3200, variance: 400 });
  });

  it('keeps the costs hidden from a reader without the cost permission', () => {
    expect(deliveryCostReportOf({ costVisible: false, wipBalance: 8000, products: [{ itemId: 42, plannedQty: 10, deliveredQty: 0, weightedAverageCost: 5000 }] }))
      .toMatchObject({ wipBalance: null, products: [{ weightedAverageCost: null }] });
    expect(deliveryCostOutlook(deliveryReport({ costVisible: false, wipBalance: null }), [])).toBeNull();
  });

  it('counts a line without any cost of a project without 1402', () => {
    expect(deliveryCostOutlook(deliveryReport({ wipBalance: 0, products: [{ itemId: 42, plannedQty: 10, deliveredQty: 0, weightedAverageCost: null }] }), [{ itemId: 42, quantity: 2, typedUnitCost: null }]))
      .toMatchObject({ rule: 'no_wip', credit: 0, withoutCost: 1, reasonNeeded: 'no_wip' });
  });
});

const PROJECT = {
  id: 1, project_code: 'PRJ-1', status: 'in_progress', item_id: 42, item_name: 'necklace', quantity: 10, unit: 'pcs',
  products: [{ id: 'prod-1', item_id: 42, item_code: 'N-1', item_name: 'necklace', customer_code: '', quantity: 10, unit: 'pcs', needs_assembly: false }],
} as unknown as ProductionProject;
const ITEMS = [{ id: 42, code: 'N-1', name: 'necklace', weightedAverageCost: 5000 }, { id: 43, code: 'N-2', name: 'ring', weightedAverageCost: 100 }] as unknown as Item[];
const deliveryRoute = (cost: unknown): Route => url => {
  if (url.endsWith('/product-progress')) return { products: [], stages: [], summary: { total_matrix_cells: 0, completed_matrix_cells: 0, all_matrix_completed: false } };
  if (url.endsWith('/add-to-inventory')) return { success: true, addedCount: 1, refNumber: 'PR-9' };
  if (url === '/projects/1/delivery-cost') return cost;
  return {};
};
const deliveryCalls = () => fetchJson.mock.calls.filter(([url]) => url.endsWith('/add-to-inventory'));
const sentLines = (call = 0) => JSON.parse(deliveryCalls()[call][1]?.body ?? '{}').itemsToAdd as Array<{ unitPrice?: number; quantity: number }>;
const priceInput = async () => (await screen.findByText(PRICE_LABEL)).parentElement?.querySelector('input') as HTMLInputElement;

const costRefusal = () => Object.assign(new Error('cost differs'), { code: 'PRODUCTION_COST_REASON_REQUIRED', details: { kind: 'cost_changed' } });

describe('delivery tab posts the real cost of the project (TD-1290 D2, v11 6.1th)', () => {
  it('shows the real unit cost as the hint of the empty field and posts no price', async () => {
    route = deliveryRoute(deliveryReport());
    render(<ProjectStockEntryTab project={PROJECT} itemsList={ITEMS} onUpdate={vi.fn()} />, { wrapper: QueryWrapper });
    await waitFor(async () => expect((await priceInput()).placeholder).toBe(REAL_COST_HINT));
    expect((await priceInput()).value).toBe('');
    expect(screen.getByTestId('project-delivery-cost').textContent).toContain('۸٬۰۰۰');
    fireEvent.click(screen.getByText(DELIVER));
    await vi.waitFor(() => expect(deliveryCalls()).toHaveLength(1));
    expect(sentLines()[0]).toMatchObject({ quantity: 10 });
    expect(sentLines()[0].unitPrice).toBeUndefined();
  });

  it('says a typed cost needs a reason, asks it when the server refuses, and resends with it', async () => {
    let refuse = true;
    const base = deliveryRoute(deliveryReport());
    route = (url, opts) => {
      if (url.endsWith('/add-to-inventory') && refuse) {
        refuse = false;
        throw costRefusal();
      }
      return base(url, opts);
    };
    render(<ProjectStockEntryTab project={PROJECT} itemsList={ITEMS} onUpdate={vi.fn()} />, { wrapper: QueryWrapper });
    await waitFor(async () => expect((await priceInput()).placeholder).toBe(REAL_COST_HINT));
    fireEvent.change(await priceInput(), { target: { value: '700' } });
    expect((await screen.findByTestId('project-delivery-cost')).textContent).toContain(REASON_NOTE);
    fireEvent.click(screen.getByText(DELIVER));
    const prompt = await screen.findByTestId('production-cost-prompt');
    fireEvent.change(within(prompt).getByLabelText(COST_REASON), { target: { value: 'scrap reused' } });
    fireEvent.click(within(prompt).getByText(SEND_WITH_REASON));
    await vi.waitFor(() => expect(deliveryCalls()).toHaveLength(2));
    const resent = JSON.parse(deliveryCalls()[1][1]?.body ?? '{}');
    expect(resent).toMatchObject({ productionCostReason: 'scrap reused', itemsToAdd: [{ unitPrice: 700, quantity: 10 }] });
    await waitFor(() => expect(screen.queryByTestId('production-cost-prompt')).toBeNull());
  });

  it('explains how several products are priced and leaves their fields empty', async () => {
    const two = deliveryReport({ products: [deliveryReport().products[0], { itemId: 43, plannedQty: 5, deliveredQty: 0, weightedAverageCost: 100 }] });
    route = deliveryRoute(two);
    const p = { ...PROJECT, products: [PROJECT.products?.[0], { id: 'prod-2', item_id: 43, item_code: 'N-2', item_name: 'ring', customer_code: '', quantity: 5, unit: 'pcs', needs_assembly: false }] } as unknown as ProductionProject;
    render(<ProjectStockEntryTab project={p} itemsList={ITEMS} onUpdate={vi.fn()} />, { wrapper: QueryWrapper });
    // the whole plan at once spreads the balance over both products by their average costs
    expect(await screen.findByText(content => content.includes(MULTI_COMPLETE_NOTE))).toBeTruthy();
    const inputs = screen.getAllByText(PRICE_LABEL).map(label => label.parentElement?.querySelector('input') as HTMLInputElement);
    expect(inputs.map(i => i.value)).toEqual(['', '']);
    // part of the plan takes the typed or average costs
    const qty = screen.getAllByText(QTY_LABEL)[1].parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(qty, { target: { value: '2' } });
    expect(await screen.findByText(content => content.includes(MULTI_PRODUCT_NOTE))).toBeTruthy();
  });

  it('shows no balance and no cost hint to a reader without the cost permission', async () => {
    route = deliveryRoute({ projectId: 1, costVisible: false, wipBalance: null, products: [{ itemId: 42, plannedQty: 10, deliveredQty: 0, weightedAverageCost: null }] });
    render(<ProjectStockEntryTab project={PROJECT} itemsList={[]} onUpdate={vi.fn()} />, { wrapper: QueryWrapper });
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/projects/1/delivery-cost', expect.anything()));
    await waitFor(() => expect(screen.queryByTestId('project-delivery-cost')).toBeNull());
    expect((await priceInput()).value).toBe('');
    expect((await priceInput()).placeholder).not.toContain('۸۰۰');
  });
});
