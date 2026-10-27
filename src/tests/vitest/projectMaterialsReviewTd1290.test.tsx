import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryWrapper } from './helpers/queryWrapper';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buildMaterialAvailabilityView, storedShortagesNowFree, type AvailabilityStockItem, type MaterialAvailabilityReport } from '../../lib/projects/materialAvailability';
import type { DeliveryCostReport } from '../../lib/projects/deliveryCostSuggestion';
import { buildSectionPurchaseList, sectionPurchaseRows } from '../../components/project/projectInventoryUtils';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
type Route = (url: string, opts?: FetchOpts) => unknown;
let route: Route = () => [];
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => route(url, opts));
const toastError = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('../../hooks/queries/useSettingsQueries', () => ({ useSettingsQuery: () => ({ data: [] }), useWarehousesQuery: () => ({ data: [{ id: 1, code: 'WH1', name: 'test warehouse' }] }) }));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: (m: string) => toastError(m) },
  default: Object.assign(vi.fn(), { success: vi.fn(), error: (m: string) => toastError(m) }),
}));
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => true, useHasAnyPermission: () => true }));
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canDeliver: true, canRequestPurchase: true,
  }),
}));

import { GlobalInventoryControlSection } from '../../components/project/GlobalInventoryControlSection';
import ProjectInventoryTab from '../../components/project/ProjectInventoryTab';
import ProjectStockEntryTab from '../../components/project/ProjectStockEntryTab';
import type { Item, ProductionProject, ProjectInventoryControlSectionData } from '../../types';

afterEach(() => { cleanup(); vi.clearAllMocks(); route = () => []; });

// Persian text the screens show (kept in constants: terminal output stays English)
const SECTION_ORDER_ONE = 'ثبت درخواست خرید (۱)';
const SECTION_ORDER = 'ثبت درخواست خرید';
const REFINALIZE_HINT = 'برای رزرو آن «تکمیل رزرو» را بزنید';
const DELIVER = 'ورود به انبار';
const PRICE_LABEL = 'بهای واحد:';
const SAVE_FORM = 'ذخیره فرم';
const REAL_COST_HINT = 'بهای واقعی: ۸۰۰';

const GLUE: AvailabilityStockItem = { id: 3, code: 'G-1', name: 'glue', unit: 'pcs', current_stock: 10 };
const glueRow = (gIdx: number, requiredQty: number, extra: Record<string, unknown> = {}) =>
  ({ itemId: `g${gIdx}`, itemCode: 'G-1', name: 'glue', unit: 'pcs', requiredQty, status: 'available', ...extra });
const globalSec = (id: string, rows: unknown[]) => ({ id, title: id, checkType: 'global', globalItems: rows }) as unknown as ProjectInventoryControlSectionData;
const figures = (stock: number, reservedByOthers = 0, issuedToProject = 0): MaterialAvailabilityReport =>
  ({ projectId: 7, items: [{ itemId: 3, stock, reservedByOthers, issuedToProject, freeForProject: Math.max(0, stock - reservedByOthers) }] });
const viewOf = (sections: ProjectInventoryControlSectionData[], report: MaterialAvailabilityReport | null, status: 'ready' | 'loading' = 'ready', stockItem = GLUE) =>
  buildMaterialAvailabilityView({ sections, products: [], manualPurchaseItems: [], stockItems: [stockItem], report, status });
const items = (stockItem = GLUE) => [stockItem] as unknown as Item[];

