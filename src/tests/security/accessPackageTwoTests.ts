import { and, eq, inArray, ne } from 'drizzle-orm';
import { TestCaseResult } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { users } from '../../db/schema.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';

/**
 * بسته ۲ (احراز هویت، دسترسی و سجل) — آزمون‌های امنیتی از مسیرهای واقعی Express با ورود واقعی (کوکی و CSRF).
 * هر آزمون روی کد پیشین قرمز است.
 */

export async function runAccessPackageTwoTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_last_admin_role_change_td_524', 'security', 'td524', 'users', 'package2')) {
    await runCase(results, {
      id: 'sec_last_admin_role_change_td_524',
      name: 'v9.0.57: the last active system admin cannot be moved out of the admin role by an edit, also under concurrent edits (TD-524)',
      details: 'with every other admin set aside, an admin demoting themself gets 409 with a Persian message and stays admin; demoting another admin works while one remains; two admins demoting themselves at the same time leave exactly one admin',
    }, async (h, wrong) => {
      const a = await h.sessionWith('admin');
      // مدیران دیگر (seed و باقی‌مانده آزمون‌ها) کنار گذاشته و در پایان دقیقاً برگردانده می‌شوند
      const others = await orm.select({ id: users.id }).from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isDeleted, 0), ne(users.id, a.userId)));
      const otherIds = others.map(r => r.id);
      const plainRole = (await h.sessionWith(['daily_logs.view'])).role;
      const roleOf = async (userId: number) => (await orm.select({ role: users.role }).from(users).where(eq(users.id, userId)))[0]?.role;
      if (otherIds.length > 0) await orm.update(users).set({ isDeleted: 1 }).where(inArray(users.id, otherIds));
      try {
        // ۱) تنها مدیر نقش خود را عوض نمی‌کند
        const alone = await h.put(`/api/users/${a.userId}`, { full_name: 'td524', role: plainRole }, a);
        if (alone.status !== 409) wrong.push(`the only admin demoting themself got ${alone.status}, not 409`);
        else if (!/[؀-ۿ]/.test(String(alone.body?.error ?? alone.body?.message ?? ''))) wrong.push('the 409 message is not Persian');
        if (await roleOf(a.userId) !== 'admin') wrong.push('the only admin lost the admin role');

        // ۲) مدیر دیگری را تا وقتی خودش مدیر است کنار می‌گذارد
        const b = await h.sessionWith('admin');
        const demoteB = await h.put(`/api/users/${b.userId}`, { full_name: 'td524', role: plainRole }, a);
        if (demoteB.status !== 200) wrong.push(`demoting a second admin got ${demoteB.status}, not 200`);
        const againAlone = await h.put(`/api/users/${a.userId}`, { full_name: 'td524', role: plainRole }, a);
        if (againAlone.status !== 409) wrong.push(`after the second admin was demoted, demoting the last one got ${againAlone.status}, not 409`);

        // ۳) دو مدیر هم‌زمان خود را کنار می‌گذارند: دقیقاً یکی می‌ماند
        const c = await h.sessionWith('admin');
        const [ra, rc] = await Promise.all([
          h.put(`/api/users/${a.userId}`, { full_name: 'td524', role: plainRole }, a),
          h.put(`/api/users/${c.userId}`, { full_name: 'td524', role: plainRole }, c),
        ]);
        const statuses = [ra.status, rc.status].sort().join(',');
        if (statuses !== '200,409') wrong.push(`concurrent self-demotions returned ${statuses}, not one 200 and one 409`);
        const remaining = [await roleOf(a.userId), await roleOf(c.userId)].filter(r => r === 'admin').length;
        if (remaining !== 1) wrong.push(`${remaining} admins remained after concurrent self-demotions, not 1`);
      } finally {
        if (otherIds.length > 0) await orm.update(users).set({ isDeleted: 0 }).where(inArray(users.id, otherIds));
      }
    });
  }

  return results;
}
