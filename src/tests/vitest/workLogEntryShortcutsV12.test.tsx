import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ComponentProps } from 'react';

vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});

import { PieceworkLogModal, EDIT_TASK_RATE_NOTE } from '../../components/piecework/PieceworkLogModal';
import { BATCH_LOG_TEXT, batchLogTotals } from '../../components/piecework/PieceworkBatchLogRows';
import { InvoiceLinePicker } from '../../components/invoices/create/InvoiceLinePicker';
import { isAddRowShortcut } from '../../lib/addRowShortcut';
import { workLogEditPayload, type BatchLogRow, type EditingWorkLog } from '../../hooks/usePiecework';
import type { PieceworkTask } from '../../types';

// v12 (start plan V12_WORKLOG_IMPORT_START_PLAN.md part B): the batch work-log form adds a row on Alt+N or Insert like the
// voucher form, shows the rows' total while they are typed, is wide enough for one line per row, and the edit form changes a
// log's task title; the sales invoice adds its line on Alt+N

const TASKS = [
  { id: 1, title: 'برش', unit: 'عدد', defaultRate: 1000 },
  { id: 2, title: 'آموزش (هرجلسه)', unit: 'ساعت', defaultRate: 600000 },
] as unknown as PieceworkTask[];
const row = (taskId: number | '', quantity: string, unitRate: number): BatchLogRow => ({ rowKey: `k${taskId}${quantity}`, taskId, projectId: '', quantity, unitRate } as BatchLogRow);

afterEach(() => cleanup());

function BatchForm({ initial, onAdd }: { initial: BatchLogRow[]; onAdd: () => void }) {
  const [rows, setRows] = useState(initial);
  const props: ComponentProps<typeof PieceworkLogModal> = {
    isOpen: true, onClose: () => undefined, onSubmit: (e) => e.preventDefault(), editingLog: null, setEditingLog: vi.fn(),
    selectedPersonnelForLog: '', setSelectedPersonnelForLog: vi.fn(), defaultBatchProjectId: '', setDefaultBatchProjectId: vi.fn(),
    logDate: '1405/09/05', setLogDate: vi.fn(), batchLogRows: rows, setBatchLogRows: setRows, tasksList: TASKS,
    personnelSelectOptions: [], projectSelectOptions: [], taskSelectOptions: TASKS.map(t => ({ value: String(t.id), label: t.title })),
    onTaskChangeInRow: vi.fn(), onAddLogRow: () => { onAdd(); setRows(r => [...r, row('', '1', 0)]); }, onRemoveLogRow: vi.fn(),
  };
  return <QueryClientProvider client={new QueryClient()}><PieceworkLogModal {...props} /></QueryClientProvider>;
}

describe('v12 batch work-log form', () => {
  it('reads Alt+N, its key on a Persian layout and Insert as a new row; not Ctrl+Alt+N, Shift+Insert (paste) or a held key', () => {
    const key = (k: string, extra: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; repeat: boolean }> = {}) =>
      isAddRowShortcut({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, key: k, ...extra });
    expect(key('n', { altKey: true })).toBe(true);
    expect(key('د', { altKey: true })).toBe(true);
    expect(key('Insert')).toBe(true);
    expect(key('n', { altKey: true, ctrlKey: true })).toBe(false);
    expect(key('n')).toBe(false);
    expect(key('Insert', { shiftKey: true })).toBe(false);
    expect(key('Insert', { ctrlKey: true })).toBe(false);
    expect(key('n', { altKey: true, repeat: true })).toBe(false);
  });

  it('adds a row on Alt+N with the focus on its task, and is a wide window', () => {
    const onAdd = vi.fn();
    render(<BatchForm initial={[row(1, '3', 1000)]} onAdd={onAdd} />);
    act(() => { fireEvent.keyDown(window, { key: 'n', altKey: true }); });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.id).toMatch(/-task-id-1$/);
    expect(screen.getByTitle(BATCH_LOG_TEXT.shortcut)).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('class')).toContain('sm:max-w-6xl');
    act(() => { fireEvent.keyDown(window, { key: 'Insert', shiftKey: true }); });
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('shows the total of the rows that will be sent: amount, and each unit\'s quantity (hours as hours)', () => {
    const rows = [row(1, '3', 1000), row(2, '1:30', 600000), row(1, '2', 1000), row('', '5', 99), row(1, '0', 1000)];
    expect(batchLogTotals(rows, TASKS)).toEqual({ count: 3, amount: 905000, quantities: [{ unit: 'عدد', quantity: 5 }, { unit: 'ساعت', quantity: 1.5 }] });
    render(<BatchForm initial={rows} onAdd={vi.fn()} />);
    const total = screen.getByRole('status', { name: BATCH_LOG_TEXT.total });
    expect(total.textContent).toContain('۳ ردیف');
    expect(total.textContent).toContain('۹۰۵٬۰۰۰');
    expect(total.textContent).toContain('۵ عدد');
  });
});

