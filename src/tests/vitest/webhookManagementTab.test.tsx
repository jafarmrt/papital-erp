/**
 * Package 15 PR b (webhook management tab, `src/components/settings/WebhookManagementSubTab.tsx`).
 * TD-719 (B15-17): the edit form took the masked key from GET and every save sent it back; «test ping» signed with it.
 * TD-720 (B15-18): the create form made the signing key with `Math.random` (so the server's CSPRNG key never ran).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fetchJson } from '../../api';
import { WebhookManagementSubTab } from '../../components/settings/WebhookManagementSubTab';

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); });

const maskedKey = '**********************abcd';
const subscription = {
  id: 7, name: 'فروشگاه شریک', targetUrl: 'https://partner.example.com/hook', secretKey: maskedKey, eventPatterns: ['*'],
  customHeaders: {}, isActive: 1, retryLimit: 3, timeoutMs: 5000, totalDeliveries: 0, successfulDeliveries: 0, failedDeliveries: 0,
  createdAt: '2026-10-01T10:00:00Z',
};

function mockServer() {
  const writes: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  vi.mocked(fetchJson).mockImplementation(async (url: string, opts?: RequestInit) => {
    const method = opts?.method || 'GET';
    if (method !== 'GET') {
      writes.push({ url, method, body: opts?.body ? JSON.parse(String(opts.body)) : {} });
      return { success: true, statusCode: 200, durationMs: 5 };
    }
    if (url === '/events/webhooks') return { success: true, data: [subscription] };
    if (url === '/events/webhooks/stats') return { success: true, stats: null };
    return { success: true, data: [] };
  });
  return writes;
}

describe('TD-719 webhook edit and ping never use the masked key', () => {
  it('saving an edit without typing a key sends no secretKey', async () => {
    const writes = mockServer();
    render(<WebhookManagementSubTab />);
    fireEvent.click(await screen.findByTitle('ویرایش تنظیمات'));
    fireEvent.click(screen.getByText('ذخیره تغییرات درگاه'));
    await waitFor(() => expect(writes.some(w => w.method === 'PUT')).toBe(true));
    const put = writes.find(w => w.method === 'PUT');
    expect(put?.url).toBe('/events/webhooks/7');
    expect(put?.body).not.toHaveProperty('secretKey');
    expect(JSON.stringify(put?.body)).not.toContain('****');
  });

  it('the row ping sends only the webhook id, so the server signs with the stored key', async () => {
    const writes = mockServer();
    render(<WebhookManagementSubTab />);
    fireEvent.click(await screen.findByText('تست پینگ و امضا'));
    await waitFor(() => expect(writes.some(w => w.url === '/events/webhooks/ping')).toBe(true));
    expect(writes.find(w => w.url === '/events/webhooks/ping')?.body).toEqual({ subscriptionId: 7 });
  });
});

describe('TD-720 the create form leaves the signing key to the server', () => {
  it('a new webhook is sent without a key and with the entered timeout, and Math.random is never called', async () => {
    const writes = mockServer();
    const random = vi.spyOn(Math, 'random');
    render(<WebhookManagementSubTab />);
    fireEvent.click(await screen.findByText('تعریف وب‌هوک جدید'));
    fireEvent.change(screen.getByPlaceholderText('مثال: فروشگاه آنلاین ووکامرس'), { target: { value: 'شریک تازه' } });
    fireEvent.change(screen.getByPlaceholderText('https://your-domain.com/api/webhook/receiver'), { target: { value: 'https://new.example.com/hook' } });
    fireEvent.change(screen.getByDisplayValue('5000'), { target: { value: '12000' } });
    fireEvent.click(screen.getByText('ایجاد و فعال‌سازی درگاه وب‌هوک'));
    await waitFor(() => expect(writes.some(w => w.method === 'POST' && w.url === '/events/webhooks')).toBe(true));
    const post = writes.find(w => w.method === 'POST' && w.url === '/events/webhooks');
    expect(post?.body).not.toHaveProperty('secretKey');
    expect(post?.body.timeoutMs).toBe(12000);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});
