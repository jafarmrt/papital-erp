import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';

/**
 * Package 8 (documents and invoices), PR E: the data of a document (who reads its treasury rows, its party by id). Through the real
 * Express routes with real sessions. Each case reproduces a finding of the package 8 review and is red on the code before
 * its fix.
 */
export async function runDocumentDataTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_document_settlements_by_permission_td_781',
      'v9.0.286: a document gives its treasury rows (number, method, tracking number, bank account, description) only to treasury readers; other readers get the paid amount, the balance and the settlement status (TD-781)',
      ['td781', 'documents', 'treasury', 'settlements', 'package8'], settlementsByPermissionCase],
    ['reg_document_party_by_id_td_778',
      'v9.0.287: a sales or purchase document keeps its party by id: the voucher, the dossier, the treasury link and the party delete guard follow the id whatever the buyer name, a return takes its invoice\'s party, and the migration links old documents by exact name (TD-778)',
      ['td778', 'documents', 'party', 'customers', 'package8'], documentPartyByIdCase],
    ['reg_document_audit_trail_td_785',
      'v9.0.288: every change of a document writes one audit row in its own transaction with the stored document before and after: create, edit, finalize, a final invoice\'s notes and a void (one DELETE row), and the invoice event carries the buyer name (TD-785)',
      ['td785', 'documents', 'audit', 'package8'], documentAuditTrailCase],
    ['reg_document_check_constraints_td_786',
      'v9.0.289: the database refuses an unknown document type or status and a negative line quantity, unit price or discount (a counted zero stays possible), the service refuses an unknown type or status, a legacy row leaves its constraint NOT VALID and is listed by the health check, and documents.project_id has one index (TD-786)',
      ['td786', 'documents', 'constraint', 'package8'], documentCheckConstraintsCase],
    ['reg_document_list_paged_td_787',
      'v9.0.290: GET /documents always answers one page (50 documents by default, also for limit=0) with its total, and only export=true returns the whole list (TD-787)',
      ['td787', 'documents', 'pagination', 'performance', 'package8'], documentListPagedCase],
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

/** B08-12 (TD-781): every document reader (sales, workflow) saw the receipts' tracking number and bank */
async function settlementsByPermissionCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { createBank } = await import('./treasuryPartyTests.js');
  const { createTestCustomer } = await import('../fixtures/factories.js');
  const bank = await createBank('P8 TD-781 bank');
  const party = `P8 party ${h.tag}`;
  const customer = await createTestCustomer({ name: party });
  const item = await f.item(10, 1_000);
  const sale = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: item, quantity: 1, unit_price: 2_000_000, location: f.wh }]));
  const invoiceId = docIdOf(sale);
  if (sale.status !== 200 || !invoiceId) throw new Error(`setup: invoice ${brief(sale)}`);
  const tracking = `TRK-${h.tag}`;
  const receipt = await h.post('/api/accounting/treasury', {
    type: 'receipt', method: 'bank_transfer', bankAccountId: bank.id, amount: 500_000, date: f.today, trackingNumber: tracking,
    description: 'P8 TD-781 private note', partyType: 'customer', partyId: customer.id, partyName: party, documentId: invoiceId,
  });
  if (![200, 201].includes(receipt.status)) throw new Error(`setup: receipt ${brief(receipt)}`);
  const [{ ref }] = await h.q(`SELECT ref_number AS ref FROM documents WHERE id = $1`, [invoiceId]) as Array<{ ref: string }>;

  type DocBody = { settlements?: Array<{ trackingNumber?: string; bankAccountId?: number }>; paidAmount?: number; remainingAmount?: number; settlementStatus?: string };
  const views = [
    ['by id', `/api/documents/${invoiceId}`],
    ['by ref', `/api/documents/by-ref/${encodeURIComponent(ref)}?type=invoice`],
  ] as const;
  const readers: Array<[string, string[], boolean]> = [
    ['documents.view', ['documents.view'], false],
    ['documents.create', ['documents.create'], false],
    ['workflow.view', ['workflow.view'], false],
    ['documents.view + accounting.treasury', ['documents.view', 'accounting.treasury'], true],
    ['documents.view + accounting.view', ['documents.view', 'accounting.view'], true],
  ];
  for (const [label, keys, seesRows] of readers) {
    const session = await h.sessionWith(keys);
    for (const [viewName, url] of views) {
      const res = await h.get(url, session);
      const body = res.body as DocBody;
      if (res.status !== 200) {
        // the by-ref lookup is not open to every document reader (TD-890); only a 200 is checked
        if (viewName === 'by id') wrong.push(`${label} read the invoice ${viewName} with ${brief(res)}, expected 200`);
        continue;
      }
      const rows = Array.isArray(body?.settlements) ? body.settlements : null;
      if (seesRows) {
        if (!rows || rows.length !== 1 || rows[0]?.trackingNumber !== tracking || Number(rows[0]?.bankAccountId) !== Number(bank.id)) {
          wrong.push(`${label} read the invoice ${viewName} without its receipt row (${JSON.stringify(rows)}), expected one row with ${tracking}`);
        }
      } else if (rows !== null || JSON.stringify(body).includes(tracking)) {
        wrong.push(`${label} read the invoice ${viewName} with its treasury rows (${JSON.stringify(rows)}), expected none`);
      }
      if (Number(body?.paidAmount) !== 500_000 || Number(body?.remainingAmount) !== 1_500_000 || body?.settlementStatus !== 'partially_paid') {
        wrong.push(`${label} read the invoice ${viewName} with paid ${body?.paidAmount}, remaining ${body?.remainingAmount}, status ${body?.settlementStatus}, expected 500000 / 1500000 / partially_paid`);
      }
    }
  }
  return `invoice ${ref} with receipt ${tracking}: documents.view, documents.create and workflow.view see paid 500000 / remaining 1500000 / partially_paid and no rows; treasury readers see the row`;
}

