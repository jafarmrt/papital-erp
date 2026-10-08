import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
// a server that keeps the project version: a save from another version is refused, a save or a schedule log raises it
let serverVersion = 2;
const puts: Array<{ version?: number }> = [];
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts) => {
  if (url === '/projects/1' && opts?.method === 'PUT') {
    const body = JSON.parse(opts.body ?? '{}') as { version?: number };
    puts.push(body);
    if (body.version !== serverVersion) throw Object.assign(new Error('OCC_CONFLICT'), { code: 'OCC_CONFLICT' });
    serverVersion += 1;
    return { id: 1, version: serverVersion };
  }
  if (url === '/projects/1') return { id: 1, version: serverVersion };
  if (url === '/piecework/logs' && opts?.method === 'POST') {
    serverVersion += 1;
    return { status: 'ok', insertedCount: 1, insertedIds: [70] };
  }
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
// v9.0.393 (TD-752): buttons follow the project API keys; these tests act as a user who holds them
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canRequestPurchase: true,
  }),
}));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: false, canLog: true, canIssuePayroll: false, canPay: false }),
}));

import toast from 'react-hot-toast';
import ProjectScheduleTab from '../../components/project/ProjectScheduleTab';
import { useProjectVersion } from '../../hooks/useProjectVersion';
import { latestProjectVersion, projectVersionOf } from '../../lib/projects/projectVersion';
import type { ProductionProject } from '../../types';

beforeEach(() => { serverVersion = 2; });
afterEach(() => {
  cleanup();
  puts.length = 0;
  vi.clearAllMocks();
});

const PROJECT = {
  id: 1, version: 2, project_code: 'PRJ-1', title: 'پروژه آزمون', start_date: '2026-08-23',
  stages: [{ id: 1, project_id: 1, stage_order: 1, title: 'برش', status: 'in_progress', assigned_personnel: [], required_resources: [], progress_percent: 0 }],
  products: [{ id: 'prod-main', item_id: 42, item_code: 'N-1', item_name: 'گردنبند', customer_code: '', quantity: 5, unit: 'عدد', needs_assembly: false }],
  stage_schedules: {
    1: { 'prod-main': { productId: 'prod-main', startDate: '2026-08-23', tasks: [
      { id: 'row-1', taskId: 3, taskTitle: 'برش', assignedPersonnelId: 7, assignedPersonnelName: 'پرسنل آزمون', quantity: 5, startDate: '2026-08-23' },
    ] } },
  },
} as unknown as ProductionProject;

const renderTab = () => render(
  <ProjectScheduleTab project={PROJECT} personnelList={[{ id: 7, fullName: 'پرسنل آزمون' }]} pieceworkTasksList={[{ id: 3, title: 'برش', defaultRate: 1000 }]} onUpdate={vi.fn()} />,
);

// v9.0.385 (TD-742, owner decision t3 A): a project save sends the version it was built from and the next save the newer one
describe('project version on save (TD-742)', () => {
  it('reads only positive whole versions and keeps the newest', () => {
    expect(projectVersionOf(3)).toBe(3);
    expect(projectVersionOf('4')).toBe(4);
    expect([0, -1, 1.5, 'x', null, undefined].map(projectVersionOf)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(latestProjectVersion(2, undefined, 5, '3')).toBe(5);
    expect(latestProjectVersion()).toBeUndefined();
  });

  it('remembers the version a save answered for the same project only', () => {
    const { result, rerender } = renderHook(({ project }) => useProjectVersion(project), { initialProps: { project: { id: 1, version: 2 } } });
    expect(result.current.version).toBe(2);
    act(() => result.current.remember({ id: 1, version: 3 }));
    expect(result.current.version).toBe(3);
    act(() => result.current.remember({ id: 9, version: 8 }));
    expect(result.current.version).toBe(3);
    rerender({ project: { id: 1, version: 5 } });
    expect(result.current.version).toBe(5);
    rerender({ project: { id: 2, version: 1 } });
    expect(result.current.version).toBe(1);
  });

  it('saves the workshop schedule twice without a conflict', async () => {
    renderTab();
    const save = await screen.findByText('ذخیره برنامه‌ریزی');
    fireEvent.click(save);
    await waitFor(() => expect(puts).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    fireEvent.click(save);
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts.map(p => p.version)).toEqual([2, 3]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('saves the schedule after a work log with the version the log left', async () => {
    renderTab();
    fireEvent.click(await screen.findByText('ثبت کارمزد'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('ذخیره برنامه‌ریزی'));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts.map(p => p.version)).toEqual([2, 4]);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
