import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import ProjectGanttTab from '../../components/project/ProjectGanttTab';
import type { ProductionProject } from '../../types';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const project = {
  id: 3, project_code: 'PRJ-3', title: 'پروژه بی تاریخ شروع', status: 'planned', start_date: '', end_date: '2026-10-20', products: [],
  stages: [{ id: 1, project_id: 3, stage_order: 1, title: 'برش', status: 'pending', progress_percent: 0, start_date: '', end_date: '2026-10-15' }],
} as unknown as ProductionProject;

// v9.0.421 (TD-765): without any start date the axis started at day 1404 × 365, thousands of years from the real dates
describe('timeline axis without a start date (TD-765)', () => {
  it('starts the axis today in the same day unit as the dates', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T08:00:00Z'));
    render(<ProjectGanttTab project={project} />);
    fireEvent.click(screen.getByText(/نوار خط زمانی/));
    const bar = screen.getByTitle(/^برش: پیشرفت/);
    // today → 2026-10-15 is 8 of the 12 days to the project end; the old axis drew it at the 8% minimum
    expect(parseFloat(bar.style.width)).toBeCloseTo((8 / 12) * 100, 1);
    expect(bar.style.right).toBe('0%');
  });
});
