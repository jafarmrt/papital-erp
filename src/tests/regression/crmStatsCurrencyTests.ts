import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmLeads } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';

/**
 * بسته ۹ (مشتریان و CRM) — آمار پرونده‌های فروش به تفکیک ارز در مسیر واقعی Express؛ روی کد پیشین قرمز است.
 */

interface Total { currency: string; count: number; value: number }
type Stats = Record<string, unknown> & {
  pipelineByCurrency?: Total[];
  wonByCurrency?: Total[];
  stageCounts?: Record<string, { count: number; byCurrency?: Total[] }>;
};

const totalOf = (totals: Total[] | undefined, currency: string) => (Array.isArray(totals) ? totals.find(t => t.currency === currency) : undefined);
const delta = (after: Total | undefined, before: Total | undefined) => ({
  count: (after?.count ?? 0) - (before?.count ?? 0),
  value: fin(after?.value ?? 0).subtract(before?.value ?? 0).toString(),
});

export async function runCrmStatsCurrencyTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_crm_stats_by_currency_td_422';
  if (!shouldRun(id, 'td422', 'crm', 'stats', 'currency', 'package9')) return results;

  const name = 'v9.0.11: CRM stats give the pipeline value, won sales and each stage per currency; a 1,000 dollar lead is not added to a 2,000,000 rial one (TD-422)';
  const tStart = Date.now();
  const leadIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const readStats = async (): Promise<Stats> => {
      const res = await request(app).get('/api/crm/stats').set('Cookie', admin.cookie);
      if (res.status !== 200) throw new Error(`/api/crm/stats returned ${res.status}`);
      return res.body as Stats;
    };

    const before = await readStats();
    const tag = String(Date.now()).slice(-6);
    const inserted = await orm.insert(crmLeads).values([
      { title: `گردنبند صادراتی ${tag}`, stage: 'proposal', status: 'active', currency: 'USD', estimatedValue: money(1000) },
      { title: `سرویس عروس ${tag}`, stage: 'proposal', status: 'active', currency: 'IRR', estimatedValue: money(2_000_000) },
      { title: `انگشتر دبی ${tag}`, stage: 'won', status: 'won', currency: ' usd ', estimatedValue: money('250.5') },
    ]).returning({ id: crmLeads.id });
    leadIds.push(...inserted.map(r => r.id));
    const after = await readStats();

    const wrong: string[] = [];
    const expect = (label: string, got: { count: number; value: string }, count: number, value: string) => {
      if (got.count !== count || !fin(got.value).equals(value)) wrong.push(`${label}: ${got.count} sales files worth ${got.value} were added, not ${count} worth ${value}`);
    };
    if (!Array.isArray(after.pipelineByCurrency)) {
      wrong.push(`pipelineByCurrency is not in the response; totalPipelineValue rose by ${fin(Number(after.totalPipelineValue ?? 0)).subtract(Number(before.totalPipelineValue ?? 0)).toString()} (dollars and rials together)`);
    } else {
      expect('dollar funnel', delta(totalOf(after.pipelineByCurrency, 'USD'), totalOf(before.pipelineByCurrency, 'USD')), 1, '1000');
      expect('rial funnel', delta(totalOf(after.pipelineByCurrency, 'IRR'), totalOf(before.pipelineByCurrency, 'IRR')), 1, '2000000');
      expect('dollar won sales (code " usd ")', delta(totalOf(after.wonByCurrency, 'USD'), totalOf(before.wonByCurrency, 'USD')), 1, '250.5');
      expect('rial won sales', delta(totalOf(after.wonByCurrency, 'IRR'), totalOf(before.wonByCurrency, 'IRR')), 0, '0');
      const stageBefore = before.stageCounts?.proposal?.byCurrency;
      const stageAfter = after.stageCounts?.proposal?.byCurrency;
      expect('dollar proposal stage', delta(totalOf(stageAfter, 'USD'), totalOf(stageBefore, 'USD')), 1, '1000');
      expect('rial proposal stage', delta(totalOf(stageAfter, 'IRR'), totalOf(stageBefore, 'IRR')), 1, '2000000');
      if ((after.stageCounts?.proposal?.count ?? 0) - (before.stageCounts?.proposal?.count ?? 0) !== 2) wrong.push('The proposal stage count did not rise by 2');
      if (Number(after.activeLeadsCount) - Number(before.activeLeadsCount) !== 2) wrong.push('The active sales file count did not rise by 2');
      if (after.pipelineByCurrency[0]?.currency !== 'IRR') wrong.push(`the first funnel currency is ${after.pipelineByCurrency[0]?.currency}, not rial`);
      for (const key of ['totalPipelineValue', 'wonTotalValue']) if (key in after) wrong.push(`the response still has ${key} (sum of all currencies)`);
    }

    if (wrong.length > 0) throw new Error(wrong.join(', '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'Funnel: 1000 dollars and 2,000,000 rials kept separate; won sales 250.5 dollars; proposal stage split by currency',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (leadIds.length > 0) await orm.delete(crmLeads).where(inArray(crmLeads.id, leadIds)).catch(() => undefined);
  }
  return results;
}
