import request from 'supertest';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { roles, users, dailyWorkLogs, pendingMaterials, personnel, pieceworkTasks, pieceworkLogs, items, documents, accounts, journalVouchers, journalVoucherItems, crmLeads, crmActivities, productionProjects } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { buildRouteGuardTable, formatGuards, type RouteGuardRow } from '../../lib/routeGuardTable.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';

/**
 * حوزه H نقشه راه V8 — امنیت و دسترسی. جدول «مسیر ← مجوز» از خود روترها ساخته و با سیاست زیر سنجیده می‌شود،
 * و هر یافته (TD-298 تا TD-309) یک آزمون دارد که روی کد پیشین قرمز است.
 */

/** مسیرهای بی‌احراز هویت (ورود، راه‌اندازی، سلامت، متریک با توکن خودش). وب‌هوک ووکامرس با router.all ثبت شده و در جدول نیست. */
export const PUBLIC_ROUTES = new Set([
  'POST /api/login', 'POST /api/auth/login', 'POST /api/logout', 'POST /api/auth/logout',
  'GET /api/check-setup', 'GET /api/public-settings', 'POST /api/setup',
  'GET /metrics', 'GET /api/metrics',
  'GET /health', 'GET /health/live', 'GET /health/ready', 'GET /health/startup',
  'GET /api/health', 'GET /api/health/live', 'GET /api/health/ready', 'GET /api/health/startup',
]);

/**
 * مسیرهایی که فقط ورود می‌خواهند. هر کدام یا داده خود کاربر را می‌خواند/می‌نویسد (پروفایل، اعلان، پیش‌نویس، فیش خود)،
 * یا فهرست انتخاب عمومی است (AGENTS.md §5)، یا مجوز را درون هندلر می‌سنجد (جست‌وجوی سراسری، پیوست، بازخورد گزارش کار).
 */
export const LOGIN_ONLY_ROUTES = new Set([
  'GET /api/auth/me', 'GET /api/me', 'GET /api/auth/csrf', 'GET /api/csrf',
  'GET /api/users/my-permissions', 'GET /api/users/profile', 'PUT /api/users/profile', 'GET /api/users/list-simple',
  'GET /api/system/business-date', 'GET /api/settings', 'GET /api/global-search',
  'GET /api/categories', 'GET /api/warehouses',
  'GET /api/notifications', 'GET /api/notifications/unread-count', 'PUT /api/notifications/:id/read',
  'PUT /api/notifications/read-all', 'DELETE /api/notifications/:id',
  'GET /api/piecework/payrolls/mine',
  'POST /api/drafts', 'GET /api/drafts/:entityType', 'GET /api/drafts', 'DELETE /api/drafts/:entityType', 'DELETE /api/drafts/id/:id',
  'GET /api/attachments/:id',
]);

/**
 * v9.0.107 (TD-516، فهرست تأییدشده M2): کارهای نگهداری سامانه که فقط «مدیر سیستم» انجام می‌دهد (`requireSystemAdmin`).
 * هیچ گارد دیگری کد نقش ندارد؛ کار تازه‌ای که فقط مدیر سیستم بکند، اینجا با تصمیم مالک محصول افزوده می‌شود.
 */
export const SYSTEM_ADMIN_ONLY_ROUTES = new Set([
  'GET /api/export-backup', 'POST /api/admin/clear-data', 'POST /api/activity-logs/purge',
  'POST /api/attachments/cleanup-orphans', 'POST /api/attachments/migrate-inline', 'POST /api/categories/reset-defaults',
  'POST /api/accounting/accounts/seed-default', 'POST /api/accounting/accounts/seed-standard',
  'GET /api/system/health', 'GET /api/system/env', 'GET /api/system/date-calendar-report',
  'GET /api/system/reconciliation-check', 'POST /api/system/reconciliation-fix',
  // v9.0.112 (TD-490، تصمیم ت۵ الف): فعال‌سازی دوباره انبار غیرفعال فقط با مدیر سیستم
  'POST /api/warehouses/:id/reactivate',
  // v9.0.427 (TD-589، تصمیم ت۵ الف): فهرست و ساختن دستی قیدهای شرطی جاافتاده مهاجرت‌ها
  'GET /api/system/conditional-constraints', 'POST /api/system/conditional-constraints/build',
]);

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const isViewPermission = (entry: string) => entry.endsWith('.view');

