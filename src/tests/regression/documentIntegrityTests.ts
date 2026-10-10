import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { crmLeads } from '../../db/schema.js';
import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, docVersion, fixture } from './documentEntryTests.js';
import { createTestWarehouse } from '../fixtures/factories.js';
import { DocumentService } from '../../services/document.service.js';

/**
 * Package 8 (documents and invoices), PR D: document integrity (the sales lead link of a document edit, stock count lines,
 * production receipts, the return invoice lookup and document numbers). Through the real Express routes with real sessions.
 * Each case reproduces a finding of the package 8 review and is red on the code before its fix.
 */
export async function runDocumentIntegrityTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_document_lead_link_in_edit_td_776',
      'v9.0.323: PUT /documents/:id links its sales lead inside the edit transaction under the lead lock: a lead with another proforma or a missing lead is 422 before any write, a free lead is marked and an unlinked one released (TD-776)',
      ['td776', 'documents', 'crm', 'lead', 'package8'], documentLeadLinkInEditCase],
    ['reg_stock_count_lines_td_777',
      'v9.0.324: a stock count line without a count or a repeated (item, warehouse) line is 422 before any movement, and the document view keys each variance by item and warehouse (TD-777)',
      ['td777', 'documents', 'audit', 'stock_count', 'package8'], stockCountLinesCase],
    ['reg_production_receipt_project_only_td_780',
      'v9.0.325: a production receipt is recorded only through the project delivery: POST /documents and finalizing a draft production receipt are 422 and move nothing, the project path still issues it (TD-780)',
      ['td780', 'documents', 'production_receipt', 'projects', 'package8'], productionReceiptProjectOnlyCase],
    ['reg_document_by_ref_fiscal_year_td_782',
      'v9.0.326: GET /documents/by-ref finds only an active final document of the type, by fiscal year when given; a number in two years is 409 with the years, a draft is 404 (TD-782)',
      ['td782', 'documents', 'by_ref', 'fiscal_year', 'package8'], documentByRefFiscalYearCase],
    ['reg_document_ref_number_rules_td_783',
      'v9.0.327: a sales document number comes only from the server series (manual 422), a taken warehouse number is 409 instead of a silent swap, a manual number does not move the series, and the audit log keeps the stored number (TD-783)',
      ['td783', 'documents', 'ref_number', 'package8'], documentRefNumberRulesCase],
    ['reg_document_read_by_id_only_td_990',
      'v10.0.50: GET /documents/:id reads only a positive whole id: a voided id is 404 even when another document carries that number, and a number is 400 pointing to by-ref instead of an unfiltered lookup across types, years and voided rows (TD-990, OBS-R1-93)',
      ['td990', 'documents', 'by_id', 'package8'], documentReadByIdOnlyCase],
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
  const taken = await h.put(`/api/documents/${p2Id}`, { version: await docVersion(h, p2Id), notes: 'P8D taken', crmLeadId: leadA });
  if (taken.status !== 422 || codeOf(taken) !== 'CRM_LEAD_HAS_PROFORMA') wrong.push(`linking proforma 2 to lead A (proforma 1) answered ${brief(taken)}, expected 422 CRM_LEAD_HAS_PROFORMA`);

  // 2) a lead that does not exist: 422 before any write (was 409 after the notes and version were saved)
  const missing = await h.put(`/api/documents/${p2Id}`, { version: await docVersion(h, p2Id), notes: 'P8D missing', crmLeadId: 99_999_999 });
  if (missing.status !== 422 || codeOf(missing) !== 'CRM_LEAD_NOT_FOUND') wrong.push(`linking a missing lead answered ${brief(missing)}, expected 422 CRM_LEAD_NOT_FOUND`);
  const afterRefusals = await docRow(p2Id);
  if (afterRefusals.crm_lead_id !== null || afterRefusals.notes !== before.notes || Number(afterRefusals.version) !== Number(before.version)) {
    wrong.push(`the refused edits left proforma 2 ${JSON.stringify(afterRefusals)}, expected it unchanged ${JSON.stringify(before)}`);
  }
  if (await leadOf(leadA) !== `1/${p1Id}`) wrong.push(`lead A is ${await leadOf(leadA)} after the refused link, expected 1/${p1Id}`);

  // 3) a free lead: linked and marked in the same edit
  const linked = await h.put(`/api/documents/${p2Id}`, { version: await docVersion(h, p2Id), notes: 'P8D linked', crmLeadId: leadB });
  const afterLink = await docRow(p2Id);
  if (linked.status !== 200 || Number(afterLink.crm_lead_id) !== leadB || await leadOf(leadB) !== `1/${p2Id}`) {
    wrong.push(`linking the free lead B answered ${brief(linked)} with document lead ${afterLink.crm_lead_id} and lead B ${await leadOf(leadB)}, expected 200, ${leadB} and 1/${p2Id}`);
  }
  const quotes = await h.q(`SELECT count(*)::int AS n FROM crm_activities WHERE lead_id = $1 AND type = 'quote' AND is_deleted = 0`, [leadB]);
  if (Number(quotes[0]?.n) !== 1) wrong.push(`lead B has ${quotes[0]?.n} proforma activities after the link, expected 1`);

  // 4) unlinking releases the lead for a new proforma
  const unlinked = await h.put(`/api/documents/${p2Id}`, { version: await docVersion(h, p2Id), crmLeadId: null });
  const afterUnlink = await docRow(p2Id);
  if (unlinked.status !== 200 || afterUnlink.crm_lead_id !== null || await leadOf(leadB) !== '0/null') {
    wrong.push(`unlinking answered ${brief(unlinked)} with document lead ${afterUnlink.crm_lead_id} and lead B ${await leadOf(leadB)}, expected 200, null and 0/null`);
  }
  const p3 = await h.post('/api/documents', f.doc('proforma', 'proforma', lines, { crmLeadId: leadB }));
  if (p3.status !== 200 || await leadOf(leadB) !== `1/${docIdOf(p3)}`) wrong.push(`a new proforma of the released lead B answered ${brief(p3)} with lead B ${await leadOf(leadB)}`);

  return 'linking proforma 2 to lead A (which holds proforma 1) is 422 CRM_LEAD_HAS_PROFORMA and a missing lead 422 CRM_LEAD_NOT_FOUND, both leaving notes and version unchanged; linking the free lead B marks it with one quote activity; unlinking releases B for a new proforma';
}

