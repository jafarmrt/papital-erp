import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { fetchJsonMock, confirmMock } = vi.hoisted(() => ({ fetchJsonMock: vi.fn(), confirmMock: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() }, default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../api', async (orig) => ({ ...(await orig<typeof import('../../api')>()), fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: (...a: unknown[]) => confirmMock(...a) }));

import SystemHealthDiagnostic from '../../components/SystemHealthDiagnostic';

// v9.0.391 (TD-623, B01-43, decision t8): replaying the failed events (third-party webhooks, notifications, workflows)
// asks first and the queue buttons appear only when there is something to replay. On v9.0.390 one click on
// «بازیابی صف DLQ» posted at once, and both buttons showed with an empty queue.

afterEach(() => { cleanup(); fetchJsonMock.mockReset(); confirmMock.mockReset(); });

const baseHealth = {
  database: { status: 'ok', latencyMs: 12, message: 'متصل' },
  storage: { status: 'ok', writable: true, message: 'قابل نوشتن', locations: [] },
  accounting: { totalVouchers: 10, unbalancedVouchers: 0, status: 'ok' },
  workflow: { activeInstances: 0, overdueSlaTasks: 0, status: 'ok' },
  network: { isHttps: true, protocol: 'https', forwardedProto: 'https', host: 'erp.example' },
  server: { nodeVersion: 'v22.22.0', platform: 'linux', uptimeSeconds: 60, memoryUsageMb: { heapUsed: 120, heapTotal: 256, rss: 300 } },
  checkTimestamp: '2026-10-08T10:00:00.000Z',
};

function renderWith(outbox: Record<string, unknown>) {
  fetchJsonMock.mockImplementation((url: string, opts?: { method?: string }) => {
    if (url === '/system/health') return Promise.resolve({ ...baseHealth, outbox });
    if (url === '/system/reconciliation-check') {
      return Promise.resolve({ healthScorePercentage: 100, totalChecks: 1, okChecks: 1, timestamp: '2026-10-08T10:00:00.000Z', checks: [] });
    }
    if (url === '/system/reconciliation-fix' && opts?.method === 'POST') return Promise.resolve({ success: true, message: 'انجام شد' });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  return render(<SystemHealthDiagnostic />);
}

const posts = () => fetchJsonMock.mock.calls.filter(c => (c[1] as { method?: string } | undefined)?.method === 'POST');

describe('event queue buttons (TD-623)', () => {
  it('asks before replaying the failed events and sends nothing when the answer is no', async () => {
    confirmMock.mockResolvedValue(false);
    renderWith({ pendingCount: 0, dlqCount: 3, stuckCount: 0, status: 'warning' });
    fireEvent.click(await screen.findByText('اجرای دوباره رویدادهای ناموفق'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    const [options] = confirmMock.mock.calls[0] as [{ message: string; confirmText: string; cancelText: string }];
    expect(options.message).toContain('۳ رویداد ناموفق دوباره اجرا شوند؟');
    expect(options.confirmText).toBe('اجرای دوباره');
    expect(options.cancelText).toBe('انصراف');
    await new Promise(r => setTimeout(r, 20));
    expect(posts()).toEqual([]);
    expect(screen.queryByText('اجرای دوباره رویدادهای مانده در صف ارسال')).toBeNull();
  });

  it('replays only after the answer is yes', async () => {
    confirmMock.mockResolvedValue(true);
    renderWith({ pendingCount: 0, dlqCount: 0, stuckCount: 2, status: 'warning' });
    fireEvent.click(await screen.findByText('اجرای دوباره رویدادهای مانده در صف ارسال'));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String((posts()[0][1] as { body: string }).body))).toEqual({ action: 'clear_stuck_outbox' });
    expect((confirmMock.mock.calls[0][0] as { message: string }).message).toContain('۲ رویداد');
  });

  it('shows no queue button when nothing is waiting, nor when the queue could not be read', async () => {
    const queueButton = /اجرای دوباره|بازیابی صف|بازنشانی/;
    renderWith({ pendingCount: 4, dlqCount: 0, stuckCount: 0, status: 'ok' });
    await screen.findByText(/شاخص سلامت/);
    expect(screen.queryByRole('button', { name: queueButton })).toBeNull();
    cleanup();
    renderWith({ pendingCount: null, dlqCount: null, stuckCount: null, status: 'unknown' });
    await screen.findByText(/شاخص سلامت/);
    expect(screen.queryByRole('button', { name: queueButton })).toBeNull();
  });
});
