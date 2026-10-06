import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { roles, users } from '../../db/schema.js';

/**
 * بسته ۱۴ (گردش کار و تأییدات) — دسترسی و یکپارچگی موتور گردش‌کار در مسیرهای واقعی Express، با ورود واقعی (کوکی و CSRF)
 * و مجوزهایی که خود سرور از نقش می‌خواند؛ هیچ مجوزی دستی به سرویس داده نمی‌شود (درس TD-444: آزمون V8 همین را پنهان کرد).
 */

interface Session { cookie: string; csrfToken: string }
type Row = Record<string, unknown>;
type ShouldRun = (id: string, ...extra: string[]) => boolean;

interface Harness {
  app: unknown;
  admin: Session;
  tag: string;
  get(url: string, s?: Session): Promise<request.Response>;
  post(url: string, body: unknown, s?: Session): Promise<request.Response>;
  put(url: string, body: unknown, s?: Session): Promise<request.Response>;
  /** نشست کاربر تازه با نقش seed‌شده (کد) یا نقش تازه با این مجوزها */
  sessionWith(roleOrPermissions: string | string[]): Promise<Session & { userId: number; role: string }>;
  q(text: string, params?: unknown[]): Promise<Row[]>;
  /** گام‌های فرایند را با کلید اقدام، از گام جاری، با نشست داده‌شده می‌رود */
  walk(instanceId: number, actionKeys: string[], s: Session): Promise<number[]>;
  cleanup(): Promise<void>;
}

async function createHarness(): Promise<Harness> {
  const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
  const app = await getTestApp();
  const admin = await getAdminSession();
  const roleIds: number[] = [];
  const userIds: number[] = [];
  const h: Harness = {
    app,
    admin,
    tag: String(Date.now()).slice(-6),
    get: (url, s = admin) => request(app).get(url).set('Cookie', s.cookie),
    post: (url, body, s = admin) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object),
    put: (url, body, s = admin) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object),
    async sessionWith(roleOrPermissions) {
      let role: string;
      if (typeof roleOrPermissions === 'string') {
        role = roleOrPermissions;
      } else {
        const created = await createTestRole({ permissions: roleOrPermissions });
        roleIds.push(created.id);
        role = created.code;
      }
      const user = await createTestUser({ role });
      userIds.push(user.id);
      return { ...(await loginTestUserWithSession(app, user.username)), userId: user.id, role };
    },
    async q(text, params = []) {
      return (await pool.query(text, params)).rows as Row[];
    },
    async walk(instanceId, actionKeys, s) {
      const statuses: number[] = [];
      for (const key of actionKeys) {
        const [inst] = await h.q(`SELECT snapshot_dsl, current_state_id FROM workflow_instances WHERE id = $1`, [instanceId]);
        const transitions = ((inst?.snapshot_dsl as { transitions?: Row[] } | null)?.transitions ?? []);
        let trId = transitions.find(t => t.actionKey === key && t.fromStateId === inst?.current_state_id)?.id;
        if (trId === undefined) {
          // فرایند بی تصویر (ساخته‌شده پیش از نسخه‌بندی): انتقال از جدول جاری
          const [row] = await h.q(`SELECT id FROM workflow_transitions WHERE from_state_id = $1 AND action_key = $2 ORDER BY id LIMIT 1`, [inst?.current_state_id, key]);
          trId = row?.id;
        }
        const res = await h.post('/api/workflow/transition', { instanceId, transitionId: trId ?? 999999999 }, s);
        statuses.push(res.status);
        if (res.status >= 300) break;
      }
      return statuses;
    },
    async cleanup() {
      if (userIds.length > 0) await orm.delete(users).where(inArray(users.id, userIds)).catch(() => undefined);
      if (roleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, roleIds)).catch(() => undefined);
    },
  };
  return h;
}

