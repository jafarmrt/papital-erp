import { TestCaseResult } from '../types.js';
import { pool } from '../../db/drizzle.js';
import { WorkflowDefinitionService, type SaveWorkflowDefinitionPayload } from '../../services/workflow/workflowDefinitionService.js';
import { runCase, draftSalesDocument, type Harness, type Row, type ShouldRun } from './workflowTestHarness.js';

/**
 * بسته ۱۴ (گردش کار)، PR ج — طراح، قاعده‌ها و پایگاه‌داده: اعتبار ساختار طرح، seed، ترتیب گام‌ها، قاعده‌های اقدام،
 * مهلت از تصویر نسخه، بدنه routeها و قیدهای جدول‌ها؛ از مسیرهای واقعی Express.
 */

const designCode = (h: Harness, label: string): string => `WF14C_${label}_${h.tag}_${Math.floor(Math.random() * 1e6)}`;

const definitionsWithCode = (h: Harness, code: string): Promise<Row[]> =>
  h.q(`SELECT id FROM workflow_definitions WHERE code = $1`, [code]);

async function dropDefinition(h: Harness, code: string): Promise<void> {
  const ids = (await definitionsWithCode(h, code)).map(r => Number(r.id));
  if (ids.length === 0) return;
  await h.q(`DELETE FROM workflow_definition_versions WHERE definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_transitions WHERE workflow_definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_states WHERE workflow_definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_definitions WHERE id = ANY($1::int[])`, [ids]);
}