// v10.2.3 (TD-1290, review of package 3, F1): «سفارش خرید بخش» compared each row with the full free stock and took what the
// project had received off every row, while its count came from the project-wide shortage: two rows of one item said
// «ثبت سفارش خرید (۲)» and the click did nothing
describe('section purchase order groups the rows of one item (TD-1290 review F1)', () => {
  it('orders the project shortage once for two rows of one item against the free stock', () => {
    const secs = [globalSec('a', [glueRow(0, 8), glueRow(1, 8)])];
    const lines = buildSectionPurchaseList(secs[0], 0, items(), viewOf(secs, figures(10)));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ itemCode: 'G-1', unit: 'pcs', warehouseStockQty: 10, issuedQty: 0, toPurchaseQty: 6, totalRequiredQty: 16 });
    expect(sectionPurchaseRows(lines[0].id)).toEqual({ secIdx: 0, rows: [0, 1] });
  });

  it('takes what the project received off the item once, not off every row', () => {
    const secs = [globalSec('a', [glueRow(0, 5), glueRow(1, 5)])];
    const lines = buildSectionPurchaseList(secs[0], 0, items({ ...GLUE, current_stock: 0 }), viewOf(secs, figures(0, 0, 5), 'ready', { ...GLUE, current_stock: 0 }));
    expect(lines.map(l => l.toPurchaseQty)).toEqual([5]);
  });

  it('never orders more than the project shortage or than the section needs', () => {
    const secs = [globalSec('a', [glueRow(0, 8)]), globalSec('b', [glueRow(0, 8)])];
    const view = viewOf(secs, figures(10));
    expect(buildSectionPurchaseList(secs[0], 0, items(), view).map(l => l.toPurchaseQty)).toEqual([6]);
    const small = [globalSec('a', [glueRow(0, 2)]), globalSec('b', [glueRow(0, 10)])];
    expect(buildSectionPurchaseList(small[0], 0, items(), viewOf(small, figures(5))).map(l => l.toPurchaseQty)).toEqual([2]);
  });

  it('orders nothing for a covered item and groups by the earlier rule without the figures', () => {
    const secs = [globalSec('a', [glueRow(0, 4), glueRow(1, 4)])];
    expect(buildSectionPurchaseList(secs[0], 0, items(), viewOf(secs, figures(10)))).toEqual([]);
    const short = [globalSec('a', [glueRow(0, 8), glueRow(1, 8)])];
    expect(buildSectionPurchaseList(short[0], 0, items(), viewOf(short, null, 'loading')).map(l => l.toPurchaseQty)).toEqual([6]);
  });

  it('counts the order lines on the section button and offers none where nothing is left to order', () => {
    const secs = [globalSec('a', [glueRow(0, 8), glueRow(1, 8)])];
    const onPurchase = vi.fn();
    const props = {
      warehouseItems: items(), handleOpenChangeMaterialModal: vi.fn(), handleOpenUnitConversionModal: vi.fn(), handleRemoveItemFromSection: vi.fn(),
      handleUpdateGlobalItem: vi.fn(), handleRemoveSectionOnTheFly: vi.fn(), handleUpdateSectionDescription: vi.fn(), handlePurchaseSection: onPurchase,
    };
    const { unmount } = render(<GlobalInventoryControlSection sections={secs} availability={viewOf(secs, figures(10))} {...props} />, { wrapper: QueryWrapper });
    fireEvent.click(screen.getByText(SECTION_ORDER_ONE));
    expect(onPurchase).toHaveBeenCalledWith(0);
    unmount();
    // a stored «needs purchase» status with the stock covering the need: the button no longer opens an empty order
    const stale = [globalSec('a', [glueRow(0, 4, { status: 'needs_procurement' })])];
    render(<GlobalInventoryControlSection sections={stale} availability={viewOf(stale, null, 'loading')} {...props} />, { wrapper: QueryWrapper });
    expect(screen.queryByText(content => content.startsWith(SECTION_ORDER))).toBeNull();
  });
});

