import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
const stage = {
  id: 11, project_id: 7, stage_order: 1, title: 'برش', status: 'pending', progress_percent: 0,
  start_date: '2026-08-23', end_date: '2026-08-28', assigned_personnel: ['نام قدیمی'], required_resources: [], notes: '',
};
const project = {
  id: 7, version: 3, project_code: 'PRJ-7', title: 'پروژه کارگاه', status: 'in_progress', quantity: 5, unit: 'عدد', progress_percent: 40,
  start_date: '2026-08-23', end_date: '2026-09-22', products: [], stages: [stage],
  inventory_control: { isFinalized: false, sections: [{ globalItems: [{ id: 1 }, { id: 2 }], perItemResults: {} }] },
};
const personnel = [
  { id: 1, fullName: 'سارا کریمی', employmentStatus: 'فعال' },
  { id: 2, fullName: 'رضا رفته', employmentStatus: 'قطع همکاری' },
  { id: 3, firstName: 'علی', lastName: 'احمدی', employmentStatus: 'فعال' },
];
const steps = {
  requisitions: { open: 1, ordered: 0, received: 0 },
  allocations: { open: 0, consumed: 0 },
  delivery: { products: 1, completeProducts: 0, delivered: 2, planned: 12, unit: 'عدد' },
};
const puts: Array<Record<string, unknown>> = [];
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  if (url === '/projects/7/stages/11' && opts?.method === 'PUT') {
    const body = JSON.parse(opts.body ?? '{}') as Record<string, unknown>;
    puts.push(body);
    return { ...stage, ...body };
  }
  if (url === '/projects/7') return project;
  if (url === '/projects/7/steps') return steps;
  if (url === '/personnel') return personnel;
  return [];
});
const confirmAction = vi.fn(async () => true);
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: () => confirmAction() }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canDeliver: true, canRequestPurchase: true,
  }),
}));
vi.mock('../../components/project/ProjectInventoryTab', () => ({ default: () => <div data-testid="materials-tab" /> }));
vi.mock('../../components/project/ProjectScheduleTab', () => ({ default: () => <div data-testid="workshop-tab" /> }));
vi.mock('../../components/project/ProjectGanttTab', () => ({ default: () => <div data-testid="timeline-chart" /> }));
vi.mock('../../components/project/ProjectStockEntryTab', () => ({ default: () => <div data-testid="delivery-tab" /> }));
vi.mock('../../components/project/ProjectProductProgressTab', () => ({ default: () => <div data-testid="progress-tab" /> }));
vi.mock('../../components/project/workspace/ProjectSpecsEditor', () => ({ ProjectSpecsEditor: () => <form data-testid="specs-editor" /> }));
vi.mock('../../components/accounting/FinancialAttachmentUploader', () => ({ FinancialAttachmentUploader: () => null }));

import { renderProjectPage } from './helpers/projectPage';
import { parseProjectWorkspaceTab, projectIdFromParam, projectWorkspacePath } from '../../lib/projects/projectWorkspaceTabs';
import { projectSteps } from '../../lib/projects/projectSteps';
import { currentStepIndex } from '../../components/project/workspace/ProjectStepsBar';
import { stagePersonnelChoices } from '../../components/project/workspace/StagePersonnelPicker';
import type { Personnel } from '../../types';

afterEach(() => { cleanup(); vi.clearAllMocks(); puts.length = 0; confirmAction.mockImplementation(async () => true); });

const location = () => screen.getByTestId('location').textContent;
const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(name) });

// v10.2.x (10.2 package 2, production projects review U1–U6, U16, U18): the project window became a page with its own address
describe('project page addresses (10.2 package 2)', () => {
  it('reads every tab name, the window names of before and nothing else', () => {
    expect(parseProjectWorkspaceTab('delivery')).toBe('delivery');
    expect(parseProjectWorkspaceTab('inventory')).toBe('materials');
    expect(parseProjectWorkspaceTab('product_progress')).toBe('progress');
    expect(parseProjectWorkspaceTab('schedule')).toBe('workshop');
    expect(parseProjectWorkspaceTab('gantt')).toBe('overview');
    expect(parseProjectWorkspaceTab('stock')).toBe('delivery');
    expect(parseProjectWorkspaceTab('nothing')).toBe('overview');
    expect(projectWorkspacePath(7)).toBe('/projects/7');
    expect(projectWorkspacePath(7, 'workshop')).toBe('/projects/7/workshop');
    expect(projectIdFromParam('7')).toBe(7);
    expect(projectIdFromParam('0')).toBeNull();
    expect(projectIdFromParam('PRJ-7')).toBeNull();
  });

  it('turns an old tab name into the tab address and shows that tab', async () => {
    renderProjectPage('/projects/7/inventory');
    expect(await screen.findByTestId('materials-tab')).toBeTruthy();
    await waitFor(() => expect(location()).toBe('/projects/7/materials'));
    expect(tab('۲. مواد').getAttribute('aria-selected')).toBe('true');
  });

  it('shows five tabs and the timeline chart beside the stages, with no workflow box', async () => {
    renderProjectPage();
    expect(await screen.findByTestId('timeline-chart')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.queryByText(/گردش کار/)).toBeNull();
  });

  it('goes back to the project list', async () => {
    renderProjectPage();
    fireEvent.click(await screen.findByRole('button', { name: 'بازگشت به فهرست پروژه‌ها' }));
    await waitFor(() => expect(location()).toBe('/projects'));
  });

  it('says a wrong address instead of loading', () => {
    renderProjectPage('/projects/abc');
    expect(screen.getByRole('alert').textContent).toContain('نشانی پروژه درست نیست.');
  });
});