const validStates = [
  { stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' },
  { stateKey: 'review', title: 'بررسی', stateType: 'intermediate' },
  { stateKey: 'done', title: 'تأیید', stateType: 'terminal' },
];

/** طرح فعلی یک تعریف به شکل بدنه طراح (گام‌ها با شناسه، اقدام‌ها با شناسه گام) برای ویرایش و بازگرداندن */
async function designOf(code: string): Promise<SaveWorkflowDefinitionPayload> {
  const def = await WorkflowDefinitionService.getDefinitionByCode(code);
  const details = def ? await WorkflowDefinitionService.getDefinitionById(Number(def.id)) : null;
  if (!details) throw new Error(`تعریف ${code} پیدا نشد`);
  const d = details.definition;
  return {
    id: d.id, code: d.code, title: d.title, entityType: d.entityType, description: d.description ?? '',
    states: details.states.map(s => ({ id: s.id, stateKey: s.stateKey, title: s.title, stateType: s.stateType ?? undefined, stepOrder: s.stepOrder ?? undefined, slaHours: s.slaHours ?? undefined, color: s.color ?? undefined, positionX: s.positionX ?? undefined, positionY: s.positionY ?? undefined })),
    transitions: details.transitions.map(t => ({
      fromStateId: t.fromStateId, toStateId: t.toStateId, actionKey: t.actionKey, title: t.title, requiredRole: t.requiredRole ?? '',
      requiredPermission: t.requiredPermission ?? '', approvalRuleType: t.approvalRuleType ?? 'SINGLE', kValue: t.kValue ?? 1,
      ruleConditionsJson: t.ruleConditionsJson, autoActionKey: t.autoActionKey ?? '', isInitiatorExcluded: t.isInitiatorExcluded,
    })),
  };
}

export async function runWorkflowDesignerTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_workflow_design_validation_td_452', 'security', 'td452', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_design_validation_td_452',
      name: 'v9.0.45: طرح گردش کار نامعتبر با ۴۲۲ و پیام فارسی رد می‌شود و هیچ اقدامی بی‌صدا حذف نمی‌شود (TD-452)',
      details: 'بی گام آغاز، دو گام آغاز، کلید تکراری، بی گام پایان، خروج از گام پایانی، گام‌ها نه آرایه، اقدام با مقصد ناموجود و شمار امضای ۰ همه ۴۲۲؛ طرح درست ۲۰۰ و همه اقدام‌ها ذخیره می‌شوند',
    }, async (h, wrong) => {
      const codes: string[] = [];
      try {
        const cases: Array<[string, unknown, unknown]> = [
          ['بی گام آغاز', validStates.map(s => ({ ...s, stateType: s.stateType === 'initial' ? 'intermediate' : s.stateType })), []],
          ['دو گام آغاز', validStates.map(s => ({ ...s, stateType: s.stateKey === 'review' ? 'initial' : s.stateType })), []],
          ['کلید تکراری', [...validStates, { stateKey: 'review', title: 'بررسی دوم', stateType: 'intermediate' }], []],
          ['بی گام پایان', validStates.map(s => ({ ...s, stateType: s.stateType === 'terminal' ? 'intermediate' : s.stateType })), []],
          ['خروج از گام پایانی', validStates, [{ fromStateKey: 'done', toStateKey: 'review', actionKey: 'back', title: 'بازگشت' }]],
          ['گام‌ها نه آرایه', 'not-an-array', []],
          ['مقصد ناموجود', validStates, [
            { fromStateKey: 'draft', toStateKey: 'review', actionKey: 'send', title: 'ارسال' },
            { fromStateKey: 'review', toStateKey: 'lost', actionKey: 'lost', title: 'گم‌شده' },
          ]],
          ['شمار امضای صفر', validStates, [{ fromStateKey: 'draft', toStateKey: 'done', actionKey: 'ok', title: 'تأیید', approvalRuleType: 'K_OF_N', kValue: 0 }]],
        ];
        for (const [label, states, transitions] of cases) {
          const code = designCode(h, 'BAD');
          codes.push(code);
          const res = await h.post('/api/workflow/definitions', { code, title: `طرح ${label}`, entityType: 'document', states, transitions });
          // از v9.0.50 (TD-459) بدنه‌ای که نوعش نادرست است پیش از سرویس با Zod ۴۰۰ می‌گیرد
          if (res.status !== 422 && res.status !== 400) wrong.push(`طرح «${label}» ${res.status} داد، نه ۴۲۲`);
          else if (!/[؀-ۿ]/.test(String(res.body?.error ?? res.body?.message ?? ''))) wrong.push(`پیام رد طرح «${label}» فارسی نیست`);
          if ((await definitionsWithCode(h, code)).length > 0) wrong.push(`طرح «${label}» با وجود رد ذخیره شد`);
        }

        // گام پایانی ردشده اقدام بازگشایی دارد (TD-379) و طرح درست همه اقدام‌هایش را نگه می‌دارد
        const code = designCode(h, 'OK');
        codes.push(code);
        const ok = await h.post('/api/workflow/definitions', {
          code, title: 'طرح درست', entityType: 'document',
          states: [...validStates, { stateKey: 'rejected', title: 'رد شده', stateType: 'terminal' }],
          transitions: [
            { fromStateKey: 'draft', toStateKey: 'review', actionKey: 'send', title: 'ارسال' },
            { fromStateKey: 'review', toStateKey: 'done', actionKey: 'approve', title: 'تأیید', approvalRuleType: 'K_OF_N', kValue: 2 },
            { fromStateKey: 'review', toStateKey: 'rejected', actionKey: 'reject', title: 'رد' },
            { fromStateKey: 'rejected', toStateKey: 'draft', actionKey: 'reopen', title: 'بازگشایی' },
          ],
        });
        if (ok.status !== 200) wrong.push(`طرح درست ${ok.status} داد: ${JSON.stringify(ok.body).slice(0, 200)}`);
        const saved = Array.isArray(ok.body?.data?.transitions) ? ok.body.data.transitions.length : -1;
        if (ok.status === 200 && saved !== 4) wrong.push(`از ۴ اقدام طرح درست ${saved} ذخیره شد`);
      } finally {
        for (const code of codes) await dropDefinition(h, code);
      }
    });
  }

  if (shouldRun('sec_workflow_seed_keeps_edited_definition_td_453', 'security', 'td453', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_seed_keeps_edited_definition_td_453',
      name: 'v9.0.46: خواندن فهرست تعریف‌ها و seed راه‌اندازی، گردش کار خرید ویرایش‌شده را بازنویسی نمی‌کنند (TD-453، ت۸)',
      details: 'گردش خرید با عنوان «…استعلام…» و نقش manager روی تأیید: پس از GET /workflow/definitions و seed راه‌اندازی همان می‌ماند و نسخه تازه نمی‌گیرد؛ همگام‌سازی دستی الگوها دیگر route ندارد',
    }, async (h, wrong) => {
      const code = 'PURCHASE_REQUISITION_WORKFLOW';
      const original = await designOf(code);
      try {
        const edited = await designOf(code);
        edited.title = `خرید با استعلام سه‌گانه قیمت ${h.tag}`;
        edited.transitions = (edited.transitions ?? []).map(t => (t.actionKey === 'approve_request' ? { ...t, requiredRole: 'manager' } : t));
        await WorkflowDefinitionService.saveWorkflowDefinition(edited);
        const [{ version: before }] = await h.q(`SELECT version FROM workflow_definitions WHERE code = $1`, [code]);

        const list = await h.get('/api/workflow/definitions');
        if (list.status !== 200) wrong.push(`فهرست تعریف‌ها ${list.status} داد`);
        await WorkflowDefinitionService.seedDefaultWorkflows();

        const [after] = await h.q(`SELECT id, title, version FROM workflow_definitions WHERE code = $1`, [code]);
        if (after?.title !== edited.title) wrong.push(`عنوان گردش خرید به «${String(after?.title)}» برگشت`);
        if (Number(after?.version) !== Number(before)) wrong.push(`خواندن فهرست و seed نسخه را از ${String(before)} به ${String(after?.version)} برد`);
        const [approve] = await h.q(`SELECT required_role FROM workflow_transitions WHERE workflow_definition_id = $1 AND action_key = 'approve_request'`, [after?.id]);
        if (approve?.required_role !== 'manager') wrong.push(`نقش لازم تأیید درخواست خرید «${String(approve?.required_role)}» شد، نه manager`);

        const sync = await h.post('/api/workflow/definitions/seed-default', {});
        if (sync.status !== 404) wrong.push(`همگام‌سازی دستی الگوها ${sync.status} داد، نه ۴۰۴`);
      } finally {
        await WorkflowDefinitionService.saveWorkflowDefinition(await restorable(original));
      }
    });
  }

  if (shouldRun('sec_workflow_step_order_td_454', 'security', 'td454', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_step_order_td_454',
      name: 'v9.0.47: ذخیره طرح ترتیب گام‌ها را نگه می‌دارد؛ گام بی ترتیب جای خودش در فهرست را می‌گیرد (TD-454)',
      details: 'طرح سه‌گامی بی stepOrder (مانند بدنه طراح پیش از v9.0.47) ترتیب ۱، ۲، ۳ می‌گیرد، نه ۱، ۱، ۱؛ ترتیب صریح طراح همان‌طور ذخیره می‌شود',
    }, async (h, wrong) => {
      const codes = [designCode(h, 'ORDER'), designCode(h, 'ORDER')];
      try {
        const orderOf = async (code: string) => (await h.q(
          `SELECT s.state_key, s.step_order FROM workflow_states s JOIN workflow_definitions d ON d.id = s.workflow_definition_id WHERE d.code = $1 ORDER BY s.id`, [code],
        )).map(r => `${String(r.state_key)}:${String(r.step_order)}`).join(',');
        const transitions = [{ fromStateKey: 'draft', toStateKey: 'review', actionKey: 'send', title: 'ارسال' }, { fromStateKey: 'review', toStateKey: 'done', actionKey: 'ok', title: 'تأیید' }];

        const bare = await h.post('/api/workflow/definitions', { code: codes[0], title: 'ترتیب ضمنی', entityType: 'document', states: validStates, transitions });
        if (bare.status !== 200) wrong.push(`طرح بی ترتیب ${bare.status} داد`);
        const implicit = await orderOf(codes[0]);
        if (implicit !== 'draft:1,review:2,done:3') wrong.push(`ترتیب گام‌های طرح بی ترتیب «${implicit}» شد، نه draft:1,review:2,done:3`);

        const ordered = validStates.map((s, i) => ({ ...s, stepOrder: [2, 3, 1][i] }));
        const explicit = await h.post('/api/workflow/definitions', { code: codes[1], title: 'ترتیب صریح', entityType: 'document', states: ordered, transitions });
        if (explicit.status !== 200) wrong.push(`طرح با ترتیب ${explicit.status} داد`);
        const kept = await orderOf(codes[1]);
        if (kept !== 'draft:2,review:3,done:1') wrong.push(`ترتیب صریح «${kept}» ذخیره شد، نه draft:2,review:3,done:1`);
      } finally {
        for (const code of codes) await dropDefinition(h, code);
      }
    });
  }

  if (shouldRun('sec_workflow_rule_validation_td_456', 'security', 'td456', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_rule_validation_td_456',
      name: 'v9.0.48: قاعده نادرست اقدام هنگام ذخیره ۴۲۲ می‌گیرد و قاعده نادرست ذخیره‌شده «بسته» ارزیابی می‌شود (TD-456)',
      details: 'ذخیره {field, op} به‌جای operator و [null] رد می‌شود؛ در فرایندی که قاعده نادرست در تصویرش دارد، اقدام روی سند ۵٬۰۰۰ ریالی رد می‌شود (نه ۲۰۰) و ویجت مراحل با [null] پاسخ ۲۰۰ و اقدام بسته می‌دهد (نه ۵۰۰)',
    }, async (h, wrong) => {
      const codes: string[] = [];
      try {
        const twoSteps = [validStates[0], validStates[2]];
        for (const [label, rule] of [['op به‌جای operator', { field: 'amount', op: 'lt', value: 1000 }], ['شرط تهی', [null]]] as const) {
          const code = designCode(h, 'RULE');
          codes.push(code);
          const res = await h.post('/api/workflow/definitions', {
            code, title: `قاعده ${label}`, entityType: 'document', states: twoSteps,
            transitions: [{ fromStateKey: 'draft', toStateKey: 'done', actionKey: 'ok', title: 'تأیید', ruleConditionsJson: rule }],
          });
          if (res.status !== 422) wrong.push(`ذخیره قاعده «${label}» ${res.status} داد، نه ۴۲۲`);
        }

        // قاعده نادرستی که پیش از این نسخه ذخیره شده و در تصویر فرایند است
        const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
        const code = designCode(h, 'STORED');
        codes.push(code);
        const saved = await WorkflowDefinitionService.saveWorkflowDefinition({
          code, title: 'قاعده ذخیره‌شده', entityType: 'document', states: twoSteps,
          transitions: [{ fromStateKey: 'draft', toStateKey: 'done', actionKey: 'ok', title: 'تأیید' }],
        });
        const definitionId = Number(saved?.definition.id);
        const withStoredRule = async (rule: unknown): Promise<{ docId: number; instanceId: number; transitionId: number }> => {
          const docId = await draftSalesDocument(h);
          const inst = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: definitionId, entityType: 'document', entityId: String(docId) });
          await h.q(`UPDATE workflow_instances SET snapshot_dsl = jsonb_set(snapshot_dsl, '{transitions,0,ruleConditionsJson}', $1::jsonb) WHERE id = $2`, [JSON.stringify(rule), inst.id]);
          const [row] = await h.q(`SELECT (snapshot_dsl->'transitions'->0->>'id')::int AS id FROM workflow_instances WHERE id = $1`, [inst.id]);
          return { docId, instanceId: inst.id, transitionId: Number(row?.id) };
        };

        const open = await withStoredRule({ field: 'amount', op: 'lt', value: 1000 });
        const run = await h.post('/api/workflow/transition', { instanceId: open.instanceId, transitionId: open.transitionId });
        if (run.status !== 422) wrong.push(`اقدام با قاعده {op:'lt'} روی سند ۵٬۰۰۰ ریالی ${run.status} گرفت، نه ۴۲۲`);

        const broken = await withStoredRule([null]);
        const view = await h.get(`/api/workflow/instance/document/${broken.docId}`);
        if (view.status !== 200) wrong.push(`ویجت مراحل با قاعده [null] ${view.status} داد، نه ۲۰۰`);
        else if ((view.body?.availableTransitions ?? []).some((t: Row) => t.actionKey === 'ok')) wrong.push('اقدام با قاعده [null] در اقدام‌های مجاز آمد');
        await h.q(`UPDATE workflow_instances SET status = 'TERMINATED' WHERE id = ANY($1::int[])`, [[open.instanceId, broken.instanceId]]);
      } finally {
        await h.q(`DELETE FROM workflow_instances WHERE workflow_definition_id IN (SELECT id FROM workflow_definitions WHERE code = ANY($1::text[]))`, [codes]);
        for (const c of codes) await dropDefinition(h, c);
      }
    });
  }

  if (shouldRun('sec_workflow_sla_from_snapshot_td_457', 'security', 'td457', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_sla_from_snapshot_td_457',
      name: 'v9.0.49: تحلیل مهلت انجام فرایند در جریان را با گام‌های تصویر نسخه خودش می‌سنجد، حتی پس از ذخیره دوباره طرح (TD-457)',
      details: 'فرایند ۳۰ ساعته در گام ۷۲ ساعته: پیش و پس از ذخیره بی‌تغییر طرح دارای تأخیر نیست و در شمار فعال همان گام (با شناسه تازه) می‌آید؛ پیش‌تر پس از ذخیره «نامشخص، مهلت ۲۴، ۶ ساعت تأخیر» شد و شمار فعال گام ۰',
    }, async (h, wrong) => {
      const code = designCode(h, 'SLA');
      try {
        const design: SaveWorkflowDefinitionPayload = {
          code, title: 'مهلت از تصویر', entityType: `wf14c_sla_${h.tag}`,
          states: [
            { stateKey: 'wait', title: 'انتظار ۷۲ ساعته', stateType: 'initial', slaHours: 72 },
            { stateKey: 'done', title: 'پایان', stateType: 'terminal' },
          ],
          transitions: [{ fromStateKey: 'wait', toStateKey: 'done', actionKey: 'ok', title: 'تأیید' }],
        };
        const saved = await WorkflowDefinitionService.saveWorkflowDefinition(design);
        const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
        const inst = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: Number(saved?.definition.id), entityType: design.entityType, entityId: '1' });
        // ورود به گام ۳۰ ساعت پیش (ماشه updated_at برای این به‌روزرسانی خاموش است)
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SET LOCAL session_replication_role = replica`);
          await client.query(`UPDATE workflow_instances SET updated_at = now() - interval '30 hours' WHERE id = $1`, [inst.id]);
          await client.query('COMMIT');
        } finally {
          client.release();
        }

        const check = async (label: string) => {
          const res = await h.get('/api/workflow/analytics/sla');
          if (res.status !== 200) {
            wrong.push(`${label}: تحلیل مهلت ${res.status} داد`);
            return;
          }
          const overdue = (res.body?.overdueInstances ?? []).find((o: Row) => Number(o.instanceId) === inst.id);
          if (overdue) wrong.push(`${label}: فرایند ۳۰ ساعته در گام ۷۲ ساعته دارای تأخیر شد (${String(overdue.stateTitle)}، مهلت ${String(overdue.slaHours)})`);
          const [current] = await h.q(`SELECT s.id FROM workflow_states s JOIN workflow_definitions d ON d.id = s.workflow_definition_id WHERE d.code = $1 AND s.state_key = 'wait'`, [code]);
          const row = (res.body?.stateSlaReport ?? []).find((r: Row) => Number(r.stateId) === Number(current?.id));
          if (Number(row?.activeCount) !== 1) wrong.push(`${label}: شمار فعال گام «انتظار» ${String(row?.activeCount)} شد، نه ۱`);
          if (Number(row?.slaHours) !== 72) wrong.push(`${label}: مهلت گام «انتظار» ${String(row?.slaHours)} شد، نه ۷۲`);
        };
        await check('پیش از ذخیره دوباره');
        await WorkflowDefinitionService.saveWorkflowDefinition({ ...design, id: Number(saved?.definition.id) });
        await check('پس از ذخیره دوباره');
      } finally {
        await h.q(`DELETE FROM workflow_instances WHERE workflow_definition_id IN (SELECT id FROM workflow_definitions WHERE code = $1)`, [code]);
        await dropDefinition(h, code);
      }
    });
  }

  if (shouldRun('sec_workflow_route_bodies_td_459', 'security', 'td459', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_route_bodies_td_459',
      name: 'v9.0.50: بدنه نادرست /transition، /definitions، /positions و /delegations ۴۰۰ با پیام فارسی می‌گیرد، نه ۵۰۰؛ /positions فقط گام‌های همان گردش کار را در تراکنش و با گزارش فعالیت جابه‌جا می‌کند (TD-459)',
      details: 'شناسه متنی، ترتیب متنی و شناسه کاربر اعشاری ۴۰۰؛ جابه‌جایی گام گردش کار دیگر ۴۲۲ و بی تغییر؛ جابه‌جایی گام خود گردش کار یک گزارش فعالیت دارد',
    }, async (h, wrong) => {
      const codes = [designCode(h, 'POS'), designCode(h, 'POS')];
      const badCode = designCode(h, 'BODY');
      try {
        const twoSteps = [validStates[0], validStates[2]];
        const okTransition = [{ fromStateKey: 'draft', toStateKey: 'done', actionKey: 'ok', title: 'تأیید' }];
        const bad: Array<[string, string, unknown]> = [
          ['اقدام با شناسه متنی', '/api/workflow/transition', { instanceId: 'abc', transitionId: 1 }],
          ['تعریف با شناسه متنی', '/api/workflow/definitions', { id: 'abc', code: badCode, title: 'نادرست', entityType: 'document', states: twoSteps, transitions: okTransition }],
          ['گام با ترتیب متنی', '/api/workflow/definitions', { code: badCode, title: 'نادرست', entityType: 'document', states: twoSteps.map(st => ({ ...st, stepOrder: 'first' })), transitions: okTransition }],
          ['مختصات با شناسه متنی', '/api/workflow/positions', { definitionId: 1, positions: [{ id: 'abc', positionX: 1, positionY: 1 }] }],
          ['تفویض به کاربر اعشاری', '/api/workflow/delegations', { toUserId: 2.5, startDate: '2026-10-06', endDate: '2026-10-07' }],
        ];
        for (const [label, url, body] of bad) {
          const res = await h.post(url, body);
          if (res.status !== 400) wrong.push(`${label} ${res.status} داد، نه ۴۰۰`);
          else if (!/[\u0600-\u06FF]/.test(String(res.body?.message ?? ''))) wrong.push(`پیام ${label} فارسی نیست`);
        }

        const ids: number[] = [];
        for (const code of codes) {
          const res = await h.post('/api/workflow/definitions', { code, title: 'جابه‌جایی گام', entityType: 'document', states: twoSteps, transitions: okTransition });
          const id = Number(res.body?.data?.definition?.id);
          if (!(id > 0)) throw new Error(`تعریف آزمون ${res.status} داد: ${JSON.stringify(res.body).slice(0, 160)}`);
          ids.push(id);
        }
        const stepOf = async (definitionId: number) => (await h.q(`SELECT id, position_x FROM workflow_states WHERE workflow_definition_id = $1 ORDER BY id LIMIT 1`, [definitionId]))[0];
        const foreign = await stepOf(ids[1]);
        const cross = await h.post('/api/workflow/positions', { definitionId: ids[0], positions: [{ id: Number(foreign?.id), positionX: 777, positionY: 777 }] });
        if (cross.status !== 422) wrong.push(`جابه‌جایی گام گردش کار دیگر ${cross.status} داد، نه ۴۲۲`);
        if (Number((await stepOf(ids[1]))?.position_x) === 777) wrong.push('گام گردش کار دیگر جابه‌جا شد');

        const own = await stepOf(ids[0]);
        const moved = await h.post('/api/workflow/positions', { definitionId: ids[0], positions: [{ id: Number(own?.id), positionX: 333, positionY: 222 }] });
        if (moved.status !== 200) wrong.push(`جابه‌جایی گام خود گردش کار ${moved.status} داد`);
        if (Number((await stepOf(ids[0]))?.position_x) !== 333) wrong.push('گام خود گردش کار جابه‌جا نشد');
        const logs = await h.q(`SELECT id FROM activity_logs WHERE entity = 'طرح گردش کار' AND entity_id = $1`, [String(ids[0])]);
        if (logs.length !== 1) wrong.push(`جابه‌جایی گام ${logs.length} گزارش فعالیت داشت، نه ۱`);
      } finally {
        for (const code of [...codes, badCode]) await dropDefinition(h, code);
      }
    });
  }

  return results;
}

/** بازگرداندن طرح اصلی روی گام‌های تازه (ذخیره ویرایش، شناسه گام‌ها را عوض کرده است) */
async function restorable(original: SaveWorkflowDefinitionPayload): Promise<SaveWorkflowDefinitionPayload> {
  const keyOf = new Map((original.states ?? []).map(s => [s.id, s.stateKey]));
  return {
    ...original,
    states: (original.states ?? []).map(({ id: _id, ...s }) => s),
    transitions: (original.transitions ?? []).map(({ fromStateId, toStateId, ...t }) => ({ ...t, fromStateKey: keyOf.get(fromStateId as number), toStateKey: keyOf.get(toStateId as number) })),
  };
}