/** B08-09 (TD-778): a document knew its party only by the buyer name text; an Arabic «ي» left the voucher without the party */
async function documentPartyByIdCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { createBank } = await import('./treasuryPartyTests.js');
  const { createTestCustomer } = await import('../fixtures/factories.js');
  const codeOf = (res: { body?: unknown }) => (res.body as { code?: string })?.code;
  const textOf = (res: { body?: unknown }) => JSON.stringify(res.body ?? null);
  const partyOf = async (docId: number) => {
    // read through to_jsonb so the case reports the behaviour (not a missing column) on the code before the fix
    const [row] = await h.q(`SELECT (to_jsonb(d) ->> 'party_id')::int AS party_id, d.buyer_name FROM documents d WHERE d.id = $1`, [docId]) as Array<{ party_id: number | null; buyer_name: string }>;
    return row;
  };
  const voucherPartyIds = async (docId: number) => (await h.q(
    `SELECT DISTINCT jvi.detailed_id FROM journal_voucher_items jvi JOIN journal_vouchers jv ON jv.id = jvi.voucher_id
      WHERE jv.source_document_id = $1 AND jv.is_deleted = 0 AND jvi.is_deleted = 0 AND jvi.detailed_type = 'customer'`, [docId],
  ) as Array<{ detailed_id: number | null }>).map(r => r.detailed_id);
  const dossierIds = async (customerId: number) => {
    const res = await h.get(`/api/customers/${customerId}/documents`);
    const rows = (res.body as { data?: Array<{ id: number }> })?.data;
    return Array.isArray(rows) ? rows.map(r => Number(r.id)) : [];
  };
  const item = await f.item(20, 1_000);
  const line = (qty: number) => [{ itemId: item, quantity: qty, unit_price: 1_000_000, location: f.wh }];
  const post = async (body: Record<string, unknown>, label: string) => {
    const res = await h.post('/api/documents', body);
    const id = docIdOf(res);
    if (res.status !== 200 || !id) throw new Error(`setup: ${label} ${brief(res)}`);
    return id;
  };

  // 1) the invoice names its party with an Arabic «ي» but carries the party id: voucher, dossier and treasury follow the id
  const party = await createTestCustomer({ name: `علی رضایی ${h.tag}` });
  const invoice = await post(f.doc('invoice', 'final', line(2), { partyId: party.id, buyer_name: `علي رضايي ${h.tag}` }), 'invoice');
  const detail = await voucherPartyIds(invoice);
  if (detail.length !== 1 || Number(detail[0]) !== party.id) wrong.push(`the invoice voucher put the customer row on detailed ids ${JSON.stringify(detail)}, expected [${party.id}]`);
  if (Number((await partyOf(invoice))?.party_id) !== party.id) wrong.push(`the invoice stored party ${JSON.stringify(await partyOf(invoice))}, expected ${party.id}`);
  // a rename does not cut the link either
  await h.q(`UPDATE customers SET name = $1 WHERE id = $2`, [`Rezaei Trading ${h.tag}`, party.id]);
  if (!(await dossierIds(party.id)).includes(invoice)) wrong.push(`the dossier of the renamed party does not list invoice ${invoice}`);
  const bank = await createBank('P8 TD-778 bank');
  const receipt = await h.post('/api/accounting/treasury', {
    type: 'receipt', method: 'bank_transfer', bankAccountId: bank.id, amount: 100_000, date: f.today,
    partyType: 'customer', partyId: party.id, partyName: `Rezaei Trading ${h.tag}`, documentId: invoice,
  });
  if (![200, 201].includes(receipt.status)) wrong.push(`a receipt of the invoice's party by id answered ${brief(receipt)}, expected 201`);

  // 2) an open proforma of the party under another name, and the draft voucher, keep the party from being deleted
  const draft = await post(f.doc('invoice', 'draft', line(1), { partyId: party.id, buyer_name: 'P8 other display name' }), 'draft');
  const [{ ref: draftRef }] = await h.q(`SELECT ref_number AS ref FROM documents WHERE id = $1`, [draft]) as Array<{ ref: string }>;
  const refused = await h.del(`/api/customers/${party.id}`);
  if (refused.status !== 409 || !textOf(refused).includes(draftRef)) wrong.push(`deleting the party answered ${brief(refused)}, expected 409 naming draft ${draftRef}`);

  // 3) a return of the invoice takes the invoice's party; another party is 422
  const other = await createTestCustomer({ name: `P8 other party ${h.tag}` });
  const returnLine = [{ itemId: item, quantity: 1, unit_price: 1_000_000, location: f.wh }];
  const wrongReturn = await h.post('/api/documents', f.doc('return', 'final', returnLine, { returnOfDocumentId: invoice, partyId: other.id }));
  if (wrongReturn.status !== 422 || codeOf(wrongReturn) !== 'RETURN_PARTY_MISMATCH') wrong.push(`a return of the invoice to another party answered ${brief(wrongReturn)}, expected 422 RETURN_PARTY_MISMATCH`);
  const ret = await post(f.doc('return', 'final', returnLine, { returnOfDocumentId: invoice, buyer_name: 'P8 return display' }), 'return');
  if (Number((await partyOf(ret))?.party_id) !== party.id) wrong.push(`the return stored party ${JSON.stringify(await partyOf(ret))}, expected the invoice's ${party.id}`);

  // 4) an edit moves the draft to another party by id; its name becomes that party's name
  const edited = await h.put(`/api/documents/${draft}`, { partyId: other.id });
  const afterEdit = await partyOf(draft);
  if (edited.status !== 200 || Number(afterEdit?.party_id) !== other.id || afterEdit?.buyer_name !== other.name) {
    wrong.push(`moving the draft to party ${other.id} answered ${brief(edited)} and stored ${JSON.stringify(afterEdit)}, expected the party and its name`);
  }

  // 5) a missing or deleted party is 422; a remittance takes no party
  const missing = await h.post('/api/documents', f.doc('invoice', 'draft', line(1), { partyId: 2_000_000_000 }));
  if (missing.status !== 422 || codeOf(missing) !== 'DOCUMENT_PARTY_INVALID') wrong.push(`a missing party answered ${brief(missing)}, expected 422 DOCUMENT_PARTY_INVALID`);
  const remittance = await h.post('/api/documents', f.doc('remittance', 'final', line(1), { partyId: party.id }));
  if (remittance.status !== 422 || codeOf(remittance) !== 'DOCUMENT_PARTY_NOT_ALLOWED') wrong.push(`a remittance with a party answered ${brief(remittance)}, expected 422 DOCUMENT_PARTY_NOT_ALLOWED`);

  // 6) a caller that sends no id gets the single party of exactly that name; an unknown name stays unlinked and is listed
  const named = await createTestCustomer({ name: `P8 named party ${h.tag}` });
  const byName = await post(f.doc('invoice', 'draft', line(1), { buyer_name: ` P8 named party ${h.tag} ` }), 'invoice by name');
  if (Number((await partyOf(byName))?.party_id) !== named.id) wrong.push(`an invoice named exactly as party ${named.id} stored ${JSON.stringify(await partyOf(byName))}`);
  const nobody = await post(f.doc('invoice', 'draft', line(1), { buyer_name: `P8 nobody ${h.tag}` }), 'invoice of nobody');
  if ((await partyOf(nobody))?.party_id !== null) wrong.push(`an invoice of an unknown name stored party ${JSON.stringify(await partyOf(nobody))}, expected none`);
  const unlinked = await import('../../services/documents/documentParty.js')
    .then(m => m.findUnlinkedPartyDocuments(), () => null);
  if (!unlinked?.some(d => d.id === nobody)) wrong.push(`the health check does not list invoice ${nobody} without a party`);

  // 7) the migration links an old document to the single live party of exactly its name
  const { existsSync, readFileSync } = await import('node:fs');
  const migration = 'drizzle/0076_document_party_id.sql';
  const backfill = existsSync(migration)
    ? readFileSync(migration, 'utf8').split('--> statement-breakpoint').find(part => part.includes('SELECT erp_update_with_unvalidated_checks('))
    : undefined;
  if (!backfill) {
    wrong.push(`the backfill statement of ${migration} was not found`);
    return 'migration missing';
  }
  const live = await createTestCustomer({ name: `P8 backfill ${h.tag}` });
  await createTestCustomer({ name: `P8 backfill ${h.tag}`, isDeleted: 1 });
  const oldDoc = await post(f.doc('invoice', 'draft', line(1), { buyer_name: `P8 backfill ${h.tag}` }), 'old document');
  await h.q(`UPDATE documents SET party_id = NULL WHERE id = ANY($1::int[])`, [[oldDoc, nobody]]);
  await h.q(backfill);
  if (Number((await partyOf(oldDoc))?.party_id) !== live.id) wrong.push(`the migration linked the old document to ${JSON.stringify(await partyOf(oldDoc))}, expected the live party ${live.id}`);
  if ((await partyOf(nobody))?.party_id !== null) wrong.push('the migration linked a document whose name no party has');

  return `invoice ${invoice} named «علي رضايي» on party ${party.id}: voucher detail ${detail.join(',')}, dossier after rename, receipt by id, delete refused naming ${draftRef}; return on the invoice's party, wrong party 422; edit by id; missing party 422; remittance 422; exact-name fallback; unknown name listed; migration backfill`;
}

