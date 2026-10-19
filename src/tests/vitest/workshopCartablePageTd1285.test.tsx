import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { rialDisplayOf } from '../../lib/rialDisplay';
import { OFFLINE_SUBMIT_TITLE, PHONE_SHEET_PANEL } from '../../lib/pwa/phoneLayout';
import { workshopRowLink, WORKSHOP_ERRORS } from '../../lib/workshop/workshopSchedule';
import {
  canReportTask, deadlineTone, deliveryNoteError, highlightedRowKey, orderTaskCards, taskCardKey, workshopQuantityError,
  workshopTabOf, workshopTabPath, workshopTabsFor,
} from '../../lib/workshop/workshopView';
import { canOpenPage } from '../../lib/permissions/pageAccess';
import type { MyWorkshopDeliveries, MyWorkshopTasks, WorkshopReviewItem, WorkshopTaskCard } from '../../lib/workshop/workshopContract';

// v10.1.40 (N-01 part 3, TD-1285): the workshop cartable page. A worker sees their schedule rows (a reminder's row first)
// and reports a finished row with at most the planned quantity; the amount appears only once a report is approved
// (decision t7-a); a delivery answer «مغایرت دارد» needs a note (t1-a); a project manager approves with a corrected
// quantity or rejects with a reason, and only a holder of projects.edit is offered the matrix tick (t6-a). Offline, no
// action is sent (t10-a), and Esc does not close a window while its request runs.

const permissions = new Set<string>();
let projectCanReview = false;
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => permissions.has(key),
  useHasAnyPermission: (keys: readonly string[]) => keys.some(k => permissions.has(k)),
}));
vi.mock('../../hooks/useAppCurrency', () => ({ useRialDisplay: () => rialDisplayOf('IRR') }));

const { default: WorkshopPage } = await import('../../pages/WorkshopPage');
const { ProjectWorkshopPanel } = await import('../../components/workshop/ProjectWorkshopPanel');

const card = (rowId: string, over: Partial<WorkshopTaskCard> = {}): WorkshopTaskCard => ({
  projectId: 7, projectCode: 'P-7', projectTitle: 'گردنبند پاییزه', stageId: 3, stageTitle: 'مونتاژ', productId: '11',
  productName: 'گردنبند ستاره', rowId, taskId: 5, taskTitle: 'بستن قفل', quantity: 40, unit: 'عدد', deadline: '2026-10-20',
  daysLeft: 4, report: null, ...over,
});

const tasksAnswer: MyWorkshopTasks = {
  personnel: { id: 2, fullName: 'مریم کارگر' },
  tasks: [card('row-a'), card('row-b', { taskTitle: 'پرداخت', daysLeft: -2 })],
  approved: [{ reportId: 9, projectCode: 'P-7', projectTitle: 'گردنبند پاییزه', stageTitle: 'برش', productName: 'گردنبند ستاره', taskTitle: 'برش زنجیر', quantity: 30, amount: 1250000, reviewedAt: '2026-10-10T08:00:00Z' }],
};

const deliveriesAnswer: MyWorkshopDeliveries = {
  personnel: { id: 2, fullName: 'مریم کارگر' },
  deliveries: [{ kind: 'document', id: 44, reference: '1205', date: '2026-10-12', projectTitle: 'گردنبند پاییزه', lines: [{ itemCode: 'M-1', itemName: 'مهره', quantity: 200, unit: 'عدد' }], confirmation: null }],
};

const reviewItem: WorkshopReviewItem = {
  report: { id: 31, status: 'submitted', quantity: 40, approvedQuantity: null, notes: 'تمام شد', reviewNote: '', version: 1, createdAt: '2026-10-14T09:00:00Z', reviewedAt: null },
  projectId: 7, projectCode: 'P-7', projectTitle: 'گردنبند پاییزه', stageId: 3, stageTitle: 'مونتاژ', productId: '11',
  productName: 'گردنبند ستاره', rowId: 'row-a', taskTitle: 'بستن قفل', plannedQuantity: 40, unit: 'عدد', personnelId: 2,
  personnelName: 'مریم کارگر', deadline: '2026-10-20', manualLogs: [], isOwn: false,
};
let reviewAnswer: WorkshopReviewItem = reviewItem;

