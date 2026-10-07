import { TestCaseResult } from '../types.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';

/**
 * بسته ۲ (مدل مجوز)، گروه سجل: پاک‌سازی و پوشاندن داده حساس سجل، از مسیرهای واقعی Express با ورود واقعی. هر آزمون روی
 * کد پیشین قرمز است.
 */

const codeOf = (res: { body?: { code?: unknown; error?: { code?: unknown } } }): string =>
  String(res.body?.code ?? res.body?.error?.code ?? '');

export async function runAccessPackageTwoAuditTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_audit_purge_keeps_financial_events_td_522', 'security', 'td522', 'audit', 'purge', 'package2')) {
    await runCase(results, {
      id: 'sec_audit_purge_keeps_financial_events_td_522',
      name: 'v9.0.154: the audit purge deletes only operational sections and never a financial, security, role or user event (TD-522)',
      details: 'R09 of the package 2 review: ten 200-day-old events with the names the code writes (voucher finalize and issue, treasury payment, cheque status, bank Sheba, payroll payment, party Sheba, role permission, login, document delete) all stay after the purge the UI sends; an old daily log is purged and an old sales lead DELETE stays; preserveCritical, allowForceRecent and less than 90 days are refused',
    }, async (h, wrong) => {
      const marker = `td522_${h.tag}`;
      const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
      const kept: Array<[string, string, string]> = [
        ['UPDATE', 'journal_voucher', 'voucher finalize'],
        ['CREATE', 'journal_voucher', 'voucher issue'],
        ['CREATE', 'treasury_transaction', 'treasury payment'],
        ['UPDATE', 'cheque', 'cheque status'],
        ['UPDATE', 'bank_account', 'bank account Sheba'],
        ['CREATE', 'پرداخت حقوق', 'payroll payment'],
        ['UPDATE', 'طرف حساب', 'party Sheba'],
        ['UPDATE', 'نقش و دسترسی', 'role permission'],
        ['LOGIN', 'احراز هویت', 'login'],
        ['DELETE', 'اسناد انبار', 'document delete'],
        ['DELETE', 'فرصت فروش CRM', 'sales lead delete'],
      ];
      const insert = (action: string, entity: string, label: string) => h.q(
        `INSERT INTO activity_logs (username, action, entity, entity_id, description, timestamp)
         VALUES ('synthetic_audit_test', $1, $2, $3, $4, $5) RETURNING id`,
        [action, entity, marker, label, old],
      );
      try {
        for (const [action, entity, label] of kept) await insert(action, entity, label);
        await insert('CREATE', 'گزارش کار روزانه', 'daily log');

        // R09: the purge the UI sends
        const purge = await h.post('/api/activity-logs/purge', { retentionDays: 90 });
        if (purge.status !== 200) wrong.push(`the purge the UI sends returned ${purge.status}, not 200`);
        const left = (await h.q('SELECT description FROM activity_logs WHERE entity_id = $1', [marker])).map(r => String(r.description));
        const lost = kept.map(([, , label]) => label).filter(label => !left.includes(label));
        if (lost.length > 0) wrong.push(`the purge deleted ${lost.join(', ')}`);
        if (left.includes('daily log')) wrong.push('the purge kept the 200-day-old daily log');

        // the options the UI no longer has, and a period under the minimum
        for (const [label, body] of [
          ['preserveCritical false', { retentionDays: 90, preserveCritical: false }],
          ['allowForceRecent', { retentionDays: 1, allowForceRecent: true }],
        ] as Array<[string, object]>) {
          const res = await h.post('/api/activity-logs/purge', body);
          if (res.status !== 400) wrong.push(`a purge with ${label} returned ${res.status}, not 400`);
        }
        const recent = await h.post('/api/activity-logs/purge', { retentionDays: 30 });
        if (recent.status !== 422 || codeOf(recent) !== 'VALIDATION_ERROR') wrong.push(`a 30-day purge returned ${recent.status} ${codeOf(recent)}, not 422 VALIDATION_ERROR`);
        if ((await h.q('SELECT 1 FROM activity_logs WHERE entity_id = $1', [marker])).length !== kept.length) wrong.push('a refused purge deleted rows');
      } finally {
        await h.q('DELETE FROM activity_logs WHERE entity_id = $1', [marker]);
      }
    });
  }

  return results;
}