/** تخلف‌های جدول مسیرها از سیاست دسترسی؛ آرایه خالی یعنی سالم */
export function routeAccessPolicyViolations(rows: RouteGuardRow[], catalogKeys: Set<string>): string[] {
  const violations: string[] = [];
  for (const row of rows) {
    const key = `${row.method} ${row.path}`;
    if (!row.authenticated) {
      if (!PUBLIC_ROUTES.has(key)) violations.push(`${key}: no authentication`);
      continue;
    }
    if (row.guards.length === 0) {
      if (!LOGIN_ONLY_ROUTES.has(key)) violations.push(`${key}: login only, no permission`);
      continue;
    }
    // هر گارد «یکی کافی است» است و گاردهای پشت هم همه لازم‌اند: اگر هر گارد یک مجوز «مشاهده» بپذیرد، دارنده فقط مشاهده می‌گذرد
    if (MUTATION_METHODS.has(row.method) && row.guards.every(g => g.some(isViewPermission))) {
      violations.push(`${key}: mutation with a view permission (${formatGuards(row)})`);
    }
    for (const entry of row.guards.flat()) {
      if (entry.includes('.') && !catalogKeys.has(entry)) violations.push(`${key}: permission "${entry}" is not in the catalog`);
    }
    // v9.0.107 (TD-516): کد نقش فقط به شکل گارد تنهای «مدیر سیستم» و فقط روی فهرست تأییدشده
    const adminOnly = row.guards.some(g => g.length === 1 && g[0] === SYSTEM_ADMIN_ROLE);
    for (const g of row.guards) {
      const codes = g.filter(e => !e.includes('.'));
      if (codes.length > 0 && !(g.length === 1 && g[0] === SYSTEM_ADMIN_ROLE)) violations.push(`${key}: guard names role code(s) ${codes.join(', ')}`);
    }
    if (adminOnly && !SYSTEM_ADMIN_ONLY_ROUTES.has(key)) violations.push(`${key}: system-admin-only guard outside SYSTEM_ADMIN_ONLY_ROUTES`);
    if (!adminOnly && SYSTEM_ADMIN_ONLY_ROUTES.has(key)) violations.push(`${key}: listed in SYSTEM_ADMIN_ONLY_ROUTES but not guarded by requireSystemAdmin`);
  }
  for (const key of SYSTEM_ADMIN_ONLY_ROUTES) {
    if (!rows.some(r => `${r.method} ${r.path}` === key)) violations.push(`${key}: listed in SYSTEM_ADMIN_ONLY_ROUTES but not registered`);
  }
  return violations;
}

interface Session { cookie: string; csrfToken: string }

