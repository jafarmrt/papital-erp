import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ChangeEvent } from 'react';
import { ownReads } from './helpers/ownReads';

/**
 * 10.3 (ARCH review finding 3, part 9): the project page and its workshop tab read through the shared cache. A save
 * elsewhere refreshes an open page; a tab with an unsaved change keeps the project its edits started from until it is
 * saved; each visit reads again and never shows what an earlier visit left in the cache.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  titleNow: 'پروژه کارگاه',
  titleLater: 'پروژه کارگاه تازه',
  titleCached: 'پروژه کهنه',
  manualTitle: 'یا عنوان دستی...',
  save: 'ذخیره برنامه‌ریزی',
  logCount: (n: string) => `${n} رکورد`,
  pickPersonnel: 'انتخاب مسئول / مجری...',
} as const;

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
const PLAN = { 11: { p1: { productId: 'p1', tasks: [{ id: 'r1', taskId: null, taskTitle: 'دستی', assignedPersonnelId: null, quantity: 2 }] } } };
const projectNamed = (title: string, version = 3) => ({
  id: 7, version, project_code: 'PRJ-7', title, status: 'in_progress', quantity: 5, unit: 'عدد', progress_percent: 0,
  start_date: '2026-08-23', end_date: '2026-09-22',
  products: [{ id: 'p1', item_id: 50, item_code: 'NK-1', item_name: 'گردنبند', customer_code: '', quantity: 2, unit: 'عدد', needs_assembly: false }],
  stages: [{ id: 11, project_id: 7, stage_order: 1, title: 'برش', status: 'pending', progress_percent: 0, assigned_personnel: [], required_resources: [] }],
  stage_schedules: PLAN,
});
let serverProject = projectNamed(SHOWN.titleNow);
let logs = [{ id: 1, personnelName: 'سارا', taskTitle: 'برش', quantity: 2, unitRate: 1000, date: '2026-10-01' }];
let personnel = [{ id: 1, fullName: 'سارا کریمی' }];
/** a project read the test answers itself, later */
let pendingRead: ((project: unknown) => void) | null = null;
let holdReads = false;
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  if (url === '/projects/7' && opts?.method === 'PUT') return { id: 7, version: 5 };
  if (url === '/projects/7' && holdReads) return new Promise(resolve => { pendingRead = resolve; });
  if (url === '/projects/7') return serverProject;
  if (url === '/projects/7/steps') return { requisitions: {}, allocations: {}, delivery: {} };
  if (url === '/personnel') return personnel;
  if (url.startsWith('/piecework/tasks')) return [{ id: 3, title: 'برش', defaultRate: 1000, unit: 'عدد' }];
  if (url === '/piecework/logs?projectId=7') return logs;
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
  usePieceworkPermissions: () => ({ canManageTasks: false, canLog: false, canIssuePayroll: false, canPay: false }),
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
import ProjectScheduleTab from '../../components/project/ProjectScheduleTab';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidatePreset } from '../../lib/queryInvalidation';
import { toPersianDigits } from '../../utils';
import type { ProductionProject } from '../../types';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  serverProject = projectNamed(SHOWN.titleNow);
  holdReads = false;
  pendingRead = null;
  logs = [{ id: 1, personnelName: 'سارا', taskTitle: 'برش', quantity: 2, unitRate: 1000, date: '2026-10-01' }];
  personnel = [{ id: 1, fullName: 'سارا کریمی' }];
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const reads = (url: string) => fetchJson.mock.calls.filter(([u, o]) => u === url && !o?.method).length;
const renderPage = (client: QueryClient, path = '/projects/7/workshop') => render(
  <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/projects/:projectId/:tab?" element={<ProjectDetailPage />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);
const heading = () => screen.getByRole('heading', { level: 1 }).textContent;

describe('the project page reads through the shared cache (10.3)', () => {
  it('reads the project again on each visit and follows a change saved elsewhere', async () => {
    const client = newClient();
    client.setQueryData(QUERY_KEYS.projects.detail(7), projectNamed(SHOWN.titleCached));
    renderPage(client);
    expect(screen.queryByText(SHOWN.titleCached)).toBeNull();
    await waitFor(() => expect(heading()).toBe(SHOWN.titleNow));

    // a stock document saved elsewhere (its preset invalidates `projects`)
    serverProject = projectNamed(SHOWN.titleLater, 4);
    await act(() => invalidatePreset(client, 'documentChange'));
    await waitFor(() => expect(heading()).toBe(SHOWN.titleLater));
  });

  it('keeps the project the workshop edits started from until they are saved', async () => {
    const client = newClient();
    renderPage(client);
    const manual = await screen.findByPlaceholderText(SHOWN.manualTitle);
    fireEvent.change(manual, { target: { value: 'کار من' } });

    serverProject = projectNamed(SHOWN.titleLater, 4);
    await act(() => invalidatePreset(client, 'documentChange'));
    await waitFor(() => expect(reads('/projects/7')).toBe(2));
    expect(heading()).toBe(SHOWN.titleNow);
    expect((screen.getByPlaceholderText(SHOWN.manualTitle) as HTMLInputElement).value).toBe('کار من');

    // the project read before the save predates it: it never replaces the saved plan, not even until the save's own read
    holdReads = true;
    fireEvent.click(screen.getByText(SHOWN.save));
    await waitFor(() => expect(pendingRead).not.toBeNull());
    expect(heading()).toBe(SHOWN.titleNow);
    expect((screen.getByPlaceholderText(SHOWN.manualTitle) as HTMLInputElement).value).toBe('کار من');
    const saved = projectNamed(SHOWN.titleLater, 5);
    await act(async () => { pendingRead?.({ ...saved, stage_schedules: { 11: { p1: { ...PLAN[11].p1, tasks: [{ ...PLAN[11].p1.tasks[0], taskTitle: 'کار من' }] } } } }); });
    await waitFor(() => expect(heading()).toBe(SHOWN.titleLater));
    expect((screen.getByPlaceholderText(SHOWN.manualTitle) as HTMLInputElement).value).toBe('کار من');
  });

  it('a project deleted while its page is open says so', async () => {
    const client = newClient();
    renderPage(client);
    await waitFor(() => expect(heading()).toBe(SHOWN.titleNow));
    serverProject = null as unknown as ReturnType<typeof projectNamed>;
    await act(() => client.invalidateQueries({ queryKey: QUERY_KEYS.projects.all }));
    expect(await screen.findByText('پروژه یافت نشد')).toBeTruthy();
  });

  it('a project that no longer exists says so', async () => {
    const client = newClient();
    serverProject = null as unknown as ReturnType<typeof projectNamed>;
    renderPage(client);
    expect(await screen.findByText('پروژه یافت نشد')).toBeTruthy();
  });
});

const renderTab = (client: QueryClient) => render(
  <QueryClientProvider client={client}>
    <ProjectScheduleTab project={projectNamed(SHOWN.titleNow) as unknown as ProductionProject} onUpdate={() => undefined} />
  </QueryClientProvider>,
);

describe('the workshop tab reads through the shared cache (10.3)', () => {
  it('shows the work logs recorded meanwhile, never the ones an earlier visit read', async () => {
    const client = newClient();
    client.setQueryData(QUERY_KEYS.piecework.logs({ projectId: 7 }), [...logs, ...logs, ...logs]);
    renderTab(client);
    expect(screen.queryByText(SHOWN.logCount(toPersianDigits(3)))).toBeNull();
    expect(await screen.findByText(SHOWN.logCount(toPersianDigits(1)))).toBeTruthy();

    // a work log saved on the payroll page (piecework)
    logs = [...logs, { id: 2, personnelName: 'رضا', taskTitle: 'برش', quantity: 1, unitRate: 1000, date: '2026-10-02' }];
    await act(() => client.invalidateQueries({ queryKey: QUERY_KEYS.piecework.all }));
    expect(await screen.findByText(SHOWN.logCount(toPersianDigits(2)))).toBeTruthy();
  });

  it('the personnel picker lists personnel added meanwhile', async () => {
    const client = newClient();
    renderTab(client);
    await waitFor(() => expect(reads('/personnel')).toBe(1));
    personnel = [...personnel, { id: 2, fullName: 'رضا تازه' }];
    await act(() => client.invalidateQueries({ queryKey: QUERY_KEYS.personnel.all }));
    await waitFor(() => expect(reads('/personnel')).toBe(2));
    fireEvent.click(screen.getByText(SHOWN.pickPersonnel));
    expect(await screen.findByText('رضا تازه')).toBeTruthy();
  });
});

const WORKSPACE_FILES = [
  'pages/ProjectDetailPage.tsx',
  'components/project/ProjectScheduleTab.tsx',
  'components/project/schedule/useScheduleReferenceData.ts',
  'components/project/schedule/useSchedulePlan.ts',
  'components/project/schedule/ScheduleStageCard.tsx',
  'components/project/schedule/ScheduleTaskRow.tsx',
  'components/project/schedule/ScheduleRecordedLogs.tsx',
  'components/project/schedule/SchedulePersonnelPicker.tsx',
];

describe('the project page and workshop tab read only through the shared cache (10.3)', () => {
  it('their own fetch calls are writes', () => {
    expect(WORKSPACE_FILES.flatMap(ownReads)).toEqual([]);
  });

  it('logging reads the project only for its version after a work log (TD-1342)', () => {
    expect(ownReads('components/project/schedule/useScheduleLogging.ts')).toHaveLength(1);
  });
});
