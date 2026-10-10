import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import toast from 'react-hot-toast';

const fetchJson = vi.fn(async (url: string, _opts?: { method?: string; body?: string }) => {
  if (url.endsWith('/product-progress')) return { summary: { total_matrix_cells: 0, completed_matrix_cells: 0, all_matrix_completed: false } };
  if (url.endsWith('/add-to-inventory')) return { success: true, addedCount: 1, refNumber: 'PR-9' };
  return {};
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: { method?: string; body?: string }) => fetchJson(url, opts) }));
vi.mock('../../hooks/queries/useSettingsQueries', () => ({ useSettingsQuery: () => ({ data: [] }), useWarehousesQuery: () => ({ data: [{ id: 1, code: 'WH1', name: 'test warehouse' }] }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canDeliver: true, canRequestPurchase: true,
  }),
}));

import ProjectStockEntryTab from '../../components/project/ProjectStockEntryTab';
import type { Item, ProductionProject } from '../../types';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const ZERO_QTY_MESSAGE = 'مقدار تحویل باید بزرگتر از صفر باشد';
const QTY_LABEL = 'تعداد تحویلی:';
const PRICE_LABEL = 'بهای واحد:';
const DELIVER = 'ورود به انبار';

const PROJECT = {
  id: 1, project_code: 'PRJ-1', status: 'in_progress', item_id: 42, item_name: 'necklace', quantity: 5, unit: 'pcs',
  products: [{ id: 'prod-1', item_id: 42, item_code: 'N-1', item_name: 'necklace', customer_code: '', quantity: 2, unit: 'pcs', needs_assembly: false }],
} as unknown as ProductionProject;
const ITEMS = [{ id: 42, code: 'N-1', name: 'necklace', weightedAverageCost: 5000 }] as unknown as Item[];

const deliveryCalls = () => fetchJson.mock.calls.filter(([url]) => url.endsWith('/add-to-inventory'));
const sentLine = (call = 0) => JSON.parse(deliveryCalls()[call][1]?.body ?? '{}').itemsToAdd[0];
const inputAfter = async (label: string) => (await screen.findByText(label)).parentElement?.querySelector('input') as HTMLInputElement;

// v10.0.28 (TD-977): the browser's cached average cost is never sent as an entered price, and no quantity is invented
describe('project stock entry price and quantity (TD-977)', () => {
  it('sends no unit price when the user typed none, so the server uses the current average cost', async () => {
    render(<ProjectStockEntryTab project={PROJECT} itemsList={ITEMS} onUpdate={vi.fn()} />);
    expect((await inputAfter(PRICE_LABEL)).value).toBe('');
    fireEvent.click(screen.getByText(DELIVER));
    await vi.waitFor(() => expect(deliveryCalls()).toHaveLength(1));
    expect(sentLine().unitPrice).toBeUndefined();
    expect(sentLine().quantity).toBe(2);
  });

  it('sends the unit price the user typed', async () => {
    render(<ProjectStockEntryTab project={PROJECT} itemsList={ITEMS} onUpdate={vi.fn()} />);
    fireEvent.change(await inputAfter(PRICE_LABEL), { target: { value: '7000' } });
    fireEvent.click(screen.getByText(DELIVER));
    await vi.waitFor(() => expect(deliveryCalls()).toHaveLength(1));
    expect(sentLine().unitPrice).toBe(7000);
  });

  it('starts empty for a product without a planned quantity and refuses to deliver 100', async () => {
    const noPlan = { ...PROJECT, quantity: undefined, products: [] } as unknown as ProductionProject;
    render(<ProjectStockEntryTab project={noPlan} itemsList={ITEMS} onUpdate={vi.fn()} />);
    expect((await inputAfter(QTY_LABEL)).value).toBe('');
    fireEvent.click(screen.getByText(DELIVER));
    await Promise.resolve();
    expect(deliveryCalls()).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith(ZERO_QTY_MESSAGE);
  });
});
