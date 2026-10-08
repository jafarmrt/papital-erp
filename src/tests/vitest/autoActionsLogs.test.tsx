/**
 * v9.0.383 (TD-721, B15-19 / FE-01, FE-02): the «اقدام‌های خودکار» tab reads the action log page and the engine stats with
 * the server's contract (`src/lib/events/actionLogContract.ts`). The hook read `res.logs` while the server sends `data`, the
 * rows read `durationMs` / `requestPayloadJson` instead of `executionDurationMs` / `result`, and the cards read `totalLogs` /
 * `avgDurationMs` instead of `logsTotal` / `avgLatencyMs`: with 7 executions at 120 ms the cards showed 0 and 0 and the list
 * said no log exists.
 */
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { useActionLogsQuery } from '../../hooks/queries/useEventQueries';
import { AutoActionsSubTab } from '../../components/settings/AutoActionsSubTab';

vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); });

const serverLog = {
  id: 1, ruleId: 1, ruleName: 'وب‌هوک فاکتور', eventId: 'evt-1', eventType: 'InvoiceApproved', actionType: 'webhook',
  status: 'success', result: { statusCode: 200, deliveredTo: 'partner' }, errorMessage: '', executionDurationMs: 120,
  executedAt: '2026-10-06 10:00:00',
};

function mockServer() {
  vi.mocked(fetchJson).mockImplementation(async (url: string) => {
    if (url.startsWith('/events/action-logs')) return { success: true, data: [serverLog], total: 7, limit: 50, offset: 0 };
    if (url.startsWith('/events/action-rules/stats')) {
      return { success: true, stats: { totalRules: 3, activeRules: 2, totalExecutions: 7, logsTotal: 7, successCount: 6, failedCount: 1, successRate: 86, avgLatencyMs: 120 } };
    }
    if (url.startsWith('/events/action-rules')) return { success: true, data: [] };
    throw new Error(`unexpected ${url}`);
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('TD-721 action logs and stats follow the server contract', () => {
  it('the hook returns the server rows and the total', async () => {
    mockServer();
    const { result } = renderHook(() => useActionLogsQuery(50, { refetchInterval: false }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(7);
    expect(result.current.data?.logs.map(l => l.id)).toEqual([1]);
  });

  it('the cards show the executions, the success rate and the average latency in Persian digits', async () => {
    mockServer();
    render(<AutoActionsSubTab />, { wrapper });
    const card = (label: string) => screen.getByText(label).parentElement as HTMLElement;
    await waitFor(() => expect(card('مجموع اجراهای خودکار').textContent).toContain('۷'));
    expect(card('میانگین تأخیر پاسخ').textContent).toContain('۱۲۰');
    expect(card('نرخ موفقیت عملیات').textContent).toContain('۸۶٪');
  });

  it('the logs view lists the execution with its rule, event, status, duration and result', async () => {
    mockServer();
    render(<AutoActionsSubTab />, { wrapper });
    const logsTab = await screen.findByText(/لاگ‌های اجرا/);
    await waitFor(() => expect(logsTab.textContent).toContain('(۷)'));
    fireEvent.click(logsTab);
    expect(screen.queryByText(/هنوز هیچ لاگ اجرایی/)).toBeNull();
    const row = await screen.findByText(/وب‌هوک فاکتور/);
    expect(row.textContent).not.toContain('InvoiceApproved');
    const body = document.body.textContent ?? '';
    expect(body).toContain('۱۲۰ میلی‌ثانیه');
    expect(body).toContain('موفق');
    fireEvent.click(row);
    await waitFor(() => expect(document.body.textContent).toContain('deliveredTo'));
  });
});
