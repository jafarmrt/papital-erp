import { describe, expect, it } from 'vitest';
import { runThrottledReminderScan, WORKSHOP_REMINDER_RETRY_MS, WORKSHOP_REMINDER_SCAN_INTERVAL_MS } from '../../lib/workshop/reminderThrottle';
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

  it('starts the hour only after a scan that succeeded, and tries a failed scan again only after the retry wait', async () => {
    const runs = new Map<number, number>();
    const t0 = 20_000_000;
    let failures = 0;
    const failing = () => { failures += 1; return Promise.reject(new Error('connection lost')); };
    await expect(runThrottledReminderScan(9, t0, failing, runs)).rejects.toThrow('connection lost');
    // a bell request soon after a failure does not scan again
    expect(await runThrottledReminderScan(9, t0 + 1_000, failing, runs)).toBe(0);
    expect(failures).toBe(1);
    let scans = 0;
    expect(await runThrottledReminderScan(9, t0 + WORKSHOP_REMINDER_RETRY_MS, async () => { scans += 1; return 2; }, runs)).toBe(2);
    expect(scans).toBe(1);
    // and the success starts a full hour
    expect(await runThrottledReminderScan(9, t0 + WORKSHOP_REMINDER_RETRY_MS + 2_000, async () => { scans += 1; return 2; }, runs)).toBe(0);
    expect(WORKSHOP_REMINDER_RETRY_MS).toBeLessThan(WORKSHOP_REMINDER_SCAN_INTERVAL_MS);
  });
});
