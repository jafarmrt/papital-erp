import { describe, expect, it } from 'vitest';
import { takeWorkshopReminderScan, WORKSHOP_REMINDER_SCAN_INTERVAL_MS } from '../../lib/workshop/reminderThrottle';
import { reportQuantityError, WORKSHOP_ERRORS } from '../../lib/workshop/workshopSchedule';

/** v10.1.39 (TD-1284 review): a row without a planned quantity takes no report; the reminder scan runs once an hour per user. */
describe('workshop review guards (TD-1284)', () => {
  it('refuses any quantity on a row whose planned quantity is zero, blank or not a number', () => {
    for (const planned of [0, -1, Number.NaN]) {
      expect(reportQuantityError(1, planned)).toBe(WORKSHOP_ERRORS.rowQuantityMissing);
    }
    expect(reportQuantityError(2, 3)).toBeNull();
    expect(reportQuantityError(4, 3)).toBe(WORKSHOP_ERRORS.quantityExceeded);
    expect(reportQuantityError(0, 3)).toBe(WORKSHOP_ERRORS.quantityInvalid);
  });

  it('runs the reminder scan at most once an hour for each user', () => {
    const runs = new Map<number, number>();
    const t0 = 1_000_000;
    expect(takeWorkshopReminderScan(7, t0, runs)).toBe(true);
    expect(takeWorkshopReminderScan(7, t0 + 60_000, runs)).toBe(false);
    expect(takeWorkshopReminderScan(8, t0 + 60_000, runs)).toBe(true);
    expect(takeWorkshopReminderScan(7, t0 + WORKSHOP_REMINDER_SCAN_INTERVAL_MS, runs)).toBe(true);
  });
});