export async function runRouteAccessPolicyTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const record = (id: string, name: string, executionType: 'real_code' | 'real_database', run: () => Promise<string>) => ({ id, name, executionType, run });
  const createdRoleIds: number[] = [];
  const createdUserIds: number[] = [];

  const { getTestApp, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
  const { PERMISSION_CATALOG } = await import('../../routes/users.routes.js');
  const catalogKeys = new Set(PERMISSION_CATALOG.flatMap(c => c.permissions.map(p => p.key)));
  const app = await getTestApp();

  const userWith = async (permissions: string[]): Promise<{ id: number; session: Session }> => {
    const role = await createTestRole({ permissions });
    createdRoleIds.push(role.id);
    const user = await createTestUser({ role: role.code });
    createdUserIds.push(user.id);
    return { id: user.id, session: await loginTestUserWithSession(app, user.username) };
  };
  const send = (s: Session, method: 'post' | 'put' | 'delete' | 'get', url: string, body?: object) => {
    const r = request(app)[method](url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken);
    return body ? r.send(body) : r;
  };

  const cases = [
    record('sec_route_access_policy_td_298', 'area H: "route -> permission" table — authentication, login-only route list, no mutation with a view permission, permission keys from the catalog (TD-298 / TD-304)', 'real_code', async () => {
      const rows = buildRouteGuardTable(app);
      if (rows.length < 300) throw new Error(`route table is incomplete (${rows.length} routes)`);
      const violations = routeAccessPolicyViolations(rows, catalogKeys);
      if (violations.length > 0) throw new Error(`${violations.length} violations: ${violations.join(' | ')}`);
      return `${rows.length} مسیر بی‌تخلف`;
    }),
    record('sec_writer_routes_validated_td_979', 'v10.0.21: every writer route reads its input through Zod; only reviewed body-less routes are listed (TD-979)', 'real_code', async () => {
      const { writerRouteValidationViolations, WRITER_ROUTES_WITHOUT_BODY } = await import('./writerRouteValidation.js');
      const violations = writerRouteValidationViolations(buildRouteGuardTable(app));
      if (violations.length > 0) throw new Error(`${violations.length} writer routes without Zod: ${violations.join(' | ')}`);
      return `${WRITER_ROUTES_WITHOUT_BODY.size} body-less routes listed`;
    }),
    record('sec_view_permission_cannot_mutate_td_298', 'area H: a view permission does not open BOM material allocation or workflow start (TD-298)', 'real_database', async () => {
      const viewer = await userWith(['warehouse.view', 'projects.view', 'workflow.view', 'products.view']);
      const allocate = await send(viewer.session, 'post', '/api/inventory/allocations/allocate', { projectId: 999999999, allocations: [{ itemId: 999999999, quantity: 1 }] });
      const start = await send(viewer.session, 'post', '/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: 999999999 });
      const wrong = [[allocate.status, 'allocate'], [start.status, 'workflow/start']].filter(([st]) => st !== 403);
      if (wrong.length > 0) throw new Error(`a view-only holder was not refused: ${wrong.map(([st, n]) => `${n} ${st}`).join(', ')}`);
      return 'both 403';
    }),
    record('sec_user_manager_cannot_grant_admin_td_299', 'area H: a users.manage holder does not grant the system admin role and does not change or delete an admin account (TD-299)', 'real_database', async () => {
      // از v9.0.129 (TD-520) مدیر کاربران فقط نقشی را می‌دهد که همه کلیدهایش را دارد
      const manager = await userWith(['users.manage', 'daily_logs.view']);
      const admin = await createTestUser({ role: 'admin' });
      createdUserIds.push(admin.id);
      const plainRole = await createTestRole({ permissions: ['daily_logs.view'] });
      createdRoleIds.push(plainRole.id);
      const suffix = Date.now();
      const checks: Array<[string, number, number]> = [];
      const createAdmin = await send(manager.session, 'post', '/api/users', { username: `td299_adm_${suffix}`, password: 'Passw0rd!x', full_name: 'td299', role: 'admin' });
      checks.push(['ساخت کاربر admin', createAdmin.status, 403]);
      const selfAdmin = await send(manager.session, 'put', `/api/users/${manager.id}`, { full_name: 'td299', role: 'admin' });
      checks.push(['admin کردن خود', selfAdmin.status, 403]);
      const resetAdmin = await send(manager.session, 'put', `/api/users/${admin.id}`, { password: 'Hijack123!', full_name: 'x', role: 'admin' });
      checks.push(['تغییر رمز مدیر', resetAdmin.status, 403]);
      const demoteAdmin = await send(manager.session, 'put', `/api/users/${admin.id}`, { full_name: 'x', role: plainRole.code });
      checks.push(['گرفتن نقش مدیر', demoteAdmin.status, 403]);
      const deleteAdmin = await send(manager.session, 'delete', `/api/users/${admin.id}`);
      checks.push(['حذف مدیر', deleteAdmin.status, 403]);
      const createPlain = await send(manager.session, 'post', '/api/users', { username: `td299_usr_${suffix}`, password: 'Passw0rd!x', full_name: 'td299', role: plainRole.code });
      checks.push(['ساخت کاربر عادی', createPlain.status, 200]);
      if (createPlain.body?.id) createdUserIds.push(Number(createPlain.body.id));
      if (createAdmin.body?.id) createdUserIds.push(Number(createAdmin.body.id));
      const wrong = checks.filter(([, got, want]) => got !== want);
      if (wrong.length > 0) throw new Error(wrong.map(([n, got, want]) => `${n}: ${got} (expected ${want})`).join(', '));
      return `${checks.length} بررسی`;
    }),
    record('sec_piecework_log_permission_td_300', 'area H: piecework work logs need the "personnel work log" permission; a manual rate only for the rates manager (TD-300, TD-805)', 'real_database', async () => {
      const logger = await userWith(['daily_logs.view', 'daily_logs.create']);
      const operator = await userWith(['piecework.view', 'piecework.log']);
      // v9.0.320 (TD-805): نرخ دستی با «مدیریت عناوین کاری و نرخ‌های پایه»، نه «مدیریت کامل پرسنل»
      const manager = await userWith(['piecework.view', 'piecework.log', 'piecework.manage_tasks']);
      const [person] = await orm.insert(personnel).values({ fullName: 'td300 آزمون', personnelCode: `TD300-${Date.now()}` }).returning();
      const [task] = await orm.insert(pieceworkTasks).values({ code: `TD300-${Date.now()}`, title: `td300-${Date.now()}`, defaultRate: money(1000) }).returning();
      try {
        const body = { personnelId: person.id, taskId: task.id, date: '2026-10-01', quantity: 2, unitRate: 50000000 };
        const byLogger = await send(logger.session, 'post', '/api/piecework/logs', body);
        if (byLogger.status !== 403) throw new Error(`a daily-log user recorded a work log (${byLogger.status})`);
        const byOperator = await send(operator.session, 'post', '/api/piecework/logs', body);
        if (byOperator.status !== 201) throw new Error(`piecework.log holder refused (${byOperator.status}: ${JSON.stringify(byOperator.body).slice(0, 200)})`);
        const [opLog] = await orm.select({ unitRate: pieceworkLogs.unitRate }).from(pieceworkLogs).where(eq(pieceworkLogs.personnelId, person.id));
        if (!money(opLog.unitRate).equals(1000)) throw new Error(`operator manual rate ${opLog.unitRate} recorded, expected base rate 1000`);
        await orm.delete(pieceworkLogs).where(eq(pieceworkLogs.personnelId, person.id));
        const byManager = await send(manager.session, 'post', '/api/piecework/logs', { ...body, unitRate: 2000 });
        const [mgrLog] = await orm.select({ unitRate: pieceworkLogs.unitRate }).from(pieceworkLogs).where(eq(pieceworkLogs.personnelId, person.id));
        if (byManager.status !== 201 || !money(mgrLog?.unitRate ?? 0).equals(2000)) throw new Error(`personnel manager manual rate not accepted (${byManager.status}, ${mgrLog?.unitRate})`);
        return 'daily_logs.create ← 403؛ اپراتور نرخ پایه؛ مدیر پرسنل نرخ دستی';
      } finally {
        await orm.delete(pieceworkLogs).where(eq(pieceworkLogs.personnelId, person.id));
        await orm.delete(pieceworkTasks).where(eq(pieceworkTasks.id, task.id));
        await orm.delete(personnel).where(eq(personnel.id, person.id));
      }
    }),
    record('sec_daily_log_by_id_visibility_td_301', 'area H: fetching one daily log by id follows the same privacy rule as the list (TD-301)', 'real_database', async () => {
      const author = await userWith(['daily_logs.view', 'daily_logs.create']);
      const other = await userWith(['daily_logs.view', 'daily_logs.create']);
      const [log] = await orm.insert(dailyWorkLogs).values({
        userId: author.id, username: 'td301', userFullName: 'td301', date: '2026-10-01', dateIso: '2026-10-01',
        title: 'td301 محرمانه', content: 'متن محرمانه', visibility: 'private'
      }).returning();
      try {
        const byOther = await send(other.session, 'get', `/api/daily-logs/${log.id}`);
        const byAuthor = await send(author.session, 'get', `/api/daily-logs/${log.id}`);
        if (byOther.status !== 404) throw new Error(`a private log was given to another user (${byOther.status})`);
        if (byAuthor.status !== 200) throw new Error(`author did not get their own log (${byAuthor.status})`);
        return 'دیگری 404، نویسنده 200';
      } finally {
        await orm.delete(dailyWorkLogs).where(eq(dailyWorkLogs.id, log.id));
      }
    }),
    record('sec_pending_material_edit_td_302', 'area H: editing a material request needs the approve permission and only before review (TD-302)', 'real_database', async () => {
      const logger = await userWith(['daily_logs.view', 'daily_logs.create']);
      const approver = await userWith(['pending_materials.view', 'pending_materials.approve']);
      const [pending] = await orm.insert(pendingMaterials).values({ code: `TD302-${Date.now()}`, name: 'td302', unit: 'عدد', status: 'pending' }).returning();
      const [reviewed] = await orm.insert(pendingMaterials).values({ code: `TD302R-${Date.now()}`, name: 'td302r', unit: 'عدد', status: 'rejected' }).returning();
      try {
        const byLogger = await send(logger.session, 'put', `/api/pending-materials/${pending.id}`, { weightedAverageCost: 999999 });
        const byApprover = await send(approver.session, 'put', `/api/pending-materials/${pending.id}`, { name: 'td302 ویرایش' });
        const reviewedEdit = await send(approver.session, 'put', `/api/pending-materials/${reviewed.id}`, { name: 'td302 پس از رد' });
        const wrong: string[] = [];
        if (byLogger.status !== 403) wrong.push(`user without permission: ${byLogger.status} (expected 403)`);
        if (byApprover.status !== 200) wrong.push(`approver: ${byApprover.status} (expected 200)`);
        if (reviewedEdit.status !== 409) wrong.push(`rejected request: ${reviewedEdit.status} (expected 409)`);
        if (wrong.length > 0) throw new Error(wrong.join(', '));
        return 'بی‌مجوز 403، تأییدکننده 200، بررسی‌شده 409';
      } finally {
        await orm.delete(pendingMaterials).where(inArray(pendingMaterials.id, [pending.id, reviewed.id]));
      }
    }),
    record('sec_payroll_amount_read_scope_td_303', 'area H: payslip payments and advance balance only with the payslip read permission (TD-303)', 'real_database', async () => {
      const production = await userWith(['personnel.view', 'projects.view', 'piecework.view']);
      const payroll = await userWith(['piecework.payroll']);
      const urls = ['/api/piecework/payrolls/999999999/payments', '/api/piecework/personnel/999999999/advance-balance'];
      const wrong: string[] = [];
      for (const url of urls) {
        const denied = await send(production.session, 'get', url);
        const allowed = await send(payroll.session, 'get', url);
        if (denied.status !== 403) wrong.push(`personnel.view ${url}: ${denied.status} (expected 403)`);
        if (allowed.status === 403) wrong.push(`piecework.payroll ${url}: 403`);
      }
      if (wrong.length > 0) throw new Error(wrong.join(', '));
      return 'personnel.view ← 403، piecework.payroll مجاز';
    }),
    record('sec_role_permissions_from_catalog_td_304', 'area H: a role gets only catalog permissions, not "*" or an unknown key (TD-304)', 'real_database', async () => {
      // از v9.0.129 (TD-520) مدیر نقش‌ها فقط کلیدی را به نقش می‌دهد که خودش دارد
      const roleAdmin = await userWith(['roles.manage', 'daily_logs.view']);
      const suffix = Date.now();
      const star = await send(roleAdmin.session, 'post', '/api/roles', { name: 'td304', code: `td304_star_${suffix}`, permissions: ['*'] });
      const unknown = await send(roleAdmin.session, 'post', '/api/roles', { name: 'td304', code: `td304_unk_${suffix}`, permissions: ['sales.view'] });
      const valid = await send(roleAdmin.session, 'post', '/api/roles', { name: 'td304', code: `td304_ok_${suffix}`, permissions: ['daily_logs.view'] });
      for (const r of [star, unknown, valid]) if (r.body?.id) createdRoleIds.push(Number(r.body.id));
      const wrong: string[] = [];
      if (star.status !== 400) wrong.push(`"*": ${star.status} (expected 400)`);
      if (unknown.status !== 400) wrong.push(`unknown key: ${unknown.status} (expected 400)`);
      if (valid.status !== 200) wrong.push(`catalog key: ${valid.status} (expected 200)`);
      if (wrong.length > 0) throw new Error(wrong.join(', '));
      return '«*» و ناشناخته 400، کاتالوگ 200';
    }),
    record('sec_item_edit_keeps_wac_td_305', 'area H: editing an item with stock does not overwrite its WAC (TD-305)', 'real_database', async () => {
      const editor = await userWith(['products.view', 'products.edit']);
      const { createTestItem } = await import('../fixtures/factories.js');
      const item = await createTestItem({ weightedAverageCost: 50000, currentStock: 10 });
      try {
        const base = { name: item.name, code: item.code, unit: item.unit, category: item.category, version: item.version };
        const forged = await send(editor.session, 'put', `/api/items/${item.id}`, { ...base, weighted_average_cost: 1 });
        const [afterForged] = await orm.select({ wac: items.weightedAverageCost }).from(items).where(eq(items.id, item.id));
        const same = await send(editor.session, 'put', `/api/items/${item.id}`, { ...base, weighted_average_cost: 50000.4 });
        const [afterSame] = await orm.select({ wac: items.weightedAverageCost }).from(items).where(eq(items.id, item.id));
        const wrong: string[] = [];
        if (forged.status !== 422) wrong.push(`new WAC: ${forged.status} (expected 422)`);
        if (!money(afterForged.wac).equals(50000)) wrong.push(`WAC after edit became ${afterForged.wac}`);
        if (same.status !== 200) wrong.push(`same WAC: ${same.status} (expected 200)`);
        if (!money(afterSame.wac).equals(50000)) wrong.push(`WAC after an edit with the same value became ${afterSame.wac}`);
        if (wrong.length > 0) throw new Error(wrong.join(', '));
        return 'WAC تازه 422، هم‌مقدار 200، WAC همان 50000';
      } finally {
        await orm.update(items).set({ isDeleted: 1 }).where(eq(items.id, item.id));
      }
    }),
    record('sec_document_user_from_session_td_307', 'area H: the document author name comes from the session, not from the request body (TD-307)', 'real_database', async () => {
      const clerk = await userWith(['documents.view', 'documents.create']);
      const { createTestItem } = await import('../fixtures/factories.js');
      const item = await createTestItem({ currentStock: 5 });
      const [clerkRow] = await orm.select({ username: users.username, fullName: users.fullName }).from(users).where(eq(users.id, clerk.id));
      const res = await send(clerk.session, 'post', '/api/documents', {
        docType: 'invoice', refNumber: 'auto', date: new Date().toISOString().split('T')[0], status: 'draft', inOut: 'out',
        buyer_name: 'td307', user: 'مدیر عامل (جعلی)', items: [{ itemId: item.id, quantity: 1, unit_price: 1000 }]
      });
      const docId = Number(res.body?.docId ?? res.body?.id ?? res.body?.data?.id);
      try {
        if (res.status !== 200 && res.status !== 201) throw new Error(`document save failed (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
        const [doc] = await orm.select({ user: documents.user }).from(documents).where(eq(documents.id, docId));
        const expected = clerkRow.fullName || clerkRow.username;
        if (doc?.user !== expected) throw new Error(`document author became "${doc?.user}", expected "${expected}"`);
        return `ثبت‌کننده «${expected}»`;
      } finally {
        if (docId) await orm.update(documents).set({ isDeleted: 1 }).where(eq(documents.id, docId));
        await orm.update(items).set({ isDeleted: 1 }).where(eq(items.id, item.id));
      }
    }),
    record('sec_voucher_approved_on_create_td_308', 'area H: a journal voucher created as approved has an approver (TD-308)', 'real_database', async () => {
      const accountant = await userWith(['accounting.view', 'accounting.vouchers']);
      // v9.0.198 (TD-549): a manual voucher row goes only on a posting account (active subsidiary or detailed, no active sub-account)
      const accountRows = await orm.select({ id: accounts.id }).from(accounts)
        .where(and(eq(accounts.isDeleted, 0), eq(accounts.isActive, 1), inArray(accounts.level, ['subsidiary', 'detailed']),
          sql`NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = ${accounts.id} AND c.is_deleted = 0 AND c.is_active = 1)`))
        .orderBy(asc(accounts.id)).limit(2);
      if (accountRows.length < 2) throw new Error('at least two ledger accounts are needed');
      const res = await send(accountant.session, 'post', '/api/accounting/vouchers', {
        date: new Date().toISOString().split('T')[0], voucherType: 'general', status: 'approved', description: `TD308-${Date.now()}`,
        items: [{ accountId: accountRows[0].id, debit: 1000, credit: 0 }, { accountId: accountRows[1].id, debit: 0, credit: 1000 }]
      });
      const voucherId = Number(res.body?.id);
      try {
        if (res.status !== 201) throw new Error(`document save failed (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
        const [row] = await orm.select({ approvedById: journalVouchers.approvedById }).from(journalVouchers).where(eq(journalVouchers.id, voucherId));
        if (row?.approvedById !== accountant.id) throw new Error(`approver is ${row?.approvedById ?? 'empty'}, expected ${accountant.id}`);
        return 'approver = recorder';
      } finally {
        if (voucherId) {
          await orm.delete(journalVoucherItems).where(eq(journalVoucherItems.voucherId, voucherId));
          await orm.delete(journalVouchers).where(eq(journalVouchers.id, voucherId));
        }
      }
    }),
    record('sec_crm_won_needs_proforma_td_309', 'area H: no "won sale" without a proforma, neither on sales file create nor with status won (TD-309)', 'real_database', async () => {
      const seller = await userWith(['crm.view', 'crm.manage', 'customers.view']);
      const stamp = Date.now();
      const createdLeadIds: number[] = [];
      try {
        const wonOnCreate = await send(seller.session, 'post', '/api/crm/leads', { title: `TD309-won-${stamp}`, customerName: `TD309 ${stamp}`, stage: 'won' });
        if (wonOnCreate.body?.id) createdLeadIds.push(Number(wonOnCreate.body.id));
        const lead = await send(seller.session, 'post', '/api/crm/leads', { title: `TD309-${stamp}`, customerName: `TD309 ${stamp}` });
        const leadId = Number(lead.body?.id ?? lead.body?.data?.id);
        if (leadId) createdLeadIds.push(leadId);
        if (lead.status !== 200 && lead.status !== 201) throw new Error(`creating a normal sales file failed (${lead.status})`);
        const statusWon = await send(seller.session, 'put', `/api/crm/leads/${leadId}`, { status: 'won' });
        const [row] = await orm.select({ status: crmLeads.status, stage: crmLeads.stage }).from(crmLeads).where(eq(crmLeads.id, leadId));
        const wrong: string[] = [];
        if (wonOnCreate.status !== 400) wrong.push(`creating a "won sale" sales file: ${wonOnCreate.status} (expected 400)`);
        if (statusWon.status !== 400) wrong.push(`status won without a proforma: ${statusWon.status} (expected 400)`);
        if (row?.status === 'won') wrong.push('sales file status became won');
        if (wrong.length > 0) throw new Error(wrong.join(', '));
        return 'هر دو 400';
      } finally {
        if (createdLeadIds.length > 0) {
          await orm.delete(crmActivities).where(inArray(crmActivities.leadId, createdLeadIds));
          await orm.delete(crmLeads).where(inArray(crmLeads.id, createdLeadIds));
        }
      }
    }),
    record('sec_project_reservation_from_server_td_306', 'area H: the server builds the project reservation from the inventory control sections, not from the request body (TD-306)', 'real_database', async () => {
      const planner = await userWith(['projects.view', 'projects.edit']);
      const { createTestItem } = await import('../fixtures/factories.js');
      const item = await createTestItem({ currentStock: 10 });
      const [project] = await orm.insert(productionProjects).values({ projectCode: `TD306-${Date.now()}`, title: 'td306 آزمون', startDate: '2026-10-05', endDate: '2026-10-05', products: [], inventoryControl: {}, isDeleted: 0 }).returning();
      const sections = [{ id: 's1', title: 'مواد', checkType: 'global', globalItems: [{ itemCode: item.code, name: item.name, requiredQty: 3, unit: 'عدد' }] }];
      const forged = [{ itemId: item.id, itemCode: item.code, itemName: item.name, reservedQty: 1000000000 }];
      const reservedOf = async () => {
        const [row] = await orm.select({ ic: productionProjects.inventoryControl }).from(productionProjects).where(eq(productionProjects.id, project.id));
        const list = (row?.ic as { reservedItems?: Array<{ itemId?: number; reservedQty?: number }> } | null)?.reservedItems;
        return Array.isArray(list) ? list : [];
      };
      // v9.0.385 (TD-742): each save sends the stored project version
      const versionOf = async () => (await orm.select({ v: productionProjects.version }).from(productionProjects).where(eq(productionProjects.id, project.id)))[0]?.v;
      const put = async (inventoryControl: object) => send(planner.session, 'put', `/api/projects/${project.id}`, { inventory_control: inventoryControl, version: await versionOf() });
      try {
        const draft = await put({ sections, isFinalized: false, reservedItems: forged });
        const afterDraft = await reservedOf();
        const finalize = await put({ sections, isFinalized: true, reservedItems: forged });
        const afterFinal = await reservedOf();
        const resave = await put({ sections, isFinalized: true, reservedItems: [] });
        const afterResave = await reservedOf();
        const wrong: string[] = [];
        for (const [n, r] of [['پیش‌نویس', draft], ['ثبت نهایی', finalize], ['ذخیره دوباره', resave]] as const) {
          if (r.status !== 200) wrong.push(`${n}: ${r.status} (expected 200)`);
        }
        const isServerReservation = (list: Array<{ itemId?: number; reservedQty?: number }>) => list.length === 1 && list[0].itemId === item.id && Number(list[0].reservedQty) === 3;
        if (afterDraft.length !== 0) wrong.push(`draft reservation was saved from the request body: ${JSON.stringify(afterDraft)}`);
        if (!isServerReservation(afterFinal)) wrong.push(`final reservation became ${JSON.stringify(afterFinal)}, expected 3 units from the sections`);
        if (!isServerReservation(afterResave)) wrong.push(`saving again changed the reservation to ${JSON.stringify(afterResave)}`);
        if (wrong.length > 0) throw new Error(wrong.join(', '));
        return 'رزرو بدنه نادیده؛ ثبت نهایی ۳ عدد از بخش‌ها؛ ذخیره دوباره رزرو را نگه داشت';
      } finally {
        await orm.update(productionProjects).set({ isDeleted: 1 }).where(eq(productionProjects.id, project.id));
        await orm.update(items).set({ isDeleted: 1 }).where(eq(items.id, item.id));
      }
    }),
  ];

  try {
    for (const c of cases) {
      if (!shouldRun(c.id, 'security', 'route', 'access')) continue;
      const tStart = Date.now();
      try {
        const details = await c.run();
        results.push(makeTestCase({ id: c.id, name: c.name, layer: 'security', executionType: c.executionType, passed: true, durationMs: Date.now() - tStart, details }));
      } catch (err) {
        results.push(makeTestCase({ id: c.id, name: c.name, layer: 'security', executionType: c.executionType, passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err) }));
      }
    }
  } finally {
    if (createdUserIds.length > 0) await orm.delete(users).where(inArray(users.id, createdUserIds)).catch(() => undefined);
    if (createdRoleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, createdRoleIds)).catch(() => undefined);
  }
  return results;
}
