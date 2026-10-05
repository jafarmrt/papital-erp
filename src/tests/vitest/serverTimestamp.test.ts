import { describe, expect, it } from 'vitest';
import { serverTimestampToUtcIso, zonedDayRangeUtc, zonedDayStartUtc } from '../../lib/serverTimestamp';
import { formatPersianDateTime } from '../../utils';

// v8.0.53 (TD-315): زمان ثبت گزارش فعالیت‌ها UTC است و روز فیلتر، روز منطقه زمانی توافقی
describe('server timestamps in the activity log', () => {
  it('marks a server timestamp as UTC so the browser shows Tehran time', () => {
    expect(serverTimestampToUtcIso('2026-10-05 08:19:00.123')).toBe('2026-10-05T08:19:00.123Z');
    expect(serverTimestampToUtcIso('2026-10-05T08:19:00Z')).toBe('2026-10-05T08:19:00Z');
    expect(serverTimestampToUtcIso(null)).toBeNull();
    expect(formatPersianDateTime(serverTimestampToUtcIso('2026-10-05 08:19:00'))).toContain('۱۱:۴۹');
  });

  it('turns a Tehran day into its UTC range', () => {
    expect(zonedDayStartUtc('2026-03-21', 'Asia/Tehran')).toBe('2026-03-20 20:30:00');
    expect(zonedDayRangeUtc('2026-10-05', '2026-10-05', 'Asia/Tehran'))
      .toEqual({ from: '2026-10-04 20:30:00', before: '2026-10-05 20:30:00' });
    expect(zonedDayRangeUtc(undefined, '2026-03-20', 'UTC')).toEqual({ before: '2026-03-21 00:00:00' });
  });

  it('follows daylight saving where the zone has it', () => {
    expect(zonedDayStartUtc('2026-07-01', 'Europe/Berlin')).toBe('2026-06-30 22:00:00');
    expect(zonedDayStartUtc('2026-01-15', 'Europe/Berlin')).toBe('2026-01-14 23:00:00');
  });
});
