import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buildMaterialAvailabilityView, type AvailabilityStockItem, type MaterialAvailabilityReport } from '../../lib/projects/materialAvailability';
import { checkDeliveryPrices, type DeliveryCostReport } from '../../lib/projects/deliveryCostSuggestion';
import { buildSectionPurchaseList, sectionPurchaseRows } from '../../components/project/projectInventoryUtils';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
type Route = (url: string, opts?: FetchOpts) => unknown;
let route: Route = () => [];
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => route(url, opts));
const confirmAction = vi.fn(async (_opts: { message: string }) => true);
const toastError = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: (opts: { message: string }) => confirmAction(opts) }));
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

import ProjectStockEntryTab from '../../components/project/ProjectStockEntryTab';
import type { Item, ProductionProject, ProjectInventoryControlSectionData } from '../../types';

afterEach(() => { cleanup(); vi.clearAllMocks(); route = () => []; confirmAction.mockImplementation(async () => true); });

// Persian text the screens show (kept in constants: terminal output stays English)
const DELIVER = 'ورود به انبار';
const PRICE_LABEL = 'بهای واحد:';
const OVER_DELIVERY_CONFIRM = 'ثبت تحویل با دلیل';

const GLUE: AvailabilityStockItem = { id: 3, code: 'G-1', name: 'glue', unit: 'pcs', current_stock: 10 };
const glueRow = (gIdx: number, requiredQty: number, extra: Record<string, unknown> = {}) =>
  ({ itemId: `g${gIdx}`, itemCode: 'G-1', name: 'glue', unit: 'pcs', requiredQty, status: 'available', ...extra });
const globalSec = (id: string, rows: unknown[]) => ({ id, title: id, checkType: 'global', globalItems: rows }) as unknown as ProjectInventoryControlSectionData;
const figures = (stock: number, reservedByOthers = 0, issuedToProject = 0): MaterialAvailabilityReport =>
  ({ projectId: 7, items: [{ itemId: 3, stock, reservedByOthers, issuedToProject, freeForProject: Math.max(0, stock - reservedByOthers) }] });
const viewOf = (sections: ProjectInventoryControlSectionData[], report: MaterialAvailabilityReport | null, status: 'ready' | 'loading' = 'ready', stockItem = GLUE) =>
  buildMaterialAvailabilityView({ sections, products: [], manualPurchaseItems: [], stockItems: [stockItem], report, status });
const items = (stockItem = GLUE) => [stockItem] as unknown as Item[];

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
  if (url.endsWith('/product-progress')) return { summary: { total_matrix_cells: 0, completed_matrix_cells: 0, all_matrix_completed: false } };
  if (url.endsWith('/add-to-inventory')) return deliveryAnswer(opts);
  if (url === '/projects/1/delivery-cost') return costAnswer;
  return {};
};
const deliveryCalls = () => fetchJson.mock.calls.filter(([url]) => url.endsWith('/add-to-inventory'));
const sentBody = (call: number) => JSON.parse(deliveryCalls()[call][1]?.body ?? '{}') as { itemsToAdd: Array<{ unitPrice?: number; itemId: number }>; overDeliveryReason?: string };
const priceInputs = () => screen.getAllByText(PRICE_LABEL).map(label => label.parentElement?.querySelector('input') as HTMLInputElement);
const deliverButton = (i = 0) => screen.getAllByText(DELIVER).map(span => span.closest('button') as HTMLButtonElement)[i];

// v10.2.3 (TD-1290, delta review of package 3)
const QTY_LABEL = 'تعداد تحویلی:';
const OVERDRAW_ALERT = 'ماندهٔ کالای در جریان ساخت پروژه منفی می‌شود';
const qtyInputs = () => screen.getAllByText(QTY_LABEL).map(label => label.parentElement?.querySelector('input') as HTMLInputElement);
const overDeliveryRefusal = (requestedQty: number) => Object.assign(new Error('over'), {
  code: 'OVER_DELIVERY_REASON_REQUIRED', details: { overDeliveries: [{ itemId: 42, itemName: 'necklace', plannedQty: 10, deliveredQty: 0, requestedQty }] },
});

