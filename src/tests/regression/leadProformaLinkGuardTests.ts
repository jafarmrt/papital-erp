import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeads, documents, roles, users } from '../../db/schema.js';

/**
 * Packages 8 and 9, TD-932 (CRM plan decision ت۱۴): linking a document to a sales lead (`crmLeadId` on POST or PUT
 * /documents) needs `crm.manage`, and a proforma is never linked to a closed lead (won or lost), which it used to reopen
 * to «proposal». Red on v10.0.34.
 */
export async function runLeadProformaLinkGuardTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_lead_proforma_link_guard_td_932';
  if (!shouldRun(id, 'td932', 'crm', 'proforma', 'documents', 'package9')) return results;

  const name = 'v10.0.35: a document is linked to a sales lead only with crm.manage (403, nothing written), and a proforma never links to or reopens a won or lost lead (422 CRM_LEAD_CLOSED) on create or edit (TD-932)';
  const tStart = Date.now();
  const tag = `TD932-${String(Date.now()).slice(-6)}`;
  const leadIds: number[] = [];
  const roleIds: number[] = [];
  const userIds: number[] = [];
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');

    const app = await getTestApp();
    const admin = await getAdminSession();
    const today = await businessTodayIsoDate();
    const wh = (await getDefaultWarehouseCode(orm)) as string;
    const item = await createTestItem({ type: 'product' });
    const wrong: string[] = [];

    const sellerRole = await createTestRole({ permissions: ['documents.view', 'documents.create', 'documents.edit', 'crm.view'] });
    roleIds.push(sellerRole.id);
    const seller = await createTestUser({ role: sellerRole.code });
    userIds.push(seller.id);
    const sellerSession = await loginTestUserWithSession(app, seller.username);

    const newLead = async (label: string, stage: string, status: string) => {
      const [lead] = await orm.insert(crmLeads).values({ title: `${tag} ${label}`, customerName: `${tag} buyer`, stage, status })
        .returning({ id: crmLeads.id });
      leadIds.push(lead.id);
      return lead.id;
    };
    const leadState = async (leadId: number) => {
      const [lead] = await orm.select({ stage: crmLeads.stage, status: crmLeads.status, hasProforma: crmLeads.hasProforma }).from(crmLeads).where(eq(crmLeads.id, leadId));
      return `${lead.stage}/${lead.status}/${lead.hasProforma}`;
    };
    const docsOf = async (leadId: number) => (await orm.select({ id: documents.id }).from(documents)
      .where(and(eq(documents.crmLeadId, leadId), eq(documents.isDeleted, 0)))).length;
    const proforma = (session: { cookie: string; csrfToken: string }, extra: Record<string, unknown>) => request(app).post('/api/documents')
      .set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send({
        docType: 'invoice', status: 'proforma', inOut: 'out', refNumber: 'auto', date: today, buyer_name: `${tag} buyer`,
        items: [{ itemId: item.id, quantity: 1, unit_price: 1_000_000, location: wh }], ...extra,
      });

    // 1) a seller without crm.manage cannot link a proforma to an open lead; nothing is recorded
    const open = await newLead('open', 'qualified', 'active');
    const noKey = await proforma(sellerSession, { crmLeadId: open });
    if (noKey.status !== 403 || noKey.body?.code !== 'CRM_LEAD_LINK_FORBIDDEN') wrong.push(`seller link answered ${noKey.status} ${noKey.body?.code}`);
    if (await docsOf(open) !== 0) wrong.push('a document was linked to the lead by a user without crm.manage');
    if (await leadState(open) !== 'qualified/active/0') wrong.push(`the open lead became ${await leadState(open)}`);

    // 2) the same seller can still issue the proforma without a lead
    const plain = await proforma(sellerSession, {});
    if (plain.status !== 200 && plain.status !== 201) wrong.push(`seller proforma without a lead answered ${plain.status} ${JSON.stringify(plain.body).slice(0, 160)}`);
    const plainId = Number(plain.body?.docId);

    // 3) a won or a lost lead is never linked to a new proforma, even by the system admin
    for (const [stage, status] of [['won', 'won'], ['lost', 'lost']] as const) {
      const closed = await newLead(stage, stage, status);
      const res = await proforma(admin, { crmLeadId: closed });
      if (res.status !== 422 || res.body?.code !== 'CRM_LEAD_CLOSED') wrong.push(`proforma on a ${stage} lead answered ${res.status} ${res.body?.code}`);
      if (await docsOf(closed) !== 0) wrong.push(`a document was linked to the ${stage} lead`);
      if (await leadState(closed) !== `${stage}/${status}/0`) wrong.push(`the ${stage} lead became ${await leadState(closed)}`);
    }

    // 4) editing a proforma: linking a lost lead is 422 for the admin and any link is 403 for the seller
    if (Number.isInteger(plainId) && plainId > 0) {
      const lost = await newLead('lost-edit', 'lost', 'lost');
      const put = (session: { cookie: string; csrfToken: string }, crmLeadId: unknown) => request(app).put(`/api/documents/${plainId}`)
        .set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send({ crmLeadId });
      const closedEdit = await put(admin, lost);
      if (closedEdit.status !== 422 || closedEdit.body?.code !== 'CRM_LEAD_CLOSED') wrong.push(`edit link to a lost lead answered ${closedEdit.status} ${closedEdit.body?.code}`);
      if (await leadState(lost) !== 'lost/lost/0') wrong.push(`the lost lead became ${await leadState(lost)} after the edit`);
      const sellerEdit = await put(sellerSession, open);
      if (sellerEdit.status !== 403 || sellerEdit.body?.code !== 'CRM_LEAD_LINK_FORBIDDEN') wrong.push(`seller edit link answered ${sellerEdit.status} ${sellerEdit.body?.code}`);
      if (await leadState(open) !== 'qualified/active/0') wrong.push(`the open lead became ${await leadState(open)} after the seller edit`);
    }

    // 5) the system admin still links an open lead
    const ok = await proforma(admin, { crmLeadId: open });
    if (ok.status !== 200 && ok.status !== 201) wrong.push(`admin link to an open lead answered ${ok.status} ${ok.body?.code}`);
    if (await leadState(open) !== 'proposal/active/1') wrong.push(`the linked open lead is ${await leadState(open)}, not proposal/active/1`);

    if (wrong.length > 0) throw new Error(wrong.join(' | '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'Seller link 403 on create and edit with nothing written; won and lost leads 422 CRM_LEAD_CLOSED and unchanged; admin links an open lead',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await orm.update(documents).set({ isDeleted: 1 }).where(eq(documents.buyerName, `${tag} buyer`)).catch(() => undefined);
    if (leadIds.length > 0) {
      await orm.delete(crmActivities).where(inArray(crmActivities.leadId, leadIds)).catch(() => undefined);
      await orm.update(crmLeads).set({ isDeleted: 1 }).where(inArray(crmLeads.id, leadIds)).catch(() => undefined);
    }
    if (userIds.length > 0) await orm.update(users).set({ isDeleted: 1 }).where(inArray(users.id, userIds)).catch(() => undefined);
    if (roleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, roleIds)).catch(() => undefined);
  }
  return results;
}
