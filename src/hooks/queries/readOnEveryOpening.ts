import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

/**
 * 10.3 (ARCH review finding 3): the read options of a window or page that used to read once when it opened, into its own
 * state. It now reads through the shared cache, so a write elsewhere that invalidates its key refreshes it while it is
 * open; it still reads again on every opening (`staleTime: 0`), stays out of the focus and reconnect refetches (a window
 * with a form does not change under the user's hands on a tab switch or when the network comes back) and shows a server
 * refusal at once (no retry). Offline, the read fails at once and the window says so, as before, instead of waiting
 * silently for the network (`networkMode`). Its request is cancelled when it closes.
 */
export const READ_ON_EVERY_OPENING = {
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
  networkMode: 'always',
} as const;

/**
 * Whether a window is open: true or false, or the id of the record it shows (null while closed), so that showing another
 * record without closing (a drawer that moves to the next sales file) is a new opening
 */
export type Opening = boolean | number | null;
const isOpen = (open: Opening) => open !== false && open !== null;

/**
 * The moment a window last opened, 0 before it ever opened. It is set in the very render that opens the window (React's
 * "state from the previous render" pattern), so no effect of that render sees the time of an earlier opening. It is the
 * wall clock, as React Query's `dataUpdatedAt` is: an answer in the same millisecond counts (`>=`), and after the clock
 * is set back an answer of this opening looks older and waits for the next read.
 */
export function useOpenedAt(open: Opening): number {
  const [opening, setOpening] = useState(() => ({ open, at: isOpen(open) ? Date.now() : 0 }));
  let at = opening.at;
  if (opening.open !== open) {
    at = isOpen(open) ? Date.now() : opening.at;
    setOpening({ open, at });
  }
  return at;
}

export interface OpeningRead<T> {
  /** the answer read during this opening; kept after a later failed refresh, like a list on screen */
  data: T | undefined;
  /** the answer only while the last read of this opening succeeded: what a check before a save may rely on */
  current: T | undefined;
  /** the error of the last read of this opening, null once a later read succeeds or while the window is closed */
  error: unknown;
  /** when the last read of this opening failed, 0 otherwise: an effect on it says so once for each failure */
  failedAt: number;
}

/**
 * What a query says for the current opening of a window. A window that stays mounted while closed (and a cache entry
 * that outlives it) keeps the answer and the error of an earlier opening; those never count here. The query must read
 * again on each opening (READ_ON_EVERY_OPENING or `staleTime: 0`), or its answer never becomes one of this opening.
 */
export function useOpeningRead<T>(query: UseQueryResult<T>, open: Opening): OpeningRead<T> {
  const openedAt = useOpenedAt(open);
  const read = isOpen(open) && openedAt > 0 && query.dataUpdatedAt >= openedAt;
  const failed = isOpen(open) && openedAt > 0 && query.isError && query.errorUpdatedAt >= openedAt;
  return {
    data: read ? query.data : undefined,
    current: read && !query.isError ? query.data : undefined,
    error: failed ? query.error : null,
    failedAt: failed ? query.errorUpdatedAt : 0,
  };
}