function answer(url: string, init?: { method?: string; body?: string }): unknown {
  if (url === '/workshop/my-tasks') return tasksAnswer;
  if (url === '/workshop/my-deliveries') return deliveriesAnswer;
  if (url === '/workshop/review/reports') return { data: [reviewAnswer] };
  if (url === '/workshop/projects/7/reports') {
    return { pending: projectCanReview ? [reviewItem] : [], stageProgress: [{ stageId: 3, plannedQuantity: 80, approvedQuantity: 40, unit: 'عدد', percent: 50 }, { stageId: 4, plannedQuantity: 14, approvedQuantity: 9, unit: null, percent: 75 }], canReview: projectCanReview };
  }
  if (url === '/workshop/reports/31/approve') {
    return { reportId: 31, pieceworkLogId: 77, matrixTickSuggestion: { projectId: 7, stageId: 3, stageOrder: 2, stageTitle: 'مونتاژ', productId: '11', productName: 'گردنبند ستاره', itemId: 11 } };
  }
  if (init?.method) return { report: reviewItem.report };
  throw new Error(`unexpected ${url}`);
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/workshop" element={<WorkshopPage />} />
          <Route path="/workshop/review" element={<WorkshopPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  permissions.clear();
  projectCanReview = false;
  reviewAnswer = reviewItem;
  fetchJson.mockReset();
  fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => answer(url, init));
});

afterEach(() => {
  cleanup();
  act(() => { window.dispatchEvent(new Event('online')); });
});

describe('workshop cartable rules (N-01 part 3)', () => {
  it('gives each viewer only the tabs of their keys and opens the page of each key', () => {
    expect(workshopTabsFor({ self: true, review: false })).toEqual(['tasks', 'deliveries']);
    expect(workshopTabsFor({ self: false, review: true })).toEqual(['review']);
    expect(workshopTabOf('/workshop/review', '', ['tasks', 'deliveries', 'review'])).toBe('review');
    expect(workshopTabOf('/workshop', '?tab=deliveries', ['tasks', 'deliveries'])).toBe('deliveries');
    expect(workshopTabPath('review')).toBe('/workshop/review');
    expect(canOpenPage('/workshop', { permissions: ['workshop.self'], isAdmin: false })).toBe(true);
    expect(canOpenPage('/workshop', { permissions: ['workshop.review'], isAdmin: false })).toBe(false);
    expect(canOpenPage('/workshop/review', { permissions: ['workshop.review'], isAdmin: false })).toBe(true);
  });

  it('brings the row of a reminder link to the top', () => {
    const link = workshopRowLink({ projectId: 7, stageId: 3, productId: '11', rowId: 'row-b' });
    const key = highlightedRowKey(link.slice(link.indexOf('?')));
    expect(key).toBe('7:3:11:row-b');
    expect(orderTaskCards(tasksAnswer.tasks, key).map(taskCardKey)).toEqual(['7:3:11:row-b', '7:3:11:row-a']);
  });

  it('colours the deadline and checks the quantity and the delivery note like the server', () => {
    expect([deadlineTone(null), deadlineTone(5), deadlineTone(1), deadlineTone(-1)]).toEqual(['none', 'normal', 'soon', 'overdue']);
    expect(workshopQuantityError('41', 40)).toBe(WORKSHOP_ERRORS.quantityExceeded.message);
    expect(workshopQuantityError('0', 40)).toBe(WORKSHOP_ERRORS.quantityInvalid.message);
    expect(workshopQuantityError('', 40)).not.toBeNull();
    expect(workshopQuantityError('40', 40)).toBeNull();
    expect(deliveryNoteError('discrepancy', ' ')).not.toBeNull();
    expect(deliveryNoteError('received', '')).toBeNull();
    expect(canReportTask(card('x', { taskId: null }))).toBe(false);
    expect(canReportTask(card('x', { report: { ...reviewItem.report, status: 'rejected' } }))).toBe(true);
    expect(canReportTask(card('x', { report: reviewItem.report }))).toBe(false);
    // TD-1284 review: a row without a planned quantity takes no report
    expect(workshopQuantityError('1', 0)).toBe(WORKSHOP_ERRORS.rowQuantityMissing.message);
    expect(canReportTask(card('x', { quantity: 0 }))).toBe(false);
  });
});

