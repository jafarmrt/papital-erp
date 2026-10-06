import { and, eq, inArray, ne } from 'drizzle-orm';
import { TestCaseResult } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { roles, users } from '../../db/schema.js';
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

  if (shouldRun('sec_synthetic_username_refused_td_521', 'security', 'td521', 'users', 'package2')) {
    await runCase(results, {
      id: 'sec_synthetic_username_refused_td_521',
      name: 'v9.0.58: a username starting with test_, e2e_ or testuser_ is refused with 422, an existing one is listed and reported by the health check (TD-521)',
      details: 'POST /api/users refuses test_x, E2E_shop and TestUser_x with a Persian 422 and creates nothing; tester-like names still work; a legacy test_ user appears in GET /api/users and list-simple and in the synthetic_test_users health check',
    }, async (h, wrong) => {
      const { findActiveSyntheticUsers, buildSyntheticUsersHealthTest } = await import('../../services/users/syntheticUserHealth.js');
      const { createTestRole } = await import('../fixtures/factories.js');
      const role = await createTestRole({ permissions: ['daily_logs.view'] });
      const created: string[] = [];
      const legacy = `test_legacy_${h.tag}`;
      try {
        for (const username of [`test_x${h.tag}`, `E2E_shop${h.tag}`, `TestUser_x${h.tag}`]) {
          const res = await h.post('/api/users', { username, password: 'Passw0rd!x', full_name: 'td521', role: role.code });
          if (res.status === 200) created.push(username);
          if (res.status !== 422) wrong.push(`creating ${username} returned ${res.status}, not 422`);
          else if (!/[؀-ۿ]/.test(String(res.body?.error ?? res.body?.message ?? ''))) wrong.push(`the refusal of ${username} is not Persian`);
          if ((await orm.select({ id: users.id }).from(users).where(eq(users.username, username))).length > 0) wrong.push(`${username} was stored although refused`);
        }
        const tester = `tester${h.tag}`;
        const okRes = await h.post('/api/users', { username: tester, password: 'Passw0rd!x', full_name: 'td521', role: role.code });
        if (okRes.status === 200) created.push(tester);
        else wrong.push(`creating ${tester} returned ${okRes.status}, not 200`);

        await orm.insert(users).values({ username: legacy, password: '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva', fullName: 'td521 legacy', role: role.code });
        created.push(legacy);
        for (const url of ['/api/users', '/api/users/list-simple']) {
          const res = await h.get(url);
          const names = (Array.isArray(res.body) ? res.body : []).map((u: { username: string }) => u.username);
          if (!names.includes(legacy)) wrong.push(`${url} hides the active user ${legacy}`);
        }
        const health = buildSyntheticUsersHealthTest(await findActiveSyntheticUsers());
        if (health.status !== 'warning' || !health.items?.some(i => i.code === legacy)) wrong.push(`the synthetic_test_users health check does not report ${legacy}`);
      } finally {
        if (created.length > 0) await orm.delete(users).where(inArray(users.username, created));
        await orm.delete(roles).where(eq(roles.id, role.id));
      }
    });
  }

  return results;
}
