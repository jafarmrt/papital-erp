import request from 'supertest';
import { eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeads } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';

/**
 * بسته ۹ (مشتریان و CRM) — اعتبارسنجی ورودی پرونده فروش در مسیر واقعی Express؛ روی کد پیشین قرمز است.
 */

export async function runCrmLeadInputTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_crm_lead_input_validation_td_427';
  if (!shouldRun(id, 'td427', 'crm', 'lead', 'validation', 'package9')) return results;

  const name = 'v9.0.18: احتمال و مبلغ متنی، مبلغ منفی، احتمال بیرون از ۰ تا ۱۰۰، ارز ناشناخته و مرحله یا وضعیت نامعتبر پرونده فروش با خطای اعتبارسنجی رد می‌شوند (نه ۵۰۰ یا صفر بی‌صدا)؛ ارقام فارسی پذیرفته می‌شوند (TD-427)';
  const tStart = Date.now();
  const tag = `TD427-${String(Date.now()).slice(-6)}`;
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const send = (req: request.Test) => req.set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
    const create = (label: string, body: Record<string, unknown>) => send(request(app).post('/api/crm/leads')).send({ title: `${label} ${tag}`, ...body });
    const wrong: string[] = [];

    const invalid: Array<[string, Record<string, unknown>]> = [
      ['احتمال متنی', { probability: 'abc' }],
      ['مبلغ متنی', { estimatedValue: 'abc' }],
      ['مبلغ منفی', { estimatedValue: -5 }],
      ['احتمال ۲۵۰', { probability: 250 }],
      ['احتمال اعشاری', { probability: 12.5 }],
      ['ارز ناشناخته', { currency: 'XYZ' }],
      ['مرحله نامعتبر', { stage: 'foo' }],
    ];
    for (const [label, body] of invalid) {
      const res = await create(label, body);
      if (res.status !== 400 && res.status !== 422) wrong.push(`${label}: ${res.status}`);
    }
    const stored = await orm.select({ id: crmLeads.id }).from(crmLeads).where(like(crmLeads.title, containsLikePattern(tag)));
    if (stored.length > 0) wrong.push(`${stored.length} پرونده با ورودی نامعتبر ذخیره شد`);

    // ورودی معتبر با ارقام فارسی و جداکننده هزارگان؛ احتمال ۰ همان ۰ می‌ماند؛ کد ارز بی‌حساسیت به بزرگی حروف
    const ok = await create('ورودی معتبر', { probability: '۷۵', estimatedValue: '۱٬۲۰۰٬۰۰۰', currency: 'usd', stage: 'qualified' });
    if (ok.status !== 201 || ok.body?.probability !== 75 || ok.body?.estimatedValue !== 1_200_000 || ok.body?.currency !== 'USD') {
      wrong.push(`ورودی معتبر ${ok.status} داد: ${JSON.stringify({ p: ok.body?.probability, v: ok.body?.estimatedValue, c: ok.body?.currency })}`);
    }
    const zero = await create('احتمال صفر', { probability: 0 });
    if (zero.status !== 201 || zero.body?.probability !== 0) wrong.push(`احتمال ۰ ${zero.status} داد و ${String(zero.body?.probability)} ذخیره شد`);

    // ویرایش هم همان قاعده را دارد و پرونده دست نمی‌خورد
    const leadId = Number(ok.body?.id);
    if (leadId) {
      for (const [label, body] of [['احتمال متنی', { probability: 'abc' }], ['وضعیت نامعتبر', { status: 'bar' }], ['مرحله نامعتبر', { stage: 'foo' }]] as Array<[string, Record<string, unknown>]>) {
        const res = await send(request(app).put(`/api/crm/leads/${leadId}`)).send(body);
        if (res.status !== 400 && res.status !== 422) wrong.push(`ویرایش با ${label}: ${res.status}`);
      }
      const [after] = await orm.select({ probability: crmLeads.probability, stage: crmLeads.stage, status: crmLeads.status }).from(crmLeads).where(eq(crmLeads.id, leadId));
      if (after.probability !== 75 || after.stage !== 'qualified' || after.status !== 'active') wrong.push(`ویرایش نامعتبر پرونده را تغییر داد: ${JSON.stringify(after)}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('، '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'هفت ورودی نامعتبر ساخت و سه ورودی نامعتبر ویرایش رد شدند و چیزی ذخیره نشد؛ «۷۵»، «۱٬۲۰۰٬۰۰۰» و «usd» درست ذخیره شدند و احتمال ۰ همان ۰ ماند',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    const leads = await orm.select({ id: crmLeads.id }).from(crmLeads).where(like(crmLeads.title, containsLikePattern(tag))).catch(() => []);
    const ids = leads.map(l => l.id);
    if (ids.length > 0) {
      await orm.delete(crmActivities).where(inArray(crmActivities.leadId, ids)).catch(() => undefined);
      await orm.update(crmLeads).set({ isDeleted: 1 }).where(inArray(crmLeads.id, ids)).catch(() => undefined);
    }
  }
  return results;
}