describe('workshop cartable page (N-01 part 3)', () => {
  it('shows a worker their tasks, the reminded row first, and the amount only of approved work', async () => {
    permissions.add('workshop.self');
    renderAt(`/workshop?row=${encodeURIComponent('7:3:11:row-b')}`);
    const cards = await screen.findAllByRole('listitem');
    expect(cards[0].getAttribute('data-task-key')).toBe('7:3:11:row-b');
    expect(within(cards[0]).getByText('۲ روز از مهلت گذشته')).toBeTruthy();
    const approved = screen.getByRole('region', { name: 'کارهای تأییدشده' });
    expect(within(approved).getByText('۱٬۲۵۰٬۰۰۰ ریال')).toBeTruthy();
    for (const c of cards.slice(0, 2)) expect(within(c).queryByText(/ریال/)).toBeNull();
    expect(screen.queryByRole('tab', { name: /بررسی گزارش‌ها/ })).toBeNull();
  });

  it('says a row without a planned quantity cannot be reported, with no report button', async () => {
    permissions.add('workshop.self');
    fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) =>
      (url === '/workshop/my-tasks' ? { ...tasksAnswer, tasks: [card('row-z', { quantity: 0 })], approved: [] } : answer(url, init)));
    renderAt('/workshop');
    const [only] = await screen.findAllByRole('listitem');
    expect(within(only).getByText(WORKSHOP_ERRORS.rowQuantityMissing.message)).toBeTruthy();
    expect(within(only).queryByRole('button', { name: 'گزارش پایان کار' })).toBeNull();
  });

  it('refuses a quantity above the plan before sending and sends the report on a phone sheet', async () => {
    permissions.add('workshop.self');
    renderAt('/workshop');
    fireEvent.click((await screen.findAllByRole('button', { name: /گزارش پایان کار/ }))[0]);
    const sheet = screen.getByRole('dialog', { name: 'گزارش پایان کار' });
    expect(sheet.getAttribute('class')).toContain(PHONE_SHEET_PANEL);
    const qty = within(sheet).getByLabelText(/تعداد انجام‌شده/);
    fireEvent.change(qty, { target: { value: '۴۵' } });
    fireEvent.blur(qty);
    const send = within(sheet).getByRole<HTMLButtonElement>('button', { name: 'ارسال گزارش' });
    expect(send.disabled).toBe(true);
    expect(within(sheet).getByText(WORKSHOP_ERRORS.quantityExceeded.message)).toBeTruthy();
    fireEvent.change(qty, { target: { value: '۳۸' } });
    fireEvent.blur(qty);
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/workshop/reports', expect.objectContaining({ method: 'POST' })));
    const body = JSON.parse((fetchJson.mock.calls.find(c => c[0] === '/workshop/reports')?.[1] as { body: string }).body);
    expect(body).toMatchObject({ projectId: 7, stageId: 3, productId: '11', rowId: 'row-a', quantity: '38' });
  });

  it('keeps every action off while offline and Esc from closing a window whose request runs', async () => {
    permissions.add('workshop.self');
    renderAt('/workshop');
    fireEvent.click((await screen.findAllByRole('button', { name: /گزارش پایان کار/ }))[0]);
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'ارسال گزارش' });
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(send.disabled).toBe(true);
    expect(send.getAttribute('title')).toBe(OFFLINE_SUBMIT_TITLE);
    act(() => { window.dispatchEvent(new Event('online')); });
    fetchJson.mockImplementation((url: string, init?: { method?: string }) => (init?.method ? new Promise(() => undefined) : Promise.resolve(answer(url, init))));
    fireEvent.click(send);
    await waitFor(() => expect(send.disabled).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'گزارش پایان کار' })).toBeTruthy();
  });

  it('asks a note for a delivery discrepancy', async () => {
    permissions.add('workshop.self');
    renderAt('/workshop?tab=deliveries');
    fireEvent.click(await screen.findByRole('button', { name: /پاسخ دریافت/ }));
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByLabelText('مغایرت دارد'));
    const send = within(sheet).getByRole<HTMLButtonElement>('button', { name: 'ثبت پاسخ' });
    expect(send.disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText('توضیح'), { target: { value: 'ده مهره کم بود' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/workshop/deliveries/confirm', expect.anything()));
    const body = JSON.parse((fetchJson.mock.calls.find(c => c[0] === '/workshop/deliveries/confirm')?.[1] as { body: string }).body);
    expect(body).toEqual({ kind: 'document', id: 44, status: 'discrepancy', note: 'ده مهره کم بود' });
  });

  it('approves with a corrected quantity and offers the matrix tick only to a holder of projects.edit', async () => {
    permissions.add('workshop.review');
    permissions.add('projects.edit');
    renderAt('/workshop/review');
    fireEvent.click(await screen.findByRole('button', { name: /^تأیید$/ }));
    const sheet = screen.getByRole('dialog', { name: 'تأیید گزارش پایان کار' });
    const qty = within(sheet).getByLabelText(/تعداد تأییدشده/);
    fireEvent.change(qty, { target: { value: '36' } });
    fireEvent.blur(qty);
    fireEvent.click(within(sheet).getByRole('button', { name: 'تأیید و ثبت کارکرد' }));
    const tick = await screen.findByRole('dialog', { name: 'تیک جدول پیشرفت' });
    const body = JSON.parse((fetchJson.mock.calls.find(c => c[0] === '/workshop/reports/31/approve')?.[1] as { body: string }).body);
    expect(body).toMatchObject({ version: 1, quantity: '36' });
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.click(within(tick).getByRole('button', { name: 'تیک بزن' }));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/projects/7/product-progress', expect.objectContaining({ method: 'PUT' })));
  });

  it('shows the manual work logs of the same task and approves only after the explicit acknowledgement', async () => {
    permissions.add('workshop.review');
    reviewAnswer = { ...reviewItem, manualLogs: [{ id: 88, date: '2026-10-11', quantity: 12 }] };
    renderAt('/workshop/review');
    expect(await screen.findByText(/کارکرد دستی/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^تأیید$/ }));
    const sheet = screen.getByRole('dialog', { name: 'تأیید گزارش پایان کار' });
    expect(within(sheet).getByText(/۱۲/)).toBeTruthy();
    const approve = within(sheet).getByRole<HTMLButtonElement>('button', { name: 'تأیید و ثبت کارکرد' });
    expect(approve.disabled).toBe(true);
    fireEvent.click(within(sheet).getByLabelText(/بررسی کردم/));
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    await waitFor(() => expect(fetchJson.mock.calls.some(c => c[0] === '/workshop/reports/31/approve')).toBe(true));
    const body = JSON.parse((fetchJson.mock.calls.find(c => c[0] === '/workshop/reports/31/approve')?.[1] as { body: string }).body);
    expect(body.acknowledgedManualLogIds).toEqual([88]);
  });

  it('takes the server\'s new manual work logs after a 409 and asks for the acknowledgement again', async () => {
    permissions.add('workshop.review');
    reviewAnswer = { ...reviewItem, manualLogs: [{ id: 88, date: '2026-10-11', quantity: 12 }] };
    let approveCalls = 0;
    fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (url === '/workshop/reports/31/approve' && ++approveCalls === 1) {
        throw Object.assign(new Error(WORKSHOP_ERRORS.manualLogsExist.message), {
          code: WORKSHOP_ERRORS.manualLogsExist.code, status: 409,
          details: { manualLogs: [{ id: 88, date: '2026-10-11', quantity: 12 }, { id: 95, date: '2026-10-13', quantity: 7 }] },
        });
      }
      return answer(url, init);
    });
    renderAt('/workshop/review');
    fireEvent.click(await screen.findByRole('button', { name: /^تأیید$/ }));
    const sheet = screen.getByRole('dialog', { name: 'تأیید گزارش پایان کار' });
    const approve = within(sheet).getByRole<HTMLButtonElement>('button', { name: 'تأیید و ثبت کارکرد' });
    const ack = within(sheet).getByLabelText<HTMLInputElement>(/بررسی کردم/);
    fireEvent.click(ack);
    fireEvent.click(approve);
    expect(await within(sheet).findByText(/کارکرد شماره ۹۵/)).toBeTruthy();
    expect(ack.checked).toBe(false);
    expect(approve.disabled).toBe(true);
    fireEvent.click(ack);
    fireEvent.click(approve);
    await waitFor(() => expect(approveCalls).toBe(2));
    const sent = fetchJson.mock.calls.filter(c => c[0] === '/workshop/reports/31/approve').map(c => JSON.parse((c[1] as { body: string }).body).acknowledgedManualLogIds);
    expect(sent).toEqual([[88], [88, 95]]);
  });

  it('offers no approve or reject on the reviewer\'s own report and says why', async () => {
    permissions.add('workshop.review');
    reviewAnswer = { ...reviewItem, isOwn: true };
    renderAt('/workshop/review');
    expect(await screen.findByText(/گزارش خودتان را نمی‌توانید تأیید یا رد کنید/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^تأیید$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^رد$/ })).toBeNull();
  });

  it('does not offer the tick without projects.edit and asks a reason to reject', async () => {
    permissions.add('workshop.review');
    renderAt('/workshop/review');
    fireEvent.click(await screen.findByRole('button', { name: /^تأیید$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'تأیید و ثبت کارکرد' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const body = JSON.parse((fetchJson.mock.calls.find(c => c[0] === '/workshop/reports/31/approve')?.[1] as { body: string }).body);
    expect(body.quantity).toBeUndefined();
    expect(screen.queryByRole('dialog', { name: 'تیک جدول پیشرفت' })).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: /^رد$/ }));
    const reject = screen.getByRole<HTMLButtonElement>('button', { name: 'رد گزارش' });
    expect(reject.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('دلیل رد'), { target: { value: 'تعداد اشتباه است' } });
    expect(reject.disabled).toBe(false);
  });
});

describe('workshop reports in the project schedule (N-01 part 3)', () => {
  const renderPanel = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProjectWorkshopPanel projectId={7} stages={[{ id: 3, title: 'مونتاژ' }]} />
    </QueryClientProvider>,
  );

  it('shows each stage\'s approved share and no review buttons to a reader who does not review', async () => {
    permissions.add('projects.view');
    renderPanel();
    const bar = await screen.findByRole('progressbar', { name: 'مونتاژ' });
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(screen.getByText(/۴۰ از ۸۰ عدد · ۵۰٪/)).toBeTruthy();
    // 10.2 package 12 (D6): a stage whose rows have several units shows only its percent
    expect(screen.getByText('۷۵٪')).toBeTruthy();
    expect(screen.queryByText(/۹ از ۱۴/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^تأیید$/ })).toBeNull();
  });

  it('lets a manager of the project review the waiting reports in place', async () => {
    permissions.add('projects.view');
    permissions.add('workshop.review');
    projectCanReview = true;
    renderPanel();
    expect(await screen.findByRole('button', { name: /^تأیید$/ })).toBeTruthy();
    expect(screen.getByText(/مریم کارگر: بستن قفل/)).toBeTruthy();
  });
});
