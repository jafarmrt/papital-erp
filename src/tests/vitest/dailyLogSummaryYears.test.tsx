import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { DailyLogSummaryView } from '../../components/daily-logs/DailyLogSummaryView';
import { summaryYearOptions } from '../../lib/dailyLogs/summaryYears';

afterEach(() => { cleanup(); vi.useRealTimers(); });

// v9.0.239 (TD-632, finding B13-07): the monthly summary offers the current Jalali year, not a fixed 1402-1405
describe('daily log summary years (TD-632)', () => {
  it('the year picker offers the current Jalali year after Nowruz 1406', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-25T08:00:00Z')); // 5 Farvardin 1406
    const noop = () => {};
    const { container } = render(
      <DailyLogSummaryView summaryMode="monthly" setSummaryMode={noop} summaryDateFilter="1406/01/05" setSummaryDateFilter={noop}
        summaryYear="1406" setSummaryYear={noop} summaryMonth="01" setSummaryMonth={noop} summarySelectedUserId="0"
        setSummarySelectedUserId={noop} summaryReportData={null} summaryLoading={false} systemUsers={[]}
        selectedUserLogsModal={null} setSelectedUserLogsModal={noop} onExportCSV={noop} onPrint={noop} />
    );
    const years = Array.from(container.querySelectorAll('option')).map(o => o.getAttribute('value'));
    expect(years).toContain('1406');
  });

  it('the list is the current year and five before it, plus an older selected year', () => {
    expect(summaryYearOptions('1406', '1406/01/05')).toEqual(['1406', '1405', '1404', '1403', '1402', '1401']);
    expect(summaryYearOptions('1398', '1406/01/05')).toEqual(['1406', '1405', '1404', '1403', '1402', '1401', '1398']);
  });
});
