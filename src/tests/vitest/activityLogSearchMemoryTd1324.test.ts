// @vitest-environment node
/**
 * 10.2 package 11 part 2d review (TD-1324): a page of the activity log read with a search runs in its own transaction
 * with work_mem 64 MB, so the bitmap of a phrase of common words stays exact; a page without a search stays on the pool.
 * This case fails when `listLogs` stops going through `withActivityLogSearchMemory`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ transactions: 0, workMem: [] as number[], readers: [] as string[] }));

vi.mock('../../db/drizzle.js', () => {
  const rowsFor = (fields: Record<string, unknown>) => ('log' in fields ? [] : [{ count: 0 }]);
  const chain = (rows: unknown[]) => {
    const link: Record<string, unknown> = {};
    for (const step of ['from', 'leftJoin', 'where', 'orderBy', 'limit', 'offset']) link[step] = () => link;
    link.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
    return link;
  };
  const executor = (name: string) => ({
    select: (fields: Record<string, unknown>) => { calls.readers.push(name); return chain(rowsFor(fields)); },
  });
  const pool = executor('pool');
  const tx = executor('tx');
  return {
    orm: {
      ...pool,
      transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => { calls.transactions += 1; return fn(tx); },
    },
    raiseWorkMem: async (_tx: unknown, megabytes: number) => { calls.workMem.push(megabytes); },
  };
});

import { ActivityLogQueryService, ACTIVITY_LOG_SEARCH_WORK_MEM_MB } from '../../services/system/activityLogQuery.service';

describe('activity_log_search_memory_td_1324', () => {
  beforeEach(() => {
    calls.transactions = 0;
    calls.workMem = [];
    calls.readers = [];
  });

  it('a page with a search is read in a transaction with the larger work_mem', async () => {
    await ActivityLogQueryService.listLogs({ search: 'پیش فاکتور' }, 20, 0);
    expect(calls.transactions).toBe(1);
    expect(calls.workMem).toEqual([ACTIVITY_LOG_SEARCH_WORK_MEM_MB]);
    expect(calls.readers).toEqual(['tx', 'tx']);
  });

  it('a page without a search, or with a search of separators only, stays on the pool', async () => {
    await ActivityLogQueryService.listLogs({}, 20, 0);
    await ActivityLogQueryService.listLogs({ search: '\x1f\u0000' }, 20, 0);
    expect(calls.transactions).toBe(0);
    expect(calls.workMem).toEqual([]);
    expect(calls.readers).toEqual(['pool', 'pool', 'pool', 'pool']);
  });
});
