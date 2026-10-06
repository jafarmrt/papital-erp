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

  if (shouldRun('sec_workflow_signer_permissions_td_444', 'security', 'td444', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_signer_permissions_td_444',
      name: 'v9.0.34: موتور مجوزهای نقش امضاکننده را خودش می‌خواند و کارتابل همان قاعده ویجت را دارد؛ مجوز طراحی گام دیگران را امضا نمی‌کند (TD-444)',
      details: 'مدیر مالی کار حسابدار را در کارتابل می‌بیند و اجرا می‌کند؛ مجوز ثبت انبار گام انباردار را باز می‌کند؛ workflow.manage/admin گام حسابدار را نه می‌بیند نه اجرا می‌کند',
    }, async (h, wrong) => {
      const { createTestVoucher, createTestWorkflow } = await import('../fixtures/factories.js');
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
      const tasksOf = async (s: Session, instanceId: number): Promise<Row[]> => {
        const res = await h.get('/api/workflow/tasks/my-tasks?limit=1000', s);
        const rows = Array.isArray(res.body?.data) ? (res.body.data as Row[]) : [];
        return rows.filter(t => Number(t.instanceId ?? (t.instance as Row | undefined)?.id) === instanceId);
      };

      // ۱) گردش‌کار سند حسابداری (همه گام‌ها با نقش accountant): مدیر مالی هم‌ارز است
      const { voucher } = await createTestVoucher({ status: 'draft', date: await businessTodayIsoDate(), totalDebit: 2000000, totalCredit: 2000000 } as never);
      const started = await h.post('/api/workflow/start', { workflowCode: 'JOURNAL_VOUCHER_WORKFLOW', entityType: 'journal_voucher', entityId: voucher.id });
      const voucherInstance = Number(started.body?.data?.id);
      if (!(voucherInstance > 0)) throw new Error(`شروع گردش‌کار سند حسابداری ${started.status} داد: ${JSON.stringify(started.body).slice(0, 160)}`);

      const designer = await h.sessionWith(['workflow.view', 'workflow.approve', 'workflow.manage', 'workflow.admin']);
      const designerTasks = await tasksOf(designer, voucherInstance);
      if (designerTasks.length > 0) wrong.push('دارنده مجوز طراحی کار حسابدار را در کارتابل دید');
      const [anyTask] = await h.q(`SELECT id FROM workflow_tasks WHERE instance_id = $1 AND status = 'pending' ORDER BY id LIMIT 1`, [voucherInstance]);
      if (anyTask) {
        const designerExec = await h.post(`/api/workflow/tasks/${String(anyTask.id)}/execute`, { action: 'approve' }, designer);
        if (designerExec.status !== 403) wrong.push(`اجرای کار حسابدار با مجوز طراحی ${designerExec.status} داد، نه ۴۰۳`);
      } else {
        wrong.push('فرایند سند حسابداری کار در انتظار نساخت');
      }
      const designerWalk = await h.walk(voucherInstance, ['approve_voucher'], designer);
      if (designerWalk[0] !== 403) wrong.push(`اقدام حسابدار با مجوز طراحی ${designerWalk.join(',')} داد، نه ۴۰۳`);

      const cfo = await h.sessionWith('cfo_accountant');
      const stats = await h.get('/api/workflow/tasks/stats', cfo);
      if (!(Number(stats.body?.pendingCount) > 0)) wrong.push(`آمار کارتابل مدیر مالی ${String(stats.body?.pendingCount)} است`);
      const cfoTasks = await tasksOf(cfo, voucherInstance);
      if (cfoTasks.length === 0) {
        wrong.push('مدیر مالی کار حسابدار را در کارتابل ندید');
      } else {
        const exec = await h.post(`/api/workflow/tasks/${String(cfoTasks[0].id)}/execute`, { action: 'approve' }, cfo);
        if (exec.status !== 200) wrong.push(`اجرای کار از کارتابل مدیر مالی ${exec.status} داد: ${JSON.stringify(exec.body).slice(0, 160)}`);
      }
      const [vAfter] = await h.q(`SELECT status FROM journal_vouchers WHERE id = $1`, [voucher.id]);
      if (vAfter?.status !== 'approved') wrong.push(`سند حسابداری پس از اجرای مدیر مالی ${String(vAfter?.status)} است`);

      // ۲) گام انباردار: نقش تازه با مجوز ثبت انبار (بی کد نقش انباردار) آن را می‌بیند و اجرا می‌کند
      const { definition } = await createTestWorkflow({ definition: { entityType: 'test_document' } });
      await h.q(`UPDATE workflow_transitions SET required_role = 'warehouse_keeper' WHERE workflow_definition_id = $1`, [definition.id]);
      const docStart = await h.post('/api/workflow/start', { workflowCode: definition.code, entityType: 'test_document', entityId: `TD444-${h.tag}` });
      const docInstance = Number(docStart.body?.data?.id);
      if (!(docInstance > 0)) throw new Error(`شروع گردش‌کار آزمایشی ${docStart.status} داد`);
      const viewer = await h.sessionWith(['workflow.view', 'workflow.approve', 'warehouse.view']);
      const widget = await h.get(`/api/workflow/instance/test_document/TD444-${h.tag}`, viewer);
      if ((widget.body?.availableTransitions ?? []).length > 0) wrong.push('مجوز مشاهده انبار اقدام گام انباردار را در ویجت دید');
      const stockKeeper = await h.sessionWith(['workflow.view', 'workflow.approve', 'warehouse.view', 'warehouse.out']);
      const keeperTasks = await tasksOf(stockKeeper, docInstance);
      if (keeperTasks.length === 0) {
        wrong.push('دارنده مجوز ثبت انبار گام انباردار را در کارتابل ندید');
      } else {
        const exec = await h.post(`/api/workflow/tasks/${String(keeperTasks[0].id)}/execute`, { action: 'approve' }, stockKeeper);
        if (exec.status !== 200) wrong.push(`اجرای گام انباردار از کارتابل ${exec.status} داد: ${JSON.stringify(exec.body).slice(0, 160)}`);
      }
      const keeperWalk = await h.walk(docInstance, ['approve'], stockKeeper);
      if (keeperWalk[0] !== 200) wrong.push(`اقدام دوم گام انباردار از ویجت ${keeperWalk.join(',')} داد، نه ۲۰۰`);
      await h.q(`DELETE FROM workflow_tasks WHERE instance_id = $1`, [docInstance]).catch(() => undefined);
    });
  }

  if (shouldRun('sec_workflow_document_steps_permission_td_445', 'security', 'td445', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_document_steps_permission_td_445',
      name: 'v9.0.35: گام‌های انبار و مالی گردش کار اسناد با مجوز بسته‌اند و قطعی‌سازی از گردش کار مجوز سند را می‌خواهد؛ تعریف دست‌نخورده نصب موجود به‌روز می‌شود (TD-445)',
      details: 'فروشنده و خزانه‌دار از گام انبار ۴۰۳؛ گردش کار ویرایش‌شده بی نگهبان: خزانه‌دار قطعی نمی‌کند و بررسی سلامت آن را فهرست می‌کند؛ انباردار و مدیر مالی سند را قطعی می‌کنند',
    }, async (h, wrong) => {
      const { createTestWorkflow } = await import('../fixtures/factories.js');
      const { WorkflowDefinitionService } = await import('../../services/workflow/workflowDefinitionService.js');
      const { findUnguardedDocumentApprovals } = await import('../../services/workflow/docApprovalGuards.js');
      const docStatus = async (id: number) => (await h.q(`SELECT type, status FROM documents WHERE id = $1`, [id]))[0];
      const startDoc = async (code: string, docId: number, s: Session = h.admin) => {
        const res = await h.post('/api/workflow/start', { workflowCode: code, entityType: 'document', entityId: docId }, s);
        const id = Number(res.body?.data?.id);
        if (!(id > 0)) throw new Error(`شروع ${code} روی سند ${docId}: ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
        return id;
      };

      // ۰) تعریف پیش‌فرض به حالت seed پیشین برمی‌گردد و به‌روزرسانی نصب موجود اجرا می‌شود
      const [docDef] = await h.q(`SELECT id, version FROM workflow_definitions WHERE code = 'DOC_APPROVAL_WORKFLOW'`);
      const legacyGuards = `UPDATE workflow_transitions SET required_role = CASE WHEN action_key = 'direct_approve' THEN 'admin' ELSE '' END,
        required_permission = CASE WHEN action_key = 'direct_approve' THEN 'workflow.approve' ELSE '' END WHERE workflow_definition_id = $1`;
      await h.q(legacyGuards, [docDef?.id]);
      await h.q(`UPDATE workflow_transitions SET title = title || ' (ویرایش)' WHERE workflow_definition_id = $1 AND action_key = 'approve_accounting'`, [docDef?.id]);
      await WorkflowDefinitionService.seedDefaultWorkflows();
      const edited = await h.q(`SELECT required_permission FROM workflow_transitions WHERE workflow_definition_id = $1 AND action_key = 'approve_accounting'`, [docDef?.id]);
      if (edited[0]?.required_permission !== '') wrong.push('گردش کار ویرایش‌شده خودکار تغییر کرد');
      const listed = await findUnguardedDocumentApprovals();
      if (!listed.some(r => r.definitionId === Number(docDef?.id))) wrong.push('بررسی سلامت گام تأیید بی‌نگهبان گردش کار ویرایش‌شده را فهرست نکرد');
      await h.q(`UPDATE workflow_transitions SET title = replace(title, ' (ویرایش)', '') WHERE workflow_definition_id = $1`, [docDef?.id]);
      await WorkflowDefinitionService.seedDefaultWorkflows();
      const guards = await h.q(`SELECT action_key, required_role, required_permission FROM workflow_transitions WHERE workflow_definition_id = $1 ORDER BY id`, [docDef?.id]);
      const guardOf = (key: string) => guards.filter(g => g.action_key === key).map(g => `${String(g.required_role)}|${String(g.required_permission)}`).join(',');
      if (guardOf('approve_warehouse') !== '|warehouse.out') wrong.push(`نگهبان بررسی انبار ${guardOf('approve_warehouse')}`);
      if (guardOf('approve_accounting') !== '|accounting.vouchers') wrong.push(`نگهبان بررسی مالی ${guardOf('approve_accounting')}`);
      if (guardOf('direct_approve') !== '|workflow.admin') wrong.push(`نگهبان تأیید مستقیم ${guardOf('direct_approve')}`);
      const [defAfter] = await h.q(`SELECT version FROM workflow_definitions WHERE id = $1`, [docDef?.id]);
      if (!(Number(defAfter?.version) > Number(docDef?.version))) wrong.push('به‌روزرسانی نسخه تازه تعریف نساخت');
      if ((await findUnguardedDocumentApprovals()).some(r => r.definitionId === Number(docDef?.id))) wrong.push('گردش کار پیش‌فرض پس از به‌روزرسانی هنوز بی‌نگهبان فهرست شد');

      // ۱) فروشنده پیش‌فاکتور خودش را از گام انبار نمی‌گذراند
      const seller = await h.sessionWith('sales_manager');
      const proforma = await draftSalesDocument(h, 'proforma');
      const sellerWalk = await h.walk(await startDoc('DOC_APPROVAL_WORKFLOW', proforma, seller), ['submit_to_warehouse', 'approve_warehouse', 'approve_accounting'], seller);
      if (sellerWalk[1] !== 403) wrong.push(`فروشنده گام انبار را ${sellerWalk.join(',')} رفت`);
      if ((await docStatus(proforma))?.status !== 'proforma') wrong.push(`پیش‌فاکتور فروشنده ${JSON.stringify(await docStatus(proforma))} شد`);

      // ۲) خزانه‌دار: گام انبار ۴۰۳؛ در گردش کار ویرایش‌شده بی نگهبان هم قطعی‌سازی مجوز سند را می‌خواهد (ت۳)
      const treasurer = await h.sessionWith('treasurer');
      const draftA = await draftSalesDocument(h);
      const treasurerWalk = await h.walk(await startDoc('DOC_APPROVAL_WORKFLOW', draftA), ['submit_to_warehouse', 'approve_warehouse'], treasurer);
      if (treasurerWalk[1] !== 403) wrong.push(`خزانه‌دار گام انبار را ${treasurerWalk.join(',')} رفت`);
      const { definition: open } = await createTestWorkflow({ definition: { entityType: 'document', code: `WF445_${h.tag}` } });
      const draftB = await draftSalesDocument(h);
      const openWalk = await h.walk(await startDoc(open.code, draftB), ['submit', 'approve'], treasurer);
      if (openWalk[0] !== 200 || openWalk[1] !== 403) wrong.push(`خزانه‌دار در گردش کار بی‌نگهبان ${openWalk.join(',')} گرفت، نه ۲۰۰,۴۰۳`);
      if ((await docStatus(draftB))?.status !== 'draft') wrong.push(`سند خزانه‌دار ${JSON.stringify(await docStatus(draftB))} شد`);
      await h.q(`UPDATE workflow_definitions SET is_active = 0 WHERE id = $1`, [open.id]);

      // ۳) مسیر درست: انباردار گام انبار، مدیر مالی گام مالی؛ سند قطعی می‌شود
      const keeper = await h.sessionWith('warehouse_keeper');
      const cfo = await h.sessionWith('cfo_accountant');
      const draftC = await draftSalesDocument(h);
      const instanceC = await startDoc('DOC_APPROVAL_WORKFLOW', draftC);
      const okWalk = [...await h.walk(instanceC, ['submit_to_warehouse', 'approve_warehouse'], keeper), ...await h.walk(instanceC, ['approve_accounting'], cfo)];
      if (okWalk.join(',') !== '200,200,200') wrong.push(`مسیر انباردار و مدیر مالی ${okWalk.join(',')} داد`);
      const finalC = await docStatus(draftC);
      if (finalC?.status !== 'final') wrong.push(`سند پس از تأیید مالی ${JSON.stringify(finalC)} است`);
    });
  }

  if (shouldRun('sec_workflow_start_failure_td_451', 'security', 'td451', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_start_failure_td_451',
      name: 'v9.0.36: خطای شروع گردش کار تعریف فعال بلعیده نمی‌شود؛ حساب خزانه و کالا بی تأیید سند افتتاحیه نمی‌گیرند (TD-451)',
      details: 'تعریف فعال بی گام آغازین برای حساب خزانه و کالا: ثبت رد می‌شود، نه حساب یا کالا ساخته می‌شود نه سند افتتاحیه',
    }, async (h, wrong) => {
      const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
      // تعریف‌های فعال دیگر این دو نوع موقتاً غیرفعال می‌شوند تا تعریف خراب انتخاب شود
      const others = await h.q(`SELECT id FROM workflow_definitions WHERE entity_type IN ('bank_account', 'item') AND is_active = 1`);
      const otherIds = others.map(r => Number(r.id));
      if (otherIds.length > 0) await h.q(`UPDATE workflow_definitions SET is_active = 0 WHERE id = ANY($1::int[])`, [otherIds]);
      const broken = await h.q(
        `INSERT INTO workflow_definitions (code, title, entity_type, version, is_active)
         VALUES ($1, 'گردش کار خراب حساب خزانه', 'bank_account', 1, 1), ($2, 'گردش کار خراب کالا', 'item', 1, 1) RETURNING id`,
        [`WF451_BANK_${h.tag}`, `WF451_ITEM_${h.tag}`],
      );
      try {
        const title = `بانک آزمون ۴۵۱ ${h.tag}`;
        const [parent] = await h.q(`SELECT id FROM accounts WHERE code = '1003' AND is_deleted = 0`);
        const [ledger] = await h.q(
          `INSERT INTO accounts (code, name, level, parent_id, account_type, nature, is_system, is_active, is_deleted)
           VALUES ($1, $2, 'subsidiary', $3, 'asset', 'debit', 0, 1, 0) RETURNING id`,
          [`1003451${h.tag}`, title, parent?.id ?? null],
        );
        const bank = await h.post('/api/accounting/bank-accounts', { title, type: 'bank', bankName: 'ملت', currency: 'IRR', initialBalance: 7000000, accountId: ledger?.id });
        if (bank.status < 400) wrong.push(`ثبت حساب خزانه با گردش کار خراب ${bank.status} داد`);
        const banks = await h.q(`SELECT id FROM bank_accounts WHERE title = $1 AND is_deleted = 0`, [title]);
        if (banks.length > 0) {
          wrong.push('حساب خزانه با گردش کار خراب ساخته شد');
          const vouchers = await h.q(`SELECT count(*)::int AS n FROM journal_vouchers WHERE is_deleted = 0 AND reference_module = 'treasury_opening' AND reference_id = $1`, [banks[0].id]);
          if (Number(vouchers[0]?.n) > 0) wrong.push('سند افتتاحیه حساب خزانه بی تأیید صادر شد');
        }

        const code = `WF451-${h.tag}`;
        const item = await h.post('/api/items', {
          type: 'raw_material', name: `کالای آزمون ۴۵۱ ${h.tag}`, code, unit: 'عدد', category: 'دستبند',
          weighted_average_cost: 1000, [`stock_${await getDefaultWarehouseCode(orm)}`]: 5,
        });
        if (item.status < 400) wrong.push(`ثبت کالا با گردش کار خراب ${item.status} داد`);
        const created = await h.q(`SELECT id FROM items WHERE code = $1 AND is_deleted = 0`, [code]);
        if (created.length > 0) {
          wrong.push('کالا با گردش کار خراب ساخته شد');
          const opening = await h.q(`SELECT count(*)::int AS n FROM journal_vouchers WHERE is_deleted = 0 AND reference_module = 'item_opening' AND reference_id = $1`, [created[0].id]);
          if (Number(opening[0]?.n) > 0) wrong.push('سند افتتاحیه کالا بی تأیید صادر شد');
        }
      } finally {
        await h.q(`UPDATE workflow_definitions SET is_active = 0 WHERE id = ANY($1::int[])`, [broken.map(r => Number(r.id))]);
        if (otherIds.length > 0) await h.q(`UPDATE workflow_definitions SET is_active = 1 WHERE id = ANY($1::int[])`, [otherIds]);
      }
    });
  }

  if (shouldRun('sec_workflow_single_open_instance_td_455', 'security', 'td455', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_single_open_instance_td_455',
      name: 'v9.0.37: شروع هم‌زمان برای یک موجودیت فقط یک فرایند در جریان می‌سازد و پایگاه‌داده فرایند باز دوم را نمی‌پذیرد (TD-455)',
      details: 'شش شروع هم‌زمان روی یک سند: یک فرایند در جریان؛ درج مستقیم فرایند باز دوم با شاخص یکتای جزئی رد می‌شود',
    }, async (h, wrong) => {
      const docId = await draftSalesDocument(h);
      const starts = await Promise.all(Array.from({ length: 6 }, () =>
        h.post('/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: docId })));
      const statuses = starts.map(r => r.status);
      if (statuses.some(s => s !== 200)) wrong.push(`شروع‌های هم‌زمان ${statuses.join(',')} دادند`);
      const open = await h.q(`SELECT id FROM workflow_instances WHERE entity_type = 'document' AND entity_id = $1 AND status = 'IN_PROGRESS'`, [String(docId)]);
      if (open.length !== 1) wrong.push(`${open.length} فرایند در جریان برای یک سند ساخته شد`);
      const ids = new Set(starts.map(r => Number(r.body?.data?.id)));
      if (ids.size !== 1) wrong.push(`شروع‌های هم‌زمان ${ids.size} فرایند متفاوت برگرداندند`);

      const [first] = open;
      if (first) {
        try {
          await h.q(
            `INSERT INTO workflow_instances (workflow_definition_id, definition_version, entity_type, entity_id, current_state_id, status, started_by_name)
             SELECT workflow_definition_id, definition_version, entity_type, entity_id, current_state_id, 'IN_PROGRESS', 'آزمون' FROM workflow_instances WHERE id = $1`,
            [first.id],
          );
          wrong.push('پایگاه‌داده فرایند در جریان دوم را برای همان سند پذیرفت');
        } catch (err) {
          if ((err as { code?: string }).code !== '23505') wrong.push(`درج فرایند دوم خطای دیگری داد: ${String(err)}`);
        }
      }
    });
  }

  return results;
}
