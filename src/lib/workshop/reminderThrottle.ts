/**
 * v10.1.39 (N-01 part 2, TD-1284 review): the bell asks for notifications often and the workshop reminder scan reads every
 * open project, so the scan runs at most once an hour per user. The system is one process (§22), so an in-memory map is
 * enough.
 */
export const WORKSHOP_REMINDER_SCAN_INTERVAL_MS = 60 * 60 * 1000;
const lastScanAt = new Map<number, number>();

/** Whether the user's reminder scan is due at `nowMs`; marks it as run when it is. */
export function takeWorkshopReminderScan(userId: number, nowMs: number, runs: Map<number, number> = lastScanAt): boolean {
  const last = runs.get(userId);
  if (last !== undefined && nowMs - last < WORKSHOP_REMINDER_SCAN_INTERVAL_MS) return false;
  if (runs.size > 1000) {
    for (const [id, at] of runs) if (nowMs - at >= WORKSHOP_REMINDER_SCAN_INTERVAL_MS) runs.delete(id);
  }
  runs.set(userId, nowMs);
  return true;
}