/** B08-08 (TD-777): a line without a count zeroed the stock, a repeated item was adjusted twice, the view mixed warehouses */
async function stockCountLinesCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const second = await createTestWarehouse({ name: `P8D second warehouse ${h.tag}` });
  const a = await f.item(10);
  const b = await f.item(10);
  const c = await f.item(10, 1_000, { [f.wh]: 10, [second.code]: 4 });
  const count = (lines: Array<Record<string, unknown>>) => h.post('/api/documents', f.doc('audit', 'final', lines, { location: f.wh }));
  const movements = async (itemId: number) => Number((await h.q(`SELECT count(*)::int AS n FROM transactions WHERE item_id = $1 AND document_type = 'audit'`, [itemId]))[0]?.n);

  // 1) a line without a count (missing or empty): 422 and the stock stays (was: counted as zero, a shortage of 10)
  for (const line of [{ itemId: a, location: f.wh }, { itemId: a, location: f.wh, physical_stock: '' }]) {
    const res = await count([line]);
    if (res.status !== 422 || codeOf(res) !== 'AUDIT_COUNT_MISSING') wrong.push(`a count line ${JSON.stringify(line)} answered ${brief(res)}, expected 422 AUDIT_COUNT_MISSING`);
  }
  if (await f.stock(a) !== 10 || await movements(a) !== 0) wrong.push(`item A is ${await f.stock(a)} with ${await movements(a)} count movements after the refused counts, expected 10 and 0`);

  // 2) the same item and warehouse twice (once through the document location): 422 and the stock stays (was: two outflows of 4, stock 2)
  const dup = await count([{ itemId: b, physical_stock: 6 }, { itemId: b, physical_stock: 6, location: f.wh }]);
  if (dup.status !== 422 || codeOf(dup) !== 'AUDIT_DUPLICATE_LINE') wrong.push(`item B counted twice in ${f.wh} answered ${brief(dup)}, expected 422 AUDIT_DUPLICATE_LINE`);
  if (await f.stock(b) !== 10 || await movements(b) !== 0) wrong.push(`item B is ${await f.stock(b)} with ${await movements(b)} count movements after the refused count, expected 10 and 0`);

  // 3) one item counted in two warehouses: each line shows its own warehouse's variance (was: -3 and book 13 on the main line)
  const both = await count([{ itemId: c, physical_stock: 10, location: f.wh }, { itemId: c, physical_stock: 1, location: second.code }]);
  if (both.status !== 200) throw new Error(`setup: the two-warehouse count answered ${brief(both)}`);
  if (await f.stock(c) !== 10 || await f.stock(c, second.code) !== 1) wrong.push(`item C is ${await f.stock(c)} / ${await f.stock(c, second.code)} after the count, expected 10 / 1`);
  const view = await h.get(`/api/documents/${docIdOf(both)}`);
  const lines = ((view.body as { items?: Array<{ location: string; variance: number; system_stock: number }> })?.items ?? [])
    .map(l => `${l.location}:${l.variance}/${l.system_stock}`).sort();
  const expected = [`${f.wh}:0/10`, `${second.code}:-3/4`].sort();
  if (view.status !== 200 || JSON.stringify(lines) !== JSON.stringify(expected)) {
    wrong.push(`the count view shows ${JSON.stringify(lines)} (${view.status}), expected variance/book ${JSON.stringify(expected)}`);
  }

  return `a line without a count is 422 AUDIT_COUNT_MISSING and a repeated (item, ${f.wh}) line 422 AUDIT_DUPLICATE_LINE, leaving stock 10 with no movement; item C counted 10 in ${f.wh} and 1 in ${second.code} shows variance/book ${expected.join(', ')}`;
}

