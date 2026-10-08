/**
 * v9.0.419 (TD-730 rest, B15-28 / FE-12): the dead-letter and webhook tabs show the server's own reason when a request is
 * refused (a 409 of a dead letter already being replayed, a 403, a 400 of a webhook delete) and a payload edit names a JSON
 * format error only when the text does not parse. On v9.0.418 these catches showed fixed texts («خطای شبکه در بازپخش
 * دسته‌ای», «خطا در حذف وب‌هوک») and a server refusal of a payload edit was shown as «فرمت JSON وارد شده نامعتبر است».
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ApiError, fetchJson } from '../../api';
import { DeadLetterQueueSubTab } from '../../components/settings/DeadLetterQueueSubTab';
import { WebhookManagementSubTab } from '../../components/settings/WebhookManagementSubTab';

vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => key === 'events.manage' }));
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); });

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

/** Every GET answers the fixture; every write is refused with `refusal`. */
function mockServer(refusal: ApiError) {
  vi.mocked(fetchJson).mockImplementation(async (url: string, opts?: RequestInit) => {
    if ((opts?.method || 'GET') !== 'GET') throw refusal;
    if (url.startsWith('/events/dlq/stats')) return { success: true, stats: { total: 1, quarantined: 1, replayed: 0, dismissed: 0, byEventType: {}, bySource: {} } };
    if (url.startsWith('/events/dlq')) return { success: true, data: [deadLetter] };
    if (url === '/events/webhooks/stats') return { success: true, stats: null };
    if (url === '/events/webhooks') return { success: true, data: [subscription] };
    return { success: true, data: [] };
  });
}

describe('TD-730 the event tabs show the server reason of a refused request', () => {
  it('a refused batch replay shows the server reason', async () => {
    const reason = 'این رویداد هم‌اکنون در حال بازپخش است.';
    mockServer(new ApiError(reason, 'DLQ_REPLAY_IN_PROGRESS', 409));
    const { container } = render(<DeadLetterQueueSubTab />);
    await screen.findByText('timeout');
    fireEvent.click(container.querySelector('thead button') as HTMLButtonElement);
    fireEvent.click(screen.getByText('بازپخش ۱ مورد'));
    expect(await screen.findByText(reason)).toBeTruthy();
  });

  it('a refused payload edit shows the server reason, not a JSON format error', async () => {
    const reason = 'برای اصلاح بدنه رویداد مجوز مدیریت رویدادها لازم است.';
    mockServer(new ApiError(reason, 'AUTHORIZATION_ERROR', 403));
    render(<DeadLetterQueueSubTab />);
    fireEvent.click(await screen.findByTitle('اصلاح داده و بازپخش'));
    fireEvent.click(screen.getByText('صرفاً ذخیره تغییرات'));
    expect(await screen.findByText(reason)).toBeTruthy();
    expect(screen.queryByText(/قالب JSON/)).toBeNull();
  });

  it('a payload that does not parse is still named a JSON format error and is not sent', async () => {
    mockServer(new ApiError('unexpected', 'INTERNAL_ERROR', 500));
    render(<DeadLetterQueueSubTab />);
    fireEvent.click(await screen.findByTitle('اصلاح داده و بازپخش'));
    fireEvent.change(screen.getByDisplayValue(/documentId/), { target: { value: '{ broken' } });
    fireEvent.click(screen.getByText('صرفاً ذخیره تغییرات'));
    expect(await screen.findByText(/قالب JSON داده رویداد نامعتبر است/)).toBeTruthy();
    expect(vi.mocked(fetchJson).mock.calls.some(([, opts]) => (opts?.method || 'GET') !== 'GET')).toBe(false);
  });

  it('a refused webhook delete shows the server reason', async () => {
    const reason = 'این وب‌هوک تحویل در جریان دارد و حذف نمی‌شود.';
    mockServer(new ApiError(reason, 'VALIDATION_ERROR', 400));
    render(<WebhookManagementSubTab />);
    fireEvent.click(await screen.findByTitle('حذف درگاه'));
    expect(await screen.findByText(reason)).toBeTruthy();
  });
});
