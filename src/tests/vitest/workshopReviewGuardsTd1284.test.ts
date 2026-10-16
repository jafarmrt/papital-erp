import { describe, expect, it } from 'vitest';
import { runThrottledReminderScan, WORKSHOP_REMINDER_SCAN_INTERVAL_MS } from '../../lib/workshop/reminderThrottle';
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

  it('runs the reminder scan at most once an hour for each user', async () => {
    const runs = new Map<number, number>();
    const t0 = 1_000_000;
    let scans = 0;
    const scan = async () => { scans += 1; return 1; };
    expect(await runThrottledReminderScan(7, t0, scan, runs)).toBe(1);
    expect(await runThrottledReminderScan(7, t0 + 60_000, scan, runs)).toBe(0);
    expect(await runThrottledReminderScan(8, t0 + 60_000, scan, runs)).toBe(1);
    expect(await runThrottledReminderScan(7, t0 + WORKSHOP_REMINDER_SCAN_INTERVAL_MS, scan, runs)).toBe(1);
    expect(scans).toBe(3);
  });

  it('starts the hour only after a scan that succeeded, so a failed scan is tried again on the next request', async () => {
    const runs = new Map<number, number>();
    const t0 = 2_000_000;
    await expect(runThrottledReminderScan(9, t0, () => Promise.reject(new Error('connection lost')), runs)).rejects.toThrow('connection lost');
    let scans = 0;
    expect(await runThrottledReminderScan(9, t0 + 1_000, async () => { scans += 1; return 2; }, runs)).toBe(2);
    expect(scans).toBe(1);
    expect(await runThrottledReminderScan(9, t0 + 2_000, async () => { scans += 1; return 2; }, runs)).toBe(0);
  });
});