/** B08-11 (TD-780): a production receipt from POST /documents skipped the project, its planned quantity and its status */
async function productionReceiptProjectOnlyCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const product = await f.item(0, 0);
  const lines = (qty: number) => [{ itemId: product, quantity: qty, unit_price: 200_000, location: f.wh }];
  const insertProject = async (status: string) => {
    const code = `P8D-${h.tag}-${status}-${Math.floor(Math.random() * 1e5)}`;
    const [row] = await h.q(`INSERT INTO production_projects (project_code, title, item_id, item_name, quantity, status) VALUES ($1, $2, $3, 'P8D product', 1, $4) RETURNING id`,
      [code, `P8D project ${code}`, product, status]);
    return Number(row.id);
  };
  const receipts = async () => Number((await h.q(`SELECT count(*)::int AS n FROM documents WHERE type = 'production_receipt' AND is_deleted = 0 AND id IN (SELECT document_id FROM document_items WHERE item_id = $1)`, [product]))[0]?.n);

  // 1) POST /documents: final without a project, final on a cancelled project, a draft: all 422, nothing recorded
  const cancelled = await insertProject('cancelled');
  const attempts: Array<[string, Record<string, unknown>]> = [
    ['final without a project', f.doc('production_receipt', 'final', lines(5))],
    ['final of 7 on a cancelled project planned for 1', f.doc('production_receipt', 'final', lines(7), { projectId: cancelled })],
    ['draft', f.doc('production_receipt', 'draft', lines(5))],
  ];
  for (const [label, body] of attempts) {
    const res = await h.post('/api/documents', body);
    if (res.status !== 422 || codeOf(res) !== 'PRODUCTION_RECEIPT_PROJECT_ONLY') wrong.push(`a production receipt (${label}) answered ${brief(res)}, expected 422 PRODUCTION_RECEIPT_PROJECT_ONLY`);
  }
  if (await f.stock(product) !== 0 || await receipts() !== 0) wrong.push(`after the refused receipts the product has stock ${await f.stock(product)} and ${await receipts()} production receipts, expected 0 and 0`);

  // 2) a draft production receipt recorded before this version is not finalized
  const legacyDraft = await DocumentService.createDocument({ docType: 'production_receipt', status: 'draft', date: f.today, user: 'p8d', location: f.wh, items: lines(5) } as never);
  const finalized = await h.put(`/api/documents/${legacyDraft}/finalize`, {});
  if (finalized.status !== 422 || codeOf(finalized) !== 'PRODUCTION_RECEIPT_PROJECT_ONLY') wrong.push(`finalizing a legacy draft production receipt answered ${brief(finalized)}, expected 422 PRODUCTION_RECEIPT_PROJECT_ONLY`);
  const [draftRow] = await h.q(`SELECT status FROM documents WHERE id = $1`, [legacyDraft]);
  if (draftRow?.status !== 'draft' || await f.stock(product) !== 0) wrong.push(`the legacy draft is ${draftRow?.status} with product stock ${await f.stock(product)}, expected draft and 0`);

  // 3) the project delivery still issues its production receipt
  const project = await insertProject('in_progress');
  const delivered = await h.post(`/api/projects/${project}/add-to-inventory`, { itemsToAdd: [{ itemId: product, quantity: 1, unitPrice: 200_000, location: f.wh }] });
  const [issued] = await h.q(`SELECT type, status FROM documents WHERE project_id = $1 AND is_deleted = 0`, [project]);
  if (delivered.status !== 200 || issued?.type !== 'production_receipt' || issued?.status !== 'final' || await f.stock(product) !== 1) {
    wrong.push(`the project delivery answered ${brief(delivered)} with document ${JSON.stringify(issued ?? null)} and stock ${await f.stock(product)}, expected 200, a final production receipt and 1`);
  }

  return 'POST /documents refuses a production receipt (final, on a cancelled project, draft) with 422 PRODUCTION_RECEIPT_PROJECT_ONLY and finalizing a legacy draft is refused the same way, leaving stock 0; the project delivery issues a final production receipt and stock 1';
}

