import { TestCaseResult } from '../types.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';

/**
 * v10.0.40 (TD-1167): routes stamp the actor's full name from `req.user.fullName` (vouchers, item export and others), but
 * `authenticateToken` set only `full_name`, so they wrote the username or an empty name. Red on v10.0.36.
 */
export async function runRequestUserFullNameTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_request_user_full_name_td_1167', 'security', 'td1167', 'fullname', 'package2')) {
    await runCase(results, {
      id: 'sec_request_user_full_name_td_1167',
      name: 'TD-1167: a route reading req.user.fullName stamps the user stored full name',
      details: 'a products.view user exports the items; the EXPORT audit row carries the user full name from the users table',
    }, async (h, wrong) => {
      const s = await h.sessionWith(['products.view']);
      const [user] = await h.q('SELECT full_name FROM users WHERE id = $1', [s.userId]);
      const res = await h.get('/api/items/unified-export', s);
      if (res.status !== 200) wrong.push(`export returned ${res.status}`);
      const [log] = await h.q(
        "SELECT user_full_name FROM activity_logs WHERE user_id = $1 AND action = 'EXPORT' ORDER BY id DESC LIMIT 1", [s.userId]);
      if (!log) wrong.push('no EXPORT audit row');
      else if (log.user_full_name !== user?.full_name) wrong.push(`audit full name ${JSON.stringify(log.user_full_name)} differs from the stored full name`);
    });
  }

  return results;
}
