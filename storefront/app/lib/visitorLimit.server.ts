/**
 * v12 phase 7 (site review 1.4): a limit per visitor on what this app asks the ERP for that no cache can answer, the
 * catalog search first. Every visitor reaches the ERP through this one server, so without it one script sending a fresh
 * search each time would fill the ERP's shared read limit and every buyer would see the error page.
 *
 * A fixed one-minute window per visitor address, in memory (one process, `AGENTS.md` §9.1), with the oldest addresses
 * dropped past `KEYS_MAX`. The address is the one the web server in front writes (`clientAddress`, read only with
 * `STOREFRONT_TRUST_PROXY=1`); without it every visitor would share one counter and one script would block them all, so
 * no address means no limit here, and the ERP's own per-visitor and shared limits still hold.
 */
export const SEARCHES_PER_MINUTE = 30;
const WINDOW_MS = 60_000;
const KEYS_MAX = 20_000;

interface Window { start: number; count: number }
const windows = new Map<string, Window>();

/** Whether this visitor may make one more search now; the answer counts the search */
export function allowSearch(address: string, now: number = Date.now()): boolean {
  if (!address) return true;
  const key = `search:${address}`;
  const current = windows.get(key);
  if (!current || now - current.start >= WINDOW_MS) {
    windows.delete(key);
    if (windows.size >= KEYS_MAX) windows.delete(windows.keys().next().value as string);
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= SEARCHES_PER_MINUTE;
}

/** Seconds until this visitor's window opens again (for `Retry-After`) */
export function searchRetryAfter(address: string, now: number = Date.now()): number {
  const current = windows.get(`search:${address}`);
  return current ? Math.max(1, Math.ceil((current.start + WINDOW_MS - now) / 1000)) : 1;
}

/** For tests only: start with no visitor counted */
export function resetVisitorLimits(): void {
  windows.clear();
}