/** B08-13 (TD-782): by-ref loaded every document of the type and always returned the current year's one */
async function documentByRefFiscalYearCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const item = await f.item(20, 1_000);
  const lines = [{ itemId: item, quantity: 1, unit_price: 5_000, location: f.wh }];
  const older = await h.post('/api/documents', f.doc('invoice', 'final', lines));
  const newer = await h.post('/api/documents', f.doc('invoice', 'final', lines));
  const draft = await h.post('/api/documents', f.doc('invoice', 'draft', lines));
  if (older.status !== 200 || newer.status !== 200 || draft.status !== 200) throw new Error(`setup: invoices ${brief(older)}, ${brief(newer)}, ${brief(draft)}`);
  const [{ fy }] = await h.q(`SELECT ref_fiscal_year AS fy FROM documents WHERE id = $1`, [docIdOf(newer)]) as Array<{ fy: number }>;
  const lastYear = Number(fy) - 1;
  // the same number in two fiscal years, as each year's series restarts (uq_documents_type_fy_ref_active is per year)
  const ref = `P8D-${h.tag}`;
  await h.q(`UPDATE documents SET ref_number = $1, ref_fiscal_year = $2 WHERE id = $3`, [ref, lastYear, docIdOf(older)]);
  await h.q(`UPDATE documents SET ref_number = $1 WHERE id = $2`, [ref, docIdOf(newer)]);
  const draftRef = `P8D-draft-${h.tag}`;
  await h.q(`UPDATE documents SET ref_number = $1 WHERE id = $2`, [draftRef, docIdOf(draft)]);
  const byRef = (r: string, query: string) => h.get(`/api/documents/by-ref/${encodeURIComponent(r)}?${query}`);
  const idOf = (res: { body?: unknown }) => Number((res.body as { id?: unknown })?.id);

  // 1) no year: two matches are 409 with both years, newest first (was: 200 with the current year's invoice)
  const both = await byRef(ref, 'type=invoice');
  const years = ((both.body as { details?: { candidates?: Array<{ refFiscalYear: number }> } })?.details?.candidates ?? []).map(c => c.refFiscalYear);
  if (both.status !== 409 || codeOf(both) !== 'DOCUMENT_REF_AMBIGUOUS' || JSON.stringify(years) !== JSON.stringify([Number(fy), lastYear])) {
    wrong.push(`by-ref without a year answered ${brief(both)} with years ${JSON.stringify(years)}, expected 409 DOCUMENT_REF_AMBIGUOUS with [${fy},${lastYear}]`);
  }
  // 2) each year finds its own invoice (was: last year's invoice unreachable)
  const old = await byRef(ref, `type=invoice&fiscalYear=${lastYear}`);
  if (old.status !== 200 || idOf(old) !== docIdOf(older)) wrong.push(`by-ref for ${lastYear} answered ${brief(old)}, expected invoice ${docIdOf(older)}`);
  const cur = await byRef(ref, `type=invoice&fiscalYear=${fy}`);
  if (cur.status !== 200 || idOf(cur) !== docIdOf(newer)) wrong.push(`by-ref for ${fy} answered ${brief(cur)}, expected invoice ${docIdOf(newer)}`);
  // 3) a draft is not a reference invoice; a missing type is 400
  const draftLookup = await byRef(draftRef, 'type=invoice');
  if (draftLookup.status !== 404 || codeOf(draftLookup) !== 'DOCUMENT_REF_NOT_FOUND') wrong.push(`by-ref of a draft invoice answered ${brief(draftLookup)}, expected 404 DOCUMENT_REF_NOT_FOUND`);
  const noType = await h.get(`/api/documents/by-ref/${encodeURIComponent(ref)}`);
  if (noType.status !== 400) wrong.push(`by-ref without a type answered ${brief(noType)}, expected 400`);

  return `number ${ref} in ${lastYear} and ${fy}: no year 409 DOCUMENT_REF_AMBIGUOUS [${fy},${lastYear}], each year its own invoice; a draft 404 DOCUMENT_REF_NOT_FOUND; no type 400`;
}

