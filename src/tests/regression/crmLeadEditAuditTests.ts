import request from 'supertest';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, crmActivities, crmLeads, customers } from '../../db/schema.js';

/**
 * Package 9, OBS-R2-33 (TD-991): a sales lead edit and «convert to customer» each write an audit row with before, after
 * and the changed fields, in the transaction of the change, and converting a lost lead keeps it lost instead of moving it
 * back to «proposal». Red on v10.0.37.
 */
export async function runCrmLeadEditAuditTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_crm_lead_edit_audit_obs_r2_33';
  if (!shouldRun(id, 'obs_r2_33', 'td991', 'crm', 'lead', 'audit', 'package9')) return results;

  const name = 'v10.0.38: a sales lead edit and its conversion to a customer write audit rows with before, after and changes, and converting a lost lead keeps it lost (OBS-R2-33)';
  const tStart = Date.now();
  const tag = `R233-${String(Date.now()).slice(-6)}`;
  const leadIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const wrong: string[] = [];
    type AuditDetails = { before?: Record<string, unknown>; after?: Record<string, unknown>; changes?: Record<string, { before: unknown; after: unknown }>; operation?: string };
    const lastAudit = async (leadId: number) => {
      const [row] = await orm.select({ details: activityLogs.details, description: activityLogs.description }).from(activityLogs)
        .where(and(eq(activityLogs.entity, 'فرصت فروش CRM'), eq(activityLogs.entityId, String(leadId))))
        .orderBy(desc(activityLogs.id)).limit(1);
      return row ? { ...row, details: (row.details ?? {}) as AuditDetails } : undefined;
    };

    // 1) an edit records before, after and only the changed fields
    const [lead] = await orm.insert(crmLeads).values({ title: `${tag} edit`, customerName: `${tag} buyer`, stage: 'lead', status: 'active', probability: 20 })
      .returning({ id: crmLeads.id });
    leadIds.push(lead.id);
    const edit = await request(app).put(`/api/crm/leads/${lead.id}`).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
      .send({ stage: 'qualified', probability: 40 });
    if (edit.status !== 200) wrong.push(`edit answered ${edit.status} ${JSON.stringify(edit.body).slice(0, 160)}`);
    const editAudit = await lastAudit(lead.id);
    const changes = editAudit?.details.changes ?? {};
    if (editAudit?.details.before?.stage !== 'lead' || editAudit?.details.after?.stage !== 'qualified') wrong.push(`edit audit before/after stage is ${editAudit?.details.before?.stage}/${editAudit?.details.after?.stage}`);
    // the edit also links the lead's buyer as a customer (TD-418), so customerId changes too
    if (JSON.stringify(Object.keys(changes).sort()) !== JSON.stringify(['customerId', 'probability', 'stage'])) wrong.push(`edit audit changes are ${JSON.stringify(Object.keys(changes))}, not customerId, probability and stage`);

    // 2) converting a lost lead keeps it lost and is audited
    const [lost] = await orm.insert(crmLeads).values({ title: `${tag} lost`, customerName: `${tag} lost buyer`, phone: `0912${String(Date.now()).slice(-7)}`, stage: 'lost', status: 'lost' })
      .returning({ id: crmLeads.id });
    leadIds.push(lost.id);
    const convert = await request(app).post(`/api/crm/leads/${lost.id}/convert-to-customer`).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send({});
    if (convert.status !== 200) wrong.push(`convert answered ${convert.status} ${JSON.stringify(convert.body).slice(0, 160)}`);
    const [afterLost] = await orm.select({ stage: crmLeads.stage, status: crmLeads.status, customerId: crmLeads.customerId }).from(crmLeads).where(eq(crmLeads.id, lost.id));
    if (afterLost.stage !== 'lost' || afterLost.status !== 'lost') wrong.push(`the converted lost lead became ${afterLost.stage}/${afterLost.status}`);
    if (!afterLost.customerId) wrong.push('the converted lead has no customer');
    const convertAudit = await lastAudit(lost.id);
    if (convertAudit?.details.operation !== 'convert_to_customer') wrong.push(`convert audit operation is ${convertAudit?.details.operation}`);
    if (convertAudit?.details.before?.customerId !== null || !convertAudit?.details.changes?.customerId) wrong.push(`convert audit does not show the customer link: ${JSON.stringify(convertAudit?.details.changes ?? {})}`);

    if (wrong.length > 0) throw new Error(wrong.join(' | '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'Edit audit has before/after and changes {customerId, probability, stage}; a converted lost lead stays lost and its audit shows the customer link',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (leadIds.length > 0) {
      const linked = await orm.select({ customerId: crmLeads.customerId }).from(crmLeads).where(inArray(crmLeads.id, leadIds)).catch(() => []);
      const customerIds = linked.map(l => l.customerId).filter((c): c is number => typeof c === 'number');
      await orm.delete(crmActivities).where(inArray(crmActivities.leadId, leadIds)).catch(() => undefined);
      await orm.update(crmLeads).set({ isDeleted: 1 }).where(inArray(crmLeads.id, leadIds)).catch(() => undefined);
      if (customerIds.length > 0) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, customerIds)).catch(() => undefined);
    }
  }
  return results;
}
