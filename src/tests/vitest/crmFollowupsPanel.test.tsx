import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CRMActivity } from '../../types';
import { getTodayJalaliDate, toPersianDigits, toStorageDate } from '../../utils';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

import { CRMFollowupsView } from '../../components/crm/CRMFollowupsView';
import { CRMTasksWidget } from '../../components/dashboard/CRMTasksWidget';

function shiftIso(days: number): string {
  const d = new Date(`${toStorageDate(getTodayJalaliDate()) as string}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const followup = (id: number, title: string, nextFollowUpDate: string, isFollowUpCompleted = 0): CRMActivity => ({
  id, title, type: 'call', nextFollowUpDate, nextFollowUpTask: `کار ${title}`, isFollowUpCompleted, activityDate: shiftIso(-40),
} as CRMActivity);

const calledUrls = () => fetchJson.mock.calls.map(c => String(c[0]));

beforeEach(() => {
  fetchJson.mockImplementation((url: string) => {
    const completed = url.includes('status=completed');
    const data = completed ? [followup(2, 'پیگیری انجام‌شده', shiftIso(-3), 1)] : [followup(1, 'پیگیری اقدام قدیمی', shiftIso(-5))];
    return Promise.resolve({ data, total: 1, page: 1, limit: 12, totalPages: 1, dueCount: completed ? 0 : 1, openCount: 1 });
  });
});

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

const withClient = (node: ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{node}</MemoryRouter>
  </QueryClientProvider>
);

// v9.0.14 (TD-428، تصمیم مالک محصول ت۵ الف): پیگیری‌ها از سرور، بی بازه تاریخ اقدام و با صفحه‌بندی
describe('CRM open follow-ups from the server (TD-428)', () => {
  it('lists the follow-ups tab from /crm/followups, not from the 30-day activity list', async () => {
    render(withClient(
      <CRMFollowupsView activeTab="followups" activities={[]} onOpenActivityModal={() => undefined} onToggleFollowup={() => undefined} />,
    ));
    expect(await screen.findByText('کار پیگیری اقدام قدیمی')).toBeTruthy();
    expect(calledUrls()).toContain('/crm/followups?status=pending&page=1&limit=12');

    fireEvent.click(screen.getByText('تکمیل شده'));
    expect(await screen.findByText('کار پیگیری انجام‌شده')).toBeTruthy();
    await waitFor(() => expect(calledUrls()).toContain('/crm/followups?status=completed&page=1&limit=12'));
  });

  it('shows the server count of due follow-ups on the dashboard widget, beyond the listed page', () => {
    render(withClient(
      <CRMTasksWidget leads={[]} activities={[followup(1, 'پیگیری اقدام قدیمی', shiftIso(-5))]} dueCount={250} openCount={300} />,
    ));
    expect(screen.getByText(`${toPersianDigits(250)} نیازمند اقدام`)).toBeTruthy();
    expect(screen.getByText(new RegExp(`از ${toPersianDigits(250)} مورد`))).toBeTruthy();
  });
});