// v10.2.3 (TD-1290, review F5): a finalized project kept its stored reservation when stock arrived, while the row turned
// «موجود» and a sales proforma could still take that stock
describe('a finalized project points to the reservation reconcile for stock that arrived (TD-1290 review F5, TD-1341)', () => {
  const stored = [{ itemId: 3, itemCode: 'G-1', itemName: 'glue', unit: 'pcs', requiredQty: 5, reservedQty: 2, shortQty: 3, stock: 2, reservedByOthers: 0 }];

  it('lists a stored shortage only once the free stock covers it', () => {
    const secs = [globalSec('a', [glueRow(0, 5)])];
    expect(storedShortagesNowFree(viewOf(secs, figures(8)), true, stored)).toEqual(stored);
    expect(storedShortagesNowFree(viewOf(secs, figures(4)), true, stored)).toEqual([]);
    expect(storedShortagesNowFree(viewOf(secs, figures(8)), false, stored)).toEqual([]);
    expect(storedShortagesNowFree(viewOf(secs, null, 'loading'), true, stored)).toEqual([]);
  });

  it('shows the hint on the materials tab', async () => {
    route = url => {
      if (url.startsWith('/items/options')) return { data: [{ ...GLUE, current_stock: 8, type: 'raw_material' }] };
      if (url.startsWith('/projects/7/material-availability')) return figures(8);
      if (url === '/projects/7/issued-materials') return { projectId: 7, costVisible: false, rows: [], total: 0, totalCost: null };
      return [];
    };
    const project = {
      id: 7, version: 1, title: 'materials', status: 'planned', products: [],
      inventory_control: { isFinalized: true, sections: [globalSec('a', [glueRow(0, 5)])], reservedItems: [], reservationShortages: stored },
    } as unknown as ProductionProject;
    render(<ProjectInventoryTab project={project} />, { wrapper: QueryWrapper });
    expect(await screen.findByText(content => content.includes(REFINALIZE_HINT))).toBeTruthy();
  });
});

describe('the materials taken from stock are read again after a save (TD-1290 review F6)', () => {
  it('reads the list again when the project is saved', async () => {
    route = (url, opts) => {
      if (url.startsWith('/items/options')) return { data: [{ ...GLUE, type: 'raw_material' }] };
      if (url.startsWith('/projects/7/material-availability')) return figures(10);
      if (url === '/projects/7/issued-materials') return { projectId: 7, costVisible: false, rows: [], total: 0, totalCost: null };
      if (url === '/api/projects/7' && opts?.method === 'PUT') return { id: 7, version: 2, inventory_control: {} };
      return [];
    };
    const project = { id: 7, version: 1, title: 'materials', status: 'planned', products: [], inventory_control: { sections: [globalSec('a', [glueRow(0, 4)])] } } as unknown as ProductionProject;
    render(<ProjectInventoryTab project={project} />, { wrapper: QueryWrapper });
    const issuedReads = () => fetchJson.mock.calls.filter(([url]) => url === '/projects/7/issued-materials').length;
    await vi.waitFor(() => expect(issuedReads()).toBe(1));
    fireEvent.click(screen.getByText(SAVE_FORM));
    await vi.waitFor(() => expect(issuedReads()).toBe(2));
  });
});

const deliveryReport = (over: Partial<DeliveryCostReport> = {}): DeliveryCostReport => ({
  projectId: 1, costVisible: true, wipBalance: 8000,
  products: [{ itemId: 42, plannedQty: 10, deliveredQty: 0, weightedAverageCost: 5000 }],
  ...over,
});

const PRODUCT = { id: 'prod-1', item_id: 42, item_code: 'N-1', item_name: 'necklace', customer_code: '', quantity: 10, unit: 'pcs', needs_assembly: false };
const PROJECT = { id: 1, project_code: 'PRJ-1', status: 'in_progress', item_id: 42, item_name: 'necklace', quantity: 10, unit: 'pcs', products: [PRODUCT] } as unknown as ProductionProject;
const ITEMS = [{ id: 42, code: 'N-1', name: 'necklace', weightedAverageCost: 5000 }, { id: 43, code: 'N-2', name: 'ring', weightedAverageCost: 100 }] as unknown as Item[];
let costAnswer: unknown = deliveryReport();
let deliveryAnswer: (opts?: FetchOpts) => unknown = () => ({ success: true, addedCount: 1, refNumber: 'PR-9' });
const deliveryRoute: Route = (url, opts) => {
  if (url.endsWith('/product-progress')) return { products: [], stages: [], summary: { total_matrix_cells: 0, completed_matrix_cells: 0, all_matrix_completed: false } };
  if (url.endsWith('/add-to-inventory')) return deliveryAnswer(opts);
  if (url === '/projects/1/delivery-cost') return costAnswer;
  return {};
};
const deliveryCalls = () => fetchJson.mock.calls.filter(([url]) => url.endsWith('/add-to-inventory'));
const sentBody = (call: number) => JSON.parse(deliveryCalls()[call][1]?.body ?? '{}') as { itemsToAdd: Array<{ unitPrice?: number; itemId: number }> };
const priceInputs = () => screen.getAllByText(PRICE_LABEL).map(label => label.parentElement?.querySelector('input') as HTMLInputElement);
const deliverButton = (i = 0) => screen.getAllByText(DELIVER).map(span => span.closest('button') as HTMLButtonElement)[i];

