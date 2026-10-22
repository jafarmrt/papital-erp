import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
const REPLAY = { success: true, idempotentReplay: true, message: 'این درخواست پیش‌تر ثبت شده است؛ نتیجهٔ آن را در فهرست ببینید.' };
// the plan as the server saved it: the first run wrote the log id into the row
const SAVED_SCHEDULES = {
  1: { 'prod-main': { productId: 'prod-main', tasks: [
    { id: 'row-1', taskId: 3, taskTitle: 'برش', assignedPersonnelId: 7, quantity: 5, pieceworkLogId: 91 },
  ] } },
};
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  if (url === '/piecework/logs' && opts?.method === 'POST') return REPLAY;
  if (url === '/piecework/payrolls/2/sync-voucher' && opts?.method === 'POST') return REPLAY;
  if (url === '/projects/1' && opts?.method === 'PUT') return { id: 1 };
  if (url === '/projects/1') return { id: 1, version: 4, stage_schedules: SAVED_SCHEDULES };
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast, toast }));
vi.mock('../../components/workshop/ProjectWorkshopPanel', () => ({ ProjectWorkshopPanel: () => null }));
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canDeliver: true, canRequestPurchase: true,
  }),
}));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('../../hooks/useCompanyName', () => ({ useCompanyName: () => '' }));
vi.mock('../../contexts/AuthContext', async () => ({
  ...(await vi.importActual<typeof import('../../contexts/AuthContext')>('../../contexts/AuthContext')),
  useViewerIdentity: () => ({ id: 4, isAdmin: false }),
}));
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: false, canLog: true, canIssuePayroll: true, canApprovePayroll: true, canPay: true }),
}));

import ProjectScheduleTab from '../../components/project/ProjectScheduleTab';
import { PieceworkPayrollsTab } from '../../components/piecework/PieceworkPayrollsTab';
import { IDEMPOTENCY_REPLAY_BODY } from '../../middleware/idempotency';
import { IDEMPOTENT_REPLAY_MESSAGE, idempotentReplayMessage, isIdempotentReplay } from '../../lib/idempotentReplay';
import { scheduleLogIdOf } from '../../lib/projects/scheduleWorkLog';
import type { PieceworkPayroll, ProductionProject } from '../../types';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PROJECT = {
  id: 1, project_code: 'PRJ-1', title: 'پروژه آزمون', start_date: '2026-08-23',
  stages: [{ id: 1, project_id: 1, stage_order: 1, title: 'برش', status: 'in_progress', assigned_personnel: [], required_resources: [], progress_percent: 0 }],
  products: [{ id: 'prod-main', item_id: 42, item_code: 'N-1', item_name: 'گردنبند', customer_code: '', quantity: 5, unit: 'عدد', needs_assembly: false }],
  stage_schedules: {
    1: { 'prod-main': { productId: 'prod-main', tasks: [
      { id: 'row-1', taskId: 3, taskTitle: 'برش', assignedPersonnelId: 7, assignedPersonnelName: 'پرسنل آزمون', quantity: 5 },
    ] } },
  },
} as unknown as ProductionProject;

const payslip = (id: number): PieceworkPayroll => ({
  id, payrollNumber: `PAY-${id}`, personnelId: 5, personnelName: 'کارگر', startDate: '2026-08-23', endDate: '2026-09-22', title: 'فیش',
  totalPieceworkAmount: 1000000, totalBonuses: 0, totalDeductions: 0, netPayable: 1000000, paidAmount: 0, status: 'draft', createdById: 9,
});

// v10.2.34 (#351 review L1): since v10.2.33 a repeat of a payroll or piecework request gets only a notice, no number or ids
describe('screens read a repeat notice, not missing fields (#351 L1)', () => {
  it('the server notice and the screens share one rule and one text', () => {
    expect(isIdempotentReplay(IDEMPOTENCY_REPLAY_BODY)).toBe(true);
    expect(IDEMPOTENCY_REPLAY_BODY.message).toBe(IDEMPOTENT_REPLAY_MESSAGE);
    expect(idempotentReplayMessage({ success: true, idempotentReplay: true, message: '' })).toBe(IDEMPOTENT_REPLAY_MESSAGE);
    for (const other of [null, undefined, 'x', [], { success: true }, { idempotentReplay: 'true' }, { payrollNumber: 'PAY-1' }]) {
      expect(isIdempotentReplay(other)).toBe(false);
    }
  });

  it('a saved row gives its log id; a row without one, or a missing row, gives none', () => {
    expect(scheduleLogIdOf(SAVED_SCHEDULES, { stageId: 1, productId: 'prod-main', rowId: 'row-1' })).toBe(91);
    expect(scheduleLogIdOf(PROJECT.stage_schedules, { stageId: 1, productId: 'prod-main', rowId: 'row-1' })).toBeUndefined();
    expect(scheduleLogIdOf(SAVED_SCHEDULES, { stageId: 2, productId: 'prod-main', rowId: 'row-1' })).toBeUndefined();
    expect(scheduleLogIdOf(null, { stageId: 1, productId: 'prod-main', rowId: 'row-1' })).toBeUndefined();
  });

  it('the schedule tab marks a row logged from the saved plan when its log request was a repeat', async () => {
    render(<ProjectScheduleTab project={PROJECT} personnelList={[{ id: 7, fullName: 'پرسنل آزمون' }]}
      pieceworkTasksList={[{ id: 3, title: 'برش', defaultRate: 1000 }]} onUpdate={vi.fn()} />);
    expect(screen.queryByText('ثبت‌شده')).toBeNull();
    fireEvent.click(await screen.findByText('ثبت کارمزد'));
    expect(await screen.findByText('ثبت‌شده')).toBeTruthy();
    expect(screen.queryByText('ثبت کارمزد')).toBeNull();
  });

  it('a repeated voucher sync shows the notice and reloads the list', async () => {
    const onReload = vi.fn();
    render(<PieceworkPayrollsTab payrollsList={[payslip(2)]} onOpenPayrollModal={vi.fn()} onViewPayslip={vi.fn()}
      onUpdateStatus={vi.fn()} onDeletePayroll={vi.fn()} onReload={onReload} />);
    fireEvent.click(screen.getByText('ثبت سند حسابداری'));
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith(IDEMPOTENT_REPLAY_MESSAGE, expect.anything());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('the payslip issue screens check for a repeat before reading the payslip number', () => {
    for (const file of ['src/hooks/usePiecework.ts', 'src/components/piecework/PayrollEidiModal.tsx']) {
      const source = readFileSync(file, 'utf8');
      const check = source.indexOf('isIdempotentReplay(res)');
      expect(check, file).toBeGreaterThan(-1);
      expect(source.indexOf('payrollNumber', check), file).toBeGreaterThan(check);
    }
  });
});
