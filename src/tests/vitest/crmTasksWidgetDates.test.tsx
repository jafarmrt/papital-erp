import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CRMTasksWidget } from '../../components/dashboard/CRMTasksWidget';
import { getTodayJalaliDate, toStorageDate } from '../../utils';
import type { CRMActivity } from '../../types';

afterEach(cleanup);

// v7.0.132 (TD-232): سررسید پیگیری CRM میلادی ISO از API می‌آید؛ ویجت داشبورد آن را با امروز شمسی مقایسه می‌کند
function shiftIso(days: number): string {
  const today = toStorageDate(getTodayJalaliDate()) as string;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const activity = (id: number, title: string, nextFollowUpDate: string): CRMActivity => ({
  id, title, type: 'call', nextFollowUpDate, isFollowUpCompleted: 0,
} as CRMActivity);

describe('CRMTasksWidget with ISO follow-up dates', () => {
  it('lists an overdue ISO follow-up under «today and overdue» and leaves a future one out', () => {
    render(
      <MemoryRouter>
        <CRMTasksWidget leads={[]} activities={[activity(1, 'پیگیری معوق آزمون', shiftIso(-2)), activity(2, 'پیگیری آینده آزمون', shiftIso(40))]} />
      </MemoryRouter>
    );
    expect(screen.getByText('پیگیری معوق آزمون')).toBeTruthy();
    expect(screen.getByText('معوق')).toBeTruthy();
    expect(screen.queryByText('پیگیری آینده آزمون')).toBeNull();
  });
});
