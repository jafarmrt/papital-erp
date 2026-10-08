/**
 * v9.0.415 (TD-722, B15-20 / FE-03): the events page opens with the permission of its route and API (`events.view`) and
 * shows a change button only to holders of `events.manage`, the key every change route of `/events` asks. On v9.0.414 the
 * page was guarded by the role codes admin / manager: a holder of events.view with another role saw the menu entry and the
 * route and then got «عدم دسترسی», and no button was hidden by events.manage.
 */
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import DomainEventsPage from '../../pages/DomainEventsPage';

let granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => granted.has(key) }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); granted = new Set(); });

const rule = {
  id: 3, name: 'اعلان فاکتور', description: '', eventType: 'InvoiceApproved', conditionsJson: [], actionType: 'in_app_notification',
  actionConfigJson: {}, isActive: 1, executionCount: 0, createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T10:00:00Z',
};
const failedOutbox = {
  id: 1, eventId: 'evt-1', eventType: 'InvoiceApproved', aggregateType: 'document', aggregateId: '1', status: 'failed',
  payload: {}, metadata: {}, retryCount: 5, lastError: 'timeout', occurredAt: '2026-10-06T10:00:00Z',
};
const deadLetter = {
  id: 9, originalEventId: 'evt-9', eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: '9', source: 'outbox',
  payload: { documentId: 9 }, metadata: {}, failureReason: 'timeout', errorStack: '', retryCount: 5, status: 'quarantined',
  quarantinedAt: '2026-10-06T10:00:00Z',
};
const subscription = {
  id: 7, name: 'فروشگاه شریک', targetUrl: 'https://partner.example.com/hook', secretKey: '********', eventPatterns: ['*'],
  customHeaders: {}, isActive: 1, retryLimit: 3, timeoutMs: 5000, totalDeliveries: 0, successfulDeliveries: 0, failedDeliveries: 0,
  createdAt: '2026-10-01T10:00:00Z',
};

