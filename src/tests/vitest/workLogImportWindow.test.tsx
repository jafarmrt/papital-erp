import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from './helpers/queryWrapper';
import type { ParsedWorkLogRow } from '../../lib/historyImport/workLogSheet';
import type { WorkLogImportResult } from '../../lib/historyImport/workLogImport';

// v12 work-log import: the window behind «ورود کارکرد از اکسل» sends what the server reads and shows what it answers

const keys = { canManageTasks: false, canLog: false, canImportLogs: false, canIssuePayroll: false, canApprovePayroll: false, canPay: false };
vi.mock('../../hooks/usePieceworkPermissions', () => ({ usePieceworkPermissions: () => keys }));

const PREVIEW: WorkLogImportResult = {
  committed: false, okCount: 2, errorCount: 0, duplicateCount: 1,
  rows: [
    { rowNo: 2, status: 'ok', date: '2026-05-21', amount: '10300000' },
    { rowNo: 3, status: 'ok', date: '2026-05-21', amount: '1500000', warnings: ['فی اکسل (۶۰۰٬۰۰۰) با نرخ کنونی برنامه (۵۰۰٬۰۰۰) فرق دارد؛ فی اکسل ثبت می‌شود.'] },
    { rowNo: 4, status: 'duplicate', date: '2026-05-21', amount: '300000', message: 'کارکردی با همین همکار پیش‌تر در برنامه ثبت شده است.' },
  ],
  totals: [{ personnelId: 7, month: '1405-02', rows: 2, amount: '11800000', bookedRows: 1, bookedAmount: '500000' }],
};
const fetchJson = vi.fn(async (url: string, _init?: RequestInit): Promise<unknown> => {
  if (url.startsWith('/personnel')) return [{ id: 7, fullName: 'علی آقایی' }];
  if (url.startsWith('/piecework/tasks')) return [{ id: 1, title: 'برش', unit: 'عدد' }, { id: 2, title: 'آموزش (هرجلسه)', unit: 'ساعت' }];
  if (url.startsWith('/projects/options')) return [{ id: 11, title: 'پروژه آلمان 1405-1', projectCode: 'P-11' }];
  if (url === '/piecework/logs/history-import') return PREVIEW;
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, init?: RequestInit) => fetchJson(url, init), ApiError: class extends Error {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});

const parsed = (rowNo: number, extra: Partial<ParsedWorkLogRow>): ParsedWorkLogRow => ({
  rowNo, sourceRow: '', monthText: '2', personName: 'علی آقایی', activity: 'برش', count: '1', hours: '', rate: '100000', total: '', notes: '', projectName: 'بدون پروژه (عمومی و مشترک)', ...extra,
});
const SHEET_ROWS = [
  parsed(2, { count: '103', total: '10300000', projectName: 'پروژه آلمان 1405-1', sourceRow: '41' }),
  parsed(3, { activity: 'آموزش', count: '', hours: '2.5', rate: '600000', total: '1500000' }),
  parsed(4, { count: '3' }),
  parsed(5, { projectName: '— (حقوق ثابت اردیبهشت)', activity: 'حقوق ثابت', rate: '', total: '150000000' }),
];
vi.mock('../../components/historyImport/workLogImportWorkbook', () => ({
  readWorkLogWorkbook: vi.fn(async () => ({ rows: SHEET_ROWS, sheet: 'کارکرد و پروژه' })),
  loadSavedWorkLogMapping: () => ({ personnel: {}, tasks: {}, projects: {} }),
  saveWorkLogMapping: vi.fn(),
}));

import { PieceworkLogsTab } from '../../components/piecework/PieceworkLogsTab';

const noop = () => undefined;
const renderLogs = () => renderWithQuery(
  <PieceworkLogsTab
    logsList={[]} loading={false} searchQuery="" onSearchChange={noop} selectedPersonnelFilter="all" onPersonnelFilterChange={noop}
    selectedProjectFilter="all" onProjectFilterChange={noop} statusFilter="all" onStatusFilterChange={noop} startDateFilter="" onStartDateChange={noop}
    endDateFilter="" onEndDateChange={noop} personnelSelectOptions={[]} projectSelectOptions={[]} onOpenAddModal={noop} onEditLog={noop} onDeleteLog={noop}
  />,
);
afterEach(() => { cleanup(); fetchJson.mockClear(); });

describe('v12 work-log Excel import window', () => {
  it('shows only with the import key and the hand entry\'s key', () => {
    Object.assign(keys, { canLog: true, canImportLogs: false });
    renderLogs();
    expect(screen.queryByText('ورود کارکرد از اکسل')).toBeNull();
    cleanup();
    Object.assign(keys, { canLog: true, canImportLogs: true });
    renderLogs();
    expect(screen.getByText('ورود کارکرد از اکسل')).toBeTruthy();
  });

  it('maps the known names, sends one resolved row per work row (no fixed-salary row) and shows each colleague\'s month total, warnings and duplicates', async () => {
    Object.assign(keys, { canLog: true, canImportLogs: true });
    renderLogs();
    fireEvent.click(screen.getByText('ورود کارکرد از اکسل'));
    // the lists load before the file is read, so the names are offered at once
    await waitFor(() => expect(fetchJson.mock.calls.some(([u]) => String(u).startsWith('/projects/options'))).toBe(true));
    await waitFor(() => expect(fetchJson.mock.calls.some(([u]) => String(u).startsWith('/piecework/tasks'))).toBe(true));
    await new Promise(r => setTimeout(r, 50));
    fireEvent.change(screen.getByLabelText('پرونده اکسل'), { target: { files: [new File(['x'], 'karkard.xlsx')] } });
    await screen.findByText(/همهٔ نام‌های این ماه نگاشت شده‌اند/);
    expect(screen.getByText(/۳ ردیف آماده، ۰ ردیف بی نگاشت، ۱ ردیف کنار گذاشته/)).toBeTruthy();

    fireEvent.click(screen.getByText('پیش‌نمایش'));
    await screen.findByText(/جمع کارکرد هر همکار/);
    const call = fetchJson.mock.calls.find(([u]) => u === '/piecework/logs/history-import');
    const body = JSON.parse(String(call?.[1]?.body)) as { commit: boolean; rows: Array<Record<string, unknown>> };
    expect(body.commit).toBe(false);
    expect(body.rows).toEqual([
      { rowNo: 2, month: '1405-02', personnelId: 7, taskId: 1, projectId: 11, quantity: '103', unitRate: '100000', excelTotal: '10300000', notes: '(ورود از اکسل، ردیف حقوق 41)' },
      { rowNo: 3, month: '1405-02', personnelId: 7, taskId: 2, projectId: null, quantity: '2.5', unitRate: '600000', excelTotal: '1500000', notes: '(ورود از اکسل)' },
      { rowNo: 4, month: '1405-02', personnelId: 7, taskId: 1, projectId: null, quantity: '3', unitRate: '100000', notes: '(ورود از اکسل)' },
    ]);
    expect(screen.getByText(/نرخ کنونی برنامه/)).toBeTruthy();
    // a colleague with hand-entered work in the month is pointed out (the import's rows on the last day are not held)
    expect(screen.getByText(/۱ ردیف، ۵۰۰٬۰۰۰/)).toBeTruthy();
    expect(screen.getByText(/پیش از ثبت ببینید/)).toBeTruthy();
    expect(screen.getByText('تکراری نیست، ثبت شود')).toBeTruthy();
    // a held row keeps the post closed until the preview passes
    expect(screen.queryByText(/ثبت نهایی/)).toBeNull();
  });
});
