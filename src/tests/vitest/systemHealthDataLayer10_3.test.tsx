import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ownReads } from './helpers/ownReads';
import { appQueryClient } from './helpers/queryWrapper';

/**
 * 10.3 (ARCH review finding 3, part 16): the health tab reads the health and the integrity check through the shared cache,
 * again on each opening, never showing what an earlier opening left; a failed read says so once; a queue fix refreshes
 * both and the event screens.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  checking: 'در حال بررسی اجزای سامانه…',
  notChecked: 'سلامت سامانه بررسی نشد',
  retry: 'تلاش دوباره',
  recheck: 'بررسی دوباره سلامت',
  rechecking: 'در حال به‌روزرسانی…',
  runCheck: 'اجرای بررسی',
  running: 'در حال بررسی…',
  checkDone: 'بررسی یکپارچگی سامانه انجام شد.',
  healthFailed: 'وضعیت سلامت سرور دریافت نشد.',
  replayFailed: 'اجرای دوباره رویدادهای ناموفق',
} as const;

type Opts = { method?: string; body?: string; signal?: AbortSignal };
const healthOf = (message: string, dlqCount = 0) => ({
  database: { status: 'ok', latencyMs: 12, message },
  outbox: { pendingCount: 0, dlqCount, stuckCount: 0, status: dlqCount ? 'warning' : 'ok' },
  server: { nodeVersion: 'v22.22.0', platform: 'linux', uptimeSeconds: 60, memoryUsageMb: { heapUsed: 120, heapTotal: 256, rss: 300 } },
  checkTimestamp: '2026-10-08T10:00:00.000Z',
});
const reportOf = (title: string) => ({
  healthScorePercentage: 100, totalChecks: 1, okChecks: 1, timestamp: '2026-10-08T10:00:00.000Z',
  checks: [{ id: 'c1', category: 'accounting', title, status: 'ok', details: '' }],
});
const server = { health: healthOf('fresh database') as unknown, report: reportOf('fresh check') as unknown };
const reads = { hold: null as string | null, fail: null as string | null, held: [] as Array<(answer: unknown) => void> };
const fetchJson = vi.fn(async (url: string, opts?: Opts): Promise<unknown> => {
  if (opts?.method) return { success: true, message: 'done' };
  if (reads.hold === url) { reads.hold = null; return new Promise(resolve => { reads.held.push(resolve); }); }
  if (reads.fail === url) { reads.fail = null; throw new Error('server refused the read'); }
  if (url === '/system/health') return server.health;
  if (url === '/system/reconciliation-check') return server.report;
  throw new Error(`unexpected ${url}`);
});
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (url: string, opts?: Opts) => fetchJson(url, opts), isAbortError: () => false }));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));

import SystemHealthDiagnostic from '../../components/SystemHealthDiagnostic';
import { INTEGRITY_CHECK_KEY, SYSTEM_HEALTH_KEY, SYSTEM_KEY } from '../../hooks/queries/useSystemQueries';
import { QUERY_KEYS } from '../../lib/queryKeys';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
  Object.assign(reads, { hold: null, fail: null, held: [] });
  Object.assign(server, { health: healthOf('fresh database'), report: reportOf('fresh check') });
});

/** the app's read defaults (fresh for five minutes): the screen must read again on its own */
const newClient = appQueryClient;
const open = (client = newClient()) => render(<QueryClientProvider client={client}><SystemHealthDiagnostic /></QueryClientProvider>);
/** the time an earlier opening of the tab read its data */
const earlier = () => ({ updatedAt: Date.now() - 60_000 });
const readsOf = (url: string) => fetchJson.mock.calls.filter(([u, o]) => u === url && !o?.method).length;
const button = (text: string) => screen.getByText(text).closest('button') as HTMLButtonElement;

