import request from 'supertest';
import { inArray, sql } from 'drizzle-orm';
import { TestCaseResult } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, activityLogSearchText } from '../../db/schema.js';
import { runCase } from './speedConsistencyV102Tests.js';

/**
 * 10.2 package 11 part 2d (OBS-R1-32, TD-1324): the activity log text search is one expression over four columns that a
 * GIN trigram index serves (migration 0132). The case is red on the code before the index.
 */
type ShouldRun = (id: string, ...extra: string[]) => boolean;

export async function runActivityLogSearchIndexTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('reg_activity_log_search_index_td_1324', 'td_1324', 'activity_log', 'search', 'obs_r1_32')) {
    const logIds: number[] = [];
    await runCase(results, 'reg_activity_log_search_index_td_1324',
      'OBS-R1-32 activity log search: one trigram-indexed expression serves the search over description, full name, username and entity (TD-1324)',
      'the planner can read activity_logs_search_trgm for the search expression; a search finds a row by any of the four columns and never across two of them',
      async (wrong) => {
        const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
        const app = await getTestApp();
        const admin = await getAdminSession();
        const tag = `AL${Date.now().toString(36)}`;
        const inserted = await orm.insert(activityLogs).values([
          { username: `${tag}user`, userFullName: 'test person', action: 'UPDATE', entity: 'test entity', description: `first ${tag}desc tail` },
          { username: 'test-user', userFullName: `${tag}full name`, action: 'UPDATE', entity: `${tag}entity`, description: 'second row ends with abc' },
        ]).returning({ id: activityLogs.id });
        logIds.push(...inserted.map(r => r.id));

        const plan = await orm.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL enable_seqscan = off`);
          const rows = await tx.execute(sql`EXPLAIN SELECT id FROM activity_logs WHERE (${activityLogSearchText(activityLogs)}) ILIKE ${`%${tag}%`}`);
          return (rows.rows as Array<Record<string, unknown>>).map(r => String(Object.values(r)[0])).join(' ');
        });
        if (!plan.includes('activity_logs_search_trgm')) wrong.push(`the search expression is not served by the trigram index: ${plan.slice(0, 200)}`);

        const total = async (search: string) => {
          const res = await request(app).get(`/api/activity-logs?search=${encodeURIComponent(search)}&limit=10`).set('Cookie', admin.cookie);
          if (res.status !== 200) throw new Error(`GET /api/activity-logs returned ${res.status}`);
          return Number(res.body?.total);
        };
        const cases: Array<[string, number]> = [
          [`${tag}desc`, 1], [`${tag}USER`, 1], [`${tag}full`, 1], [`${tag}entity`, 1], [tag, 2],
          // the end of one column and the start of the next are never one match
          ['ends with abc' + `${tag}full`, 0], ['test person' + `${tag}user`, 0],
        ];
        for (const [search, expected] of cases) {
          const got = await total(search);
          if (got !== expected) wrong.push(`the search ${JSON.stringify(search)} found ${got}, expected ${expected}`);
        }
      });
    if (logIds.length > 0) await orm.delete(activityLogs).where(inArray(activityLogs.id, logIds)).catch(() => undefined);
  }

  return results;
}
