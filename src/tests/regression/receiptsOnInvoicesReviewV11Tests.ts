import request from 'supertest';
import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { treasuryTransactions } from '../../db/schema.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';
import { BANK_NAME, brief, codeOf, ok, tagOf, world } from './receiptsOnInvoicesV11Tests.js';

/**
 * v11 phase 6.1t (second review of M11): the finalize of a settled proforma, the documents section a receipt or cheque
 * needs to settle invoices, the part a draft keeps, and the exact remaining of a part. Real Express routes and services on
 * PostgreSQL, in its own schema, with the world of `receiptsOnInvoicesV11Tests.ts`.
 */
export async function runReceiptsOnInvoicesReviewV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const review2 = 'reg_settlement_second_review_v11_6_1t_m11';
  if (shouldRun(review2, 'v11', 'phase6', 'm11', 'treasury', 'cheques', 'documents', 'settlement', 'review')) {
    await runCase(results, review2, 'v11 phase 6.1t (second review of M11): the VAT sent with a finalize does not drop a settled proforma below what settles it; putting a receipt or cheque on invoices needs the documents section; a draft a receipt already settles keeps its part or a smaller one but no larger; a part above what an invoice has left by less than 0.01 is refused', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      const line = (price: number) => [{ itemId: w.item.id, quantity: 1, unit_price: price, location: w.main }];
      const refusedWith = (label: string, res: request.Response, status: number, code: string) => {
        if (res.status !== status || codeOf(res) !== code) problems.push(`${label} returned ${brief(res)}, expected ${status} ${code}`);
      };

      // 1) a proforma with 10% VAT settled in full keeps its VAT at finalize; finalizing as it is settles the invoice
      const proforma = await w.doc('invoice', w.customer, 1_000_000, 'proforma', { vatPercent: 10 });
      const payable = (await w.state(proforma)).remaining;
      if (payable !== 1_100_000) throw new Error(`setup: the proforma has ${payable} left, expected 1100000 with its VAT`);
      const advance = await w.receipt(payable, { allocations: [{ documentId: proforma, amount: payable }] });
      if (advance.status !== 201) throw new Error(`setup: a receipt on the proforma returned ${brief(advance)}`);
      refusedWith('finalizing the settled proforma without VAT', await admin.put(`/api/documents/${proforma}/finalize`, { vatPercent: 0 }), 409, 'SETTLED_DOCUMENT_BELOW_SETTLED');
      refusedWith('finalizing the settled proforma with a VAT of zero', await admin.put(`/api/documents/${proforma}/finalize`, { vatAmount: 0 }), 409, 'SETTLED_DOCUMENT_BELOW_SETTLED');
      const stillProforma = (await admin.get(`/api/documents/${proforma}`)).body?.status;
      if (stillProforma !== 'proforma') problems.push(`a refused finalize left the document ${stillProforma}, expected a proforma`);
      const finalized = await admin.put(`/api/documents/${proforma}/finalize`, {});
      if (!ok(finalized)) problems.push(`finalizing the settled proforma with its VAT returned ${brief(finalized)}, expected success`);
      const fz = await w.state(proforma);
      if (fz.paid !== payable || fz.remaining !== 0 || fz.status !== 'fully_paid') problems.push(`the finalized invoice shows paid ${fz.paid}, left ${fz.remaining}, ${fz.status}; expected settled`);

      // 2) a cheque clerk or treasurer without the documents section puts nothing on invoices, and reads no parts
      const inv = await w.doc('invoice', w.customer, 1_000_000);
      const left = (await w.state(inv)).remaining;
      const clerk = await sandboxClientWith(['accounting.cheques']);
      const clerkCheque = (extra: Record<string, unknown>) => clerk.post('/api/accounting/cheques', {
        type: 'received', chequeNumber: `M11c${tagOf()}`, amount: 400_000, bankName: BANK_NAME, issueDate: w.today, dueDate: w.today,
        partyType: 'customer', partyId: w.customer.id, partyName: w.customer.name, ...extra,
      });
      refusedWith('a cheque clerk putting a new cheque on an invoice', await clerkCheque({ allocations: [{ documentId: inv, amount: 400_000 }] }), 403, 'SETTLEMENT_DOCUMENTS_NOT_READABLE');
      const plain = await clerkCheque({});
      const plainId = Number(plain.body?.id);
      if (!ok(plain) || !plainId) problems.push(`a cheque clerk recording a cheque on account returned ${brief(plain)}, expected success`);
      else {
        refusedWith('a cheque clerk reading a cheque\'s parts', await clerk.get(`/api/accounting/cheques/${plainId}/allocations`), 403, 'SETTLEMENT_DOCUMENTS_NOT_READABLE');
        refusedWith('a cheque clerk putting a recorded cheque on an invoice', await clerk.put(`/api/accounting/cheques/${plainId}/allocations`, { allocations: [{ documentId: inv, amount: 400_000 }] }), 403, 'SETTLEMENT_DOCUMENTS_NOT_READABLE');
      }
      const treasurer = await sandboxClientWith(['accounting.treasury']);
      refusedWith('a treasurer without documents putting a receipt on an invoice', await treasurer.post('/api/accounting/treasury', {
        type: 'receipt', method: 'bank_transfer', bankAccountId: w.bank, amount: 400_000, date: w.today,
        partyType: 'customer', partyId: w.customer.id, partyName: w.customer.name, allocations: [{ documentId: inv, amount: 400_000 }],
      }), 403, 'SETTLEMENT_DOCUMENTS_NOT_READABLE');
      const untouched = await w.state(inv);
      if (untouched.paid !== 0) problems.push(`the invoice shows paid ${untouched.paid} after refused parts, expected 0`);

      // 3) a part above what is left by less than 0.01 is refused; the exact amount is taken
      refusedWith('a part 0.0099 above what is left', await w.receipt(left + 0.0099, { allocations: [{ documentId: inv, amount: left + 0.0099 }] }), 422, 'TREASURY_AMOUNT_EXCEEDS_DOCUMENT_REMAINING');
      const exact = await w.receipt(left, { allocations: [{ documentId: inv, amount: left }] });
      if (exact.status !== 201) problems.push(`a part of exactly what is left returned ${brief(exact)}, expected 201`);
      const ex = await w.state(inv);
      if (ex.paid !== left || ex.remaining !== 0) problems.push(`the invoice shows paid ${ex.paid}, left ${ex.remaining}; expected exactly settled`);

      // 4) a proforma sent back to draft keeps its part: the window lists it, saves it unchanged or lower, not higher
      const back = await w.doc('invoice', w.customer, 1_000_000, 'proforma');
      const part = await w.receipt(500_000, { allocations: [{ documentId: back, amount: 500_000 }] });
      const partId = Number(part.body?.id);
      if (part.status !== 201 || !partId) throw new Error(`setup: a receipt on the second proforma returned ${brief(part)}`);
      const toDraft = await w.editDoc(back, { status: 'draft', items: line(1_000_000) });
      if (!ok(toDraft)) throw new Error(`setup: sending the proforma back to draft returned ${brief(toDraft)}`);
      const listed = await admin.get(`/api/documents/settlement-options?treasuryId=${partId}`);
      const row = (Array.isArray(listed.body?.data) ? listed.body.data as Array<{ id: number; status: string; allocatedHere: number }> : []).find(d => d.id === back);
      if (row?.status !== 'draft' || row?.allocatedHere !== 500_000) problems.push(`the receipt's window lists the draft as ${JSON.stringify(row)}, expected a draft with 500000 here`);
      const same = await admin.put(`/api/accounting/treasury/${partId}/allocations`, { allocations: [{ documentId: back, amount: 500_000 }] });
      if (same.status !== 200) problems.push(`saving the window's own set on the draft returned ${brief(same)}, expected 200`);
      const lower = await admin.put(`/api/accounting/treasury/${partId}/allocations`, { allocations: [{ documentId: back, amount: 300_000 }] });
      if (lower.status !== 200) problems.push(`lowering the part on the draft returned ${brief(lower)}, expected 200`);
      refusedWith('raising the part on the draft', await admin.put(`/api/accounting/treasury/${partId}/allocations`, { allocations: [{ documentId: back, amount: 400_000 }] }), 422, 'SETTLEMENT_DOCUMENT_NOT_ISSUED');
      const bk = await w.state(back);
      if (bk.paid !== 300_000) problems.push(`the draft shows paid ${bk.paid}, expected 300000`);

      // 5) a receipt linked directly to a draft saves the same amount as a part, and its link is cleared
      const draft = await w.doc('invoice', w.customer, 1_000_000, 'draft');
      // an old direct link: since v11 phase 7.2 a new direct link goes only to an issued document
      const linked = await w.receipt(200_000);
      const linkedId = Number(linked.body?.id);
      if (linked.status !== 201 || !linkedId) throw new Error(`setup: a receipt on account returned ${brief(linked)}`);
      await orm.update(treasuryTransactions).set({ documentId: draft }).where(eq(treasuryTransactions.id, linkedId));
      const moved = await admin.put(`/api/accounting/treasury/${linkedId}/allocations`, { allocations: [{ documentId: draft, amount: 200_000 }] });
      if (moved.status !== 200) problems.push(`saving a draft's direct link as a part returned ${brief(moved)}, expected 200`);
      const [linkRow] = await orm.select({ documentId: treasuryTransactions.documentId }).from(treasuryTransactions).where(eq(treasuryTransactions.id, linkedId));
      if (linkRow?.documentId !== null) problems.push(`the receipt keeps its direct link to ${linkRow?.documentId} beside its part`);
      const dr = await w.state(draft);
      if (dr.paid !== 200_000) problems.push(`the draft shows paid ${dr.paid}, expected 200000 counted once`);

      if (problems.length > 0) throw new Error(problems.join('; '));
      return 'finalize keeps a settled proforma covered; no parts without the documents section; a draft keeps or lowers its part; no 0.01 slack on a part';
    }));
  }

  return results;
}
