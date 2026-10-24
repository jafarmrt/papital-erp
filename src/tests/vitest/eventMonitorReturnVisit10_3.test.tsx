/**
 * 10.3 package 6 (package-2 leftover): coming back to the outbox or the live events tab showed the counts and rows of the
 * previous visit until the new read answered. Each visit now shows only its own answers: «—» and «در حال خواندن» until
 * the server answers, then the new counts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { appQueryClient } from './helpers/queryWrapper';

/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  outboxTab: 'صف ارسال رویداد',
  liveTab: 'گذرگاه رویدادهای زنده',
  rulesTab: 'عملیات و قوانین خودکار',
  outboxReading: 'در حال خواندن صف ارسال رویداد…',
  liveReading: 'در حال خواندن رویدادهای زنده…',
  three: '۳',
  seven: '۷',
  unread: '—',
} as const;

type Opts = { method?: string; signal?: AbortSignal };
const server = { total: 3, emitted: 3, hold: null as Promise<void> | null };
const stats = () => ({ total: server.total, pending: 0, processing: 0, completed: server.total, failed: 0, workerRunning: true });
const fetchJson = vi.fn(async (url: string, opts?: Opts): Promise<unknown> => {
  const path = url.split('?')[0] ?? '';
  if (opts?.method) return { success: true };
  if (server.hold && (path.startsWith('/events/outbox') || path === '/events/domain-events')) await server.hold;
  if (path === '/events/outbox/stats') return { success: true, stats: stats() };
  if (path === '/events/outbox') return { success: true, events: [], total: 0 };
  if (path === '/events/domain-events') return { success: true, events: [], stats: { totalEmitted: server.emitted, eventCounts: {} } };
  return { success: true, data: [], total: 0 };
});
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (url: string, opts?: Opts) => fetchJson(url, opts), isAbortError: () => false }));
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => false }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));

import { DomainEventsTab } from '../../components/settings/DomainEventsTab';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  Object.assign(server, { total: 3, emitted: 3, hold: null });
});

/** Opens the tab, reads it, leaves it, makes the server answer anew but slowly, and comes back */
async function returnTo(tab: string, change: () => void): Promise<() => Promise<void>> {
  render(<QueryClientProvider client={appQueryClient()}><DomainEventsTab /></QueryClientProvider>);
  fireEvent.click(screen.getByText(tab));
  expect((await screen.findAllByText(SHOWN.three)).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByText(SHOWN.rulesTab));
  change();
  let release = () => undefined as void;
  server.hold = new Promise<void>(resolve => { release = resolve; });
  fireEvent.click(screen.getByText(tab));
  return async () => {
    await act(async () => { release(); await server.hold; });
  };
}

describe('an event monitor shows only the answers of its current visit (10.3 package 6)', () => {
  it('the outbox tab shows no count of the previous visit while it reads again', async () => {
    const answer = await returnTo(SHOWN.outboxTab, () => { server.total = 7; });
    expect(screen.queryByText(SHOWN.three)).toBeNull();
    expect(screen.getAllByText(SHOWN.unread).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(SHOWN.outboxReading)).toBeTruthy();
    await answer();
    expect(await screen.findAllByText(SHOWN.seven)).toHaveLength(2);
    expect(screen.queryByText(SHOWN.outboxReading)).toBeNull();
  });

  it('the live events tab shows no count of the previous visit while it reads again', async () => {
    const answer = await returnTo(SHOWN.liveTab, () => { server.emitted = 7; });
    expect(screen.queryByText(SHOWN.three)).toBeNull();
    expect(screen.getByText(SHOWN.liveReading)).toBeTruthy();
    await answer();
    expect(await screen.findByText(SHOWN.seven)).toBeTruthy();
    expect(screen.queryByText(SHOWN.liveReading)).toBeNull();
  });
});
