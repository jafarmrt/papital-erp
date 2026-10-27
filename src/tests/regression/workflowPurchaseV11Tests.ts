import request from 'supertest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { crmLeads, notifications, roles, users } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { approvalInboxInstanceLink } from '../../lib/notifications/notificationNotices.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { WorkflowDefinitionService } from '../../services/workflow/workflowDefinitionService.js';
import { WorkflowTransitionExecutor } from '../../services/workflow/workflowTransitionExecutor.js';
import { terminateOpenWorkflows } from '../../services/workflow/workflowTermination.js';
import { createTestCustomer, createTestDocument, createTestItem } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';
import { brief, codeOf, ok } from './receiptsOnInvoicesV11Tests.js';

/**
 * v11 phase 6.3p: one search rule for the lists (U8), global search for every reader of a section and with its failed
 * sections named (C12), workflow task notices that open their own task and close with it (U6), and a proforma from any
 * open sales lead (U17). Real Express routes and services on PostgreSQL, each scenario in its own schema; the search and
 * notice cases are red on v11.4.0, where the lists compared the raw text with ILIKE, global search asked documents.view
 * only and swallowed a failed section, and a task notice linked to the inbox and stayed unread after the task closed.
 */

type Client = { get: (url: string) => request.Test };

const listRows = (res: request.Response): Array<Record<string, unknown>> => {
  const body = res.body as unknown;
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
};

/** the ids a list returns for a search text */
async function idsFound(client: Client, url: string, search: string): Promise<number[]> {
  const res = await client.get(`${url}${url.includes('?') ? '&' : '?'}search=${encodeURIComponent(search)}`);
  if (res.status !== 200) throw new Error(`${url} «${search}» returned ${brief(res)}`);
  return listRows(res).map(r => Number(r.id));
}

