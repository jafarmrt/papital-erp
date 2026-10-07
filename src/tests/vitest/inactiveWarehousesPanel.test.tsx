import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InactiveWarehousesPanel } from '../../components/settings/InactiveWarehousesPanel';

// Package 6 (TD-490 / B06-11, decision t5 «الف»): on v9.0.109 «مدیریت انبارها» listed only active warehouses and had no
// way back for a deactivated one; the system admin now sees inactive warehouses and reactivates them after a confirmation.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(() => Promise.resolve(true)) }));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

const renderPanel = (enabled: boolean) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><InactiveWarehousesPanel enabled={enabled} /></QueryClientProvider>);
};

describe('InactiveWarehousesPanel (TD-490)', () => {
  it('lists only inactive warehouses and reactivates one', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(url.startsWith('/warehouses?includeInactive=1')
      ? [{ id: 1, name: 'انبار مرکزی', code: 'main', isActive: 1 }, { id: 6, name: 'فروشگاه', code: 'shop', isActive: 0 }]
      : { id: 6, is_active: 1 }));
    renderPanel(true);
    await screen.findByText('فروشگاه');
    expect(screen.queryByText('انبار مرکزی')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /فعال‌سازی دوباره/ }));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/warehouses/6/reactivate', { method: 'POST' }));
  });

  it('asks nothing for users who may not reactivate', () => {
    renderPanel(false);
    expect(fetchJson).not.toHaveBeenCalled();
    expect(screen.queryByText('انبارهای غیرفعال')).toBeNull();
  });
});
