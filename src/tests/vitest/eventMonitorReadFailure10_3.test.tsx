/**
 * 10.3 (ARCH review, package 2 part 17): the outbox and the live events tabs answered a refused read with zero counts
 * and «nothing found». A refused read now says why; a count shows «—» until it is read; «nothing found» is said only
 * after a list was read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { appQueryClient } from './helpers/queryWrapper';

/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  outboxTab: 'صف ارسال رویداد',
  liveTab: 'گذرگاه رویدادهای زنده',
  outboxEmpty: 'هیچ رویدادی با پالایش انتخابی در صف ارسال یافت نشد.',
  liveEmpty: 'هیچ رویدادی با پالایش انتخابی یافت نشد.',
  zero: '۰',
  unread: '—',
} as const;

type Opts = { method?: string; signal?: AbortSignal };
const refused = { path: null as string | null };
const fetchJson = vi.fn(async (url: string, opts?: Opts): Promise<unknown> => {
  const path = url.split('?')[0] ?? '';
  if (opts?.method) return { success: true };
  if (refused.path === path) throw new Error('server refused the read');
  if (path === '/events/outbox/stats') return { success: true, stats: { total: 3, pending: 1, processing: 0, completed: 2, failed: 0, workerRunning: true } };
  if (path === '/events/outbox') return { success: true, events: [], total: 0 };
  if (path === '/events/domain-events') return { success: true, events: [], stats: { totalEmitted: 0, eventCounts: {} } };
  return { success: true, data: [], total: 0 };
});
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (url: string, opts?: Opts) => fetchJson(url, opts), isAbortError: () => false }));
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => true }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));

import { DomainEventsTab } from '../../components/settings/DomainEventsTab';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  refused.path = null;
});

const openTab = (tab: string) => {
  render(<QueryClientProvider client={appQueryClient()}><DomainEventsTab /></QueryClientProvider>);
  fireEvent.click(screen.getByText(tab));
};
const readsOf = (path: string) => fetchJson.mock.calls.filter(([u, o]) => u.split('?')[0] === path && !o?.method).length;

describe('the event monitors say a refused read (10.3)', () => {
  it('a refused outbox stats read says why and shows no count it did not read', async () => {
    refused.path = '/events/outbox/stats';
    openTab(SHOWN.outboxTab);
    expect((await screen.findByRole('alert')).textContent).toBe('server refused the read');
    expect(screen.getAllByText(SHOWN.unread)).toHaveLength(4);
    expect(screen.queryAllByText(SHOWN.zero)).toHaveLength(0);
  });

  it('a read outbox stats shows its counts', async () => {
    openTab(SHOWN.outboxTab);
    expect(await screen.findByText('۳')).toBeTruthy();
    expect(screen.queryAllByText(SHOWN.unread)).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refused outbox page says why, never «nothing found»', async () => {
    refused.path = '/events/outbox';
    openTab(SHOWN.outboxTab);
    expect((await screen.findByRole('alert')).textContent).toBe('server refused the read');
    expect(screen.queryByText(SHOWN.outboxEmpty)).toBeNull();
  });

  it('an empty outbox page that was read says «nothing found»', async () => {
    openTab(SHOWN.outboxTab);
    expect(await screen.findByText(SHOWN.outboxEmpty)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refused live events read says why, with no count and never «nothing found»', async () => {
    refused.path = '/events/domain-events';
    openTab(SHOWN.liveTab);
    expect((await screen.findByRole('alert')).textContent).toBe('server refused the read');
    expect(screen.getAllByText(SHOWN.unread)).toHaveLength(4);
    expect(screen.queryAllByText(SHOWN.zero)).toHaveLength(0);
    expect(screen.queryByText(SHOWN.liveEmpty)).toBeNull();
  });

  it('a read empty live events list says «nothing found» and its zero counts', async () => {
    openTab(SHOWN.liveTab);
    expect(await screen.findByText(SHOWN.liveEmpty)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(SHOWN.zero)).toHaveLength(4));
    expect(readsOf('/events/domain-events')).toBe(1);
  });
});
