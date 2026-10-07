/**
 * v9.0.216 (TD-538, B02-23, owner decision t8 A): the audit log shows every action in Persian from one table (page badge,
 * action filter, print, Excel), and the Excel file is named with today's Jalali date in the display time zone. The Excel
 * export used to write the raw code (LOGIN_FAILED) and name the file with the UTC Gregorian day
 * (00:15 Tehran on 14 Mehr 1405 gave 2026-10-05).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ActivityLogsPage from '../../pages/ActivityLogsPage';
import { SearchProvider } from '../../SearchContext';
import { AUDIT_ACTION_LABELS, auditActionLabel } from '../../lib/audit/auditActionLabels';
import { exportAuditLogsToExcel } from '../../components/audit/auditExportUtils';
import { codeAuditWrites, migrationAuditWrites } from './support/auditWriteScan';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

const jsonToSheet = vi.fn((rows: unknown[]) => ({ rows }));
const writeFile = vi.fn();
vi.mock('xlsx', () => ({
  utils: { json_to_sheet: (rows: unknown[]) => jsonToSheet(rows), book_new: () => ({}), book_append_sheet: () => undefined },
  writeFile: (...args: unknown[]) => writeFile(...args),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  fetchJson.mockReset();
  jsonToSheet.mockClear();
  writeFile.mockClear();
});

const PERSIAN_LABEL = /^[؀-ۿ‌ ]+$/;
const failedLogin = {
  id: 7, username: 'ali', userFullName: 'علی', action: 'LOGIN_FAILED', entity: 'احراز هویت', entityId: null,
  description: 'ورود ناموفق علی', ipAddress: '10.0.0.1', timestamp: '2026-10-05T20:45:00Z', details: {},
};

describe('audit action labels (TD-538)', () => {
  it('labels in Persian every action the code writes into the audit log', () => {
    const uses = [...codeAuditWrites('action'), ...migrationAuditWrites('action')];
    expect(uses.filter(u => u.unresolved.length > 0 || u.heads.length > 0).map(u => `${u.file}:${u.line}`)).toEqual([]);
    const written = [...new Set(uses.flatMap(u => u.names))].sort();
    expect(written).toEqual(expect.arrayContaining(['CREATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PURGE', 'UPDATE']));
    for (const action of written) expect(auditActionLabel(action), action).toMatch(PERSIAN_LABEL);
    for (const label of Object.values(AUDIT_ACTION_LABELS)) expect(label).toMatch(PERSIAN_LABEL);
    expect(auditActionLabel('LOGIN_FAILED')).toBe('ورود ناموفق');
    expect(auditActionLabel('PURGE')).toBe('پاک‌سازی سجل');
  });

  it('writes the Persian action and names the Excel file with the Jalali day of Tehran', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T20:45:00Z')); // 00:15 Tehran, 14 Mehr 1405
    await exportAuditLogsToExcel([failedLogin]);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0][1]).toBe('گزارش-سجل-رویدادها-1405-07-14.xlsx');
    expect((jsonToSheet.mock.calls[0][0] as Array<Record<string, unknown>>)[0]['نوع اقدام']).toBe('ورود ناموفق');
  });

  it('shows the Persian action on the page badge, in the action filter and on the print', async () => {
    fetchJson.mockImplementation(async (url: string) => (url === '/activity-logs/filters'
      ? { users: [], actions: ['LOGIN_FAILED', 'UPDATE'], entities: [] }
      : { data: [failedLogin], total: 1, totalPages: 1 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SearchProvider>
          <ActivityLogsPage />
        </SearchProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('ورود ناموفق علی');
    const row = screen.getByText('ورود ناموفق علی').closest('tr') as HTMLElement;
    expect(row.textContent).toContain('ورود ناموفق');

    const filter = (screen.getAllByRole('combobox') as HTMLSelectElement[])
      .find(select => [...select.options].some(o => o.value === 'LOGIN_FAILED')) as HTMLSelectElement;
    const options = [...filter.options].map(o => o.textContent ?? '');
    expect(options.filter(text => /[A-Za-z]/.test(text))).toEqual([]);
    expect(options).toContain('پاک‌سازی سجل');

    fireEvent.change(filter, { target: { value: 'LOGIN_FAILED' } });
    fireEvent.click(screen.getByRole('button', { name: /پیش‌نمایش چاپ امنیتی/ }));
    const sheet = (await screen.findByText('تعداد کل رکوردها:')).closest('.doc-print-area') as HTMLElement;
    expect(within(sheet).queryByText('LOGIN_FAILED')).toBeNull();
    expect(within(sheet).getAllByText('ورود ناموفق').length).toBeGreaterThanOrEqual(2); // the action filter and the row
  });
});