/** B08-16 (TD-785): the create row logged the request, the edit row had no «before», notes had no row and a void had two */
async function documentAuditTrailCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const buyer = `P8 audit buyer ${h.tag}`;
  const item = await f.item(20, 1_000);
  type Snapshot = { id?: number; refNumber?: string; status?: string; docType?: string; buyerName?: string; notes?: string; items?: Array<{ itemId?: number; quantity?: string; unitPrice?: string }> };
  type AuditRow = { action: string; description: string; details: { before?: Snapshot | null; after?: Snapshot | null; changes?: Record<string, { before: unknown; after: unknown }> } };
  const auditRows = async (docId: number): Promise<AuditRow[]> => {
    const rows = await h.q(
      `SELECT action, description, details FROM activity_logs
        WHERE entity_id = $1 AND (entity LIKE 'اسناد انبار%' OR entity = 'فاکتور فروش') ORDER BY id`,
      [String(docId)],
    ) as Array<{ action: string; description: string; details: unknown }>;
    return rows.map(r => ({ ...r, details: (typeof r.details === 'string' ? JSON.parse(r.details) : r.details) as AuditRow['details'] ?? {} }));
  };
  const show = (row: AuditRow | undefined) => JSON.stringify(row?.details ?? null).slice(0, 220);

  // 1) create: one CREATE row whose «after» is the stored invoice (camelCase buyer name, stored number and lines)
  const created = await h.post('/api/documents', f.doc('invoice', 'draft', [{ itemId: item, quantity: 2, unit_price: 5_000, location: f.wh }], {
    buyer_name: undefined, buyerName: buyer, notes: 'P8 audit first note',
  }));
  const docId = docIdOf(created);
  if (created.status !== 200 || !docId) throw new Error(`setup: invoice ${brief(created)}`);
  const [{ ref }] = await h.q(`SELECT ref_number AS ref FROM documents WHERE id = $1`, [docId]) as Array<{ ref: string }>;
  let rows = await auditRows(docId);
  const createRow = rows.find(r => r.action === 'CREATE');
  const createAfter = createRow?.details.after;
  if (rows.filter(r => r.action === 'CREATE').length !== 1 || createAfter?.id !== docId || createAfter?.refNumber !== ref
    || createAfter?.status !== 'draft' || createAfter?.buyerName !== buyer || createAfter?.items?.length !== 1
    || Number(createAfter?.items?.[0]?.quantity) !== 2 || Number(createAfter?.items?.[0]?.unitPrice) !== 5_000) {
    wrong.push(`the create row is ${show(createRow)}, expected the stored invoice ${ref} (id ${docId}, draft, buyer ${buyer}, one line of 2 at 5000)`);
  }
  const [event] = await h.q(
    `SELECT payload->>'buyerName' AS buyer FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'InvoiceCreated' ORDER BY id DESC LIMIT 1`,
    [String(docId)],
  ) as Array<{ buyer: string | null }>;
  if (event?.buyer !== buyer) wrong.push(`the InvoiceCreated event carries the buyer ${JSON.stringify(event?.buyer ?? null)}, expected ${buyer}`);

  // 2) edit: one UPDATE row with the stored document before and after and the changed field
  const edited = await h.put(`/api/documents/${docId}`, { notes: 'P8 audit second note' });
  if (edited.status !== 200) throw new Error(`setup: edit ${brief(edited)}`);
  rows = await auditRows(docId);
  const editRow = rows.filter(r => r.action === 'UPDATE').at(-1);
  if (editRow?.details.before?.notes !== 'P8 audit first note' || editRow?.details.after?.notes !== 'P8 audit second note'
    || editRow?.details.changes?.notes?.after !== 'P8 audit second note' || editRow?.details.before?.buyerName !== buyer) {
    wrong.push(`the edit row is ${show(editRow)}, expected before.notes «P8 audit first note», after.notes «P8 audit second note» and changes.notes`);
  }

  // 3) finalize: one UPDATE row from draft to final
  const finalized = await h.put(`/api/documents/${docId}/finalize`, {});
  if (finalized.status !== 200) throw new Error(`setup: finalize ${brief(finalized)}`);
  rows = await auditRows(docId);
  const finalizeRow = rows.filter(r => r.action === 'UPDATE').at(-1);
  if (finalizeRow?.details.before?.status !== 'draft' || finalizeRow?.details.after?.status !== 'final' || finalizeRow?.details.changes?.status?.after !== 'final') {
    wrong.push(`the finalize row is ${show(finalizeRow)}, expected before.status draft and after.status final`);
  }
  const updatesBeforeNotes = rows.filter(r => r.action === 'UPDATE').length;

  // 4) notes of the final invoice: one more UPDATE row with the old and the new notes
  const noted = await h.put(`/api/documents/${docId}/notes`, { notes: 'P8 audit final note' });
  if (noted.status !== 200) throw new Error(`setup: notes ${brief(noted)}`);
  rows = await auditRows(docId);
  const notesRow = rows.filter(r => r.action === 'UPDATE').at(-1);
  if (rows.filter(r => r.action === 'UPDATE').length !== updatesBeforeNotes + 1
    || notesRow?.details.before?.notes !== 'P8 audit second note' || notesRow?.details.after?.notes !== 'P8 audit final note') {
    wrong.push(`changing the final invoice's notes wrote ${rows.filter(r => r.action === 'UPDATE').length - updatesBeforeNotes} rows (last ${show(notesRow)}), expected one with before «P8 audit second note» and after «P8 audit final note»`);
  }

  // 5) void: exactly one DELETE row, carrying the invoice as it was
  const voided = await h.del(`/api/documents/${docId}`);
  if (voided.status !== 200) throw new Error(`setup: void ${brief(voided)}`);
  rows = await auditRows(docId);
  const deletes = rows.filter(r => r.action === 'DELETE');
  const deleteBefore = deletes[0]?.details.before;
  if (deletes.length !== 1 || deleteBefore?.refNumber !== ref || deleteBefore?.status !== 'final' || deleteBefore?.notes !== 'P8 audit final note'
    || deleteBefore?.items?.length !== 1) {
    wrong.push(`the void wrote ${deletes.length} DELETE rows (${deletes.map(show).join(' | ')}), expected one with the final invoice ${ref} before it`);
  }
  return `invoice ${ref}: CREATE (stored after), edit, finalize and notes UPDATE rows with before and after, one DELETE row; event buyer ${buyer}`;
}