describe('the health tab reads through the shared cache (10.3)', () => {
  it('never shows the health an earlier opening left while it reads again', async () => {
    const client = newClient();
    client.setQueryData(SYSTEM_HEALTH_KEY, healthOf('stale database'), earlier());
    reads.hold = '/system/health';
    open(client);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('stale database')).toBeNull();
    expect(screen.getByText(SHOWN.checking)).toBeTruthy();
    await act(async () => { reads.held[0]?.(server.health); });
    expect(await screen.findByText('fresh database')).toBeTruthy();
  });

  it('never shows the integrity report an earlier opening left while it checks again', async () => {
    const client = newClient();
    client.setQueryData(INTEGRITY_CHECK_KEY, reportOf('stale check'), earlier());
    reads.hold = '/system/reconciliation-check';
    open(client);
    expect(await screen.findByText('fresh database')).toBeTruthy();
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('stale check')).toBeNull();
    expect(toastSuccess).not.toHaveBeenCalled();
    await act(async () => { reads.held[0]?.(server.report); });
    expect(await screen.findByText('fresh check')).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalledWith(SHOWN.checkDone);
  });

  it('a failed health read shows the reason, says so once, and its retry reads again', async () => {
    reads.fail = '/system/health';
    open();
    expect(await screen.findByText(SHOWN.notChecked)).toBeTruthy();
    expect(screen.getByText('server refused the read')).toBeTruthy();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(SHOWN.healthFailed));
    expect(toastError.mock.calls.filter(([m]) => m === SHOWN.healthFailed)).toHaveLength(1);
    reads.hold = '/system/health';
    fireEvent.click(button(SHOWN.retry));
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText(SHOWN.notChecked)).toBeNull();
    expect(screen.getByText(SHOWN.checking)).toBeTruthy();
    await act(async () => { reads.held[0]?.(server.health); });
    expect(await screen.findByText('fresh database')).toBeTruthy();
  });

  it('a failed integrity check says why once and shows no report', async () => {
    reads.fail = '/system/reconciliation-check';
    open();
    expect(await screen.findByText('fresh database')).toBeTruthy();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('server refused the read'));
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByText('fresh check')).toBeNull();
    expect(button(SHOWN.runCheck).disabled).toBe(false);
  });

  it('each finished check says so once, and the check button checks again', async () => {
    open();
    expect(await screen.findByText('fresh check')).toBeTruthy();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    reads.hold = '/system/reconciliation-check';
    fireEvent.click(button(SHOWN.runCheck));
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(button(SHOWN.running).disabled).toBe(true);
    await act(async () => { reads.held[0]?.(reportOf('later check')); });
    expect(await screen.findByText('later check')).toBeTruthy();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(2));
    expect(readsOf('/system/reconciliation-check')).toBe(2);
  });

  it('a failed recheck shows the reason, and its retry shows the cards while it reads', async () => {
    open();
    expect(await screen.findByText('fresh database')).toBeTruthy();
    reads.fail = '/system/health';
    fireEvent.click(button(SHOWN.recheck));
    expect(await screen.findByText(SHOWN.notChecked)).toBeTruthy();
    reads.hold = '/system/health';
    fireEvent.click(button(SHOWN.retry));
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText(SHOWN.notChecked)).toBeNull();
    expect(screen.getByText('fresh database')).toBeTruthy();
  });

  it('the recheck button keeps the cards on screen while it reads the health again', async () => {
    open();
    expect(await screen.findByText('fresh database')).toBeTruthy();
    reads.hold = '/system/health';
    fireEvent.click(button(SHOWN.recheck));
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.getByText('fresh database')).toBeTruthy();
    expect(button(SHOWN.rechecking).disabled).toBe(true);
    await act(async () => { reads.held[0]?.(healthOf('later database')); });
    expect(await screen.findByText('later database')).toBeTruthy();
  });

  it('a queue fix refreshes the health, the integrity check and the event screens', async () => {
    server.health = healthOf('before the fix', 3);
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    open(client);
    fireEvent.click(await screen.findByText(SHOWN.replayFailed));
    server.health = healthOf('after the fix');
    server.report = reportOf('check after the fix');
    expect(await screen.findByText('after the fix')).toBeTruthy();
    expect(await screen.findByText('check after the fix')).toBeTruthy();
    expect(screen.queryByText(SHOWN.replayFailed)).toBeNull();
    const keys = invalidated.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys).toEqual(expect.arrayContaining([JSON.stringify(SYSTEM_KEY), JSON.stringify(QUERY_KEYS.events.all)]));
  });

  it('makes no read of its own', () => {
    expect(ownReads('components/SystemHealthDiagnostic.tsx')).toEqual([]);
  });
});
