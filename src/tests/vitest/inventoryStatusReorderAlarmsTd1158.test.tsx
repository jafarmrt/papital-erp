import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// TD-1158: the «وضعیت انبار» reorder alarm reads GET /items/reorder-alerts (free stock = stock − reservations, the
// reorder page's rule) and is shown only to a viewer who may open that page; other viewers get no section and no request.

const ALARM_CARD = 'اقلام نیازمند سفارش (هشدار)';

const state = vi.hoisted(() => ({
  viewer: { permissions: [] as string[], isAdmin: false },
  urls: [] as string[],
}));

vi.mock('../../contexts/AuthContext', () => ({ useViewerAccess: () => state.viewer }));
vi.mock('../../hooks/useAppCurrency', () => ({ useRialDisplay: () => ({ number: (n: number) => String(n), label: 'ریال' }) }));
vi.mock('../../hooks/queries', () => ({
  useDashboardStatsQuery: () => ({ data: { totalItems: 0 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }),
  useDashboardBIStatsQuery: () => ({
    // the dashboard's own list (total stock) disagrees with the reorder page on purpose
    data: {
      reorderAlarms: [{ id: 9, name: 'کالای کل', code: 'TOTAL-9', current_stock: 1, reorder_point: 5, unit: 'عدد', type: 'product' }],
      fastMoving: [], slowMoving: [], deadStock: [], totalValuation: 0, locations: {}, locationItemCounts: {}, warehouses: [], monthlyTrends: [],
    },
    isLoading: false, isFetching: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('../../api', () => ({
  fetchJson: vi.fn(async (url: string) => {
    state.urls.push(url);
    if (url === '/items/reorder-alerts') {
      return [1, 2].map(id => ({
        id, name: `کالای آزاد ${id}`, code: `FREE-${id}`, type: 'raw_material', unit: 'عدد', current_stock: 10, reserved_qty: 8,
        free_stock: 2, reorder_point: 5, weighted_average_cost: 1, deficit: 3, deficit_value: 3, is_zero_stock: false,
      }));
    }
    return [];
  }),
}));

async function renderPage() {
  const { default: InventoryStatusPage } = await import('../../pages/InventoryStatusPage');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><InventoryStatusPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('inventory status reorder alarm (TD-1158)', () => {
  beforeEach(() => { cleanup(); state.urls = []; });

  it('hides the alarm and sends no request for a reports-only viewer', async () => {
    state.viewer = { permissions: ['reports.view'], isAdmin: false };
    await renderPage();
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText(ALARM_CARD)).toBeNull();
    expect(screen.queryByText('TOTAL-9')).toBeNull();
    expect(state.urls).not.toContain('/items/reorder-alerts');
  });

  it('counts the reorder page items by free stock for a warehouse reader', async () => {
    state.viewer = { permissions: ['warehouse.view'], isAdmin: false };
    await renderPage();
    await waitFor(() => expect(screen.getByText('FREE-1')).toBeTruthy());
    expect(state.urls).toContain('/items/reorder-alerts');
    expect(screen.queryByText('TOTAL-9')).toBeNull();
    expect(screen.getByText(/۲ قلم کالا نیازمند سفارش/)).toBeTruthy();
  });
});
