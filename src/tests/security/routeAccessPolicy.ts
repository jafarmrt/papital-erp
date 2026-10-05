import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { roles, users, dailyWorkLogs, pendingMaterials } from '../../db/schema.js';
import {  } from '../../lib/money.js';
import { buildRouteGuardTable, formatGuards, type RouteGuardRow } from '../../lib/routeGuardTable.js';

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
  'GET /api/system/business-date', 'GET /api/settings', 'GET /api/menu-visibility', 'GET /api/global-search',
  'GET /api/categories', 'GET /api/warehouses',
  'PUT /api/daily-logs/:id/review',
  'GET /api/notifications', 'GET /api/notifications/unread-count', 'PUT /api/notifications/:id/read',
  'PUT /api/notifications/read-all', 'DELETE /api/notifications/:id',
  'GET /api/piecework/payrolls/mine',
  'POST /api/pending-materials',
  'POST /api/drafts', 'GET /api/drafts/:entityType', 'GET /api/drafts', 'DELETE /api/drafts/:entityType', 'DELETE /api/drafts/id/:id',
  'GET /api/attachments/:id',
]);

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const isViewPermission = (entry: string) => entry.endsWith('.view');

/** تخلف‌های جدول مسیرها از سیاست دسترسی؛ آرایه خالی یعنی سالم */
export function routeAccessPolicyViolations(rows: RouteGuardRow[], catalogKeys: Set<string>): string[] {
  const violations: string[] = [];
  for (const row of rows) {
    const key = `${row.method} ${row.path}`;
    if (!row.authenticated) {
      if (!PUBLIC_ROUTES.has(key)) violations.push(`${key}: بدون احراز هویت`);
      continue;
    }
    if (row.guards.length === 0) {
      if (!LOGIN_ONLY_ROUTES.has(key)) violations.push(`${key}: فقط ورود، بدون مجوز`);
      continue;
    }
    // هر گارد «یکی کافی است» است و گاردهای پشت هم همه لازم‌اند: اگر هر گارد یک مجوز «مشاهده» بپذیرد، دارنده فقط مشاهده می‌گذرد
    if (MUTATION_METHODS.has(row.method) && row.guards.every(g => g.some(isViewPermission))) {
      violations.push(`${key}: تغییر با مجوز مشاهده (${formatGuards(row)})`);
    }
    for (const entry of row.guards.flat()) {
      if (entry.includes('.') && !catalogKeys.has(entry)) violations.push(`${key}: مجوز «${entry}» در کاتالوگ نیست`);
    }
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
    record('sec_route_access_policy_td_298', 'حوزه H: جدول «مسیر ← مجوز» — احراز هویت، فهرست مسیرهای فقط‌ورود، تغییر بی مجوز مشاهده، کلید مجوز از کاتالوگ (TD-298 / TD-304)', 'real_code', async () => {
      const rows = buildRouteGuardTable(app);
      if (rows.length < 300) throw new Error(`جدول مسیرها ناقص است (${rows.length} مسیر)`);
      const violations = routeAccessPolicyViolations(rows, catalogKeys);
      if (violations.length > 0) throw new Error(`${violations.length} تخلف: ${violations.join(' | ')}`);
      return `${rows.length} مسیر بی‌تخلف`;
    }),
    record('sec_view_permission_cannot_mutate_td_298', 'حوزه H: مجوز مشاهده تخصیص مواد BOM و شروع فرآیند را باز نمی‌کند (TD-298)', 'real_database', async () => {
      const viewer = await userWith(['warehouse.view', 'projects.view', 'workflow.view', 'products.view']);
      const allocate = await send(viewer.session, 'post', '/api/inventory/allocations/allocate', { projectId: 999999999, allocations: [{ itemId: 999999999, quantity: 1 }] });
      const start = await send(viewer.session, 'post', '/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: 999999999 });
      const wrong = [[allocate.status, 'allocate'], [start.status, 'workflow/start']].filter(([st]) => st !== 403);
      if (wrong.length > 0) throw new Error(`دارنده فقط مشاهده رد نشد: ${wrong.map(([st, n]) => `${n} ${st}`).join('، ')}`);
      return 'هر دو 403';
    }),
    record('sec_user_manager_cannot_grant_admin_td_299', 'حوزه H: دارنده users.manage نقش مدیر سیستم نمی‌دهد و حساب مدیر را تغییر یا حذف نمی‌کند (TD-299)', 'real_database', async () => {
      const manager = await userWith(['users.manage']);
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
      if (wrong.length > 0) throw new Error(wrong.map(([n, got, want]) => `${n}: ${got} (انتظار ${want})`).join('، '));
      return `${checks.length} بررسی`;
    }),
    record('sec_daily_log_by_id_visibility_td_301', 'حوزه H: دریافت تکی گزارش کار همان قاعده محرمانگی فهرست را دارد (TD-301)', 'real_database', async () => {
      const author = await userWith(['daily_logs.view', 'daily_logs.create']);
      const other = await userWith(['daily_logs.view', 'daily_logs.create']);
      const [log] = await orm.insert(dailyWorkLogs).values({
        userId: author.id, username: 'td301', userFullName: 'td301', date: '2026-10-01', dateIso: '2026-10-01',
        title: 'td301 محرمانه', content: 'متن محرمانه', visibility: 'private'
      }).returning();
      try {
        const byOther = await send(other.session, 'get', `/api/daily-logs/${log.id}`);
        const byAuthor = await send(author.session, 'get', `/api/daily-logs/${log.id}`);
        if (byOther.status !== 404) throw new Error(`گزارش محرمانه به کاربر دیگر داده شد (${byOther.status})`);
        if (byAuthor.status !== 200) throw new Error(`نویسنده گزارش خود را نگرفت (${byAuthor.status})`);
        return 'دیگری 404، نویسنده 200';
      } finally {
        await orm.delete(dailyWorkLogs).where(eq(dailyWorkLogs.id, log.id));
      }
    }),
    record('sec_pending_material_edit_td_302', 'حوزه H: ویرایش درخواست ماده اولیه فقط با مجوز تأیید و فقط پیش از بررسی (TD-302)', 'real_database', async () => {
      const logger = await userWith(['daily_logs.view', 'daily_logs.create']);
      const approver = await userWith(['pending_materials.view', 'pending_materials.approve']);
      const [pending] = await orm.insert(pendingMaterials).values({ code: `TD302-${Date.now()}`, name: 'td302', unit: 'عدد', status: 'pending' }).returning();
      const [reviewed] = await orm.insert(pendingMaterials).values({ code: `TD302R-${Date.now()}`, name: 'td302r', unit: 'عدد', status: 'rejected' }).returning();
      try {
        const byLogger = await send(logger.session, 'put', `/api/pending-materials/${pending.id}`, { weightedAverageCost: 999999 });
        const byApprover = await send(approver.session, 'put', `/api/pending-materials/${pending.id}`, { name: 'td302 ویرایش' });
        const reviewedEdit = await send(approver.session, 'put', `/api/pending-materials/${reviewed.id}`, { name: 'td302 پس از رد' });
        const wrong: string[] = [];
        if (byLogger.status !== 403) wrong.push(`کاربر بی‌مجوز: ${byLogger.status} (انتظار 403)`);
        if (byApprover.status !== 200) wrong.push(`تأییدکننده: ${byApprover.status} (انتظار 200)`);
        if (reviewedEdit.status !== 409) wrong.push(`درخواست ردشده: ${reviewedEdit.status} (انتظار 409)`);
        if (wrong.length > 0) throw new Error(wrong.join('، '));
        return 'بی‌مجوز 403، تأییدکننده 200، بررسی‌شده 409';
      } finally {
        await orm.delete(pendingMaterials).where(inArray(pendingMaterials.id, [pending.id, reviewed.id]));
      }
    }),
    record('sec_payroll_amount_read_scope_td_303', 'حوزه H: پرداخت‌های فیش و مانده مساعده فقط با مجوز خواندن فیش‌ها (TD-303)', 'real_database', async () => {
      const production = await userWith(['personnel.view', 'projects.view', 'piecework.view']);
      const payroll = await userWith(['piecework.payroll']);
      const urls = ['/api/piecework/payrolls/999999999/payments', '/api/piecework/personnel/999999999/advance-balance'];
      const wrong: string[] = [];
      for (const url of urls) {
        const denied = await send(production.session, 'get', url);
        const allowed = await send(payroll.session, 'get', url);
        if (denied.status !== 403) wrong.push(`personnel.view ${url}: ${denied.status} (انتظار 403)`);
        if (allowed.status === 403) wrong.push(`piecework.payroll ${url}: 403`);
      }
      if (wrong.length > 0) throw new Error(wrong.join('، '));
      return 'personnel.view ← 403، piecework.payroll مجاز';
    }),
    record('sec_role_permissions_from_catalog_td_304', 'حوزه H: نقش فقط مجوزهای کاتالوگ را می‌گیرد، نه «*» یا کلید ناشناخته (TD-304)', 'real_database', async () => {
      const roleAdmin = await userWith(['roles.manage']);
      const suffix = Date.now();
      const star = await send(roleAdmin.session, 'post', '/api/roles', { name: 'td304', code: `td304_star_${suffix}`, permissions: ['*'] });
      const unknown = await send(roleAdmin.session, 'post', '/api/roles', { name: 'td304', code: `td304_unk_${suffix}`, permissions: ['sales.view'] });
      const valid = await send(roleAdmin.session, 'post', '/api/roles', { name: 'td304', code: `td304_ok_${suffix}`, permissions: ['daily_logs.view'] });
      for (const r of [star, unknown, valid]) if (r.body?.id) createdRoleIds.push(Number(r.body.id));
      const wrong: string[] = [];
      if (star.status !== 400) wrong.push(`«*»: ${star.status} (انتظار 400)`);
      if (unknown.status !== 400) wrong.push(`کلید ناشناخته: ${unknown.status} (انتظار 400)`);
      if (valid.status !== 200) wrong.push(`کلید کاتالوگ: ${valid.status} (انتظار 200)`);
      if (wrong.length > 0) throw new Error(wrong.join('، '));
      return '«*» و ناشناخته 400، کاتالوگ 200';
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