export async function runWorkflowPurchaseV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const search = 'reg_one_search_rule_v11_6_3p_u8';
  if (shouldRun(search, 'v11', 'phase6', 'u8', 'search', 'customers', 'documents')) {
    await runCase(results, search, 'v11 phase 6.3p (U8): the customer list, the customer pick list and the documents list find a row by a phone typed in Latin digits, a name stored with the Arabic yeh or kaf, a name typed without the alef madda and a phone typed with spaces and +98, as global search did; another row is not found', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const tag = String(Date.now()).slice(-5);
      // Persian text as stored by users: a phone in Persian digits, an Arabic «ي» and «ك», a name with «آ»
      const persianPhone = await createTestCustomer({ name: `مشتری رقم فارسی ${tag}`, phone: '۰۹۱۲۷۴۱۲۰۳۲' });
      const arabicName = await createTestCustomer({ name: `كيان رضايي ${tag}`, phone: '02100000000' });
      const madda = await createTestCustomer({ name: `آرمان آذری ${tag}`, phone: '02100000001' });
      const spaced = await createTestCustomer({ name: `مشتری بین‌المللی ${tag}`, phone: '+98 935 600 1144' });
      const other = await createTestCustomer({ name: `مشتری دیگر ${tag}`, phone: '02100000002' });

      const cases: Array<[string, string, number]> = [
        ['a phone typed in Latin digits', '09127412', persianPhone.id],
        ['an Arabic-letter name typed with Persian letters', 'کیان رضایی', arabicName.id],
        ['a name typed without the alef madda', 'ارمان اذری', madda.id],
        ['a phone typed with 0 instead of +98', '0935 600', spaced.id],
      ];
      for (const [label, text, id] of cases) {
        const listed = await idsFound(admin, '/api/customers?page=1&limit=50', text);
        if (!listed.includes(id)) problems.push(`the customer list did not find ${label} (${JSON.stringify(text)}): ${JSON.stringify(listed)}`);
        if (listed.includes(other.id)) problems.push(`the customer list found another customer for ${label}`);
        const picked = await idsFound(admin, '/api/customers/options?limit=50', text);
        if (!picked.includes(id)) problems.push(`the customer pick list did not find ${label} (${JSON.stringify(text)}): ${JSON.stringify(picked)}`);
      }

      const { document: doc } = await createTestDocument({ type: 'invoice', status: 'draft', buyerName: `خريدار عربي ${tag}`, buyerPhone: '۰۹۱۹۸۸۸۷۷۶۶', partyId: arabicName.id });
      const { document: otherDoc } = await createTestDocument({ type: 'invoice', status: 'draft', buyerName: `خریدار دیگر ${tag}`, buyerPhone: '02100000003', partyId: other.id });
      for (const [label, text] of [['the buyer phone in Latin digits', '0919888'], ['the buyer name with Persian letters', `خریدار عربی ${tag}`]] as const) {
        const found = await idsFound(admin, '/api/documents?type=invoice&page=1&limit=50', text);
        if (!found.includes(doc.id)) problems.push(`the documents list did not find ${label} (${JSON.stringify(text)}): ${JSON.stringify(found)}`);
        if (found.includes(otherDoc.id)) problems.push(`the documents list found another invoice for ${label}`);
      }
      // a % or _ typed by a user is a letter, not a wildcard
      if ((await idsFound(admin, '/api/customers?page=1&limit=50', '%')).length !== 0) problems.push('a typed % matched every customer');

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'the customer list, the pick list and the documents list find Latin digits, Arabic letters, a name without the alef madda and a spaced +98 phone';
    }));
  }

  const globalSearch = 'reg_global_search_sections_v11_6_3p_c12';
  if (shouldRun(globalSearch, 'v11', 'phase6', 'c12', 'search', 'global')) {
    await runCase(results, globalSearch, 'v11 phase 6.3p (C12): global search opens each section with the keys of its own list (a clerk who records invoices finds them, a role without the documents keys does not), and a section whose query fails is named in failedSections while the other sections still answer', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const tag = String(Date.now()).slice(-5);
      const main = String(await getDefaultWarehouseCode(orm));
      const item = await createTestItem({ type: 'raw_material', name: `کالای جست‌وجو ${tag}`, stocks: { [main]: 1 } });
      const customer = await createTestCustomer({ name: `مشتری سراسری ${tag}` });
      const { document: doc } = await createTestDocument({ type: 'invoice', status: 'draft', buyerName: `خریدار سراسری ${tag}`, partyId: customer.id });

      // 1) a clerk who records invoices (documents.create) sees them in the documents list, so global search finds them too
      const clerk = await sandboxClientWith(['documents.create']);
      const inList = await clerk.get(`/api/documents?type=invoice&page=1&limit=50&search=${encodeURIComponent(`خریدار سراسری ${tag}`)}`);
      if (inList.status !== 200 || !listRows(inList).some(r => Number(r.id) === doc.id)) problems.push(`setup: the clerk's documents list returned ${brief(inList)}`);
      const clerkSearch = await clerk.get(`/api/global-search?q=${encodeURIComponent(`سراسری ${tag}`)}`);
      const clerkDocs = (clerkSearch.body?.documents ?? []) as Array<{ id: number }>;
      if (clerkSearch.status !== 200 || !clerkDocs.some(d => Number(d.id) === doc.id)) problems.push(`the clerk's global search returned ${brief(clerkSearch)}, expected the invoice`);
      if ((clerkSearch.body?.customers ?? []).length !== 0) problems.push('the clerk without the customer keys found customers');
      // a price editor (products.edit_price) reads the item list, so global search finds the item
      const pricer = await sandboxClientWith(['products.edit_price']);
      const pricerSearch = await pricer.get(`/api/global-search?q=${encodeURIComponent(`کالای جست‌وجو ${tag}`)}`);
      if (!((pricerSearch.body?.items ?? []) as Array<{ id: number }>).some(i => Number(i.id) === item.id)) problems.push(`the price editor's global search returned ${brief(pricerSearch)}, expected the item`);
      // a role without any of the documents keys finds no document
      const reader = await sandboxClientWith(['customers.view']);
      const readerSearch = await reader.get(`/api/global-search?q=${encodeURIComponent(`سراسری ${tag}`)}`);
      if ((readerSearch.body?.documents ?? []).length !== 0) problems.push(`a role without the documents keys found documents: ${brief(readerSearch)}`);
      if (!((readerSearch.body?.customers ?? []) as Array<{ id: number }>).some(c => Number(c.id) === customer.id)) problems.push(`the customer reader's global search returned ${brief(readerSearch)}, expected the customer`);
      if (JSON.stringify(readerSearch.body?.failedSections) !== '[]') problems.push(`a search where nothing failed named the sections ${JSON.stringify(readerSearch.body?.failedSections)}`);

      // 2) a section whose query fails (its table is missing in this sandbox) is named; the others still answer
      await orm.execute(sql`ALTER TABLE production_projects RENAME TO production_projects_gone`);
      try {
        const broken = await admin.get(`/api/global-search?q=${encodeURIComponent(`سراسری ${tag}`)}`);
        if (broken.status !== 200) problems.push(`global search with a failed section returned ${brief(broken)}, expected 200`);
        if (JSON.stringify(broken.body?.failedSections) !== '["projects"]') problems.push(`failedSections is ${JSON.stringify(broken.body?.failedSections)}, expected ["projects"]`);
        if (!((broken.body?.documents ?? []) as Array<{ id: number }>).some(d => Number(d.id) === doc.id)) problems.push('the documents section did not answer beside the failed one');
      } finally {
        await orm.execute(sql`ALTER TABLE production_projects_gone RENAME TO production_projects`);
      }

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'a clerk finds invoices and a price editor finds items as in their lists; a role without the documents keys finds none; a failed section is named and the others answer';
    }));
  }

  const notices = 'reg_workflow_task_notice_v11_6_3p_u6';
  if (shouldRun(notices, 'v11', 'phase6', 'u6', 'workflow', 'notifications')) {
    await runCase(results, notices, 'v11 phase 6.3p (U6): a workflow task notice links to its own record in the inbox; when one recipient acts, the notices of that step still unread by the others are marked read, while another record\'s notices stay unread; a workflow that is ended closes its notices too', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const entityType = `reg_63p_u6_${suffix}`;
      const role = `reg_63p_u6_${suffix}`;
      await orm.insert(roles).values({ code: role, name: `نقش آزمون اعلان کار ${suffix}`, permissions: [] });
      const userIds: number[] = [];
      for (const name of ['a', 'b']) {
        const [u] = await orm.insert(users).values({ username: `reg_63p_${name}_${suffix}`, password: 'x', fullName: `کاربر آزمون اعلان ${name}`, role }).returning({ id: users.id });
        userIds.push(u.id);
      }
      const saved = await WorkflowDefinitionService.saveWorkflowDefinition({
        code: `REG_63P_U6_${suffix}`, title: 'گردش کار آزمون اعلان کار', entityType,
        states: [
          { stateKey: 'review', title: 'بررسی', stateType: 'initial', stepOrder: 1 },
          { stateKey: 'done', title: 'تایید', stateType: 'terminal', stepOrder: 2 },
        ],
        transitions: [{ fromStateKey: 'review', toStateKey: 'done', actionKey: 'approve', title: 'تایید مدیر', requiredRole: role }],
      });
      const defId = Number(saved?.definition?.id);
      if (!defId) throw new Error('setup: the definition was not saved');
      const first = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '1' });
      const second = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '2' });
      const third = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: defId, entityType, entityId: '3' });
      const taskNotices = () => orm.select().from(notifications).where(and(inArray(notifications.userId, userIds), eq(notifications.type, 'task')));

      // 1) each recipient's notice opens its own record
      const sent = await taskNotices();
      for (const inst of [first, second, third]) {
        for (const userId of userIds) {
          const mine = sent.filter(n => n.userId === userId && n.link === approvalInboxInstanceLink(inst.id));
          if (mine.length !== 1 || mine[0].isRead !== 0) problems.push(`user ${userId} has ${mine.length} unread notice(s) of record ${inst.id}, expected 1`);
        }
      }

      // 2) user a acts on the first record: user b's notice of it is read; the second record's notices stay unread
      const state = await WorkflowTransitionExecutor.getInstanceByEntity(entityType, '1', userIds[0], role, []);
      const approve = ((state?.availableTransitions || []) as Array<{ id: number; actionKey: string }>).find(t => t.actionKey === 'approve');
      if (!approve) throw new Error('setup: user a has no approve action');
      await WorkflowTransitionExecutor.executeTransition({ instanceId: first.id, transitionId: approve.id, userId: userIds[0], userName: 'کاربر آزمون اعلان a', userRole: role, userPermissions: [] });
      const afterAct = await taskNotices();
      const unreadOf = (instanceId: number) => afterAct.filter(n => n.link === approvalInboxInstanceLink(instanceId) && n.isRead === 0).map(n => n.userId);
      if (unreadOf(first.id).length !== 0) problems.push(`after user a acted, the first record's notices are still unread for users ${JSON.stringify(unreadOf(first.id))}`);
      if (unreadOf(second.id).length !== 2) problems.push(`acting on the first record read the second record's notices (unread for ${JSON.stringify(unreadOf(second.id))})`);

      // 3) an ended workflow closes its notices; the third record's stay
      await orm.transaction(tx => terminateOpenWorkflows(tx, { entityType, entityId: '2', actionKey: 'void', actionTitle: 'ابطال', comment: 'v11 6.3p U6 test' }));
      const afterEnd = await taskNotices();
      const unreadAfterEnd = (instanceId: number) => afterEnd.filter(n => n.link === approvalInboxInstanceLink(instanceId) && n.isRead === 0).length;
      if (unreadAfterEnd(second.id) !== 0) problems.push(`the ended workflow's notices are still unread (${unreadAfterEnd(second.id)})`);
      if (unreadAfterEnd(third.id) !== 2) problems.push(`ending the second record read the third record's notices (${unreadAfterEnd(third.id)} unread)`);

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'each notice links to its record; acting or ending closes that record\'s unread notices and no other record\'s';
    }));
  }

  const proforma = 'reg_lead_proforma_any_stage_v11_6_3p_u17';
  if (shouldRun(proforma, 'v11', 'phase6', 'u17', 'crm', 'proforma')) {
    await runCase(results, proforma, 'v11 phase 6.3p (U17): a proforma linked to a sales lead at its first stage (lead) is accepted and moves the lead to the proposal stage, as the screens now offer; a second proforma of the same lead and a proforma of a won lead are refused', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const main = String(await getDefaultWarehouseCode(orm));
      const item = await createTestItem({ type: 'product', stocks: { [main]: 5 } });
      const customer = await createTestCustomer();
      const [lead] = await orm.insert(crmLeads).values({ title: `پرونده سرنخ ${Date.now()}`, customerName: customer.name, customerId: customer.id, stage: 'lead', status: 'active', hasProforma: 0, isDeleted: 0 }).returning();
      const [won] = await orm.insert(crmLeads).values({ title: `پرونده موفق ${Date.now()}`, customerName: customer.name, customerId: customer.id, stage: 'won', status: 'won', hasProforma: 0, isDeleted: 0 }).returning();
      const issue = (leadId: number) => admin.post('/api/documents', {
        docType: 'invoice', status: 'proforma', refNumber: 'auto', date: today, location: main, buyer_name: customer.name, partyId: customer.id,
        inOut: 'out', crmLeadId: leadId, items: [{ itemId: item.id, quantity: 1, unit_price: 100_000 }],
      });

      const issued = await issue(lead.id);
      if (!ok(issued)) problems.push(`a proforma of a lead at its first stage returned ${brief(issued)}, expected it accepted`);
      const [after] = await orm.select().from(crmLeads).where(eq(crmLeads.id, lead.id));
      if (after?.stage !== 'proposal' || after?.hasProforma !== 1 || Number(after?.proformaId) !== Number(issued.body?.docId)) {
        problems.push(`the lead is at ${after?.stage} with proforma ${after?.hasProforma}/${after?.proformaId}, expected proposal with document ${issued.body?.docId}`);
      }
      const again = await issue(lead.id);
      if (ok(again)) problems.push(`a second proforma of the same lead was accepted: ${brief(again)}`);
      const closed = await issue(won.id);
      if (ok(closed) || codeOf(closed) !== 'CRM_LEAD_CLOSED') problems.push(`a proforma of a won lead returned ${brief(closed)}, expected CRM_LEAD_CLOSED`);
      const [wonAfter] = await orm.select().from(crmLeads).where(eq(crmLeads.id, won.id));
      if (wonAfter?.stage !== 'won' || wonAfter?.hasProforma !== 0) problems.push(`the won lead changed to ${wonAfter?.stage} with proforma ${wonAfter?.hasProforma}`);

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'a first-stage lead takes a proforma and moves to proposal; a second one and a won lead are refused';
    }));
  }

  return results;
}
