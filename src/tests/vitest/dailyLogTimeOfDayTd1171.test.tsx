import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DailyLogsList } from '../../components/daily-logs/DailyLogsList';
import { TimeOfDayInput } from '../../components/daily-logs/TimeOfDayInput';
import type { DailyWorkLog, User } from '../../types';

// TD-1171: a daily log's work times are 24-hour times in Persian digits («۰۸:۳۰»), in the form and in the list; the
// browser's time input showed «08:30 AM» and the list printed the stored Latin text.

const user: User = { id: 3, username: 'writer', full_name: 'نویسنده', role: 'custom_role' };

afterEach(cleanup);

describe('daily log time of day (TD-1171)', () => {
  it('the form field shows Persian digits and stores Latin HH:MM', () => {
    const onChange = vi.fn();
    render(<TimeOfDayInput label="ساعت شروع" value="08:30" onChange={onChange} />);
    const input = screen.getByLabelText('ساعت شروع') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.value).toBe('۰۸:۳۰');
    fireEvent.change(input, { target: { value: '۱۷:۰۵' } });
    expect(onChange).toHaveBeenCalledWith('17:05');
  });

  it('the log form uses it, not the browser time input', () => {
    const modal = readFileSync('src/components/daily-logs/DailyLogModal.tsx', 'utf8');
    expect(modal).not.toContain('type="time"');
    expect(modal).toContain('<TimeOfDayInput');
  });

  it('the list prints the times in Persian digits', () => {
    const log = { id: 1, userId: 3, date: '2026-10-09', start_time: '08:30', end_time: '17:00', title: 'برچسب', content: 'متن', work_mode: 'onsite' } as unknown as DailyWorkLog;
    render(<DailyLogsList logs={[log]} loading={false} page={1} total={1} setPage={() => undefined} limit={20} user={user} systemUsers={[]}
      onOpenEditModal={() => undefined} onDeleteLog={() => undefined} onOpenReviewModal={() => undefined} />);
    expect(screen.getByText(/۰۸:۳۰ الی ۱۷:۰۰/)).toBeTruthy();
    expect(screen.queryByText(/08:30/)).toBeNull();
  });
});
