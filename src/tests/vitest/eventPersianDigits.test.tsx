/**
 * v9.0.442 (TD-732, B15-30 / FE-17): the events, webhook, dead-letter and notification screens write numbers in Persian
 * digits, a percent as «۸۶٪» and a duration in «میلی‌ثانیه». On v9.0.441 they showed «بازپخش 1 مورد», «تلاش 3/۵»
 * (two digit scripts in one label), «%۸۶», «120ms», «200» and «3 خوانده‌نشده».
 */
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { DeadLetterQueueSubTab } from '../../components/settings/DeadLetterQueueSubTab';
import { DomainEventsTab } from '../../components/settings/DomainEventsTab';
import { WebhookManagementSubTab } from '../../components/settings/WebhookManagementSubTab';
import NotificationBell from '../../components/NotificationBell';

vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => key === 'events.manage' }));
vi.mock('../../components/settings/AutoActionsSubTab', () => ({ AutoActionsSubTab: () => <div /> }));
vi.mock('../../hooks/queries', () => ({
  useUnreadNotificationsCountQuery: () => ({ data: 3 }),
  useNotificationsQuery: () => ({ data: [], isLoading: false }),
  useMarkNotificationReadMutation: () => ({ mutate: vi.fn() }),
  useMarkAllNotificationsReadMutation: () => ({ mutate: vi.fn() }),
  useDeleteNotificationMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); });

const LATIN_DIGIT = /[0-9]/;

const deadLetter = {
  id: 9, originalEventId: 'evt-a', eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: 'x', source: 'outbox',
  payload: { documentId: 9 }, metadata: {}, failureReason: 'timeout', errorStack: '', retryCount: 5, status: 'quarantined',
  quarantinedAt: '2026-10-06T10:00:00Z',
};
const failedOutbox = {
  id: 12, eventId: 'evt-b', eventType: 'InvoiceApproved', aggregateType: 'document', aggregateId: 'x', status: 'failed',
  payload: {}, metadata: {}, retryCount: 3, lastError: 'timeout', occurredAt: '2026-10-06T10:00:00Z',
};
const subscription = {
  id: 7, name: 'فروشگاه شریک', targetUrl: 'https://partner.example.com/hook', secretKey: '********', eventPatterns: ['*'],
  customHeaders: {}, isActive: 1, retryLimit: 3, timeoutMs: 5000, totalDeliveries: 12, successfulDeliveries: 10, failedDeliveries: 2,
  createdAt: '2026-10-01T10:00:00Z',
};
const delivery = {
  id: 4, subscriptionId: 7, subscriptionName: 'فروشگاه شریک', eventId: 'evt-c', eventType: 'InvoiceApproved',
  targetUrl: 'https://partner.example.com/hook', statusCode: 200, status: 'success', signature: '', attempt: 1, durationMs: 120,
  createdAt: '2026-10-06T10:00:00Z',
};

function mockServer() {
  vi.mocked(fetchJson).mockImplementation(async (url: string) => {
    if (url.startsWith('/events/dlq/stats')) return { success: true, stats: { total: 1, quarantined: 1, replayed: 0, dismissed: 0, byEventType: {}, bySource: {} } };
    if (url.startsWith('/events/dlq')) return { success: true, data: [deadLetter] };
    if (url.startsWith('/events/outbox/stats')) {
      return { success: true, stats: { total: 1, pending: 0, processing: 0, completed: 0, failed: 1, workerRunning: true } };
    }
    if (url.startsWith('/events/outbox')) return { success: true, events: [failedOutbox] };
    if (url === '/events/webhooks/stats') {
      return { success: true, stats: { totalSubscriptions: 1, activeSubscriptions: 1, totalDeliveries: 12, successfulDeliveries: 10, failedDeliveries: 2, successRate: 86 } };
    }
    if (url.startsWith('/events/webhooks/deliveries')) return { success: true, data: [delivery] };
    if (url === '/events/webhooks') return { success: true, data: [subscription] };
    if (url.startsWith('/events/domain-events')) return { success: true, events: [], stats: null };
    return { success: true, data: [] };
  });
}

function withQueryClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('TD-732 numbers in the events screens use Persian digits', () => {
  it('the dead-letter tab counts attempts and selected rows in Persian digits', async () => {
    mockServer();
    const { container } = render(<DeadLetterQueueSubTab />);
    await screen.findByText('timeout');
    expect(screen.getByText('تعداد تلاش: ۵ بار')).toBeTruthy();
    fireEvent.click(container.querySelector('thead button') as HTMLButtonElement);
    expect(screen.getByText('بازپخش ۱ مورد')).toBeTruthy();
  });

  it('the outbox list writes «attempt N of 5» in one digit script', async () => {
    mockServer();
    render(withQueryClient(<DomainEventsTab />));
    fireEvent.click(screen.getByText('صف ارسال رویداد'));
    expect(await screen.findByText('تلاش ۳ از ۵')).toBeTruthy();
    expect(screen.getByText(/تلاش مجدد تمام خطاهای ارسال \(۱\)/)).toBeTruthy();
    expect(screen.queryByText(/#12/)).toBeNull();
  });

  it('the webhook tab shows the success rate with the Persian percent sign and a delivery in Persian digits and milliseconds', async () => {
    mockServer();
    const { container } = render(<WebhookManagementSubTab />);
    await screen.findAllByText('فروشگاه شریک');
    await screen.findByText('۱۲۰ میلی‌ثانیه');
    expect(screen.getByText('۸۶٪')).toBeTruthy();
    expect(screen.getByText('۲۰۰')).toBeTruthy();
    expect(screen.getByText(/\(۱۲\)/)).toBeTruthy();
    // an address and the signature algorithm's standard name (HMAC-SHA256) are not numbers
    const visible = (container.textContent || '').replace('https://partner.example.com/hook', '').replace(/(HMAC-)?SHA-?256/g, '');
    expect(visible.match(LATIN_DIGIT)).toBeNull();
  });

  it('the notification bell counts unread notifications in Persian digits', () => {
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    expect(screen.getByText('۳')).toBeTruthy();
    fireEvent.click(screen.getByTitle('اعلان‌ها و اشاره‌ها'));
    expect(screen.getByText('۳ خوانده‌نشده')).toBeTruthy();
  });
});
