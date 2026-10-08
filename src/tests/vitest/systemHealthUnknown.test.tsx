import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const fetchJsonMock = vi.fn();
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() }, default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../api', async (orig) => ({ ...(await orig<typeof import('../../api')>()), fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import SystemHealthDiagnostic from '../../components/SystemHealthDiagnostic';
import { SubsystemHealthCards } from '../../components/system/SubsystemHealthCards';
import { SUBSYSTEM_UNKNOWN_MESSAGES } from '../../lib/system/subsystemHealth';

// v9.0.358 (TD-593, B01-13): a subsystem whose own query failed is shown as unknown with the server's message, never
// as healthy; on v9.0.357 a failed outbox query showed «روان» and every voucher «تراز».

afterEach(() => { cleanup(); fetchJsonMock.mockReset(); });

const health = {
  database: { status: 'ok', latencyMs: 12, message: 'متصل' },
  storage: { status: 'ok', writable: true, uploadsPath: '/srv/erp/attachments', message: 'قابل نوشتن' },
  outbox: { pendingCount: null, dlqCount: null, status: 'unknown', message: SUBSYSTEM_UNKNOWN_MESSAGES.outbox },
  accounting: { totalVouchers: 1250, unbalancedVouchers: 1, status: 'error' },
  workflow: { activeInstances: null, overdueSlaTasks: null, status: 'unknown', message: SUBSYSTEM_UNKNOWN_MESSAGES.workflow },
  network: { isHttps: true, protocol: 'https', forwardedProto: 'https', host: 'erp.example' },
  server: { nodeVersion: 'v22.22.0', platform: 'linux', uptimeSeconds: 600, memoryUsageMb: { heapUsed: 120, heapTotal: 256, rss: 300 } },
  checkTimestamp: '2026-10-08T10:00:00.000Z',
};

const cardOf = (title: string) => screen.getByText(title).closest('[data-status]') as HTMLElement | null;

describe('system health unknown subsystems (TD-593)', () => {
  it('shows a failed outbox and workflow query as unknown and the real voucher balance next to them', async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url === '/system/health') return Promise.resolve(health);
      if (url === '/system/reconciliation-check') return Promise.reject(new Error('not needed'));
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    const { container } = render(<SystemHealthDiagnostic />);
    await screen.findByText('صف رویدادها');

    const outbox = cardOf('صف رویدادها');
    expect(outbox?.dataset.status).toBe('unknown');
    expect(outbox?.textContent).toContain(SUBSYSTEM_UNKNOWN_MESSAGES.outbox);
    expect(outbox?.textContent).toContain('نامعلوم');
    expect(container.textContent).not.toContain('روان');

    const workflow = cardOf('گردش کار و مهلت‌ها');
    expect(workflow?.dataset.status).toBe('unknown');
    expect(workflow?.textContent).toContain(SUBSYSTEM_UNKNOWN_MESSAGES.workflow);

    const accounting = cardOf('تراز اسناد حسابداری');
    expect(accounting?.dataset.status).toBe('error');
    expect(accounting?.textContent).toContain('۱ سند ناتراز');
  });

  it('never says every voucher is balanced when the balance could not be read, nor when a subsystem is missing', () => {
    render(<SubsystemHealthCards accounting={{ totalVouchers: null, unbalancedVouchers: null, status: 'unknown' }} />);
    expect(screen.queryByText('همه اسناد فعال تراز هستند.')).toBeNull();
    expect(cardOf('تراز اسناد حسابداری')?.textContent).toContain(SUBSYSTEM_UNKNOWN_MESSAGES.accounting);
    expect(cardOf('صف رویدادها')?.dataset.status).toBe('unknown');
    expect(cardOf('گردش کار و مهلت‌ها')?.dataset.status).toBe('unknown');
  });

  it('shows healthy subsystems with their counts in Persian digits', () => {
    render(<SubsystemHealthCards
      outbox={{ pendingCount: 12, dlqCount: 0, status: 'ok' }}
      accounting={{ totalVouchers: 1250, unbalancedVouchers: 0, status: 'ok' }}
      workflow={{ activeInstances: 4, overdueSlaTasks: 2, status: 'warning' }}
    />);
    expect(cardOf('صف رویدادها')?.textContent).toContain('روان');
    expect(cardOf('صف رویدادها')?.textContent).toContain('۱۲');
    expect(screen.getByText('همه اسناد فعال تراز هستند.')).toBeTruthy();
    expect(cardOf('گردش کار و مهلت‌ها')?.textContent).toContain('۲ کار');
  });
});