/** B08-14 (TD-783): a taken number was silently swapped (the log kept the requested one) and a large manual number moved the series */
async function documentRefNumberRulesCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const item = await f.item(50, 1_000);
  const lines = [{ itemId: item, quantity: 1, unit_price: 5_000, location: f.wh }];
  const refOf = (res: { body?: unknown }) => String((res.body as { refNumber?: unknown })?.refNumber ?? '');
  const storedRef = async (id: number) => String((await h.q(`SELECT ref_number FROM documents WHERE id = $1`, [id]))[0]?.ref_number ?? '');
  const peek = async (type: string) => String(((await h.get(`/api/documents/next-ref?type=${type}`)).body as { nextRef?: unknown })?.nextRef ?? '');

  // 1) sales documents: a manual number is 422, before anything is written
  for (const docType of ['invoice', 'return']) {
    const res = await h.post('/api/documents', f.doc(docType, 'draft', lines, { refNumber: '900000' }));
    if (res.status !== 422 || codeOf(res) !== 'DOCUMENT_REF_SERVER_SERIES') wrong.push(`a ${docType} with the manual number 900000 answered ${brief(res)}, expected 422 DOCUMENT_REF_SERVER_SERIES`);
  }
  const invoiceNext = await peek('invoice');
  const invoice = await h.post('/api/documents', f.doc('invoice', 'draft', lines));
  const invoiceRef = await storedRef(docIdOf(invoice));
  if (invoice.status !== 200 || invoiceRef !== invoiceNext || refOf(invoice) !== invoiceRef) {
    wrong.push(`an invoice with "auto" answered ${brief(invoice)} and stored ${invoiceRef}, expected the series number ${invoiceNext} in the response`);
  }
  const [log] = await h.q(`SELECT description, details FROM activity_logs WHERE entity_id::text = $1 AND action = 'CREATE' ORDER BY id DESC LIMIT 1`, [String(docIdOf(invoice))]) as
    Array<{ description: string; details: { after?: { refNumber?: string; status?: string } } | string }>;
  const after = (typeof log?.details === 'string' ? JSON.parse(log.details) : log?.details)?.after;
  if (!log?.description.includes(`"${invoiceRef}"`) || after?.refNumber !== invoiceRef || after?.status !== 'draft') {
    wrong.push(`the create log says ${JSON.stringify(log?.description)} with ${JSON.stringify(after ?? null)}, expected the stored number ${invoiceRef} and status draft`);
  }
  // editing keeps the invoice number: the same number passes, another is 422
  const same = await h.put(`/api/documents/${docIdOf(invoice)}`, { version: await docVersion(h, docIdOf(invoice)), refNumber: invoiceRef, notes: 'P8D same number' });
  const other = await h.put(`/api/documents/${docIdOf(invoice)}`, { version: await docVersion(h, docIdOf(invoice)), refNumber: '900000', notes: 'P8D other number' });
  if (same.status !== 200 || other.status !== 422 || codeOf(other) !== 'DOCUMENT_REF_SERVER_SERIES' || await storedRef(docIdOf(invoice)) !== invoiceRef) {
    wrong.push(`editing the invoice number answered ${brief(same)} (same) and ${brief(other)} (other) leaving ${await storedRef(docIdOf(invoice))}, expected 200, 422 DOCUMENT_REF_SERVER_SERIES and ${invoiceRef}`);
  }

  // 2) warehouse documents: a manual number stays, a taken one is 409 (was: silently the next number, logged as the requested one)
  const manual = `P8D-R-${h.tag}`;
  const first = await h.post('/api/documents', f.doc('receipt', 'draft', lines, { refNumber: manual }));
  const second = await h.post('/api/documents', f.doc('receipt', 'draft', lines, { refNumber: manual }));
  if (first.status !== 200 || refOf(first) !== manual) wrong.push(`a receipt with the manual number ${manual} answered ${brief(first)}`);
  if (second.status !== 409 || codeOf(second) !== 'DOCUMENT_REF_TAKEN') wrong.push(`a second receipt with ${manual} answered ${brief(second)}, expected 409 DOCUMENT_REF_TAKEN`);
  // editing another receipt to that number: the same 409 with its own code (was: a generic duplicate error)
  const third = await h.post('/api/documents', f.doc('receipt', 'draft', lines));
  const moved = await h.put(`/api/documents/${docIdOf(third)}`, { version: await docVersion(h, docIdOf(third)), refNumber: manual });
  if (moved.status !== 409 || codeOf(moved) !== 'DOCUMENT_REF_TAKEN') wrong.push(`editing a receipt to the taken number answered ${brief(moved)}, expected 409 DOCUMENT_REF_TAKEN`);

  // 3) a manual number ahead of the series does not move it, and the series skips it
  const receiptNext = Number(await peek('receipt'));
  const ahead = await h.post('/api/documents', f.doc('receipt', 'draft', lines, { refNumber: String(receiptNext + 1) }));
  const big = await h.post('/api/documents', f.doc('receipt', 'draft', lines, { refNumber: '900000' }));
  if (ahead.status !== 200 || big.status !== 200 || Number(await peek('receipt')) !== receiptNext) {
    wrong.push(`after manual receipts ${receiptNext + 1} (${ahead.status}) and 900000 (${big.status}) the next receipt number is ${await peek('receipt')}, expected ${receiptNext}`);
  }
  const autoA = await h.post('/api/documents', f.doc('receipt', 'draft', lines));
  const autoB = await h.post('/api/documents', f.doc('receipt', 'draft', lines));
  if (refOf(autoA) !== String(receiptNext) || refOf(autoB) !== String(receiptNext + 2)) {
    wrong.push(`the next two automatic receipts got ${refOf(autoA)} and ${refOf(autoB)} (${autoA.status}/${autoB.status}), expected ${receiptNext} and ${receiptNext + 2} (skipping the manual ${receiptNext + 1})`);
  }

  return `invoice and return with a manual number 422 DOCUMENT_REF_SERVER_SERIES; invoice ${invoiceRef} from the series, logged with that number; receipt ${manual} twice 409 DOCUMENT_REF_TAKEN; manual ${receiptNext + 1} and 900000 leave the series at ${receiptNext}, which then skips ${receiptNext + 1}`;
}

