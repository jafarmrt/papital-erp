import request from 'supertest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { journalVouchers, treasuryTransactions } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { fin } from '../../lib/financialDecimal.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { createTestCustomer, createTestDocument, createTestItem } from '../fixtures/factories.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { fundedBank } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';

/**
 * v11 phase 6.1t (M11 / U2, decision ت۵۲-۵): a receipt or payment of the treasury form, or a cheque, settles one or more
 * documents of its party in parts. Real Express routes and services on PostgreSQL, each scenario in its own schema with
 * the standard chart of accounts; each is red on v11.3.0, where a receipt from the treasury or the cheque book left every
 * invoice unpaid and the remaining check of a direct link ignored final returns.
 */

let seq = 0;
export const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;
export const brief = (res: request.Response) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 260)}`;
export const codeOf = (res: request.Response) => String(res.body?.code ?? res.body?.error?.code ?? '');
export const ok = (res: request.Response) => res.status >= 200 && res.status < 300;

// Persian text sent as typed input
const VOID_REASON = 'ثبت تکراری دریافت';
export const BANK_NAME = 'ملت';

type Admin = Awaited<ReturnType<typeof sandboxAdminClient>>;

const count = async (query: ReturnType<typeof sql>) => Number(((await orm.execute(query)).rows[0] as { n: number | string }).n);
const treasuryRows = () => count(sql`SELECT count(*)::int AS n FROM treasury_transactions WHERE is_deleted = 0`);
const liveParts = () => count(sql`SELECT count(*)::int AS n FROM settlement_allocations WHERE is_deleted = 0`);

/** PATCH as the system admin (the sandbox client has none) */
async function adminPatch(url: string, body: unknown): Promise<request.Response> {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s = await getAdminSession();
  return request(app).patch(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object);
}

/** A sales world: a customer, a supplier, an item in stock, a funded bank and helpers for documents and money */
export async function world(admin: Admin) {
  const today = await businessTodayIsoDate();
  const main = String(await getDefaultWarehouseCode(orm));
  const item = await createTestItem({ type: 'raw_material', stocks: { [main]: 500 }, weightedAverageCost: 1000 });
  const customer = await createTestCustomer();
  const supplier = await createTestCustomer({ partyType: 'supplier' });
  const bank = await fundedBank();
  const doc = async (
    docType: 'invoice' | 'receipt', party: { id: number; name: string }, price: number, status: 'final' | 'draft' | 'proforma' = 'final',
    extra: Record<string, unknown> = {},
  ): Promise<number> => {
    const res = await admin.post('/api/documents', {
      docType, status, refNumber: 'auto', date: today, location: main, buyer_name: party.name, partyId: party.id,
      inOut: docType === 'receipt' ? 'in' : 'out', items: [{ itemId: item.id, quantity: 1, unit_price: price }], ...extra,
    });
    const id = Number(res.body?.docId);
    if (!ok(res) || !id) throw new Error(`setup: a ${status} ${docType} returned ${brief(res)}`);
    return id;
  };
  /** what the document page shows: paid, remaining, status and its parts */
  const state = async (id: number) => {
    const res = await admin.get(`/api/documents/${id}`);
    if (res.status !== 200) throw new Error(`reading document ${id} returned ${brief(res)}`);
    return {
      paid: fin(res.body?.paidAmount ?? 0).toNumber(),
      remaining: fin(res.body?.remainingAmount ?? 0).toNumber(),
      status: String(res.body?.settlementStatus ?? ''),
      parts: Array.isArray(res.body?.allocations) ? (res.body.allocations as Array<{ amount: number; source: string; sourceId: number }>) : [],
    };
  };
  const receipt = (amount: number, extra: Record<string, unknown> = {}) => admin.post('/api/accounting/treasury', {
    type: 'receipt', method: 'bank_transfer', bankAccountId: bank, amount, date: today,
    partyType: 'customer', partyId: customer.id, partyName: customer.name, ...extra,
  });
  const cheque = (type: 'received' | 'paid', amount: number, extra: Record<string, unknown> = {}) => admin.post('/api/accounting/cheques', {
    type, chequeNumber: `M11${tagOf()}`, amount, bankName: BANK_NAME, issueDate: today, dueDate: today,
    ...(type === 'received'
      ? { partyType: 'customer', partyId: customer.id, partyName: customer.name }
      : { partyType: 'supplier', partyId: supplier.id, partyName: supplier.name, bankAccountId: bank }),
    ...extra,
  });
  /** an edit of a draft or proforma through `PUT /documents/:id` with its current version */
  const editDoc = async (id: number, body: Record<string, unknown>) => {
    const version = (await admin.get(`/api/documents/${id}`)).body?.version;
    return admin.put(`/api/documents/${id}`, { version, ...body });
  };
  return { today, main, item, customer, supplier, bank, doc, state, receipt, cheque, editDoc };
}

export async function runReceiptsOnInvoicesV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const treasury = 'reg_receipt_settles_invoices_v11_6_1t_m11';
  if (shouldRun(treasury, 'v11', 'phase6', 'm11', 'u2', 'treasury', 'documents', 'settlement')) {
    await runCase(results, treasury, 'v11 phase 6.1t (M11 / U2): the open invoices of a customer are listed oldest first; a treasury receipt put on them in parts settles each (paid, remaining, status, parts on the document page), every wrong part is refused with nothing saved (more than the receipt, more than an invoice has left, another party, both a direct link and parts, a party that is not a customer, one document twice); the parts are changed in one step, a row with parts is not moved and its invoice is not voided, and a voided receipt settles nothing', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      const other = await createTestCustomer();
      const inv1 = await w.doc('invoice', w.customer, 1_000_000);
      const inv2 = await w.doc('invoice', w.customer, 2_000_000);
      const inv3 = await w.doc('invoice', w.customer, 3_000_000);
      const otherInv = await w.doc('invoice', other, 500_000);
      const [p1, p2, p3] = [(await w.state(inv1)).remaining, (await w.state(inv2)).remaining, (await w.state(inv3)).remaining];
      if (!(p1 > 0 && p2 > 0 && p3 > 0)) throw new Error(`setup: the invoices are not open (${p1}, ${p2}, ${p3})`);

      // 1) the open invoices of the customer, oldest first, with what is left on each; a reader of the books only is refused
      const options = await admin.get(`/api/documents/settlement-options?direction=receipt&partyType=customer&partyId=${w.customer.id}&currency=IRR`);
      const listed = Array.isArray(options.body?.data) ? (options.body.data as Array<{ id: number; remaining: number }>) : [];
      if (options.status !== 200) problems.push(`the open invoices returned ${brief(options)}, expected 200`);
      const order = listed.map(d => d.id).filter(id => [inv1, inv2, inv3, otherInv].includes(id));
      if (JSON.stringify(order) !== JSON.stringify([inv1, inv2, inv3])) problems.push(`the open invoices are ${JSON.stringify(order)}, expected ${JSON.stringify([inv1, inv2, inv3])} (oldest first, not the other customer's)`);
      if (listed.find(d => d.id === inv2)?.remaining !== p2) problems.push(`the list shows ${listed.find(d => d.id === inv2)?.remaining} left on the second invoice, expected ${p2}`);
      const viewer = await sandboxClientWith(['accounting.view']);
      const peek = await viewer.get(`/api/documents/settlement-options?direction=receipt&partyType=customer&partyId=${w.customer.id}&currency=IRR`);
      if (peek.status !== 403) problems.push(`a reader of the books only read the open invoices: ${brief(peek)}, expected 403`);

      // 2) a receipt on the first invoice in full and on the second in part
      const amount = p1 + 500_000;
      const created = await w.receipt(amount, { allocations: [{ documentId: inv1, amount: p1 }, { documentId: inv2, amount: 500_000 }] });
      const receiptId = Number(created.body?.id);
      if (created.status !== 201 || !receiptId) throw new Error(`a receipt with parts returned ${brief(created)}, expected 201`);
      const s1 = await w.state(inv1);
      const s2 = await w.state(inv2);
      if (s1.remaining !== 0 || s1.status !== 'fully_paid' || s1.paid !== p1) problems.push(`the first invoice shows paid ${s1.paid}, left ${s1.remaining}, ${s1.status}; expected paid in full`);
      if (s2.paid !== 500_000 || s2.remaining !== p2 - 500_000 || s2.status !== 'partially_paid') problems.push(`the second invoice shows paid ${s2.paid}, left ${s2.remaining}, ${s2.status}; expected 500000 paid`);
      if (s1.parts.length !== 1 || s1.parts[0]?.sourceId !== receiptId || s1.parts[0]?.source !== 'treasury') problems.push(`the first invoice lists the parts ${JSON.stringify(s1.parts)}, expected the receipt`);
      if ((await w.state(inv3)).paid !== 0) problems.push('the third invoice was settled without a part');
      const read = await admin.get(`/api/accounting/treasury/${receiptId}/allocations`);
      if (read.status !== 200 || read.body?.allocations?.length !== 2 || fin(read.body?.unallocated ?? -1).toNumber() !== 0) problems.push(`the receipt's parts read ${brief(read)}, expected two parts and nothing on account`);

      // 3) wrong parts are refused and nothing is saved
      const rowsBefore = await treasuryRows();
      const partsBefore = await liveParts();
      const refused = async (label: string, res: request.Response, status: number, code: string) => {
        if (res.status !== status || codeOf(res) !== code) problems.push(`${label} returned ${brief(res)}, expected ${status} ${code}`);
      };
      await refused('parts above the receipt', await w.receipt(400_000, { allocations: [{ documentId: inv2, amount: 300_000 }, { documentId: inv3, amount: 300_000 }] }), 422, 'SETTLEMENT_ALLOCATION_EXCEEDS_SOURCE');
      await refused('a part on a settled invoice', await w.receipt(1_000, { allocations: [{ documentId: inv1, amount: 1_000 }] }), 422, 'TREASURY_AMOUNT_EXCEEDS_DOCUMENT_REMAINING');
      await refused('a part above what the invoice has left', await w.receipt(p2, { allocations: [{ documentId: inv2, amount: p2 }] }), 422, 'TREASURY_AMOUNT_EXCEEDS_DOCUMENT_REMAINING');
      await refused('a part on another customer\'s invoice', await w.receipt(1_000, { allocations: [{ documentId: otherInv, amount: 1_000 }] }), 422, 'TREASURY_DOCUMENT_PARTY_MISMATCH');
      await refused('a direct link and parts', await w.receipt(2_000, { documentId: inv3, allocations: [{ documentId: inv2, amount: 1_000 }] }), 422, 'SETTLEMENT_ALLOCATION_WITH_DOCUMENT');
      await refused('a part of a receipt from a party that is not a customer', await w.receipt(1_000, {
        partyType: 'other', partyId: null, partyName: 'M11 other', contraAccountId: await miscContraAccountId(), allocations: [{ documentId: inv3, amount: 1_000 }],
      }), 422, 'SETTLEMENT_ALLOCATION_PARTY_INVALID');
      await refused('one invoice twice', await w.receipt(2_000, { allocations: [{ documentId: inv3, amount: 1_000 }, { documentId: inv3, amount: 1_000 }] }), 422, 'SETTLEMENT_ALLOCATION_INVALID');
      if (await treasuryRows() !== rowsBefore) problems.push('a refused receipt was saved');
      if (await liveParts() !== partsBefore) problems.push('a refused receipt saved parts');

      // 4) a row with parts is not moved to another document, and an invoice it settles is not voided
      await refused('moving a receipt with parts', await admin.put(`/api/accounting/treasury/${receiptId}/document`, { documentId: inv3 }), 409, 'TREASURY_ROW_HAS_ALLOCATIONS');
      await refused('voiding an invoice a receipt settles in part', await admin.del(`/api/documents/${inv2}`), 409, 'DOCUMENT_HAS_TREASURY_ROWS');

      // 5) the parts are replaced in one step: the first two invoices are open again and the third takes the receipt
      const replaced = await admin.put(`/api/accounting/treasury/${receiptId}/allocations`, { allocations: [{ documentId: inv3, amount }] });
      if (replaced.status !== 200) problems.push(`replacing the parts returned ${brief(replaced)}, expected 200`);
      const [r1, r2, r3] = [await w.state(inv1), await w.state(inv2), await w.state(inv3)];
      if (r1.paid !== 0 || r1.remaining !== p1) problems.push(`after the change the first invoice shows paid ${r1.paid}, left ${r1.remaining}; expected open again`);
      if (r2.paid !== 0 || r2.remaining !== p2) problems.push(`after the change the second invoice shows paid ${r2.paid}, left ${r2.remaining}; expected open again`);
      if (r3.paid !== amount) problems.push(`after the change the third invoice shows paid ${r3.paid}, expected ${amount}`);
      const released = await admin.del(`/api/documents/${inv2}`);
      if (!ok(released)) problems.push(`voiding the second invoice after its part was taken off returned ${brief(released)}, expected success`);

      // 6) a voided receipt settles nothing, and its parts are not changed any more
      const voided = await admin.post(`/api/accounting/treasury/${receiptId}/void`, { reason: VOID_REASON });
      if (!ok(voided)) problems.push(`voiding the receipt returned ${brief(voided)}, expected success`);
      const v3 = await w.state(inv3);
      if (v3.paid !== 0 || v3.remaining !== p3 || v3.parts.length !== 0) problems.push(`after the void the third invoice shows paid ${v3.paid}, left ${v3.remaining}, ${v3.parts.length} parts; expected open again`);
      await refused('new parts for a voided receipt', await admin.put(`/api/accounting/treasury/${receiptId}/allocations`, { allocations: [{ documentId: inv3, amount: 1_000 }] }), 409, 'SETTLEMENT_SOURCE_NOT_ALLOCATABLE');

      if (problems.length > 0) throw new Error(problems.join('; '));
      return 'oldest-first list; a receipt in parts settles two invoices; seven wrong parts refused with nothing saved; no move or invoice void with parts; parts replaced in one step; a voided receipt settles nothing';
    }));
  }

  const direct = 'reg_direct_link_and_returns_v11_6_1t_m11';
  if (shouldRun(direct, 'v11', 'phase6', 'm11', 'u2', 'treasury', 'documents', 'settlement', 'return')) {
    await runCase(results, direct, 'v11 phase 6.1t (M11 / U2): a receipt linked to one invoice is moved to parts in one step (its link is cleared and nothing is counted twice); what an invoice has left counts its final returns, for a part and for a direct link alike', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      const inv4 = await w.doc('invoice', w.customer, 1_000_000);
      const inv5 = await w.doc('invoice', w.customer, 1_000_000);
      const [p4, p5] = [(await w.state(inv4)).remaining, (await w.state(inv5)).remaining];

      // 1) a receipt linked to the fourth invoice is put on both invoices
      const linked = await w.receipt(600_000, { documentId: inv4 });
      const linkedId = Number(linked.body?.id);
      if (linked.status !== 201 || !linkedId) throw new Error(`setup: a linked receipt returned ${brief(linked)}`);
      const moved = await admin.put(`/api/accounting/treasury/${linkedId}/allocations`, { allocations: [{ documentId: inv4, amount: 400_000 }, { documentId: inv5, amount: 200_000 }] });
      if (moved.status !== 200) problems.push(`putting the linked receipt in parts returned ${brief(moved)}, expected 200`);
      const [row] = await orm.select({ documentId: treasuryTransactions.documentId }).from(treasuryTransactions).where(eq(treasuryTransactions.id, linkedId));
      if (row?.documentId !== null) problems.push(`the receipt keeps its direct link to ${row?.documentId} beside its parts`);
      const [s4, s5] = [await w.state(inv4), await w.state(inv5)];
      if (s4.paid !== 400_000 || s4.remaining !== p4 - 400_000) problems.push(`the fourth invoice shows paid ${s4.paid}, left ${s4.remaining}; expected 400000 paid, not counted twice`);
      if (s5.paid !== 200_000) problems.push(`the fifth invoice shows paid ${s5.paid}, expected 200000`);

      // 2) a final return of the fifth invoice lowers what it has left, and both a part and a direct link respect it
      await createTestDocument({ type: 'return', status: 'final', returnOfDocumentId: inv5, partyId: w.customer.id, buyerName: w.customer.name }, [{ itemId: w.item.id, quantity: 1, unitPrice: 300_000 }]);
      const left = (await w.state(inv5)).remaining;
      if (left !== p5 - 200_000 - 300_000) problems.push(`after the return the fifth invoice has ${left} left, expected ${p5 - 500_000}`);
      const listed = await admin.get(`/api/documents/settlement-options?direction=receipt&partyType=customer&partyId=${w.customer.id}&currency=IRR`);
      const shown = (listed.body?.data as Array<{ id: number; remaining: number }> | undefined)?.find(d => d.id === inv5)?.remaining;
      if (shown !== left) problems.push(`the open invoices show ${shown} left on the fifth invoice, expected ${left} as on its page`);
      const overPart = await w.receipt(left + 1, { allocations: [{ documentId: inv5, amount: left + 1 }] });
      if (overPart.status !== 422 || codeOf(overPart) !== 'TREASURY_AMOUNT_EXCEEDS_DOCUMENT_REMAINING') problems.push(`a part above what is left after the return returned ${brief(overPart)}, expected 422`);
      const overLink = await w.receipt(left + 1, { documentId: inv5 });
      if (overLink.status !== 422 || codeOf(overLink) !== 'TREASURY_AMOUNT_EXCEEDS_DOCUMENT_REMAINING') problems.push(`a direct link above what is left after the return returned ${brief(overLink)}, expected 422 (the return was not counted)`);
      const exact = await w.receipt(left, { allocations: [{ documentId: inv5, amount: left }] });
      if (exact.status !== 201) problems.push(`a part of exactly what is left returned ${brief(exact)}, expected 201`);
      const done = await w.state(inv5);
      if (done.remaining !== 0 || done.status !== 'fully_paid') problems.push(`the fifth invoice shows ${done.remaining} left, ${done.status}; expected settled`);

      if (problems.length > 0) throw new Error(problems.join('; '));
      return 'a linked receipt moved to parts with its link cleared and no double count; a final return lowers what is left for a part and a direct link alike';
    }));
  }

  const cheques = 'reg_cheque_settles_invoices_v11_6_1t_m11';
  if (shouldRun(cheques, 'v11', 'phase6', 'm11', 'u2', 'cheque', 'documents', 'settlement')) {
    await runCase(results, cheques, 'v11 phase 6.1t (M11 / U2): a cheque received from a customer settles its invoices from receipt (the cheque list shows the amount on invoices) until it bounces, and a bounced cheque takes no new parts; a paid cheque settles a supplier\'s purchase receipt; parts are put on a recorded cheque later and taken off again', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      const invA = await w.doc('invoice', w.customer, 1_500_000);
      const invB = await w.doc('invoice', w.customer, 700_000);
      const purchase = await w.doc('receipt', w.supplier, 900_000);
      const [pA, pB, pP] = [(await w.state(invA)).remaining, (await w.state(invB)).remaining, (await w.state(purchase)).remaining];

      // 1) a received cheque on the first invoice
      const received = await w.cheque('received', pA, { allocations: [{ documentId: invA, amount: pA }] });
      const chequeId = Number(received.body?.id);
      if (!ok(received) || !chequeId) throw new Error(`a received cheque with a part returned ${brief(received)}, expected 201`);
      const a1 = await w.state(invA);
      if (a1.remaining !== 0 || a1.parts[0]?.source !== 'cheque') problems.push(`the invoice shows ${a1.remaining} left with parts ${JSON.stringify(a1.parts)}; expected settled by the cheque`);
      const listedCheques = await admin.get('/api/accounting/cheques?type=all');
      const listedRow = (Array.isArray(listedCheques.body) ? listedCheques.body : listedCheques.body?.data ?? []).find((c: { id: number }) => Number(c.id) === chequeId);
      if (fin(listedRow?.allocatedAmount ?? 0).toNumber() !== pA) problems.push(`the cheque list shows ${listedRow?.allocatedAmount} on invoices, expected ${pA}`);

      // 2) the cheque bounces: the invoice is open again, and the cheque takes no new parts
      const bounced = await adminPatch(`/api/accounting/cheques/${chequeId}/status`, { status: 'bounced', actionDate: w.today });
      if (!ok(bounced)) problems.push(`bouncing the cheque returned ${brief(bounced)}, expected success`);
      const a2 = await w.state(invA);
      if (a2.remaining !== pA || a2.paid !== 0) problems.push(`after the bounce the invoice shows paid ${a2.paid}, left ${a2.remaining}; expected open again`);
      const late = await admin.put(`/api/accounting/cheques/${chequeId}/allocations`, { allocations: [{ documentId: invB, amount: 1_000 }] });
      if (late.status !== 409 || codeOf(late) !== 'SETTLEMENT_SOURCE_NOT_ALLOCATABLE') problems.push(`new parts for a bounced cheque returned ${brief(late)}, expected 409`);

      // 3) a paid cheque settles the supplier's purchase receipt
      const paid = await w.cheque('paid', pP, { allocations: [{ documentId: purchase, amount: pP }] });
      if (!ok(paid)) problems.push(`a paid cheque with a part returned ${brief(paid)}, expected 201`);
      else if ((await w.state(purchase)).remaining !== 0) problems.push('the purchase receipt is not settled by the paid cheque');
      const wrongSide = await w.cheque('paid', 1_000, { allocations: [{ documentId: invB, amount: 1_000 }] });
      if (wrongSide.status !== 422) problems.push(`a paid cheque put on a sales invoice returned ${brief(wrongSide)}, expected 422`);

      // 4) a cheque recorded on account is put on an invoice later, then taken off
      const plain = await w.cheque('received', pB);
      const plainId = Number(plain.body?.id);
      if (!ok(plain) || !plainId) throw new Error(`setup: a received cheque on account returned ${brief(plain)}`);
      const later = await admin.put(`/api/accounting/cheques/${plainId}/allocations`, { allocations: [{ documentId: invB, amount: pB }] });
      if (later.status !== 200 || (await w.state(invB)).remaining !== 0) problems.push(`putting a recorded cheque on an invoice returned ${brief(later)}; expected the invoice settled`);
      const off = await admin.put(`/api/accounting/cheques/${plainId}/allocations`, { allocations: [] });
      if (off.status !== 200 || (await w.state(invB)).remaining !== pB) problems.push(`taking the cheque off the invoice returned ${brief(off)}; expected the invoice open again`);

      if (problems.length > 0) throw new Error(problems.join('; '));
      return 'a received cheque settles until it bounces; a bounced cheque takes no parts; a paid cheque settles a purchase; a cheque is put on an invoice later and taken off';
    }));
  }

  const race = 'reg_settlement_parts_race_v11_6_1t_m11';
  if (shouldRun(race, 'v11', 'phase6', 'm11', 'u2', 'treasury', 'settlement', 'concurrency')) {
    await runCase(results, race, 'v11 phase 6.1t (M11 / U2): two receipts that each put the whole of what an invoice has left on it at the same moment, as parts or as a part and a direct link, never settle it twice: one is recorded and the other refused', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      // the second receipt goes to another bank, so the bank's own lock does not line the two up
      const otherBank = await fundedBank();
      for (const [label, second] of [['two parts', 'parts'], ['a part and a direct link', 'link']] as const) {
        const inv = await w.doc('invoice', w.customer, 800_000);
        const left = (await w.state(inv)).remaining;
        const before = await treasuryRows();
        const answers = await Promise.all([
          w.receipt(left, { allocations: [{ documentId: inv, amount: left }] }),
          second === 'parts'
            ? w.receipt(left, { bankAccountId: otherBank, allocations: [{ documentId: inv, amount: left }] })
            : w.receipt(left, { bankAccountId: otherBank, documentId: inv }),
        ]);
        const recorded = answers.filter(r => r.status === 201).length;
        const refusedOnes = answers.filter(r => r.status === 422 && codeOf(r) === 'TREASURY_AMOUNT_EXCEEDS_DOCUMENT_REMAINING').length;
        if (recorded !== 1 || refusedOnes !== 1) problems.push(`${label}: the answers were ${answers.map(brief).join(' | ')}, expected one 201 and one 422`);
        const s = await w.state(inv);
        if (s.paid !== left || s.remaining !== 0) problems.push(`${label}: the invoice shows paid ${s.paid}, left ${s.remaining}; expected settled once`);
        if (await treasuryRows() !== before + 1) problems.push(`${label}: ${await treasuryRows() - before} receipts were saved, expected 1`);
      }
      if (problems.length > 0) throw new Error(problems.join('; '));
      return 'concurrent receipts on one invoice: one recorded, one refused, for two parts and for a part beside a direct link';
    }));
  }

  const drafts = 'reg_party_card_drafts_v11_6_1t_u1';
  if (shouldRun(drafts, 'v11', 'phase6', 'u1', 'customers', 'reports', 'account_card', 'draft')) {
    await runCase(results, drafts, 'v11 phase 6.1t (U1): while the vouchers of an invoice and a receipt are drafts, the customer\'s card and statement list them apart with the balance they make (the customer owes the invoice less the receipt), also when only the receipt is approved; the statement that counts drafts in its rows gives the same balance and no separate list', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      const inv = await w.doc('invoice', w.customer, 1_700_000);
      const payable = (await w.state(inv)).remaining;
      const paid = await w.receipt(200_000, { documentId: inv });
      const receiptId = Number(paid.body?.id);
      if (paid.status !== 201 || !receiptId) throw new Error(`setup: a receipt returned ${brief(paid)}`);
      const [docRow] = await orm.select({ voucherId: journalVouchers.id }).from(journalVouchers)
        .where(and(eq(journalVouchers.referenceId, inv), inArray(journalVouchers.referenceModule, ['invoice', 'document']), eq(journalVouchers.isDeleted, 0)));
      const [rowOf] = await orm.select({ voucherId: treasuryTransactions.voucherId }).from(treasuryTransactions).where(eq(treasuryTransactions.id, receiptId));
      const statusOf = async (id: number | null | undefined) => id ? (await orm.select({ s: journalVouchers.status }).from(journalVouchers).where(eq(journalVouchers.id, id)))[0]?.s : undefined;
      if (await statusOf(docRow?.voucherId) !== 'draft' || await statusOf(rowOf?.voucherId) !== 'draft') throw new Error('setup: the automatic vouchers are not drafts');
      const expected = payable - 200_000;

      type Card = { items?: unknown[]; finalBalance?: number; draftRows?: { items: unknown[]; voucherCount: number; balanceWithDrafts: number } };
      const card = async () => (await admin.get(`/api/customers/${w.customer.id}/account-card`)).body as Card;
      const statement = async (includeDrafts = false) => (await admin.get(`/api/accounting/reports/party-ledger?partyId=${w.customer.id}&partyType=customer${includeDrafts ? '&includeDrafts=true' : ''}`)).body as Card;

      // 1) both vouchers are drafts: no approved row, two draft vouchers, the customer owes the invoice less the receipt
      const c1 = await card();
      if ((c1.items?.length ?? 0) !== 0 || fin(c1.finalBalance ?? 0).toNumber() !== 0) problems.push(`with drafts only the card shows ${c1.items?.length} approved rows and balance ${c1.finalBalance}, expected none`);
      if (c1.draftRows?.voucherCount !== 2 || fin(c1.draftRows?.balanceWithDrafts ?? 0).toNumber() !== expected) problems.push(`the card's drafts are ${JSON.stringify({ n: c1.draftRows?.voucherCount, b: c1.draftRows?.balanceWithDrafts })}, expected 2 vouchers and ${expected} owed`);

      // 2) only the receipt is approved: the approved balance is a credit, the balance with drafts is still the debt
      await orm.update(journalVouchers).set({ status: 'approved' }).where(eq(journalVouchers.id, Number(rowOf?.voucherId)));
      const c2 = await card();
      if (fin(c2.finalBalance ?? 0).toNumber() !== -200_000) problems.push(`with the receipt approved the card's approved balance is ${c2.finalBalance}, expected -200000`);
      if (c2.draftRows?.voucherCount !== 1 || fin(c2.draftRows?.balanceWithDrafts ?? 0).toNumber() !== expected) problems.push(`with the receipt approved the card's drafts are ${JSON.stringify({ n: c2.draftRows?.voucherCount, b: c2.draftRows?.balanceWithDrafts })}, expected 1 voucher and ${expected} owed`);

      // 3) the statement reads the same rule, and the statement that counts drafts in its rows lists none apart
      const s1 = await statement();
      if (fin(s1.finalBalance ?? 0).toNumber() !== -200_000 || fin(s1.draftRows?.balanceWithDrafts ?? 0).toNumber() !== expected) problems.push(`the statement shows ${s1.finalBalance} approved and ${s1.draftRows?.balanceWithDrafts} with drafts, expected -200000 and ${expected}`);
      const s2 = await statement(true);
      if (fin(s2.finalBalance ?? 0).toNumber() !== expected || s2.draftRows !== undefined) problems.push(`the statement with drafts shows ${s2.finalBalance} and a draft list ${JSON.stringify(s2.draftRows)?.slice(0, 80)}, expected ${expected} and none`);

      if (problems.length > 0) throw new Error(problems.join('; '));
      return 'drafts listed apart on the card and the statement with the balance they make; only the receipt approved still shows the debt with drafts; one rule with the statement that counts drafts';
    }));
  }

  const guards = 'reg_settlement_review_guards_v11_6_1t_m11';
  if (shouldRun(guards, 'v11', 'phase6', 'm11', 'treasury', 'cheques', 'documents', 'settlement', 'review')) {
    await runCase(results, guards, 'v11 phase 6.1t (review of M11): a draft is neither listed nor settled in parts; a proforma or draft a receipt settles keeps its party, currency and cover when edited; a bounced cheque shows nothing on invoices; a cheque without a status still settles; the open invoices follow the reader\'s document scope', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      const other = await createTestCustomer();
      const draft = await w.doc('invoice', w.customer, 1_000_000, 'draft');
      const proforma = await w.doc('invoice', w.customer, 1_000_000, 'proforma');
      const finalInv = await w.doc('invoice', w.customer, 400_000);
      const legacyInv = await w.doc('invoice', w.customer, 300_000);
      const line = (price: number) => [{ itemId: w.item.id, quantity: 1, unit_price: price, location: w.main }];

      // 1) a draft is not offered and takes no part; the proforma is offered
      const options = await admin.get(`/api/documents/settlement-options?direction=receipt&partyType=customer&partyId=${w.customer.id}&currency=IRR`);
      const listedIds = (Array.isArray(options.body?.data) ? options.body.data as Array<{ id: number }> : []).map(d => d.id);
      if (listedIds.includes(draft) || !listedIds.includes(proforma)) problems.push(`the open invoices are ${JSON.stringify(listedIds)}: expected the proforma ${proforma} and not the draft ${draft}`);
      const rowsBefore = await treasuryRows();
      const onDraft = await w.receipt(500_000, { allocations: [{ documentId: draft, amount: 500_000 }] });
      if (onDraft.status !== 422 || codeOf(onDraft) !== 'SETTLEMENT_DOCUMENT_NOT_ISSUED') problems.push(`a part on a draft returned ${brief(onDraft)}, expected 422 SETTLEMENT_DOCUMENT_NOT_ISSUED`);
      if (await treasuryRows() !== rowsBefore) problems.push('the refused receipt on a draft was saved');

      // 2) a proforma settled in part keeps its party, currency and cover
      const advance = await w.receipt(600_000, { allocations: [{ documentId: proforma, amount: 600_000 }] });
      if (advance.status !== 201) throw new Error(`setup: an advance on the proforma returned ${brief(advance)}`);
      const locked = async (label: string, res: request.Response, code: string) => {
        if (res.status !== 409 || codeOf(res) !== code) problems.push(`${label} returned ${brief(res)}, expected 409 ${code}`);
      };
      await locked('moving the settled proforma to another customer', await w.editDoc(proforma, { partyId: other.id, buyer_name: other.name, items: line(1_000_000) }), 'SETTLED_DOCUMENT_IDENTITY_LOCKED');
      await locked('turning the settled proforma into dollars', await w.editDoc(proforma, { currency: 'USD', exchangeRate: 500_000, items: line(100) }), 'SETTLED_DOCUMENT_IDENTITY_LOCKED');
      await locked('pricing the settled proforma below its advance', await w.editDoc(proforma, { items: line(100_000) }), 'SETTLED_DOCUMENT_BELOW_SETTLED');
      const kept = await w.editDoc(proforma, { items: line(800_000) });
      if (kept.status !== 200) problems.push(`an edit that still covers the advance returned ${brief(kept)}, expected 200`);
      const pf = await w.state(proforma);
      if (pf.paid !== 600_000 || pf.remaining !== 200_000) problems.push(`the proforma shows paid ${pf.paid}, left ${pf.remaining}; expected 600000 and 200000`);

      // 3) a draft linked directly (an old link: since v11 phase 7.2 a new direct link goes only to an issued document) keeps its party too
      const direct = await w.receipt(300_000);
      if (direct.status !== 201) problems.push(`a receipt on account returned ${brief(direct)}, expected 201`);
      else {
        await orm.update(treasuryTransactions).set({ documentId: draft }).where(eq(treasuryTransactions.id, Number(direct.body?.id)));
        await locked('moving the directly settled draft to another customer', await w.editDoc(draft, { partyId: other.id, buyer_name: other.name, items: line(1_000_000) }), 'SETTLED_DOCUMENT_IDENTITY_LOCKED');
      }

      // 4) a bounced cheque shows nothing on invoices, in the list and in its window
      const chequeRes = await w.cheque('received', 400_000, { allocations: [{ documentId: finalInv, amount: 400_000 }] });
      const chequeId = Number(chequeRes.body?.id);
      if (!ok(chequeRes) || !chequeId) throw new Error(`setup: a cheque with a part returned ${brief(chequeRes)}`);
      const bounced = await adminPatch(`/api/accounting/cheques/${chequeId}/status`, { status: 'bounced', actionDate: w.today });
      if (!ok(bounced)) problems.push(`bouncing the cheque returned ${brief(bounced)}`);
      const list = await admin.get('/api/accounting/cheques?type=all');
      const row = (Array.isArray(list.body) ? list.body : list.body?.data ?? []).find((c: { id: number }) => Number(c.id) === chequeId);
      if (fin(row?.allocatedAmount ?? -1).toNumber() !== 0) problems.push(`the bounced cheque shows ${row?.allocatedAmount} on invoices in the list, expected 0`);
      const window = await admin.get(`/api/accounting/cheques/${chequeId}/allocations`);
      if (window.status !== 200 || (window.body?.allocations?.length ?? -1) !== 0) problems.push(`the bounced cheque's window reads ${brief(window)}, expected no parts`);

      // 5) a cheque without a status (an imported row) still settles its invoice
      const legacy = await w.cheque('received', 300_000, { allocations: [{ documentId: legacyInv, amount: 300_000 }] });
      const legacyId = Number(legacy.body?.id);
      if (!ok(legacy) || !legacyId) throw new Error(`setup: a cheque on the second invoice returned ${brief(legacy)}`);
      await orm.execute(sql`UPDATE cheques SET status = NULL WHERE id = ${legacyId}`);
      const lg = await w.state(legacyInv);
      if (lg.paid !== 300_000 || lg.remaining !== 0) problems.push(`the invoice of a cheque without a status shows paid ${lg.paid}, left ${lg.remaining}; expected settled`);
      const twice = await w.receipt(300_000, { allocations: [{ documentId: legacyInv, amount: 300_000 }] });
      if (twice.status !== 422) problems.push(`a second settlement of that invoice returned ${brief(twice)}, expected 422`);

      // 6) a holder of the cheque book without the documents section is offered no invoice
      const clerk = await sandboxClientWith(['accounting.cheques']);
      const peek = await clerk.get(`/api/documents/settlement-options?direction=receipt&partyType=customer&partyId=${w.customer.id}&currency=IRR`);
      if (peek.status !== 200 || (peek.body?.data?.length ?? -1) !== 0) problems.push(`the cheque clerk without documents read ${brief(peek)}, expected 200 and no document`);

      if (problems.length > 0) throw new Error(problems.join('; '));
      return 'drafts left out of parts; a settled proforma or draft keeps party, currency and cover; a bounced cheque shows nothing; a cheque without status settles; open invoices follow the document scope';
    }));
  }

  return results;
}