/** B08-17 (TD-786): documents and document lines had no CHECK constraints and documents.project_id had two identical indexes */
async function documentCheckConstraintsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { orm } = await import('../../db/drizzle.js');
  const { sql } = await import('drizzle-orm');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const names = ['chk_documents_type', 'chk_documents_status', 'chk_document_items_quantity', 'chk_document_items_unit_price', 'chk_document_items_discount'];
  const pgCode = (err: unknown): string | undefined => {
    for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
      const code = (e as { code?: unknown }).code;
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    }
    return undefined;
  };
  const refused = async (label: string, write: () => Promise<unknown>) => {
    try {
      await write();
      wrong.push(`${label} was stored, expected 23514`);
    } catch (err) {
      if (pgCode(err) !== '23514') wrong.push(`${label} failed with ${pgCode(err)} instead of 23514: ${String(err).slice(0, 160)}`);
    }
  };

  // 1) the migrated schema: every constraint present and validated, one index on project_id
  const constraints = await h.q(`SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY($1::text[])`, [names]) as Array<{ conname: string; convalidated: boolean }>;
  for (const name of names) {
    const row = constraints.find(c => c.conname === name);
    if (!row?.convalidated) wrong.push(`constraint ${name} is ${row ? 'NOT VALID' : 'missing'}, expected validated`);
  }
  const indexes = (await h.q(`SELECT indexname FROM pg_indexes WHERE tablename = 'documents' AND schemaname = current_schema() AND indexdef LIKE '%(project_id)%'`) as Array<{ indexname: string }>)
    .map(r => r.indexname).sort();
  if (indexes.join(',') !== 'idx_docs_project') wrong.push(`documents.project_id indexes: ${indexes.join(', ') || 'none'}, expected only idx_docs_project`);

  // 2) direct writes the services never make: refused by the database (a soft-deleted line is exempt)
  const item = await f.item(10, 1_000);
  const receipt = await h.post('/api/documents', f.doc('receipt', 'draft', [{ itemId: item, quantity: 1, unit_price: 1_000, location: f.wh }]));
  const receiptId = docIdOf(receipt);
  if (receipt.status !== 200 || !receiptId) throw new Error(`setup: receipt ${brief(receipt)}`);
  const doc = (type: string, status: string) => h.q(`INSERT INTO documents (type, ref_number, date, status) VALUES ($1, $2, now(), $3) RETURNING id`, [type, `P8E-${h.tag}-${type}-${status}`, status]);
  const line = (quantity: number, unitPrice: number, discount: number, isDeleted = 0) => h.q(
    `INSERT INTO document_items (document_id, item_id, quantity, unit_price, discount, location, is_deleted) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [receiptId, item, quantity, unitPrice, discount, f.wh, isDeleted],
  );
  await refused('a document of type quote', () => doc('quote', 'draft'));
  await refused('a document with status pending', () => doc('receipt', 'pending'));
  await refused('a line with quantity -1', () => line(-1, 1_000, 0));
  await refused('a line with unit price -1', () => line(1, -1, 0));
  await refused('a line with discount -1', () => line(1, 1_000, -1));
  try {
    await line(1, 1_000, -1, 1);
  } catch (err) {
    wrong.push(`a soft-deleted line with discount -1 was refused (${pgCode(err)}), expected it to be exempt`);
  }

  // 3) a counted zero is still a stock count line
  const counted = await h.post('/api/documents', f.doc('audit', 'final', [{ itemId: item, physical_stock: 0, system_stock: 10, location: f.wh }], { location: f.wh }));
  const countedQty = await h.q(`SELECT quantity::float8 AS q FROM document_items WHERE document_id = $1 AND is_deleted = 0`, [docIdOf(counted)]) as Array<{ q: number }>;
  if (counted.status !== 200 || countedQty.length !== 1 || countedQty[0].q !== 0 || await f.stock(item) !== 0) {
    wrong.push(`a count of zero answered ${brief(counted)} with lines ${JSON.stringify(countedQty)} and stock ${await f.stock(item)}, expected 200, one line of 0 and stock 0`);
  }

  // 4) the document service refuses an unknown type or status before writing (was: a header row of any type or status)
  const { DocumentService } = await import('../../services/document.service.js');
  const serviceCode = (body: Record<string, unknown>) => DocumentService.createDocument({ date: f.today, items: [], user: 'test-agent', ...body } as never)
    .then(id => `recorded #${id}`, (err: { code?: string }) => String(err?.code));
  const unknownType = await serviceCode({ docType: 'quote', status: 'draft' });
  if (unknownType !== 'DOCUMENT_TYPE_NOT_RECORDABLE') wrong.push(`the service answered ${unknownType} for a draft of type quote, expected DOCUMENT_TYPE_NOT_RECORDABLE`);
  const unknownStatus = await serviceCode({ docType: 'receipt', status: 'pending' });
  if (unknownStatus !== 'DOCUMENT_STATUS_INVALID') wrong.push(`the service answered ${unknownStatus} for a receipt with status pending, expected DOCUMENT_STATUS_INVALID`);

  // 5) a legacy row from before the constraint: the migration leaves that constraint NOT VALID and the health check lists it
  //    (inside a transaction that is rolled back, so the shared test schema keeps its validated constraints)
  const dir = path.resolve(process.cwd(), 'drizzle');
  const file = fs.readdirSync(dir).find(name => name.endsWith('_document_check_constraints.sql'));
  if (!file) {
    wrong.push('the document constraint migration file is missing');
    return 'constraints missing';
  }
  const health = await import('../../services/documents/documentConstraintHealth.js').catch(() => null);
  const rollback = new Error('rollback');
  let legacyReport = '';
  try {
    await orm.transaction(async (tx) => {
      // zero-quantity lines other cases may have left are counted before, so only this case's legacy rows are compared
      const zeroBefore = health ? (await health.findDocumentIntegrityGaps(tx)).find(g => g.name === 'document_items_quantity_zero')?.brokenRows ?? 0 : 0;
      await tx.execute(sql`ALTER TABLE documents DROP CONSTRAINT IF EXISTS chk_documents_status`);
      await tx.execute(sql`INSERT INTO documents (type, ref_number, date, status) VALUES ('receipt', ${`P8E-${h.tag}-legacy`}, now(), 'pending')`);
      await tx.execute(sql`INSERT INTO document_items (document_id, item_id, quantity, unit_price, discount, location) VALUES (${receiptId}, ${item}, 0, 1000, 0, ${f.wh})`);
      await tx.execute(sql.raw(fs.readFileSync(path.join(dir, file), 'utf8')));
      const state = await tx.execute(sql`SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY(${sql.param(names)}::text[])`);
      const rows = state.rows as Array<{ conname: string; convalidated: boolean }>;
      const status = rows.find(r => r.conname === 'chk_documents_status');
      if (status?.convalidated !== false) wrong.push(`chk_documents_status over a legacy row is ${JSON.stringify(status ?? null)}, expected NOT VALID`);
      if (rows.filter(r => r.conname !== 'chk_documents_status').some(r => !r.convalidated)) wrong.push(`other constraints over the legacy rows: ${JSON.stringify(rows)}`);
      const gaps = health ? await health.findDocumentIntegrityGaps(tx) : [];
      legacyReport = gaps
        .map(g => `${g.name}:${g.state}:${g.name === 'document_items_quantity_zero' ? g.brokenRows - zeroBefore : g.brokenRows}`)
        .sort().join(', ');
      if (legacyReport !== 'chk_documents_status:not_valid:1, document_items_quantity_zero:service:1') {
        wrong.push(`the health check lists ${legacyReport || 'nothing'}, expected chk_documents_status (NOT VALID, 1 row) and document_items_quantity_zero (1 row)`);
      }
      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) wrong.push(`the legacy rerun failed: ${String(err).slice(0, 200)}`);
  }
  return `constraints validated, one project_id index; type, status and negative line values refused (23514); a counted zero stored; the service refuses quote and pending; legacy rerun lists ${legacyReport}`;
}

/** B08-18: a list request without page or limit returned every document with its lines and settlements (20,050 documents: 27.9 MB) */
async function documentListPagedCase(h: Harness, wrong: string[]): Promise<string> {
  const COUNT = 55;
  const prefix = `P8E-787-${h.tag}-`;
  await h.q(
    `INSERT INTO documents (type, ref_number, date, status, notes)
     SELECT 'waste', $1 || lpad(n::text, 3, '0'), now(), 'final', 'TD-787 list paging' FROM generate_series(1, $2::int) AS n`,
    [prefix, COUNT],
  );
  try {
    const base = `/api/documents?type=waste&search=${encodeURIComponent(prefix)}`;
    const page = async (label: string, query: string, expected: { rows: number; page: number; totalPages: number }) => {
      const res = await h.get(`${base}${query}`);
      const body = res.body as { data?: unknown[]; total?: number; page?: number; limit?: number; totalPages?: number } | unknown[];
      if (res.status !== 200) { wrong.push(`${label}: status ${res.status}`); return; }
      if (Array.isArray(body)) { wrong.push(`${label}: returned the whole list as an array of ${body.length} documents, expected one page`); return; }
      const rows = Array.isArray(body.data) ? body.data.length : -1;
      if (rows !== expected.rows || body.total !== COUNT || body.page !== expected.page || body.limit !== 50 || body.totalPages !== expected.totalPages) {
        wrong.push(`${label}: rows ${rows}, total ${body.total}, page ${body.page}, limit ${body.limit}, pages ${body.totalPages}; expected rows ${expected.rows}, total ${COUNT}, page ${expected.page}, limit 50, pages ${expected.totalPages}`);
      }
    };
    await page('no page or limit', '', { rows: 50, page: 1, totalPages: 2 });
    await page('limit=0', '&limit=0', { rows: 50, page: 1, totalPages: 2 });
    await page('page=2', '&page=2', { rows: COUNT - 50, page: 2, totalPages: 2 });

    const exported = await h.get(`${base}&export=true`);
    if (exported.status !== 200 || !Array.isArray(exported.body) || exported.body.length !== COUNT) {
      wrong.push(`export=true returned ${exported.status} with ${Array.isArray(exported.body) ? `${exported.body.length} documents` : 'no array'}, expected all ${COUNT}`);
    }
  } finally {
    await h.q(`DELETE FROM documents WHERE ref_number LIKE $1`, [`${prefix}%`]).catch(() => undefined);
  }
  return `${COUNT} documents: one page of 50 without page or limit and with limit=0, 5 on page 2, all ${COUNT} only with export=true`;
}
