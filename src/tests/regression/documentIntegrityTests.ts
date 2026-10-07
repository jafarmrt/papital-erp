import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { crmLeads } from '../../db/schema.js';
import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';

/**
 * Package 8 (documents and invoices), PR D: document integrity (the sales lead link of a document edit, stock count lines,
 * production receipts, the return invoice lookup and document numbers). Through the real Express routes with real sessions.
 * Each case reproduces a finding of the package 8 review and is red on the code before its fix.
 */
export async function runDocumentIntegrityTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_document_lead_link_in_edit_td_776',
      'v9.0.254: PUT /documents/:id links its sales lead inside the edit transaction under the lead lock: a lead with another proforma or a missing lead is 422 before any write, a free lead is marked and an unlinked one released (TD-776)',
      ['td776', 'documents', 'crm', 'lead', 'package8'], documentLeadLinkInEditCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    let h: Harness | undefined;
    try {
      h = await createHarness();
      const wrong: string[] = [];
      const details = await run(h, wrong);
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      await h?.cleanup();
    }
  }
  return results;
}

const docIdOf = (res: { body?: unknown }) => Number((res.body as { docId?: unknown })?.docId);
const codeOf = (res: { body?: unknown }) => (res.body as { code?: string })?.code;

/** B08-07 (TD-776): the edit linked the lead after its commit, without the lock and the one-proforma rule */
async function documentLeadLinkInEditCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const item = await f.item(20, 1_000);
  const lines = [{ itemId: item, quantity: 1, unit_price: 5_000, location: f.wh }];
  const newLead = async (label: string) => {
    const [lead] = await orm.insert(crmLeads).values({ title: `P8D ${label} ${h.tag}`, customerName: `P8D buyer ${h.tag}`, stage: 'qualified', status: 'active' })
      .returning({ id: crmLeads.id });
    return lead.id;
  };
  const leadOf = async (id: number) => {
    const [lead] = await orm.select({ hasProforma: crmLeads.hasProforma, proformaId: crmLeads.proformaId }).from(crmLeads).where(eq(crmLeads.id, id));
    return `${lead?.hasProforma}/${lead?.proformaId ?? 'null'}`;
  };
  const docRow = async (id: number) => (await h.q(`SELECT crm_lead_id, notes, version FROM documents WHERE id = $1`, [id]))[0] as
    { crm_lead_id: number | null; notes: string | null; version: number };

  const leadA = await newLead('A');
  const leadB = await newLead('B');
  const p1 = await h.post('/api/documents', f.doc('proforma', 'proforma', lines, { crmLeadId: leadA }));
  const p2 = await h.post('/api/documents', f.doc('proforma', 'proforma', lines, { notes: 'P8D before' }));
  const p1Id = docIdOf(p1);
  const p2Id = docIdOf(p2);
  if (p1.status !== 200 || p2.status !== 200 || await leadOf(leadA) !== `1/${p1Id}`) {
    throw new Error(`setup: proformas ${brief(p1)} and ${brief(p2)}, lead A ${await leadOf(leadA)} (expected 1/${p1Id})`);
  }
  const before = await docRow(p2Id);

  // 1) a lead that already has another proforma: 422 before any write
  const taken = await h.put(`/api/documents/${p2Id}`, { notes: 'P8D taken', crmLeadId: leadA });
  if (taken.status !== 422 || codeOf(taken) !== 'CRM_LEAD_HAS_PROFORMA') wrong.push(`linking proforma 2 to lead A (proforma 1) answered ${brief(taken)}, expected 422 CRM_LEAD_HAS_PROFORMA`);

  // 2) a lead that does not exist: 422 before any write (was 409 after the notes and version were saved)
  const missing = await h.put(`/api/documents/${p2Id}`, { notes: 'P8D missing', crmLeadId: 99_999_999 });
  if (missing.status !== 422 || codeOf(missing) !== 'CRM_LEAD_NOT_FOUND') wrong.push(`linking a missing lead answered ${brief(missing)}, expected 422 CRM_LEAD_NOT_FOUND`);
  const afterRefusals = await docRow(p2Id);
  if (afterRefusals.crm_lead_id !== null || afterRefusals.notes !== before.notes || Number(afterRefusals.version) !== Number(before.version)) {
    wrong.push(`the refused edits left proforma 2 ${JSON.stringify(afterRefusals)}, expected it unchanged ${JSON.stringify(before)}`);
  }
  if (await leadOf(leadA) !== `1/${p1Id}`) wrong.push(`lead A is ${await leadOf(leadA)} after the refused link, expected 1/${p1Id}`);

  // 3) a free lead: linked and marked in the same edit
  const linked = await h.put(`/api/documents/${p2Id}`, { notes: 'P8D linked', crmLeadId: leadB });
  const afterLink = await docRow(p2Id);
  if (linked.status !== 200 || Number(afterLink.crm_lead_id) !== leadB || await leadOf(leadB) !== `1/${p2Id}`) {
    wrong.push(`linking the free lead B answered ${brief(linked)} with document lead ${afterLink.crm_lead_id} and lead B ${await leadOf(leadB)}, expected 200, ${leadB} and 1/${p2Id}`);
  }
  const quotes = await h.q(`SELECT count(*)::int AS n FROM crm_activities WHERE lead_id = $1 AND type = 'quote' AND is_deleted = 0`, [leadB]);
  if (Number(quotes[0]?.n) !== 1) wrong.push(`lead B has ${quotes[0]?.n} proforma activities after the link, expected 1`);

  // 4) unlinking releases the lead for a new proforma
  const unlinked = await h.put(`/api/documents/${p2Id}`, { crmLeadId: null });
  const afterUnlink = await docRow(p2Id);
  if (unlinked.status !== 200 || afterUnlink.crm_lead_id !== null || await leadOf(leadB) !== '0/null') {
    wrong.push(`unlinking answered ${brief(unlinked)} with document lead ${afterUnlink.crm_lead_id} and lead B ${await leadOf(leadB)}, expected 200, null and 0/null`);
  }
  const p3 = await h.post('/api/documents', f.doc('proforma', 'proforma', lines, { crmLeadId: leadB }));
  if (p3.status !== 200 || await leadOf(leadB) !== `1/${docIdOf(p3)}`) wrong.push(`a new proforma of the released lead B answered ${brief(p3)} with lead B ${await leadOf(leadB)}`);

  return 'linking proforma 2 to lead A (which holds proforma 1) is 422 CRM_LEAD_HAS_PROFORMA and a missing lead 422 CRM_LEAD_NOT_FOUND, both leaving notes and version unchanged; linking the free lead B marks it with one quote activity; unlinking releases B for a new proforma';
}
