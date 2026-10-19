/**
 * v10.2 package 11 (OBS-R2-86, TD-1323): the event screens read their long lists one page at a time. The outbox asked
 * for its newest 100 rows and searched only those in the browser, the rule execution log showed its newest 50 rows and
 * the dead letters their newest 100, each without a way to the older rows. Now each list asks the server for one page of
 * 50, shows the pager with the total and moves to the next page; the outbox search and every filter go to the server
 * and start again from page 1.
 */
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { DomainEventsTab } from '../../components/settings/DomainEventsTab';
import { AutoActionsSubTab } from '../../components/settings/AutoActionsSubTab';
import { DeadLetterQueueSubTab } from '../../components/settings/DeadLetterQueueSubTab';

vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => true }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); });

const OUTBOX_TAB = 'صف ارسال رویداد';
const LOGS_VIEW = /گزارش اجرا/;
const NEXT_PAGE = 'صفحه بعد';
const PAGE_ONE_OF_THREE = 'صفحه ۱ از ۳';
const PAGE_TWO_OF_THREE = 'صفحه ۲ از ۳';
const OUTBOX_SEARCH_PLACEHOLDER = 'جست‌وجو در شناسه رویداد، نوع یا خطا…';
const SEARCH_TEXT = 'فاکتور';
const DLQ_SEARCH_PLACEHOLDER = 'جست‌وجو در شناسه، نوع رویداد یا متن خطا…';
const LIVE_TAB = 'گذرگاه رویدادهای زنده';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const urls = () => vi.mocked(fetchJson).mock.calls.map(c => String(c[0]));
const query = (url: string) => new URLSearchParams(url.split('?')[1] ?? '');

const outboxRow = (id: number) => ({
  id, eventId: `evt-${id}`, eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: String(id),
  status: 'completed', payload: {}, metadata: {}, retryCount: 0, occurredAt: '2026-10-18 10:00:00',
});
const logRow = (id: number) => ({
  id, ruleId: 1, ruleName: 'rule', eventId: `evt-${id}`, eventType: 'InvoiceApproved', actionType: 'audit_log',
  status: 'success', result: {}, errorMessage: '', executionDurationMs: 5, executedAt: '2026-10-18 10:00:00',
});
const dlqRow = (id: number) => ({
  id, originalEventId: `evt-${id}`, eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: String(id),
  source: 'outbox', payload: {}, metadata: {}, failureReason: 'timeout', errorStack: '', retryCount: 5,
  status: 'quarantined', quarantinedAt: '2026-10-18 10:00:00',
});
const pageOf = <T,>(url: string, make: (id: number) => T) => {
  const page = Number(query(url).get('page') ?? 1);
  return Array.from({ length: 2 }, (_, i) => make(page * 100 + i));
};

function mockServer() {
  vi.mocked(fetchJson).mockImplementation(async (url: string) => {
    if (url.startsWith('/events/outbox/stats')) return { success: true, stats: { total: 120, pending: 0, processing: 0, completed: 120, failed: 0 } };
    if (url.startsWith('/events/outbox')) return { success: true, events: pageOf(url, outboxRow), total: 120 };
    if (url.startsWith('/events/action-logs')) return { success: true, data: pageOf(url, logRow), total: 120, limit: 50, offset: 0 };
    if (url.startsWith('/events/action-rules/stats')) return { success: true, stats: { totalRules: 0, activeRules: 0, totalExecutions: 120, logsTotal: 120, successCount: 120, failedCount: 0, successRate: 100, avgLatencyMs: 5 } };
    if (url.startsWith('/events/dlq/stats')) return { success: true, stats: { total: 120, quarantined: 120, replayed: 0, dismissed: 0, byEventType: {}, bySource: {} } };
    if (url.startsWith('/events/dlq')) return { success: true, data: pageOf(url, dlqRow), total: 120 };
    return { success: true, data: [], events: [], total: 0 };
  });
}

describe('TD-1323 the event lists are read one page at a time', () => {
  it('the outbox asks one page of 50, shows the pager and searches on the server from page 1', async () => {
    mockServer();
    render(<DomainEventsTab />, { wrapper });
    fireEvent.click(screen.getByText(OUTBOX_TAB));
    await screen.findByText(PAGE_ONE_OF_THREE);
    const first = urls().find(u => u.startsWith('/events/outbox?'));
    expect(query(first ?? '').get('page')).toBe('1');
    expect(query(first ?? '').get('limit')).toBe('50');

    fireEvent.click(screen.getByLabelText(NEXT_PAGE));
    await screen.findByText(PAGE_TWO_OF_THREE);
    expect(urls().some(u => u.startsWith('/events/outbox?') && query(u).get('page') === '2')).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(OUTBOX_SEARCH_PLACEHOLDER), { target: { value: SEARCH_TEXT } });
    await waitFor(() => expect(urls().some(u => u.startsWith('/events/outbox?') && query(u).get('search') === SEARCH_TEXT)).toBe(true));
    const searched = urls().filter(u => u.startsWith('/events/outbox?') && query(u).get('search') === SEARCH_TEXT);
    expect(searched.every(u => query(u).get('page') === '1')).toBe(true);
  });

  it('the live bus tab reads the whole in-memory buffer of 200 events, not its newest 100', async () => {
    mockServer();
    render(<DomainEventsTab />, { wrapper });
    fireEvent.click(screen.getByText(LIVE_TAB));
    await waitFor(() => expect(urls().some(u => u.startsWith('/events/domain-events?'))).toBe(true));
    const live = urls().find(u => u.startsWith('/events/domain-events?')) ?? '';
    expect(query(live).get('limit')).toBe('200');
  });

  it('the rule execution log moves to its next page', async () => {
    mockServer();
    render(<AutoActionsSubTab />, { wrapper });
    fireEvent.click(await screen.findByText(LOGS_VIEW));
    await screen.findByText(PAGE_ONE_OF_THREE);
    fireEvent.click(screen.getByLabelText(NEXT_PAGE));
    await screen.findByText(PAGE_TWO_OF_THREE);
    const logUrls = urls().filter(u => u.startsWith('/events/action-logs'));
    expect(logUrls.some(u => query(u).get('page') === '2' && query(u).get('limit') === '50')).toBe(true);
  });

  it('the dead letters ask one page of 50 and a new search starts again from page 1', async () => {
    mockServer();
    render(<DeadLetterQueueSubTab />);
    await screen.findByText(PAGE_ONE_OF_THREE);
    const first = urls().find(u => u.startsWith('/events/dlq?'));
    expect(query(first ?? '').get('page')).toBe('1');
    expect(query(first ?? '').get('limit')).toBe('50');

    fireEvent.click(screen.getByLabelText(NEXT_PAGE));
    await screen.findByText(PAGE_TWO_OF_THREE);
    expect(urls().some(u => u.startsWith('/events/dlq?') && query(u).get('page') === '2')).toBe(true);

    const input = screen.getByPlaceholderText(DLQ_SEARCH_PLACEHOLDER);
    fireEvent.change(input, { target: { value: SEARCH_TEXT } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    await waitFor(() => expect(urls().some(u => u.startsWith('/events/dlq?') && query(u).get('search') === SEARCH_TEXT && query(u).get('page') === '1')).toBe(true));
  });
});