describe('project step bar (10.2 package 2, U4)', () => {
  it('builds the steps from the record and the counts, and marks the first one not done', async () => {
    const built = projectSteps(project, steps);
    expect(built.map(s => s.state)).toEqual(['done', 'active', 'active', 'todo', 'active', 'active']);
    expect(built[2].note).toBe('۱ درخواست در جریان');
    expect(built[5].note).toBe('۲ از ۱۲ عدد');
    expect(currentStepIndex(built)).toBe(1);
    // a malformed answer reads as not yet known
    expect(projectSteps(project, [] as never)[2].note).toBe('در حال خواندن');

    renderProjectPage();
    const bar = await screen.findByRole('navigation', { name: 'گام‌های پروژه' });
    await waitFor(() => expect(within(bar).getByText('۱ درخواست در جریان')).toBeTruthy());
    const current = within(bar).getAllByRole('button').find(b => b.getAttribute('aria-current') === 'step');
    expect(current?.textContent).toContain('رزرو انبار');
    fireEvent.click(within(bar).getByText('ورود به انبار'));
    await waitFor(() => expect(location()).toBe('/projects/7/delivery'));
  });
});

describe('unsaved changes on the project page (10.2 package 2, U2)', () => {
  it('asks before leaving a tab with a change not saved, and stays when the user chooses to stay', async () => {
    renderProjectPage();
    fireEvent.click(await screen.findByText('ویرایش زمان‌بندی و پرسنل'));
    expect(within(tab('۱. مشخصات')).getByText('ذخیره‌نشده')).toBeTruthy();

    confirmAction.mockImplementation(async () => false);
    fireEvent.click(tab('۳. پیشرفت'));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(location()).toBe('/projects/7');

    confirmAction.mockImplementation(async () => true);
    fireEvent.click(tab('۳. پیشرفت'));
    await waitFor(() => expect(location()).toBe('/projects/7/progress'));
  });

  it('switches tabs without asking when nothing is unsaved', async () => {
    renderProjectPage();
    fireEvent.click(await screen.findByRole('tab', { name: /۴. تقسیم کار/ }));
    await waitFor(() => expect(location()).toBe('/projects/7/workshop'));
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it('asks before following a link of the application', async () => {
    renderProjectPage();
    fireEvent.click(await screen.findByText('ویرایش زمان‌بندی و پرسنل'));
    const link = document.createElement('a');
    link.href = '/documents';
    link.textContent = 'اسناد';
    document.body.appendChild(link);
    try {
      confirmAction.mockImplementation(async () => false);
      fireEvent.click(link);
      await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
      expect(location()).toBe('/projects/7');
      confirmAction.mockImplementation(async () => true);
      fireEvent.click(link);
      await waitFor(() => expect(location()).toBe('/documents'));
    } finally {
      link.remove();
    }
  });

  it('opens the specs on the page with ?edit=1 and marks the tab unsaved', async () => {
    renderProjectPage('/projects/7?edit=1');
    expect(await screen.findByTestId('specs-editor')).toBeTruthy();
    expect(within(tab('۱. مشخصات')).getByText('ذخیره‌نشده')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ویرایش مشخصات' })).toBeNull();
  });
});

describe('stage personnel from the personnel list (10.2 package 2, U18)', () => {
  it('offers working personnel not yet on the stage', () => {
    expect(stagePersonnelChoices(personnel as Personnel[], ['سارا کریمی'])).toEqual(['علی احمدی']);
  });

  it('adds a name from the list, keeps an earlier name and saves the names', async () => {
    renderProjectPage();
    fireEvent.click(await screen.findByText('ویرایش زمان‌بندی و پرسنل'));
    const select = await screen.findByDisplayValue('افزودن از فهرست پرسنل');
    const options = within(select).getAllByRole('option').map(o => o.textContent);
    expect(options).toEqual(['افزودن از فهرست پرسنل', 'سارا کریمی', 'علی احمدی']);
    fireEvent.change(select, { target: { value: 'سارا کریمی' } });
    expect(screen.getByRole('button', { name: 'برداشتن نام قدیمی' })).toBeTruthy();
    fireEvent.click(screen.getByText('ذخیره مرحله'));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].assigned_personnel).toEqual(['نام قدیمی', 'سارا کریمی']);
  });
});
