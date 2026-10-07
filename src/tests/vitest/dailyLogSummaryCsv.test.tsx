import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { User } from '../../types';

const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
const fetchJson = vi.fn();
vi.mock('../../api', async (orig) => ({ ...(await orig<typeof import('../../api')>()), fetchJson: (...a: unknown[]) => fetchJson(...a) }));

import { useDailyLogs } from '../../hooks/useDailyLogs';
import { buildSummaryCsv, csvTextCell } from '../../lib/dailyLogs/summaryCsv';

afterEach(() => { cleanup(); fetchJson.mockReset(); toastSuccess.mockReset(); });

// v9.0.217 (TD-640, finding B13-15): the summary CSV never writes a live formula and escapes quotes
describe('daily log summary CSV (TD-640)', () => {
  it('a full name that starts with "=" is not written as a live spreadsheet formula', async () => {
    fetchJson.mockImplementation((url: string) => String(url).startsWith('/daily-logs/summary-report')
      ? Promise.resolve({ user_summaries: [{ userFullName: '=HYPERLINK("http://evil.example","باز کن")', username: 'u1', role: 'viewer', totalHours: 8, daysWorked: 1, logsCount: 1, onsiteCount: 1, remoteCount: 0, avgDailyHours: 8 }] })
      : Promise.resolve([]));
    let captured: Blob | null = null;
    let downloadName = '';
    Object.assign(URL, { createObjectURL: (b: Blob) => { captured = b; return 'blob:x'; }, revokeObjectURL: () => {} });
    const setAttribute = HTMLAnchorElement.prototype.setAttribute;
    vi.spyOn(HTMLAnchorElement.prototype, 'setAttribute').mockImplementation(function (this: HTMLAnchorElement, name: string, value: string) {
      if (name === 'download') downloadName = value;
      setAttribute.call(this, name, value);
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { result } = renderHook(() => useDailyLogs({ id: 1, username: 'admin', role: 'admin' } as unknown as User));
    result.current.setActiveTab('summary');
    await waitFor(() => expect(result.current.summaryReportData).not.toBeNull());
    result.current.handleExportSummaryCSV();
    const text = await new Promise<string>((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.readAsText(captured as unknown as Blob); });
    const firstCell = text.split('\n')[1].split(',')[0];
    expect(firstCell.replace(/^"/, '').startsWith('=')).toBe(false);
    expect(downloadName).toMatch(/^گزارش-کار-(روزانه|ماهانه)-.*\.csv$/);
    expect(String(toastSuccess.mock.calls[0]?.[0])).toContain('CSV');
  });

  it('quotes are doubled and commas stay inside their cell', () => {
    expect(csvTextCell('علی "کوچک", رضایی')).toBe('"علی ""کوچک"", رضایی"');
    expect(csvTextCell('+98912')).toBe(`"'+98912"`);
    expect(csvTextCell('-1')).toBe(`"'-1"`);
    expect(csvTextCell('@x')).toBe(`"'@x"`);
    const row = buildSummaryCsv([{ userFullName: 'الف, ب', username: 'u', totalHours: 7.5 }]).split('\n')[1];
    expect(row.startsWith('"الف, ب","u",')).toBe(true);
  });
});