/** OBS-R1-93 (TD-990): GET /documents/:id fell back to a reference number lookup with no type, year or voided filter */
async function documentReadByIdOnlyCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const item = await f.item(20, 1_000);
  const lines = [{ itemId: item, quantity: 1, unit_price: 5_000, location: f.wh }];
  const voided = await h.post('/api/documents', f.doc('invoice', 'draft', lines));
  const other = await h.post('/api/documents', f.doc('invoice', 'final', lines));
  const receipt = await h.post('/api/documents', f.doc('receipt', 'final', lines));
  if (voided.status !== 200 || other.status !== 200 || receipt.status !== 200) throw new Error(`setup: ${brief(voided)}, ${brief(other)}, ${brief(receipt)}`);
  const voidedId = docIdOf(voided);
  const voidRes = await h.del(`/api/documents/${voidedId}`);
  if (voidRes.status !== 200) throw new Error(`setup void: ${brief(voidRes)}`);
  const idOf = (res: { body?: unknown }) => Number((res.body as { id?: unknown })?.id);

  // 1) a live document read by its id
  const live = await h.get(`/api/documents/${docIdOf(other)}`);
  if (live.status !== 200 || idOf(live) !== docIdOf(other)) wrong.push(`reading invoice ${docIdOf(other)} by id answered ${brief(live)}, expected 200 with it`);
  // 2) a voided id is 404, even when another document carries that number (was: 200 with the other document)
  await h.q(`UPDATE documents SET ref_number = $1 WHERE id = $2`, [String(voidedId), docIdOf(other)]);
  const gone = await h.get(`/api/documents/${voidedId}`);
  if (gone.status !== 404) wrong.push(`reading voided document ${voidedId} answered ${brief(gone)} (id ${idOf(gone)}), expected 404 instead of invoice ${docIdOf(other)} with that number`);
  // 3) a number shared by two types is not read here (was: 200 with one of them); by-ref names the type
  const ref = `P8R-${h.tag}`;
  await h.q(`UPDATE documents SET ref_number = $1 WHERE id = ANY($2::int[])`, [ref, [docIdOf(other), docIdOf(receipt)]]);
  const byNumber = await h.get(`/api/documents/${encodeURIComponent(ref)}`);
  if (byNumber.status !== 400) wrong.push(`reading by the number ${ref} of an invoice and a receipt answered ${brief(byNumber)} (id ${idOf(byNumber)}), expected 400`);
  const byRef = await h.get(`/api/documents/by-ref/${encodeURIComponent(ref)}?type=receipt`);
  if (byRef.status !== 200 || idOf(byRef) !== docIdOf(receipt)) wrong.push(`by-ref of the receipt answered ${brief(byRef)}, expected receipt ${docIdOf(receipt)}`);
  for (const bad of ['0', '12abc', '-3']) {
    const res = await h.get(`/api/documents/${bad}`);
    if (res.status !== 400) wrong.push(`reading document "${bad}" answered ${brief(res)}, expected 400`);
  }
  return `id ${docIdOf(other)} 200; voided id ${voidedId} 404 though another invoice has that number; the number ${ref} 400 and by-ref finds the receipt; 0, 12abc and -3 are 400`;
}