async function runCase(
  results: TestCaseResult[],
  meta: { id: string; name: string; details: string },
  body: (h: Harness, wrong: string[]) => Promise<void>,
): Promise<void> {
  const tStart = Date.now();
  let h: Harness | undefined;
  try {
    h = await createHarness();
    const wrong: string[] = [];
    await body(h, wrong);
    if (wrong.length > 0) throw new Error(wrong.join('؛ '));
    results.push(makeTestCase({ id: meta.id, name: meta.name, layer: 'security', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details: meta.details }));
  } catch (err) {
    results.push(makeTestCase({
      id: meta.id, name: meta.name, layer: 'security', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await h?.cleanup();
  }
}

async function draftSalesDocument(h: Harness, status: 'draft' | 'proforma' = 'draft'): Promise<number> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const { DocumentService } = await import('../../services/document.service.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  const item = await createTestItem({ type: 'product', name: `کالای گردش‌کار ${h.tag}`, code: `WF14-${h.tag}-${Math.floor(Math.random() * 1e6)}` });
  return Number(await DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status, date: await businessTodayIsoDate(), user: 'آزمون بسته ۱۴', buyerName: `خریدار ${h.tag}`,
    items: [{ itemId: item.id, quantity: 1, unitPrice: 5000, location: await getDefaultWarehouseCode(orm) }],
  } as never));
}

export async function runWorkflowAccessTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_workflow_start_entity_scope_td_443', 'security', 'td443', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_start_entity_scope_td_443',
      name: 'v9.0.33: شروع فرایند فقط با تعریف فعالِ همان نوع موجودیت و روی موجودیت موجود؛ فرایندی که تعریفش نوع دیگری است اقدام دامنه را اجرا نمی‌کند (TD-443)',
      details: 'گردش‌کار اسناد روی سند حسابداری ۴۲۲ و سند پیش‌نویس می‌ماند؛ نوع یا شناسه ناموجود و شناسه شیء رد؛ فرایند ناهمخوان قدیمی ۴۰۹؛ شروع درست روی سند ۲۰۰',
    }, async (h, wrong) => {
      const { createTestVoucher } = await import('../fixtures/factories.js');
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
      const { voucher } = await createTestVoucher({ status: 'draft', date: await businessTodayIsoDate(), totalDebit: 5000000, totalCredit: 5000000 } as never);
      const seller = await h.sessionWith('sales_manager');

      // ۱) گردش‌کار اسناد روی سند حسابداری: ۴۲۲؛ اگر شروع شد، رفتن گام‌ها نباید سند را تأیید کند
      const start = await h.post('/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'journal_voucher', entityId: String(voucher.id) }, seller);
      if (start.status !== 422) {
        wrong.push(`شروع DOC_APPROVAL_WORKFLOW روی سند حسابداری ${start.status} داد، نه ۴۲۲`);
        const instanceId = Number(start.body?.data?.id);
        if (instanceId > 0) await h.walk(instanceId, ['submit_to_warehouse', 'approve_warehouse', 'approve_accounting'], seller);
      }
      const [after] = await h.q(`SELECT status FROM journal_vouchers WHERE id = $1`, [voucher.id]);
      if (after?.status !== 'draft') wrong.push(`سند حسابداری پس از شروع جعلی ${String(after?.status)} شد`);

      // ۲) ورودی نادرست
      const unknownType = await h.post('/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'no_such_type', entityId: '999999999' });
      if (unknownType.status !== 422) wrong.push(`نوع موجودیت ناموجود ${unknownType.status} داد، نه ۴۲۲`);
      const missingDoc = await h.post('/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: '999999999' });
      if (missingDoc.status !== 404) wrong.push(`سند ناموجود ${missingDoc.status} داد، نه ۴۰۴`);
      const objectId = await h.post('/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: { a: 1 } });
      if (objectId.status !== 400) wrong.push(`شناسه شیء ${objectId.status} داد، نه ۴۰۰`);
      const stored = await h.q(`SELECT count(*)::int AS n FROM workflow_instances WHERE entity_id IN ('999999999', '[object Object]')`);
      if (Number(stored[0]?.n) !== 0) wrong.push(`${String(stored[0]?.n)} فرایند روی موجودیت ناموجود ساخته شد`);

      // ۳) فرایند ناهمخوانی که پیش از رفع ساخته شده: انتقال آن ۴۰۹ و سند دست‌نخورده
      const [docDef] = await h.q(`SELECT id, version FROM workflow_definitions WHERE code = 'DOC_APPROVAL_WORKFLOW'`);
      const [initial] = await h.q(`SELECT id FROM workflow_states WHERE workflow_definition_id = $1 AND state_type = 'initial' ORDER BY id LIMIT 1`, [docDef?.id]);
      const { voucher: legacyVoucher } = await createTestVoucher({ status: 'draft', date: await businessTodayIsoDate(), totalDebit: 1000, totalCredit: 1000 } as never);
      const [legacy] = await h.q(
        `INSERT INTO workflow_instances (workflow_definition_id, definition_version, entity_type, entity_id, current_state_id, status, started_by_name)
         VALUES ($1, $2, 'journal_voucher', $3, $4, 'IN_PROGRESS', 'آزمون') RETURNING id`,
        [docDef?.id, docDef?.version ?? 1, String(legacyVoucher.id), initial?.id],
      );
      const adminWalk = await h.walk(Number(legacy?.id), ['submit_to_warehouse', 'approve_warehouse', 'approve_accounting'], h.admin);
      if (adminWalk[0] !== 409) wrong.push(`انتقال فرایند ناهمخوان قدیمی ${adminWalk.join(',')} داد، نه ۴۰۹`);
      const [legacyAfter] = await h.q(`SELECT status FROM journal_vouchers WHERE id = $1`, [legacyVoucher.id]);
      if (legacyAfter?.status !== 'draft') wrong.push(`سند حسابداری فرایند ناهمخوان ${String(legacyAfter?.status)} شد`);
      const widget = await h.get(`/api/workflow/instance/journal_voucher/${legacyVoucher.id}`);
      if (widget.body?.instance) wrong.push('ویجت سند حسابداری فرایند ناهمخوان را نشان داد');

      // ۴) شروع درست: گردش‌کار اسناد روی سند پیش‌نویس موجود
      const docId = await draftSalesDocument(h);
      const ok = await h.post('/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: docId });
      if (ok.status !== 200 || !(Number(ok.body?.data?.id) > 0)) wrong.push(`شروع درست روی سند ${ok.status} داد: ${JSON.stringify(ok.body).slice(0, 160)}`);
    });
  }

  return results;
}
