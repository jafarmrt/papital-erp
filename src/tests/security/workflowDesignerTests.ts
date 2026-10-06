import { TestCaseResult } from '../types.js';
import { WorkflowDefinitionService, type SaveWorkflowDefinitionPayload } from '../../services/workflow/workflowDefinitionService.js';
import { runCase, type Harness, type Row, type ShouldRun } from './workflowTestHarness.js';

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
          if (res.status !== 422) wrong.push(`طرح «${label}» ${res.status} داد، نه ۴۲۲`);
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