function mockServer() {
  vi.mocked(fetchJson).mockImplementation(async (url: string, opts?: RequestInit) => {
    if ((opts?.method || 'GET') !== 'GET') throw new Error(`unexpected write ${url}`);
    if (url.startsWith('/events/action-rules/stats')) return { success: true, stats: null };
    if (url.startsWith('/events/action-logs')) return { success: true, data: [], total: 0 };
    if (url.startsWith('/events/action-rules')) return { success: true, data: [rule] };
    if (url.startsWith('/events/outbox/stats')) {
      return { success: true, stats: { total: 1, pending: 0, processing: 0, completed: 0, failed: 1, workerRunning: true } };
    }
    if (url.startsWith('/events/outbox')) return { success: true, events: [failedOutbox] };
    if (url.startsWith('/events/dlq/stats')) {
      return { success: true, stats: { total: 1, quarantined: 1, replayed: 0, dismissed: 0, byEventType: {}, bySource: {} } };
    }
    if (url.startsWith('/events/dlq')) return { success: true, data: [deadLetter] };
    if (url.startsWith('/events/event-sourcing/types')) return { success: true, types: [{ type: 'document', title: 'سند', description: '', icon: '' }] };
    if (url.startsWith('/events/event-sourcing/aggregates')) return { success: true, data: [{ id: '42', title: 'سند ۴۲' }] };
    if (url.startsWith('/events/event-sourcing/timeline')) {
      return {
        success: true, auditIncluded: true,
        timeline: [{ id: 'o1', eventId: 'evt-1', eventType: 'InvoiceApproved', occurredAt: '2026-10-06T10:00:00Z', source: 'outbox', actor: 'admin', title: 'رویداد', description: '', status: 'completed', payload: {}, metadata: {} }],
      };
    }
    if (url.startsWith('/events/webhooks/stats')) return { success: true, stats: null };
    if (url.startsWith('/events/webhooks/deliveries')) return { success: true, data: [] };
    if (url.startsWith('/events/webhooks')) return { success: true, data: [subscription] };
    if (url.startsWith('/events/domain-events')) return { success: true, events: [], stats: null };
    return { success: true, data: [] };
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(<DomainEventsPage />, { wrapper });
}

/** The change buttons of every sub-tab, each found by its own text or title once the tab has loaded. */
async function changeButtonsShown(): Promise<string[]> {
  const shown: string[] = [];
  const check = (label: string, present: boolean) => { if (present) shown.push(label); };

  await screen.findByText('اعلان فاکتور');
  check('add rule', !!screen.queryByText('افزودن قانون خودکار'));
  check('toggle rule', !!screen.queryByTitle('غیرفعال‌سازی'));
  check('test rule', !!screen.queryByText('آزمایش'));
  check('edit rule', !!screen.queryByTitle('ویرایش قانون'));
  check('delete rule', !!screen.queryByTitle('حذف قانون'));

  fireEvent.click(screen.getByText('صف ارسال رویداد'));
  await screen.findByText('evt-1', { exact: false });
  check('process outbox', !!screen.queryByText('پردازش دستی دسته'));
  check('retry all failed', !!screen.queryByText(/تلاش مجدد تمام خطاهای ارسال/));
  check('retry one', !!screen.queryByText('تلاش مجدد'));

  fireEvent.click(screen.getByText('صف خطا'));
  await screen.findByText('timeout');
  check('purge dead letters', !!screen.queryByText('پاکسازی حل‌شده‌ها'));
  check('replay dead letter', !!screen.queryByTitle('بازپخش فوری رویداد'));
  check('edit dead letter', !!screen.queryByTitle('اصلاح داده و بازپخش'));
  check('dismiss dead letter', !!screen.queryByTitle('صرف‌نظر و نادیده‌گرفتن'));

  fireEvent.click(screen.getByText('خط زمان و بازپخش رویدادها'));
  await screen.findByText('توسط: admin');
  check('simulate replay', !!screen.queryByTitle('شبیه‌سازی و بازپخش رویداد'));

  fireEvent.click(screen.getByText('اشتراک‌ها و وب‌هوک‌ها'));
  await screen.findByText('فروشگاه شریک');
  check('add webhook', !!screen.queryByText('تعریف وب‌هوک جدید'));
  check('toggle webhook', !(screen.getByText('فعال').closest('button') as HTMLButtonElement).disabled);
  check('ping webhook', !!screen.queryByText('آزمایش اتصال و امضا'));
  check('edit webhook', !!screen.queryByTitle('ویرایش تنظیمات'));
  check('delete webhook', !!screen.queryByTitle('حذف درگاه'));
  check('rotate webhook key', !!screen.queryByText('ساخت کلید تازه'));

  fireEvent.click(screen.getByText('گذرگاه رویدادهای زنده'));
  await waitFor(() => expect(vi.mocked(fetchJson).mock.calls.some(([url]) => String(url).startsWith('/events/domain-events'))).toBe(true));
  check('simulate event', !!screen.queryByText('شبیه‌سازی بی‌اثر'));
  return shown;
}

const ALL_CHANGE_BUTTONS = [
  'add rule', 'toggle rule', 'test rule', 'edit rule', 'delete rule',
  'process outbox', 'retry all failed', 'retry one',
  'purge dead letters', 'replay dead letter', 'edit dead letter', 'dismiss dead letter',
  'simulate replay',
  'add webhook', 'toggle webhook', 'ping webhook', 'edit webhook', 'delete webhook', 'rotate webhook key',
  'simulate event',
];

describe('TD-722 the events page follows events.view and events.manage, never a role code', () => {
  it('a holder of events.view alone opens the page and sees every list but no change button', async () => {
    granted = new Set(['events.view']);
    mockServer();
    renderPage();
    expect(screen.queryByText(/عدم دسترسی/)).toBeNull();
    expect(await changeButtonsShown()).toEqual([]);
  });

  it('a holder of events.manage sees every change button', async () => {
    granted = new Set(['events.view', 'events.manage']);
    mockServer();
    renderPage();
    expect(await changeButtonsShown()).toEqual(ALL_CHANGE_BUTTONS);
  });
});
