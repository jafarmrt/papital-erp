import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DailyLogStatsCards } from '../../components/daily-logs/DailyLogStatsCards';
import { DailyLogsList } from '../../components/daily-logs/DailyLogsList';
import type { User } from '../../types';

// TD-1156: «ثبت گزارش کار جدید» is shown only with a create handler, which the page passes only to holders of
// daily_logs.create (the key of POST /daily-logs). Before, a reader saw both buttons and the save answered 403.

const user: User = { id: 3, username: 'viewer', full_name: 'بیننده', role: 'custom_role' };
const CREATE = 'ثبت گزارش کار جدید';

afterEach(cleanup);

describe('daily log create button (TD-1156)', () => {
  it('is hidden in the header without a create handler', () => {
    render(<DailyLogStatsCards user={user} stats={{}} onPrint={() => undefined} />);
    expect(screen.queryByText(CREATE)).toBeNull();
  });

  it('is hidden in the empty list without a create handler', () => {
    render(<DailyLogsList logs={[]} loading={false} page={1} total={0} setPage={() => undefined} limit={20} user={user} systemUsers={[]}
      onOpenEditModal={() => undefined} onDeleteLog={() => undefined} onOpenReviewModal={() => undefined} />);
    expect(screen.queryByText(CREATE)).toBeNull();
  });

  it('is shown with a create handler', () => {
    render(<DailyLogStatsCards user={user} stats={{}} onPrint={() => undefined} onOpenCreateModal={() => undefined} />);
    expect(screen.getByText(CREATE)).toBeTruthy();
  });

  it('is offered by the page only for daily_logs.create', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('src/pages/DailyLogsPage.tsx', 'utf8');
    expect(page).toContain("useHasPermission('daily_logs.create')");
    expect(page).toContain('onOpenCreateModal={canCreate ? dl.handleOpenCreateModal : undefined}');
  });
});
