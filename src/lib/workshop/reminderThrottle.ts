/**
 * v10.1.39 (N-01 part 2, TD-1284 review): the bell asks for notifications often and the workshop reminder scan reads every
 * open project, so the scan runs at most once an hour per user. The system is one process (§22), so an in-memory map is
 * enough.
 * v10.1.40 (TD-1285, review of TD-1284): the hour starts only after a scan that succeeded, so a failed scan (a dropped
 * connection, a timeout) is tried again on the next bell request instead of leaving the worker without a reminder for an
 * hour. Two bell requests at once may both scan; the reminder's unique index still makes one notification.
 */
export const WORKSHOP_REMINDER_SCAN_INTERVAL_MS = 60 * 60 * 1000;
const lastScanAt = new Map<number, number>();

/** Whether the user's reminder scan is due at `nowMs`. */
export function isWorkshopReminderScanDue(userId: number, nowMs: number, runs: Map<number, number> = lastScanAt): boolean {
  const last = runs.get(userId);
  return last === undefined || nowMs - last >= WORKSHOP_REMINDER_SCAN_INTERVAL_MS;
}

/** Records a successful scan at `nowMs`, dropping entries older than the interval once the map grows. */
export function markWorkshopReminderScan(userId: number, nowMs: number, runs: Map<number, number> = lastScanAt): void {
  if (runs.size > 1000) {
    for (const [id, at] of runs) if (nowMs - at >= WORKSHOP_REMINDER_SCAN_INTERVAL_MS) runs.delete(id);
  }
  runs.set(userId, nowMs);
}

/** Runs `scan` when it is due and marks it only after it resolved; a rejected scan stays due and its error goes on. */
export async function runThrottledReminderScan(
  userId: number, nowMs: number, scan: () => Promise<number>, runs: Map<number, number> = lastScanAt,
): Promise<number> {
  if (!isWorkshopReminderScanDue(userId, nowMs, runs)) return 0;
  const made = await scan();
  markWorkshopReminderScan(userId, nowMs, runs);
  return made;
}