describe('the over-delivery resend sends what it priced (TD-1290 delta review D1, D3)', () => {
  afterEach(() => { costAnswer = deliveryReport(); deliveryAnswer = () => ({ success: true, addedCount: 1, refNumber: 'PR-9' }); });

  it('closes the reason prompt when a quantity changes, so the refused quantity is never resent at the new price', async () => {
    route = deliveryRoute;
    deliveryAnswer = opts => {
      if (JSON.parse(opts?.body ?? '{}').overDeliveryReason) return { success: true, addedCount: 1 };
      throw overDeliveryRefusal(16);
    };
    render(<ProjectStockEntryTab project={PROJECT} itemsList={ITEMS} onUpdate={vi.fn()} />);
    await waitFor(() => expect(priceInputs()[0].value).toBe('۸۰۰'));
    fireEvent.change(qtyInputs()[0], { target: { value: '16' } });
    await waitFor(() => expect(priceInputs()[0].value).toBe('۵۰۰'));
    fireEvent.click(deliverButton());
    await screen.findByText(OVER_DELIVERY_CONFIRM);
    expect(sentBody(0).itemsToAdd[0]).toMatchObject({ quantity: 16, unitPrice: 500 });
    fireEvent.change(qtyInputs()[0], { target: { value: '10' } });
    await waitFor(() => expect(screen.queryByText(OVER_DELIVERY_CONFIRM)).toBeNull());
    await waitFor(() => expect(priceInputs()[0].value).toBe('۸۰۰'));
    expect(deliveryCalls()).toHaveLength(1);
  });

  it('checks the resend against the quantity it sends when only the price changed', async () => {
    route = deliveryRoute;
    deliveryAnswer = opts => {
      if (JSON.parse(opts?.body ?? '{}').overDeliveryReason) return { success: true, addedCount: 1 };
      throw overDeliveryRefusal(16);
    };
    render(<ProjectStockEntryTab project={PROJECT} itemsList={ITEMS} onUpdate={vi.fn()} />);
    await waitFor(() => expect(priceInputs()[0].value).toBe('۸۰۰'));
    fireEvent.change(qtyInputs()[0], { target: { value: '16' } });
    await waitFor(() => expect(priceInputs()[0].value).toBe('۵۰۰'));
    fireEvent.click(deliverButton());
    await screen.findByText(OVER_DELIVERY_CONFIRM);
    expect(confirmAction).not.toHaveBeenCalled();
    fireEvent.change(priceInputs()[0], { target: { value: '800' } });
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'customer asked for more' } });
    fireEvent.click(screen.getByText(OVER_DELIVERY_CONFIRM));
    // 16 × 800 = 12,800 against a balance of 8,000
    await vi.waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(confirmAction.mock.calls[0][0].message).toContain('۱۲٬۸۰۰');
    await vi.waitFor(() => expect(deliveryCalls()).toHaveLength(2));
    expect(sentBody(1)).toMatchObject({ overDeliveryReason: 'customer asked for more', itemsToAdd: [{ quantity: 16, unitPrice: 800 }] });
  });

  it('reads the balance again before posting when the first read failed', async () => {
    let fail = true;
    route = (url, opts) => {
      if (url === '/projects/1/delivery-cost' && fail) throw new Error('down');
      return deliveryRoute(url, opts);
    };
    render(<ProjectStockEntryTab project={PROJECT} itemsList={ITEMS} onUpdate={vi.fn()} />);
    await waitFor(() => expect(deliverButton().disabled).toBe(false));
    expect(priceInputs()[0].value).toBe('');
    fail = false;
    fireEvent.change(priceInputs()[0], { target: { value: '2000' } });
    confirmAction.mockImplementation(async () => false);
    fireEvent.click(deliverButton());
    // 10 × 2,000 = 20,000 against a balance of 8,000: asked, refused, nothing posted
    await vi.waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(deliverButton().disabled).toBe(false));
    expect(deliveryCalls()).toHaveLength(0);
  });

  it('posts the typed price without a cost read answer for a user who does not see cost', async () => {
    costAnswer = { projectId: 1, costVisible: false, wipBalance: null, products: [{ itemId: 42, plannedQty: 10, deliveredQty: 0, weightedAverageCost: null }] };
    route = deliveryRoute;
    render(<ProjectStockEntryTab project={PROJECT} itemsList={ITEMS} onUpdate={vi.fn()} />);
    await waitFor(() => expect(deliverButton().disabled).toBe(false));
    fireEvent.change(priceInputs()[0], { target: { value: '300' } });
    const urls = () => fetchJson.mock.calls.map(([url]) => url);
    const before = urls().filter(url => url === '/projects/1/delivery-cost').length;
    fireEvent.click(deliverButton());
    await vi.waitFor(() => expect(deliveryCalls()).toHaveLength(1));
    expect(sentBody(0).itemsToAdd[0].unitPrice).toBe(300);
    // no fresh read between the click and the post (the read after it is the reload of a delivered tab)
    const posted = urls().findIndex(url => url.endsWith('/add-to-inventory'));
    expect(urls().slice(0, posted).filter(url => url === '/projects/1/delivery-cost')).toHaveLength(before);
    expect(confirmAction).not.toHaveBeenCalled();
  });
});

