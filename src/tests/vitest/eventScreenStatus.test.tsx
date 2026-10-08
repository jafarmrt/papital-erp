/**
 * v9.0.396 (TD-733, B15-31 / FE-19, FE-20, FE-25, FE-26): the events page says what is true. A stopped background
 * processor is shown as stopped (red, no pulse), an outbox action is announced once (the tab's banner, no second toast from
 * the mutation hook), and the live events label names the interval the list really refreshes at. On v9.0.395 a stopped
 * processor showed the green pulse with «ورکر در حال پایش», every outbox action showed a banner and a toast, and the label
 * said «هر ۸ ثانیه» while the list refreshed every 10 seconds.
 */
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import { DomainEventsTab } from '../../components/settings/DomainEventsTab';
import { DOMAIN_EVENTS_REFRESH_MS } from '../../hooks/queries/useEventQueries';

vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => key === 'events.manage' }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/settings/AutoActionsSubTab', () => ({ AutoActionsSubTab: () => <div /> }));
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear(); });

function mockServer(workerRunning: boolean) {
  vi.mocked(fetchJson).mockImplementation(async (url: string, opts?: RequestInit) => {
    if ((opts?.method || 'GET') !== 'GET') return { success: true, message: 'پردازش دسته انجام شد.' };
    if (url.startsWith('/events/outbox/stats')) {
      return { success: true, stats: { total: 4, pending: 4, processing: 0, completed: 0, failed: 0, workerRunning } };
    }
    if (url.startsWith('/events/outbox')) return { success: true, events: [] };
    if (url.startsWith('/events/domain-events')) return { success: true, events: [], stats: null };
    return { success: true, data: [] };
  });
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(<DomainEventsTab />, { wrapper });
}

describe('TD-733 the events page states its real status', () => {
  it('a stopped background processor is shown as stopped, without the green pulse', async () => {
    mockServer(false);
    renderTab();
    fireEvent.click(screen.getByText('صف ارسال رویداد'));
    const label = await screen.findByText('پردازشگر پس‌زمینه متوقف است');
    const dot = label.previousElementSibling as HTMLElement;
    expect(dot.className).not.toContain('bg-emerald-500');
    expect(dot.className).not.toContain('animate-pulse');
  });

  it('a running background processor is shown as running', async () => {
    mockServer(true);
    renderTab();
    fireEvent.click(screen.getByText('صف ارسال رویداد'));
    expect(await screen.findByText('پردازشگر پس‌زمینه فعال است')).toBeTruthy();
  });

  it('processing the outbox by hand is announced once, in the tab banner', async () => {
    mockServer(true);
    renderTab();
    fireEvent.click(screen.getByText('صف ارسال رویداد'));
    fireEvent.click(await screen.findByText('پردازش دستی دسته'));
    expect(await screen.findByText('پردازش دسته انجام شد.')).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('the live events label names the interval the list refreshes at', async () => {
    mockServer(true);
    renderTab();
    fireEvent.click(screen.getByText('گذرگاه رویدادهای زنده'));
    expect(DOMAIN_EVENTS_REFRESH_MS).toBe(10000);
    expect(await screen.findByText('به‌روزرسانی خودکار هر ۱۰ ثانیه')).toBeTruthy();
  });
});
