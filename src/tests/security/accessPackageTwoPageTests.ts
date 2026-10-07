import { TestCaseResult } from '../types.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';

/**
 * بسته ۲ (مدل مجوز)، M4 — جدول یکتای دسترسی صفحه‌ها و زبانه‌های تنظیمات (`src/lib/permissions/pageAccess.ts`) با گارد
 * API همان صفحه یکی است (TD-668، یافته B16-04، تصمیم ت۲ الف بسته ۱۶). منو، مسیر، میانبر و زبانه از همین جدول می‌خوانند
 * (Vitest `pageAccessTable.test.tsx`)؛ این آزمون سوی سرور را از روترهای واقعی Express می‌سنجد.
 */

export async function runAccessPackageTwoPageTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_page_access_matches_api_td_668', 'security', 'td668', 'pages', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_page_access_matches_api_td_668',
      name: 'v9.0.114: every key that opens a page or settings tab passes the guards of its main API (TD-668)',
      details: 'for every row of PAGE_ACCESS and SETTINGS_TAB_ACCESS: each named API exists in the Express routers; each key of the page passes every guard of each API; a system-admin-only page or tab has system-admin-only APIs; a holder of piecework.manage_tasks alone opens the task-titles settings tab and reads its list (GET /api/piecework/tasks 200; personnel.manage until v9.0.285, TD-805)',
    }, async (h, wrong) => {
      const { buildRouteGuardTable } = await import('../../lib/routeGuardTable.js');
      const { SYSTEM_ADMIN_ROLE } = await import('../../lib/permissions/permissionCatalog.js');
      const { PAGE_ACCESS, SETTINGS_TAB_ACCESS } = await import('../../lib/permissions/pageAccess.js');
      const rows = buildRouteGuardTable(h.app as Parameters<typeof buildRouteGuardTable>[0]);
      const byRoute = new Map(rows.map(r => [`${r.method} ${r.path}`, r]));

      const tables: Array<[string, Record<string, { gate: unknown; api: readonly string[] }>]> = [
        ['page', PAGE_ACCESS],
        ['settings tab', SETTINGS_TAB_ACCESS],
      ];
      for (const [kind, table] of tables) {
        for (const [name, rule] of Object.entries(table)) {
          for (const api of rule.api) {
            const row = byRoute.get(api);
            if (!row) { wrong.push(`${kind} ${name}: API ${api} is not an Express route`); continue; }
            if (!row.authenticated) wrong.push(`${kind} ${name}: API ${api} is public`);
            if (rule.gate === 'system_admin') {
              const adminOnly = row.guards.some(g => g.length === 1 && g[0] === SYSTEM_ADMIN_ROLE);
              if (!adminOnly) wrong.push(`${kind} ${name} is for the system admin only but ${api} accepts ${row.guards.map(g => g.join('|')).join(' & ') || 'every signed-in user'}`);
              continue;
            }
            if (rule.gate === 'login') {
              if (row.guards.length > 0) wrong.push(`${kind} ${name} opens for every signed-in user but ${api} needs ${row.guards.map(g => g.join('|')).join(' & ')}`);
              continue;
            }
            for (const key of (rule.gate as { anyOf: readonly string[] }).anyOf) {
              const refused = row.guards.find(g => !g.includes(key));
              if (refused) wrong.push(`${kind} ${name} opens for ${key} but ${api} refuses it (guard ${refused.join('|')})`);
            }
          }
        }
      }

      const holder = await h.sessionWith(['piecework.manage_tasks']);
      const tasks = await h.get('/api/piecework/tasks', holder);
      if (tasks.status !== 200) wrong.push(`GET /api/piecework/tasks for piecework.manage_tasks alone returned ${tasks.status}, not 200`);
    });
  }

  if (shouldRun('sec_menu_visibility_removed_td_884', 'security', 'td884', 'menu', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_menu_visibility_removed_td_884',
      name: 'v9.0.115: the per-role menu hiding is gone; a saved menu_visibility is ignored (TD-884)',
      details: 'GET /api/menu-visibility is no longer a route (404); POST /api/settings with menu_visibility from a holder of settings.manage and roles.manage returns 200 and changes nothing, like the other retired keys',
    }, async (h, wrong) => {
      const read = await h.get('/api/menu-visibility');
      if (read.status !== 404) wrong.push(`GET /api/menu-visibility returned ${read.status}, not 404`);
      const [before] = await h.q("SELECT value FROM app_settings WHERE key = 'menu_visibility'");
      const holder = await h.sessionWith(['settings.manage', 'roles.manage']);
      const save = await h.post('/api/settings', { settings: [{ key: 'menu_visibility', value: JSON.stringify({ [holder.role]: ['/products'] }) }] }, holder);
      if (save.status !== 200) wrong.push(`saving menu_visibility returned ${save.status}, not 200 (ignored)`);
      const [after] = await h.q("SELECT value FROM app_settings WHERE key = 'menu_visibility'");
      if ((after?.value ?? null) !== (before?.value ?? null)) wrong.push(`menu_visibility changed to ${String(after?.value)}`);
    });
  }

  return results;
}