describe('v12 work-log edit: the task title', () => {
  const log = { id: 9, personnelName: 'رضا', date: '2026-10-09', taskId: 1, unit: 'عدد', quantity: 4, unitRate: 3000, projectId: null, originalTaskId: 1, originalUnitRate: 3000, rateEdited: false, version: 3 } as unknown as EditingWorkLog;

  it('sends the new task without a rate unless one was typed, and no task when it did not change', () => {
    expect(workLogEditPayload(log, 4)).toEqual({ date: '2026-10-09', projectId: null, quantity: 4, version: 3, unitRate: 3000 });
    expect(workLogEditPayload({ ...log, taskId: 2, unitRate: 600000 }, 4)).toEqual({ date: '2026-10-09', projectId: null, quantity: 4, version: 3, taskId: 2 });
    expect(workLogEditPayload({ ...log, taskId: 2, unitRate: 700000, rateEdited: true }, 4)).toEqual({ date: '2026-10-09', projectId: null, quantity: 4, version: 3, taskId: 2, unitRate: 700000 });
  });

  it('offers the task titles on the edit form and says where the new rate comes from', () => {
    function EditForm() {
      const [editing, setEditing] = useState<EditingWorkLog | null>(log);
      return (
        <QueryClientProvider client={new QueryClient()}>
          <PieceworkLogModal isOpen onClose={() => undefined} onSubmit={(e) => e.preventDefault()} editingLog={editing} setEditingLog={setEditing}
            selectedPersonnelForLog="" setSelectedPersonnelForLog={vi.fn()} defaultBatchProjectId="" setDefaultBatchProjectId={vi.fn()} logDate="" setLogDate={vi.fn()}
            batchLogRows={[]} setBatchLogRows={vi.fn()} tasksList={TASKS} personnelSelectOptions={[]} projectSelectOptions={[]}
            taskSelectOptions={TASKS.map(t => ({ value: String(t.id), label: t.title }))} onTaskChangeInRow={vi.fn()} onAddLogRow={vi.fn()} onRemoveLogRow={vi.fn()}
            suggestedLogRate={(taskId) => (taskId === 2 ? 650000 : 1000)} />
        </QueryClientProvider>
      );
    }
    render(<EditForm />);
    const picker = screen.getByRole('button', { name: /عنوان کاری/ });
    expect(picker.textContent).toContain('برش');
    expect(screen.queryByText(EDIT_TASK_RATE_NOTE)).toBeNull();
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole('option', { name: 'آموزش (هرجلسه)' }));
    expect(screen.getByText(EDIT_TASK_RATE_NOTE)).toBeTruthy();
    expect(screen.getByLabelText(/تعداد \/ کارکرد \(ساعت\)/)).toBeTruthy();
    // the colleague's custom rate of the new task is shown, as the server will take it
    expect((screen.getByLabelText(/نرخ واحد/) as HTMLInputElement).value).toContain('۶۵۰');
    // a wrong pick taken back restores the log's own (manual) rate
    fireEvent.click(screen.getByRole('button', { name: /عنوان کاری/ }));
    fireEvent.click(screen.getByRole('option', { name: 'برش' }));
    expect((screen.getByLabelText(/نرخ واحد/) as HTMLInputElement).value).toContain('۳٬۰۰۰');
    expect(screen.queryByText(EDIT_TASK_RATE_NOTE)).toBeNull();
  });
});

describe('v12 sales invoice line picker', () => {
  it('adds the line on Alt+N or Insert as the button does, but not while a window is open over the page', () => {
    const onAdd = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InvoiceLinePicker location="" status="proforma" editingDocId={null} warehouses={[]} currency="IRR" selectedItem="" onItemSelect={vi.fn()} prices={[]}
          quantity="" onQuantityChange={vi.fn()} unitPrice="" onUnitPriceChange={vi.fn()} discount="" onDiscountChange={vi.fn()} onAdd={onAdd} />
      </QueryClientProvider>,
    );
    act(() => { fireEvent.keyDown(window, { key: 'n', altKey: true }); });
    act(() => { fireEvent.keyDown(window, { key: 'Insert' }); });
    expect(onAdd).toHaveBeenCalledTimes(2);
    const over = document.createElement('div');
    over.setAttribute('role', 'dialog');
    over.setAttribute('aria-modal', 'true');
    document.body.appendChild(over);
    act(() => { fireEvent.keyDown(window, { key: 'n', altKey: true }); });
    expect(onAdd).toHaveBeenCalledTimes(2);
    over.remove();
  });
});
