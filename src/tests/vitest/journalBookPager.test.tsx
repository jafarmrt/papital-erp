import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { JournalBookView } from '../../components/accounting/reports/JournalBookView';
import { JOURNAL_BOOK_REPORT } from '../../hooks/accounting/useFinancialReportQueries';
import type { JournalBookReport } from '../../lib/accounting/journalBook';

// v9.0.213 (TD-561, B03-19): the journal book asks the server for one page of rows and pages through the range; the
// footer totals cover the whole range. Before, the whole range came at once and every row was sent twice.

const row = (n: number) => ({
  rowNumber: n, voucherId: n, voucherNumber: n, date: '2026-10-01', voucherType: 'general', accountCode: '1001',
  accountName: 'صندوق', accountLevel: 'subsidiary', description: `ردیف ${n}`, debit: 10, credit: 0, runningBalance: 10 * n,
});
const report = (page: number): JournalBookReport => ({
  items: [row((page - 1) * 200 + 1)], totalDebit: 4500, totalCredit: 4500, reportCurrency: 'IRR', vouchersCount: 225,
  isBalanced: true, total: 450, page, limit: 200,
});

afterEach(() => cleanup());

describe('journal book paging (TD-561)', () => {
  it('asks for one page of the range and reads the bare report', () => {
    const url = JOURNAL_BOOK_REPORT.url({ startDate: '2026-03-21', endDate: '2026-10-07', page: 2 });
    const params = new URL(url, 'http://x').searchParams;
    expect(params.get('page')).toBe('2');
    expect(params.get('limit')).toBe('200');
    expect(params.get('startDate')).toBe('2026-03-21');
    expect(JOURNAL_BOOK_REPORT.parse(report(1))).toEqual(report(1));
  });

  it('shows where the page sits in the range and moves to the next and previous page', () => {
    const onPageChange = vi.fn();
    const { rerender } = render(
      <JournalBookView journalLoading={false} journalBookData={report(1)} onFetchJournalBook={() => undefined} onPageChange={onPageChange} />,
    );
    expect(screen.getByText('صفحه ۱ از ۳')).toBeTruthy();
    expect(screen.getByText('ردیف ۱ تا ۲۰۰ از ۴۵۰ ردیف')).toBeTruthy();
    expect(screen.getByText(/جمع کل دفتر روزنامه در بازه/).textContent).toContain('۲۲۵');
    expect((screen.getByText('صفحه قبل') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('صفحه بعد'));
    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(
      <JournalBookView journalLoading={false} journalBookData={report(3)} onFetchJournalBook={() => undefined} onPageChange={onPageChange} />,
    );
    expect(screen.getByText('ردیف ۴۰۱ تا ۴۵۰ از ۴۵۰ ردیف')).toBeTruthy();
    expect((screen.getByText('صفحه بعد') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('صفحه قبل'));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
  });
});
