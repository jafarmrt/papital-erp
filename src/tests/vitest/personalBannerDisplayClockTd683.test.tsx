import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PersonalBanner } from '../../components/dashboard/PersonalBanner';
import { getTodayJalaliDate, setDisplayTimezone } from '../../utils';
import type { User } from '../../types';

// v9.0.293 (TD-683، B16-19): بنر پیشخوان تاریخ و ساعت منطقه زمانی نمایش را نشان می‌دهد، نه ساعت دستگاه
const deviceTz = process.env.TZ;

beforeEach(() => {
  process.env.TZ = 'UTC';
  setDisplayTimezone('Asia/Tehran');
  vi.useFakeTimers({ toFake: ['Date'] });
  // ۰۰:۳۰ تهران، ۱ فروردین ۱۴۰۵ = ۲۱:۰۰ UTC روز پیش
  vi.setSystemTime(new Date('2026-03-20T21:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (deviceTz === undefined) delete process.env.TZ; else process.env.TZ = deviceTz;
});

describe('personal banner clock (TD-683)', () => {
  it('shows the display time zone date and time on a UTC device', () => {
    expect(getTodayJalaliDate()).toBe('1405/01/01');
    const { container } = render(<PersonalBanner user={{ id: 1, username: 'td683', full_name: 'آزمون', role: 'warehouse' } as User} />);
    const text = container.textContent ?? '';
    expect(text).toContain('۱ فروردین ۱۴۰۵');
    expect(text).toContain('۰۰:۳۰:۰۰');
    expect(text).not.toContain('اسفند');
  });
});