describe('a rounded suggestion does not warn of a negative balance (TD-1290 delta review D2)', () => {
  const thirds = deliveryReport({ wipBalance: 2000, products: [{ itemId: 42, plannedQty: 3, deliveredQty: 0, weightedAverageCost: 5000 }] });

  it('posts the untouched suggestion of 2,000 over 3 units without an overdraw', () => {
    const check = checkDeliveryPrices(thirds, [{ itemId: 42, quantity: 3, typedPrice: undefined, shownSuggestion: 666.6667 }], true);
    expect(check).toMatchObject({ kind: 'post', prices: [666.6667], overdraws: false });
  });

  it('shows no negative balance alert for it on the delivery tab', async () => {
    costAnswer = thirds;
    route = deliveryRoute;
    const three = { ...PROJECT, quantity: 3, products: [{ ...PRODUCT, quantity: 3 }] } as unknown as ProductionProject;
    render(<ProjectStockEntryTab project={three} itemsList={ITEMS} onUpdate={vi.fn()} />);
    await waitFor(() => expect(priceInputs()[0].value).toBe('۶۶۶٫۶۶۶۷'));
    expect(screen.queryByText(content => content.includes(OVERDRAW_ALERT))).toBeNull();
    fireEvent.click(deliverButton());
    await vi.waitFor(() => expect(deliveryCalls()).toHaveLength(1));
    expect(confirmAction).not.toHaveBeenCalled();
  });
});

describe('a section order never adds quantities of two units (TD-1290 delta review D4)', () => {
  it('orders a row the finalize cannot convert apart, in its own unit, and marks only the rows of each line', () => {
    const kg = glueRow(1, 3, { unit: 'kg' });
    const secs = [globalSec('a', [glueRow(0, 8), kg])];
    const lines = buildSectionPurchaseList(secs[0], 0, items({ ...GLUE, current_stock: 0 }), viewOf(secs, null, 'loading', { ...GLUE, current_stock: 0 }));
    expect(lines.map(l => [l.unit, l.toPurchaseQty, sectionPurchaseRows(l.id)?.rows])).toEqual([['pcs', 8, [0]], ['kg', 3, [1]]]);
  });

  it('orders the project shortage for the converted rows and leaves an unconvertible row out of that line', () => {
    const kg = glueRow(1, 3, { unit: 'kg' });
    const secs = [globalSec('a', [glueRow(0, 8), kg])];
    const lines = buildSectionPurchaseList(secs[0], 0, items(), viewOf(secs, figures(5)));
    const pcs = lines.find(l => l.unit === 'pcs');
    expect(pcs).toMatchObject({ toPurchaseQty: 3, totalRequiredQty: 8 });
    expect(sectionPurchaseRows(pcs?.id ?? '')?.rows).toEqual([0]);
    expect(lines.every(l => !(l.unit === 'pcs' && sectionPurchaseRows(l.id)?.rows.includes(1)))).toBe(true);
  });

  it('adds a converted row to the item line in the item unit', () => {
    const grams = glueRow(1, 500, { unit: 'g', conversionRate: 100, convertedUnit: 'pcs' });
    const secs = [globalSec('a', [glueRow(0, 8), grams])];
    const lines = buildSectionPurchaseList(secs[0], 0, items(), viewOf(secs, figures(10)));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ unit: 'pcs', totalRequiredQty: 13, toPurchaseQty: 3 });
    expect(sectionPurchaseRows(lines[0].id)?.rows).toEqual([0, 1]);
  });
});
