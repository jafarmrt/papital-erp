/**
 * 10.2 package 6 (D-04 part B): the automatic stock push of the WooCommerce tab (`WcAutoPushPanel`) and its shared rules
 * (`src/lib/woocommerce/wcAutoPush.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { fetchJson } from '../../api';
import { confirmAction } from '../../components/ConfirmDialogHost';
import { WcAutoPushPanel } from '../../components/settings/WcAutoPushPanel';
import {
  AUTO_PUSH_ENABLE_CONFIRM, autoPushBackoffMinutes, BULK_PUSH_OPEN_ORDERS_NOTE, isAutoPushOn, orderReadBudgetMs, WC_AUTO_MAX_BACKOFF_MINUTES, type WcAutoPushView,
} from '../../lib/woocommerce/wcAutoPush';

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); vi.mocked(confirmAction).mockReset(); });

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const TURN_ON = 'روشن کردن';
const TURN_OFF = 'خاموش کردن';
const UNTRACKED_ITEM = 'گردنبند بی ردیابی';

const view: WcAutoPushView = {
  enabled: false,
  lastRun: null,
  failedRuns: 0,
  nextAttemptAt: null,
  untracked: [{ itemId: 3, code: 'PR-3', name: UNTRACKED_ITEM }],
  untrackedTotal: 1,
  stopped: [],
  stoppedTotal: 0,
};

describe('D-04 part B: the automatic push rules', () => {
  it('waits 1, 2, 4 … minutes after failed runs in a row, never more than the cap', () => {
    expect(autoPushBackoffMinutes(0)).toBe(0);
    expect(autoPushBackoffMinutes(1)).toBe(1);
    expect(autoPushBackoffMinutes(2)).toBe(2);
    expect(autoPushBackoffMinutes(3)).toBe(4);
    expect(autoPushBackoffMinutes(9)).toBe(WC_AUTO_MAX_BACKOFF_MINUTES);
    expect(autoPushBackoffMinutes(500)).toBe(WC_AUTO_MAX_BACKOFF_MINUTES);
  });

  it('is on only for the stored value 1 (off when the setting is absent)', () => {
    expect(isAutoPushOn('1')).toBe(true);
    expect(isAutoPushOn(undefined)).toBe(false);
    expect(isAutoPushOn('0')).toBe(false);
    expect(isAutoPushOn('true')).toBe(false);
  });
});

describe('D-04 part B delta review: the order reading budget and the bulk push note', () => {
  it('leaves the push its minimum budget, and the reading at least half of a short deadline (N-2)', () => {
    expect(orderReadBudgetMs(50_000, 5_000)).toBe(45_000);
    expect(orderReadBudgetMs(6_000, 5_000)).toBe(3_000);
  });

  it('says a failed completed order is kept off for 30 days and how to stop it (M-1)', () => {
    expect(BULK_PUSH_OPEN_ORDERS_NOTE).toContain('۳۰ روز');
    expect(BULK_PUSH_OPEN_ORDERS_NOTE).toContain('دوباره همگام کنید');
  });
});

describe('D-04 part B: the automatic push panel', () => {
  it('a reader sees the state and the untracked products, and no switch', () => {
    render(<WcAutoPushPanel view={view} canManage={false} />, { wrapper });
    expect(screen.getByText('خاموش')).toBeTruthy();
    expect(screen.queryByRole('button', { name: TURN_ON })).toBeNull();
    expect(screen.getByText(UNTRACKED_ITEM)).toBeTruthy();
  });

  it('turning it on asks first and sends the target state; a declined question sends nothing', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ success: true, enabled: true });
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    render(<WcAutoPushPanel view={view} canManage />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: TURN_ON }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ message: AUTO_PUSH_ENABLE_CONFIRM })));
    expect(vi.mocked(fetchJson).mock.calls.filter(([url]) => url === '/woocommerce/auto-push')).toHaveLength(0);

    vi.mocked(confirmAction).mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: TURN_ON }));
    await waitFor(() => expect(vi.mocked(fetchJson).mock.calls.filter(([url]) => url === '/woocommerce/auto-push')).toHaveLength(1));
    const [, options] = vi.mocked(fetchJson).mock.calls.find(([url]) => url === '/woocommerce/auto-push') ?? [];
    expect(JSON.parse(String((options as RequestInit).body))).toEqual({ enabled: true });
  });

  it('turning it off needs no question', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ success: true, enabled: false });
    render(<WcAutoPushPanel view={{ ...view, enabled: true }} canManage />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: TURN_OFF }));
    await waitFor(() => expect(vi.mocked(fetchJson).mock.calls.some(([url]) => url === '/woocommerce/auto-push')).toBe(true));
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it('shows the failed runs in a row and when the next attempt is, in Persian digits', () => {
    render(<WcAutoPushPanel view={{ ...view, failedRuns: 3, nextAttemptAt: '2026-10-18T05:00:00.000Z' }} canManage={false} />, { wrapper });
    expect(screen.getByText(/۳ بار پیاپی ناموفق بود/)).toBeTruthy();
  });
});
