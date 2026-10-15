import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// v9.0.290 (TD-674، B16-10): پیشخوان داده ارتباط با مشتری را فقط برای دارنده crm.view و فقط پرونده‌ها و اقدام‌ها را می‌خواند
const granted = new Set<string>();
const requested: string[] = [];
const toastError = vi.fn();

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 7, username: 'td674', fullName: 'آزمون', role: 'warehouse' },
    userPermissions: { permissions: [...granted], isAdmin: false },
    logout: () => undefined,
  }),
  useHasPermission: (key: string) => granted.has(key),
  useHasAnyPermission: (keys: readonly string[]) => keys.some(key => granted.has(key)),
  useIsSystemAdmin: () => false,
}));
vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  fetchJson: vi.fn(async (url: string) => {
    requested.push(url);
    return url.startsWith('/crm/followups') ? { data: [], total: 0, dueCount: 0, openCount: 0 } : [];
  }),
}));
vi.mock('react-hot-toast', () => ({ default: { error: toastError, success: vi.fn() }, toast: { error: toastError, success: vi.fn() } }));
vi.mock('../../hooks/useDailyLogs', () => ({ useDailyLogs: () => ({ logs: [], stats: {}, loading: false }) }));
vi.mock('../../components/dashboard/PersonalBanner', () => ({ PersonalBanner: () => null }));
vi.mock('../../components/dashboard/CustomizableShortcuts', () => ({ CustomizableShortcuts: () => null }));
vi.mock('../../components/dashboard/DailyLogsMentionsWidget', () => ({ DailyLogsMentionsWidget: () => null }));

const { default: Dashboard } = await import('../../pages/Dashboard');

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  );
  return render(<Dashboard />, { wrapper: wrap });
}

beforeEach(() => {
  granted.clear();
  requested.length = 0;
  toastError.mockClear();
});
afterEach(cleanup);

const PAGE_ONLY = /^\/(customers|personnel|users)|^\/crm\/stats/;

describe('dashboard sales data (TD-674)', () => {
  it('asks nothing of the sales follow-up section without crm.view and shows no error', async () => {
    granted.add('warehouse.view');
    renderDashboard();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(requested.filter(url => url.startsWith('/crm') || PAGE_ONLY.test(url))).toEqual([]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('reads only sales files, activities and follow-ups with crm.view', async () => {
    granted.add('crm.view');
    renderDashboard();
    await waitFor(() => expect(requested.some(url => url.startsWith('/crm/activities'))).toBe(true));
    expect(requested.some(url => url.startsWith('/crm/leads'))).toBe(true);
    expect(requested.filter(url => PAGE_ONLY.test(url))).toEqual([]);
  });
});

// v10.1.15 (D-03 بخش ۴، ت۱۴): ابزارک فروش و مطالبات پیشخوان فقط برای دارنده یکی از کلیدهای گزارشش
describe('dashboard sales widget (D-03)', () => {
  it('asks no sales summary without reports.sales or accounting.reports', async () => {
    granted.add('warehouse.view');
    renderDashboard();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(requested.filter(url => url.startsWith('/reports/'))).toEqual([]);
  });

  it('reads the sales summary with reports.sales', async () => {
    granted.add('reports.sales');
    renderDashboard();
    await waitFor(() => expect(requested).toContain('/reports/dashboard-summary'));
  });
});
