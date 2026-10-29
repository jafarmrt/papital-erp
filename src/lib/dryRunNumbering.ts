import { AsyncLocalStorage } from 'async_hooks';

/**
 * v11 history import: the preview of an Excel import runs the real services in a transaction that is rolled back, so it
 * refuses exactly what posting would refuse. A PostgreSQL sequence is not rolled back, so inside such a preview the
 * voucher and treasury numbers come from here (negative, unique within the preview) and the real sequences keep no gap.
 * Outside a preview `dryRunNumber()` is null and the caller takes `nextval` as before.
 */
const storage = new AsyncLocalStorage<{ next: number }>();

/** Runs `fn` as a preview: every number asked for inside it is a placeholder below zero. */
export function withDryRunNumbering<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ next: 0 }, fn);
}

/** The next placeholder number of the running preview, or null when no preview runs. */
export function dryRunNumber(): number | null {
  const store = storage.getStore();
  if (!store) return null;
  store.next -= 1;
  return store.next;
}

export const isDryRun = (): boolean => storage.getStore() !== undefined;
