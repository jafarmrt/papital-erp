import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { DailyLogReviewModal } from '../../components/daily-logs/DailyLogReviewModal';
import { DailyLogDetailModal } from '../../components/daily-logs/DailyLogDetailModal';
import { DailyLogsMentionsWidget } from '../../components/dashboard/DailyLogsMentionsWidget';
import { useDashboardDailyLogs } from '../../hooks/useDashboardDailyLogs';
import { useDailyLogFocus, DAILY_LOG_NOT_FOUND_MESSAGE } from '../../hooks/useDailyLogFocus';
import type { DailyWorkLog, User } from '../../types';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

beforeEach(() => { fetchJson.mockReset(); vi.mocked(toast.error).mockReset(); });
afterEach(cleanup);

const log = {
  id: 5, userId: 3, username: 'author', user_full_name: 'نویسنده', title: 'گزارش نمونه', content: 'کار روز', date: '2026-10-05',
  start_time: '08:00', end_time: '16:00', work_hours: 8, work_mode: 'onsite', mentions: [7], tags: [],
} as unknown as DailyWorkLog;

// v9.0.261 (TD-637, finding B13-12): the review form mentions nobody; its notification goes only to the author
describe('daily log review form (TD-637)', () => {
  it('has no @ mention picker and says the notification goes to the author', () => {
    render(<DailyLogReviewModal reviewModalLog={log} onClose={() => {}} reviewNotes="" setReviewNotes={() => {}} isSubmittingReview={false} onSaveReview={() => {}} />);
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.placeholder).not.toContain('@');
    fireEvent.change(box, { target: { value: '@' } });
    expect(screen.queryByText(/همکاران/)).toBeNull();
    expect(screen.getByText('اعلان بازخورد فقط برای نویسنده گزارش فرستاده می‌شود.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /ثبت و ارسال اعلان به نویسنده/ })).toBeTruthy();
  });
});

// v9.0.262 (TD-639, finding B13-14): the dashboard reads daily logs only with `daily_logs.view`, with its own requests
describe('dashboard daily logs (TD-639)', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
  );

  it('sends no request and shows no error without the permission', async () => {
    const { result } = renderHook(() => useDashboardDailyLogs(false), { wrapper });
    await new Promise(r => setTimeout(r, 20));
    expect(fetchJson).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('with the permission reads the latest logs, the mentions and the statistics only', async () => {
    fetchJson.mockImplementation(async (url: string) => (url.includes('/stats') ? { today_hours: 2 } : { data: [log], total: 1 }));
    const { result } = renderHook(() => useDashboardDailyLogs(true), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const urls = fetchJson.mock.calls.map(c => String(c[0])).sort();
    expect(urls).toEqual([
      '/daily-logs/stats',
      '/daily-logs?filter_type=all&page=1&limit=50',
      '/daily-logs?filter_type=mentioned&page=1&limit=30',
    ]);
    expect(result.current.mentionedLogs).toHaveLength(1);
  });
});

// v9.0.263 (TD-645, finding B13-20): `/daily-logs?id=N` opens that log; the widget links to it
describe('daily log link (TD-645)', () => {
  function Focus() {
    const { focusedLog, closeFocusedLog } = useDailyLogFocus();
    const location = useLocation();
    return (
      <>
        <span data-testid="search">{location.search}</span>
        <DailyLogDetailModal log={focusedLog} onClose={closeFocusedLog} />
      </>
    );
  }

  it('opens the log of ?id= and removes the id on close', async () => {
    fetchJson.mockResolvedValue(log);
    render(<MemoryRouter initialEntries={['/daily-logs?id=5']}><Focus /></MemoryRouter>);
    await screen.findByRole('dialog', { name: 'گزارش نمونه' });
    expect(fetchJson.mock.calls[0][0]).toBe('/daily-logs/5');
    fireEvent.click(screen.getByRole('button', { name: 'بستن' }));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''));
  });

  it('a log the user may not read shows a Persian message and clears the id', async () => {
    fetchJson.mockRejectedValue(new Error('404'));
    render(<MemoryRouter initialEntries={['/daily-logs?id=9']}><Focus /></MemoryRouter>);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(DAILY_LOG_NOT_FOUND_MESSAGE));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a widget card links to its own log', async () => {
    const me = { id: 7, username: 'ali', full_name: 'علی' } as unknown as User;
    function Where() { return <span data-testid="where">{useLocation().pathname + useLocation().search}</span>; }
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<DailyLogsMentionsWidget user={me} logs={[log]} />} />
          <Route path="/daily-logs" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('کار روز'));
    expect((await screen.findByTestId('where')).textContent).toBe('/daily-logs?id=5');
  });
});
