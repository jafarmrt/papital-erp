import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChangeEvent } from 'react';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
const posts: Array<{ items: Array<Record<string, unknown>> }> = [];
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts) => {
  if (url === '/piecework/logs' && opts?.method === 'POST') {
    const body = JSON.parse(opts.body ?? '{}') as { items: Array<Record<string, unknown>> };
    posts.push(body);
    return { status: 'ok', insertedCount: body.items.length, insertedIds: body.items.map((_, i) => 70 + i) };
  }
  if (url === '/projects/1' && opts?.method === 'PUT') return { id: 1 };
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
vi.mock('../../components/common/JalaliDateInput', () => ({
  // v9.0.396 (TD-764): the product schedule dates use the same picker, labelled by their placeholder
  JalaliDateInput: ({ value, onChange, placeholder }: { value: string; onChange: (iso: string) => void; placeholder?: string }) => (
    <input aria-label={placeholder ?? 'work date'} value={value} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} />
  ),
}));

import ProjectScheduleTab from '../../components/project/ProjectScheduleTab';
import type { ProductionProject } from '../../types';
import { getTodayIsoDate } from '../../utils';

afterEach(() => {
  cleanup();
  posts.length = 0;
});

// the row and the project start on 1 Shahrivar; the work is logged on another day
const PROJECT = {
  id: 1, project_code: 'PRJ-1', title: 'پروژه آزمون', start_date: '2026-08-23',
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

// v9.0.283 (TD-747, package 11 decision t6 «الف»): a schedule work log is dated by the picker (default today), never the row or project start
describe('work date of workshop schedule logs (TD-747)', () => {
  it('logs a row on today, not on the row or project start date', async () => {
    renderTab();
    fireEvent.click(await screen.findByText('ثبت کارمزد'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].items[0].date).toBe(getTodayIsoDate());
    expect(posts[0].items[0].date).not.toBe('2026-08-23');
  });

  it('logs a stage batch on the date chosen in the picker', async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText('work date'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByText('ثبت گروهی کارکرد مرحله'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].items.map(i => i.date)).toEqual(['2026-10-01']);
  });
});
