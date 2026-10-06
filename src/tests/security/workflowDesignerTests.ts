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
  if (!details) throw new Error(`definition ${code} not found`);
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
      name: 'v9.0.45: an invalid workflow design is refused with 422 and a Persian message, and no action is dropped silently (TD-452)',
      details: 'no initial step, two initial steps, a duplicate key, no terminal step, an exit from a terminal step, non-array states, an unknown target and a signature count of 0 are all refused; a valid design returns 200 and keeps every action',
    }, async (h, wrong) => {
      const codes: string[] = [];
      try {
        const cases: Array<[string, unknown, unknown]> = [
          ['no initial step', validStates.map(s => ({ ...s, stateType: s.stateType === 'initial' ? 'intermediate' : s.stateType })), []],
          ['two initial steps', validStates.map(s => ({ ...s, stateType: s.stateKey === 'review' ? 'initial' : s.stateType })), []],
          ['duplicate key', [...validStates, { stateKey: 'review', title: 'بررسی دوم', stateType: 'intermediate' }], []],
          ['no terminal step', validStates.map(s => ({ ...s, stateType: s.stateType === 'terminal' ? 'intermediate' : s.stateType })), []],
          ['exit from terminal step', validStates, [{ fromStateKey: 'done', toStateKey: 'review', actionKey: 'back', title: 'بازگشت' }]],
          ['states not an array', 'not-an-array', []],
          ['unknown target', validStates, [
            { fromStateKey: 'draft', toStateKey: 'review', actionKey: 'send', title: 'ارسال' },
            { fromStateKey: 'review', toStateKey: 'lost', actionKey: 'lost', title: 'گم‌شده' },
          ]],
          ['zero signature count', validStates, [{ fromStateKey: 'draft', toStateKey: 'done', actionKey: 'ok', title: 'تأیید', approvalRuleType: 'K_OF_N', kValue: 0 }]],
        ];
        for (const [label, states, transitions] of cases) {
          const code = designCode(h, 'BAD');
          codes.push(code);
          const res = await h.post('/api/workflow/definitions', { code, title: `طرح ${label}`, entityType: 'document', states, transitions });
          // از v9.0.50 (TD-459) بدنه‌ای که نوعش نادرست است پیش از سرویس با Zod ۴۰۰ می‌گیرد
          if (res.status !== 422 && res.status !== 400) wrong.push(`design "${label}" returned ${res.status}, not 422`);
          else if (!/[؀-ۿ]/.test(String(res.body?.error ?? res.body?.message ?? ''))) wrong.push(`refusal message of design "${label}" is not Persian`);
          if ((await definitionsWithCode(h, code)).length > 0) wrong.push(`design "${label}" was saved although refused`);
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
        if (ok.status !== 200) wrong.push(`valid design returned ${ok.status}: ${JSON.stringify(ok.body).slice(0, 200)}`);
        const saved = Array.isArray(ok.body?.data?.transitions) ? ok.body.data.transitions.length : -1;
        if (ok.status === 200 && saved !== 4) wrong.push(`valid design kept ${saved} of 4 actions`);
      } finally {
        for (const code of codes) await dropDefinition(h, code);
      }
    });
  }

  if (shouldRun('sec_workflow_seed_keeps_edited_definition_td_453', 'security', 'td453', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_seed_keeps_edited_definition_td_453',
      name: 'v9.0.46: listing definitions and the startup seed do not overwrite an edited purchase workflow (TD-453)',
      details: 'a purchase workflow titled with the quote keyword and a manager role on approval stays as edited, with no new version, after GET /workflow/definitions and the startup seed; the manual template sync route is gone',
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
        if (list.status !== 200) wrong.push(`definition list returned ${list.status}`);
        await WorkflowDefinitionService.seedDefaultWorkflows();

        const [after] = await h.q(`SELECT id, title, version FROM workflow_definitions WHERE code = $1`, [code]);
        if (after?.title !== edited.title) wrong.push(`purchase workflow title reverted to "${String(after?.title)}"`);
        if (Number(after?.version) !== Number(before)) wrong.push(`listing and seed moved the version from ${String(before)} to ${String(after?.version)}`);
        const [approve] = await h.q(`SELECT required_role FROM workflow_transitions WHERE workflow_definition_id = $1 AND action_key = 'approve_request'`, [after?.id]);
        if (approve?.required_role !== 'manager') wrong.push(`required role of requisition approval became "${String(approve?.required_role)}", not manager`);

        const sync = await h.post('/api/workflow/definitions/seed-default', {});
        if (sync.status !== 404) wrong.push(`manual template sync returned ${sync.status}, not 404`);
      } finally {
        await WorkflowDefinitionService.saveWorkflowDefinition(await restorable(original));
      }
    });
  }

  if (shouldRun('sec_workflow_step_order_td_454', 'security', 'td454', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_step_order_td_454',
      name: 'v9.0.47: saving a design keeps the step order; a step without one takes its list position (TD-454)',
      details: 'a three-step design without stepOrder (the designer body before v9.0.47) gets 1, 2, 3, not 1, 1, 1; an explicit designer order is stored as sent',
    }, async (h, wrong) => {
      const codes = [designCode(h, 'ORDER'), designCode(h, 'ORDER')];
      try {
        const orderOf = async (code: string) => (await h.q(
          `SELECT s.state_key, s.step_order FROM workflow_states s JOIN workflow_definitions d ON d.id = s.workflow_definition_id WHERE d.code = $1 ORDER BY s.id`, [code],
        )).map(r => `${String(r.state_key)}:${String(r.step_order)}`).join(',');
        const transitions = [{ fromStateKey: 'draft', toStateKey: 'review', actionKey: 'send', title: 'ارسال' }, { fromStateKey: 'review', toStateKey: 'done', actionKey: 'ok', title: 'تأیید' }];

        const bare = await h.post('/api/workflow/definitions', { code: codes[0], title: 'ترتیب ضمنی', entityType: 'document', states: validStates, transitions });
        if (bare.status !== 200) wrong.push(`design without order returned ${bare.status}`);
        const implicit = await orderOf(codes[0]);
        if (implicit !== 'draft:1,review:2,done:3') wrong.push(`implicit step order is "${implicit}", not draft:1,review:2,done:3`);

        const ordered = validStates.map((s, i) => ({ ...s, stepOrder: [2, 3, 1][i] }));
        const explicit = await h.post('/api/workflow/definitions', { code: codes[1], title: 'ترتیب صریح', entityType: 'document', states: ordered, transitions });
        if (explicit.status !== 200) wrong.push(`design with order returned ${explicit.status}`);
        const kept = await orderOf(codes[1]);
        if (kept !== 'draft:2,review:3,done:1') wrong.push(`explicit order stored as "${kept}", not draft:2,review:3,done:1`);
      } finally {
        for (const code of codes) await dropDefinition(h, code);
      }
    });
  }

  if (shouldRun('sec_workflow_rule_validation_td_456', 'security', 'td456', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_rule_validation_td_456',
      name: 'v9.0.48: an invalid action rule is refused with 422 on save and a stored invalid rule fails closed (TD-456)',
      details: 'saving {field, op} instead of operator, or [null], is refused; with an invalid rule in the instance snapshot the action on a 5,000 rial document is refused (not 200) and the stepper widget with [null] answers 200 with the action closed (not 500)',
    }, async (h, wrong) => {
      const codes: string[] = [];
      try {
        const twoSteps = [validStates[0], validStates[2]];
        for (const [label, rule] of [['op instead of operator', { field: 'amount', op: 'lt', value: 1000 }], ['null condition', [null]]] as const) {
          const code = designCode(h, 'RULE');
          codes.push(code);
          const res = await h.post('/api/workflow/definitions', {
            code, title: `قاعده ${label}`, entityType: 'document', states: twoSteps,
            transitions: [{ fromStateKey: 'draft', toStateKey: 'done', actionKey: 'ok', title: 'تأیید', ruleConditionsJson: rule }],
          });
          if (res.status !== 422) wrong.push(`saving rule "${label}" returned ${res.status}, not 422`);
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
        if (run.status !== 422) wrong.push(`action with rule {op:'lt'} on a 5,000 rial document returned ${run.status}, not 422`);

        const broken = await withStoredRule([null]);
        const view = await h.get(`/api/workflow/instance/document/${broken.docId}`);
        if (view.status !== 200) wrong.push(`stepper widget with rule [null] returned ${view.status}, not 200`);
        else if ((view.body?.availableTransitions ?? []).some((t: Row) => t.actionKey === 'ok')) wrong.push('action with rule [null] was offered as available');
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
      name: 'v9.0.49: SLA analytics measure a running instance against its own snapshot steps, also after the design is saved again (TD-457)',
      details: 'an instance 30 hours into a 72-hour step is not overdue before or after an unchanged save and counts as active in that step (new id); before, after a save it became unknown, SLA 24, 6 hours late, and the step active count was 0',
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
            wrong.push(`${label}: SLA analytics returned ${res.status}`);
            return;
          }
          const overdue = (res.body?.overdueInstances ?? []).find((o: Row) => Number(o.instanceId) === inst.id);
          if (overdue) wrong.push(`${label}: a 30-hour instance in a 72-hour step was overdue (state ${String(overdue.stateTitle)}, SLA ${String(overdue.slaHours)})`);
          const [current] = await h.q(`SELECT s.id FROM workflow_states s JOIN workflow_definitions d ON d.id = s.workflow_definition_id WHERE d.code = $1 AND s.state_key = 'wait'`, [code]);
          const row = (res.body?.stateSlaReport ?? []).find((r: Row) => Number(r.stateId) === Number(current?.id));
          if (Number(row?.activeCount) !== 1) wrong.push(`${label}: active count of the wait step is ${String(row?.activeCount)}, not 1`);
          if (Number(row?.slaHours) !== 72) wrong.push(`${label}: SLA of the wait step is ${String(row?.slaHours)}, not 72`);
        };
        await check('before re-save');
        await WorkflowDefinitionService.saveWorkflowDefinition({ ...design, id: Number(saved?.definition.id) });
        await check('after re-save');
      } finally {
        await h.q(`DELETE FROM workflow_instances WHERE workflow_definition_id IN (SELECT id FROM workflow_definitions WHERE code = $1)`, [code]);
        await dropDefinition(h, code);
      }
    });
  }

  if (shouldRun('sec_workflow_route_bodies_td_459', 'security', 'td459', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_route_bodies_td_459',
      name: 'v9.0.50: invalid bodies of /transition, /definitions, /positions and /delegations get 400 with a Persian message, not 500; /positions moves only its own workflow steps, in a transaction with an activity log (TD-459)',
      details: 'text ids, a text step order and a fractional user id get 400; moving another workflow step gets 422 and changes nothing; moving an own step writes one activity log',
    }, async (h, wrong) => {
      const codes = [designCode(h, 'POS'), designCode(h, 'POS')];
      const badCode = designCode(h, 'BODY');
      try {
        const twoSteps = [validStates[0], validStates[2]];
        const okTransition = [{ fromStateKey: 'draft', toStateKey: 'done', actionKey: 'ok', title: 'تأیید' }];
        const bad: Array<[string, string, unknown]> = [
          ['transition with text id', '/api/workflow/transition', { instanceId: 'abc', transitionId: 1 }],
          ['definition with text id', '/api/workflow/definitions', { id: 'abc', code: badCode, title: 'نادرست', entityType: 'document', states: twoSteps, transitions: okTransition }],
          ['step with text order', '/api/workflow/definitions', { code: badCode, title: 'نادرست', entityType: 'document', states: twoSteps.map(st => ({ ...st, stepOrder: 'first' })), transitions: okTransition }],
          ['position with text id', '/api/workflow/positions', { definitionId: 1, positions: [{ id: 'abc', positionX: 1, positionY: 1 }] }],
          ['delegation to fractional user', '/api/workflow/delegations', { toUserId: 2.5, startDate: '2026-10-06', endDate: '2026-10-07' }],
        ];
        for (const [label, url, body] of bad) {
          const res = await h.post(url, body);
          if (res.status !== 400) wrong.push(`${label} returned ${res.status}, not 400`);
          else if (!/[\u0600-\u06FF]/.test(String(res.body?.message ?? ''))) wrong.push(`message of ${label} is not Persian`);
        }

        const ids: number[] = [];
        for (const code of codes) {
          const res = await h.post('/api/workflow/definitions', { code, title: 'جابه‌جایی گام', entityType: 'document', states: twoSteps, transitions: okTransition });
          const id = Number(res.body?.data?.definition?.id);
          if (!(id > 0)) throw new Error(`test definition returned ${res.status}: ${JSON.stringify(res.body).slice(0, 160)}`);
          ids.push(id);
        }
        const stepOf = async (definitionId: number) => (await h.q(`SELECT id, position_x FROM workflow_states WHERE workflow_definition_id = $1 ORDER BY id LIMIT 1`, [definitionId]))[0];
        const foreign = await stepOf(ids[1]);
        const cross = await h.post('/api/workflow/positions', { definitionId: ids[0], positions: [{ id: Number(foreign?.id), positionX: 777, positionY: 777 }] });
        if (cross.status !== 422) wrong.push(`moving another workflow step returned ${cross.status}, not 422`);
        if (Number((await stepOf(ids[1]))?.position_x) === 777) wrong.push('another workflow step was moved');

        const own = await stepOf(ids[0]);
        const moved = await h.post('/api/workflow/positions', { definitionId: ids[0], positions: [{ id: Number(own?.id), positionX: 333, positionY: 222 }] });
        if (moved.status !== 200) wrong.push(`moving an own step returned ${moved.status}`);
        if (Number((await stepOf(ids[0]))?.position_x) !== 333) wrong.push('own workflow step was not moved');
        const logs = await h.q(`SELECT id FROM activity_logs WHERE entity = 'طرح گردش کار' AND entity_id = $1`, [String(ids[0])]);
        if (logs.length !== 1) wrong.push(`moving a step wrote ${logs.length} activity logs, not 1`);
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
