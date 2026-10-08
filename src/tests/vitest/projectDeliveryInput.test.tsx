import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import toast from 'react-hot-toast';

const fetchJson = vi.fn(async (url: string, _opts?: { method?: string; body?: string }) => {
  if (url.endsWith('/product-progress')) return { summary: { total_matrix_cells: 0, completed_matrix_cells: 0, all_matrix_completed: false } };
  if (url.endsWith('/add-to-inventory')) return { success: true, addedCount: 1, refNumber: 'PR-9' };
  return {};
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: { method?: string; body?: string }) => fetchJson(url, opts) }));
vi.mock('../../hooks/queries/useSettingsQueries', () => ({ useWarehousesQuery: () => ({ data: [{ id: 1, code: 'WH1', name: 'انبار آزمون' }] }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
// v9.0.393 (TD-752): buttons follow the project API keys; these tests act as a user who holds them
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canRequestPurchase: true,
  }),
}));

import ProjectStockEntryTab from '../../components/project/ProjectStockEntryTab';
import type { ProductionProject } from '../../types';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const PROJECT = {
  id: 1, project_code: 'PRJ-1', status: 'in_progress', item_id: 42, item_name: 'گردنبند آزمون', quantity: 5, unit: 'عدد',
  products: [{ id: 'prod-1', item_id: 42, item_code: 'N-1', item_name: 'گردنبند آزمون', customer_code: '', quantity: 2, unit: 'عدد', needs_assembly: false }],
} as unknown as ProductionProject;

const deliveryCalls = () => fetchJson.mock.calls.filter(([url]) => url.endsWith('/add-to-inventory'));

// v9.0.381 (TD-741): a zero delivery quantity is an error, never the planned quantity
describe('project delivery quantity (TD-741)', () => {
  it('refuses a zero quantity instead of delivering the planned quantity', async () => {
    render(<ProjectStockEntryTab project={PROJECT} onUpdate={vi.fn()} />);
    const qty = (await screen.findByText('تعداد تحویلی:')).parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(qty, { target: { value: '0' } });
    fireEvent.click(screen.getByText('ورود به انبار'));
    await Promise.resolve();
    expect(deliveryCalls()).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith('مقدار تحویل باید بزرگتر از صفر باشد');
  });

  it('sends the quantity the user entered', async () => {
    render(<ProjectStockEntryTab project={PROJECT} onUpdate={vi.fn()} />);
    const qty = (await screen.findByText('تعداد تحویلی:')).parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(qty, { target: { value: '3' } });
    fireEvent.click(screen.getByText('ورود به انبار'));
    await vi.waitFor(() => expect(deliveryCalls()).toHaveLength(1));
    expect(JSON.parse(deliveryCalls()[0][1]?.body ?? '{}').itemsToAdd[0].quantity).toBe(3);
  });
});