// v10.2.3 (TD-1290, review F2): a suggestion read before another delivery, or kept in the over-delivery resend, could
// credit more than the project's 1402 balance. v11 phase 6.1ث (decision ت۵۲-۳): the server prices the receipt from the
// 1402 it reads under the project lock, so the tab sends only the costs the user typed and the hint can never go stale
describe('the delivery tab sends only typed costs (TD-1290 review F2, F3, F6; v11 6.1th)', () => {
  afterEach(() => { costAnswer = deliveryReport(); deliveryAnswer = () => ({ success: true, addedCount: 1, refNumber: 'PR-9' }); });

  it('sends no price for the hint, without reading the balance again first', async () => {
    route = deliveryRoute;
    render(<ProjectStockEntryTab project={PROJECT} itemsList={ITEMS} onUpdate={vi.fn()} />, { wrapper: QueryWrapper });
    await waitFor(() => expect(priceInputs()[0].placeholder).toBe(REAL_COST_HINT));
    const reads = () => fetchJson.mock.calls.filter(([url]) => url === '/projects/1/delivery-cost').length;
    const before = reads();
    fireEvent.click(deliverButton());
    await vi.waitFor(() => expect(deliveryCalls()).toHaveLength(1));
    expect(sentBody(0).itemsToAdd[0].unitPrice).toBeUndefined();
    const urls = fetchJson.mock.calls.map(([url]) => url);
    expect(urls.slice(0, urls.findIndex(url => url.endsWith('/add-to-inventory'))).filter(url => url === '/projects/1/delivery-cost')).toHaveLength(before);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('keeps the unit cost typed for a product that was not delivered (F3)', async () => {
    costAnswer = deliveryReport({ products: [deliveryReport().products[0], { itemId: 43, plannedQty: 5, deliveredQty: 0, weightedAverageCost: 100 }] });
    route = deliveryRoute;
    const two = { ...PROJECT, products: [PRODUCT, { ...PRODUCT, id: 'prod-2', item_id: 43, item_code: 'N-2', item_name: 'ring', quantity: 5 }] } as unknown as ProductionProject;
    render(<ProjectStockEntryTab project={two} itemsList={ITEMS} onUpdate={vi.fn()} />, { wrapper: QueryWrapper });
    await waitFor(() => expect(deliverButton(0).disabled).toBe(false));
    fireEvent.change(priceInputs()[0], { target: { value: '111' } });
    fireEvent.change(priceInputs()[1], { target: { value: '222' } });
    fireEvent.click(deliverButton(0));
    await vi.waitFor(() => expect(deliveryCalls()).toHaveLength(1));
    expect(sentBody(0).itemsToAdd).toMatchObject([{ itemId: 42, unitPrice: 111 }]);
    await waitFor(() => expect(priceInputs()[0].value).toBe(''));
    expect(priceInputs()[1].value).toBe('۲۲۲');
  });

  it('lets a delivery go before the balance read answers, then shows the hint (F6)', async () => {
    let answer: (v: unknown) => void = () => undefined;
    route = url => (url === '/projects/1/delivery-cost' ? new Promise(resolve => { answer = resolve; }) : deliveryRoute(url));
    render(<ProjectStockEntryTab project={PROJECT} itemsList={ITEMS} onUpdate={vi.fn()} />, { wrapper: QueryWrapper });
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/projects/1/delivery-cost', expect.anything()));
    expect(deliverButton().disabled).toBe(false);
    answer(deliveryReport());
    await waitFor(() => expect(priceInputs()[0].placeholder).toBe(REAL_COST_HINT));
  });
});
