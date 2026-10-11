import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const OVER = { itemId: 42, itemName: 'گردنبند آزمون', unit: 'عدد', planned: 5, delivered: 5, requested: 2, excess: 2 };
/** The server's refusal that the tab shows as it is */
const OVER_DELIVERY_MESSAGE = 'تحویل بیش از مقدار برنامه‌ریزی‌شده پروژه';
let deliveries = 0;
const fetchJson = vi.fn(async (url: string, _opts?: { method?: string; body?: string }) => {
  if (url.endsWith('/product-progress')) return { summary: { total_matrix_cells: 0, completed_matrix_cells: 0, all_matrix_completed: false } };
  if (url.endsWith('/add-to-inventory')) {
    deliveries++;
    if (deliveries === 1) {
      throw Object.assign(new Error(OVER_DELIVERY_MESSAGE), { code: 'OVER_DELIVERY_REASON_REQUIRED', status: 422, details: { overDeliveries: [OVER] } });
    }
    return { success: true, addedCount: 1, refNumber: 'PR-9' };
  }
  return {};
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: { method?: string; body?: string }) => fetchJson(url, opts) }));
vi.mock('../../hooks/queries/useSettingsQueries', () => ({ useSettingsQuery: () => ({ data: [] }), useWarehousesQuery: () => ({ data: [{ id: 1, code: 'WH1', name: 'انبار آزمون' }] }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
// v9.0.417 (TD-752): buttons follow the project API keys; these tests act as a user who holds them
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canDeliver: true, canRequestPurchase: true,
  }),
}));

import ProjectStockEntryTab from '../../components/project/ProjectStockEntryTab';
import type { ProductionProject } from '../../types';

afterEach(cleanup);

const PROJECT = {
  id: 1, project_code: 'PRJ-1', status: 'in_progress', item_id: 42, item_name: 'گردنبند آزمون', quantity: 5, unit: 'عدد',
  products: [{ id: 'prod-1', item_id: 42, item_code: 'N-1', item_name: 'گردنبند آزمون', customer_code: '', quantity: 2, unit: 'عدد', needs_assembly: false }],
} as unknown as ProductionProject;

// v8.0.72 (TD-327، تصمیم مالک محصول — گزینه ب «با دلیل»): تحویل بیش از برنامه با دلیل دوباره فرستاده می‌شود
describe('project over-delivery reason (TD-327)', () => {
  it('asks for a reason when the server refuses an over-delivery and resends the same delivery with it', async () => {
    const onUpdate = vi.fn();
    render(<ProjectStockEntryTab project={PROJECT} onUpdate={onUpdate} />);
    fireEvent.click(await screen.findByText('ورود به انبار'));
    expect(await screen.findByText('تحویل بیش از مقدار برنامه‌ریزی‌شده پروژه')).toBeTruthy();
    const confirm = screen.getByText('ثبت تحویل با دلیل').closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(/اضافه سفارش داد/), { target: { value: 'سفارش اضافه مشتری' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    const calls = fetchJson.mock.calls.filter(([url]) => url.endsWith('/add-to-inventory'));
    expect(calls).toHaveLength(2);
    const first = JSON.parse(calls[0][1]?.body ?? '{}');
    const second = JSON.parse(calls[1][1]?.body ?? '{}');
    expect(first.overDeliveryReason).toBeUndefined();
    expect(second).toEqual({ ...first, overDeliveryReason: 'سفارش اضافه مشتری' });
    expect(screen.queryByText('تحویل بیش از مقدار برنامه‌ریزی‌شده پروژه')).toBeNull();
  });
});
