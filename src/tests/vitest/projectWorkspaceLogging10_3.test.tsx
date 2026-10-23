import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ChangeEvent } from 'react';
import { appQueryClient } from './helpers/queryWrapper';

/**
 * 10.3 (ARCH review finding 3, part 9 review): «ثبت کارمزد» saves the plan first and refreshes the project only when the
 * work log is over, so the page holds the project back until then. A project read started while the plan held a change
 * never resets the quantity that was saved and logged, even when the refresh after the log fails.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  title: 'پروژه کارگاه',
  titleLater: 'پروژه کارگاه تازه',
  quantity: 'تعداد',
  logOne: 'ثبت کارمزد',
  logStage: 'ثبت گروهی کارکرد مرحله',
} as const;

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
const ROW = { id: 'r1', taskId: 3, taskTitle: 'برش', assignedPersonnelId: 1, assignedPersonnelName: 'سارا کریمی', quantity: 2, unit: 'عدد' };
const projectWith = (quantity: number, version: number, title: string = SHOWN.title, logId?: number) => ({
  id: 7, version, project_code: 'PRJ-7', title, status: 'in_progress', quantity: 5, unit: 'عدد', progress_percent: 0,
  start_date: '2026-08-23', end_date: '2026-09-22',
  products: [{ id: 'p1', item_id: 50, item_code: 'NK-1', item_name: 'گردنبند', customer_code: '', quantity: 2, unit: 'عدد', needs_assembly: false }],
  stages: [{ id: 11, project_id: 7, stage_order: 1, title: 'برش', status: 'pending', progress_percent: 0, assigned_personnel: [], required_resources: [] }],
  stage_schedules: { 11: { p1: { productId: 'p1', tasks: [{ ...ROW, quantity, ...(logId ? { pieceworkLogId: logId } : {}) }] } } },
});
let serverProject: unknown = projectWith(2, 3);
/** the page's next project read waits for the test */
let holdNextRead = false;
const heldReads: Array<(project: unknown) => void> = [];
let failReads = false;
let pendingPost: ((answer: unknown) => void) | null = null;
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  if (url === '/projects/7' && opts?.method === 'PUT') return { id: 7, version: 5 };
  if (url === '/piecework/logs' && opts?.method === 'POST') return new Promise(resolve => { pendingPost = resolve; });
  // the page's query read passes a signal; the logging's own version read does not
  if (url === '/projects/7' && opts?.signal) {
    if (holdNextRead) {
      holdNextRead = false;
      return new Promise(resolve => { heldReads.push(resolve); });
    }
    if (failReads) throw new Error('read refused');
    return serverProject;
  }
  if (url === '/projects/7') return serverProject;
  if (url === '/projects/7/steps') return { requisitions: {}, allocations: {}, delivery: {} };
  if (url === '/personnel') return [{ id: 1, fullName: 'سارا کریمی' }];
  if (url.startsWith('/piecework/tasks')) return [{ id: 3, title: 'برش', defaultRate: 1000, unit: 'عدد' }];
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../components/workshop/ProjectWorkshopPanel', () => ({ ProjectWorkshopPanel: () => null }));
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canDeliver: true, canRequestPurchase: true,
  }),
}));
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: false, canLog: true, canIssuePayroll: false, canPay: false }),
}));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('../../components/common/JalaliDateInput', () => ({
  JalaliDateInput: ({ value, onChange, placeholder }: { value: string; onChange: (iso: string) => void; placeholder?: string }) => (
    <input aria-label={placeholder ?? 'date'} value={value} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} />
  ),
}));

import ProjectDetailPage from '../../pages/ProjectDetailPage';
import { QUERY_KEYS } from '../../lib/queryKeys';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  serverProject = projectWith(2, 3);
  holdNextRead = false;
  heldReads.length = 0;
  failReads = false;
  pendingPost = null;
});

const renderPage = (client: QueryClient) => render(
  <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/projects/7/workshop']}>
      <Routes><Route path="/projects/:projectId/:tab?" element={<ProjectDetailPage />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);
const LATIN = '۰۱۲۳۴۵۶۷۸۹';
const quantity = () => (screen.getByPlaceholderText(SHOWN.quantity) as HTMLInputElement).value.replace(/[۰-۹]/g, d => String(LATIN.indexOf(d)));
const sentQuantity = () => {
  const put = fetchJson.mock.calls.find(([u, o]) => u === '/projects/7' && o?.method === 'PUT');
  return JSON.parse(String(put?.[1]?.body)).stage_schedules[11].p1.tasks[0].quantity;
};

describe('a work log holds the project back until it is over (10.3)', () => {
  it.each([false, true])('a read started while the plan held a change never resets the logged quantity (refresh fails: %s)', async (refreshFails) => {
    const client = appQueryClient();
    renderPage(client);
    await waitFor(() => expect(quantity()).toBe('2'));
    fireEvent.change(screen.getByPlaceholderText(SHOWN.quantity), { target: { value: '3' } });
    await waitFor(() => expect(quantity()).toBe('3'));

    // an invalidation while the plan holds the change: its read answers only after the log saved the plan
    holdNextRead = true;
    await act(async () => { void client.invalidateQueries({ queryKey: QUERY_KEYS.projects.all }); });
    await waitFor(() => expect(heldReads).toHaveLength(1));
    fireEvent.click(screen.getByText(SHOWN.logOne));
    await waitFor(() => expect(pendingPost).not.toBeNull());
    expect(sentQuantity()).toBe(3);
    // one work log at a time: no other log ends this one's busy spell
    expect((screen.getByText(SHOWN.logStage).closest('button') as HTMLButtonElement).disabled).toBe(true);
    // the plan is clean once its PUT answered: let that render land before the old read answers
    await act(() => new Promise(resolve => setTimeout(resolve, 30)));

    serverProject = projectWith(3, 5);
    await act(async () => { heldReads[0]?.(projectWith(2, 3, SHOWN.titleLater)); });
    await act(() => new Promise(resolve => setTimeout(resolve, 30)));
    expect(quantity()).toBe('3');

    serverProject = projectWith(3, 6, SHOWN.title, 99);
    failReads = refreshFails;
    await act(async () => { pendingPost?.({ insertedIds: [99] }); });
    await waitFor(() => expect(fetchJson.mock.calls.filter(([u, o]) => u === '/projects/7' && o?.signal).length).toBeGreaterThanOrEqual(3));
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    expect(quantity()).toBe('3');
  });
});
