import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReopenedTasksReportCard } from '../../components/workflow/ReopenedTasksReportCard';

// TD-085 (تصمیم «بازگشایی با گزارش»): گزارش کارهای منقضی‌شده خودکار در تب تحلیل SLA
afterEach(cleanup);

describe('ReopenedTasksReportCard (TD-085)', () => {
  it('shows the reopened and kept counts with the reason of each task', () => {
    render(<ReopenedTasksReportCard report={{
      reopenedCount: 1,
      keptExpiredCount: 1,
      rows: [
        { taskId: 1, instanceId: 12, taskTitle: 'تایید مدیر مالی', dueAt: null, action: 'reopened', reason: 'کار مرحله جاری فرایند در جریان' },
        { taskId: 2, instanceId: 13, taskTitle: 'تایید انبار', dueAt: null, action: 'kept_expired', reason: 'فرایند پایان یافته است' },
      ],
    }} />);
    expect(screen.getByText('۱ کار دوباره در کارتابل باز شد و ۱ کار منقضی ماند.')).toBeTruthy();
    expect(screen.getByText('بازگشایی شد')).toBeTruthy();
    expect(screen.getByText('فرایند پایان یافته است')).toBeTruthy();
  });

  it('renders nothing when no task was auto-expired', () => {
    const { container } = render(<ReopenedTasksReportCard report={{ reopenedCount: 0, keptExpiredCount: 0, rows: [] }} />);
    expect(container.innerHTML).toBe('');
  });
});
