import { TestCaseResult } from '../types.js';
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

  return results;
}
