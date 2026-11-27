import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, customers, documents, journalVoucherItems, journalVouchers } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { VoucherSyncService } from '../../services/accounting/voucherSync.service.js';
import { createTestCustomer } from '../fixtures/factories.js';
import { newWorker } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';
import { brief, codeOf, ok, world } from './receiptsOnInvoicesV11Tests.js';

/**
 * v12 colleague and partner sales (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md, part A): a party linked to a colleague
 * or partner of the personnel has its final sales invoices on that person's running account (3208 or 4101, personnel
 * detail) and settled from it at once; a return credits the same account and lowers the settlement; a void takes it back.
 * Real Express routes and services on PostgreSQL, each scenario in its own schema. Red before migration 0038: the party
 * took no link and every invoice debited trade receivables and stood unpaid.
 */

type Admin = Awaited<ReturnType<typeof sandboxAdminClient>>;
type Res = request.Response;

/** The live voucher rows of a document's voucher, with their account codes */
async function voucherRows(documentId: number) {
  return orm.select({
    code: accounts.code, detailedType: journalVoucherItems.detailedType, detailedId: journalVoucherItems.detailedId,
    debit: journalVoucherItems.debit, credit: journalVoucherItems.credit, status: journalVouchers.status,
  }).from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .innerJoin(accounts, eq(accounts.id, journalVoucherItems.accountId))
    .where(and(eq(journalVouchers.sourceDocumentId, documentId), eq(journalVouchers.isDeleted, 0), eq(journalVoucherItems.isDeleted, 0)));
}

const liveRunningPart = async (documentId: number) => {
  const rows = (await orm.execute(sql`SELECT amount::text AS amount, running_account_personnel_id AS pid FROM settlement_allocations
    WHERE document_id = ${documentId} AND is_deleted = 0 AND running_account_personnel_id IS NOT NULL`)).rows as Array<{ amount: string; pid: number }>;
  return rows;
};

async function linkParty(admin: Admin, partyId: number, personnelId: number | null, runningAccount: '' | 'colleague' | 'partner'): Promise<Res> {
  const [row] = await orm.select({ version: customers.version }).from(customers).where(eq(customers.id, partyId));
  return admin.put(`/api/customers/${partyId}`, { version: row?.version, personnelId, runningAccount });
}

export async function runColleagueSalesV12Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const flow = 'reg_colleague_sales_invoice_v12';
  if (shouldRun(flow, 'v12', 'colleague_sales', 'documents', 'accounting', 'settlement')) {
    await runCase(results, flow, 'v12 colleague sales: a final invoice of a party linked to a colleague debits the colleague running account (3208) on the colleague\'s personnel detail, not 1201, and is settled from the running account (paid, nothing left); a partner\'s goes to 4101; a return credits the same account and lowers the settlement; voiding the return gives it back; voiding the invoice drops it; an ordinary party still goes to 1201', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      const colleague = await newWorker('همکار آزمون فروش');
      const partner = await newWorker('شریک آزمون فروش');
      const colleagueParty = await createTestCustomer();
      const partnerParty = await createTestCustomer();
      for (const [party, person, kind] of [[colleagueParty, colleague, 'colleague'], [partnerParty, partner, 'partner']] as const) {
        const linked = await linkParty(admin, party.id, person, kind);
        if (!ok(linked)) throw new Error(`setup: linking the party answered ${brief(linked)}`);
      }

      // stock in the ledger (a purchase receipt), so the return's void has later history to stand on
      for (let i = 0; i < 4; i++) await w.doc('receipt', w.supplier, 900_000);
      const invoice = await w.doc('invoice', colleagueParty, 1_000_000);
      const rows = await voucherRows(invoice);
      const debit = rows.find(r => fin(r.debit).isPositive() && (r.code === '3208' || r.code === '1201'));
      if (debit?.code !== '3208' || debit.detailedType !== 'personnel' || debit.detailedId !== colleague) problems.push(`the colleague's invoice debits ${JSON.stringify(debit)}, expected 3208 on personnel ${colleague}`);
      if (rows.some(r => r.code === '1201')) problems.push(`the colleague's invoice still touches 1201: ${JSON.stringify(rows)}`);
      const [stamp] = await orm.select({ kind: documents.runningAccount, pid: documents.runningAccountPersonnelId }).from(documents).where(eq(documents.id, invoice));
      if (stamp?.kind !== 'colleague' || stamp.pid !== colleague) problems.push(`the invoice is stamped ${JSON.stringify(stamp)}, expected colleague ${colleague}`);
      const state = await w.state(invoice);
      if (state.remaining !== 0 || !state.parts.some(p => p.source === 'running_account')) problems.push(`the colleague's invoice reads ${JSON.stringify(state)}, expected nothing left and a running-account settlement part`);
      const payable = state.paid;

      // a return of part of it credits 3208 on the colleague and lowers the settlement to what is still owed
      const ret = await admin.post('/api/documents', {
        docType: 'return', status: 'final', refNumber: 'auto', date: w.today, location: w.main, buyer_name: colleagueParty.name, partyId: colleagueParty.id,
        inOut: 'in', returnOfDocumentId: invoice, items: [{ itemId: w.item.id, quantity: 1, unit_price: 1_000_000 }],
      });
      const retId = Number(ret.body?.docId);
      if (!ok(ret) || !retId) problems.push(`the return answered ${brief(ret)}`);
      else {
        const credit = (await voucherRows(retId)).find(r => fin(r.credit).isPositive() && ['3208', '1201'].includes(String(r.code)));
        if (credit?.code !== '3208' || credit.detailedId !== colleague) problems.push(`the return credits ${JSON.stringify(credit)}, expected 3208 on personnel ${colleague}`);
        const afterReturn = await liveRunningPart(invoice);
        if (afterReturn.length !== 0) problems.push(`after a return of the whole invoice the settlement reads ${JSON.stringify(afterReturn)}, expected none left`);
        if ((await w.state(invoice)).remaining !== 0) problems.push(`after the return the invoice has ${(await w.state(invoice)).remaining} left, expected 0`);
        const voidRet = await admin.del(`/api/documents/${retId}`);
        if (!ok(voidRet)) problems.push(`voiding the return answered ${brief(voidRet)}`);
        const back = await liveRunningPart(invoice);
        if (back.length !== 1 || !fin(back[0].amount).equals(payable)) problems.push(`after voiding the return the settlement reads ${JSON.stringify(back)}, expected ${payable} again`);
      }

      const partnerInvoice = await w.doc('invoice', partnerParty, 700_000);
      const partnerDebit = (await voucherRows(partnerInvoice)).find(r => fin(r.debit).isPositive() && ['4101', '3208', '1201'].includes(String(r.code)));
      if (partnerDebit?.code !== '4101' || partnerDebit.detailedId !== partner) problems.push(`the partner's invoice debits ${JSON.stringify(partnerDebit)}, expected 4101 on personnel ${partner}`);

      const voided = await admin.del(`/api/documents/${invoice}`);
      if (!ok(voided)) problems.push(`voiding the colleague's invoice answered ${brief(voided)}, expected it voided with its settlement`);
      else if ((await liveRunningPart(invoice)).length !== 0) problems.push('the voided invoice kept its running-account settlement');

      const plain = await w.doc('invoice', w.customer, 400_000);
      const plainDebit = (await voucherRows(plain)).find(r => fin(r.debit).isPositive() && ['3208', '1201'].includes(String(r.code)));
      if (plainDebit?.code !== '1201' || (await w.state(plain)).remaining <= 0 || (await liveRunningPart(plain)).length !== 0) problems.push(`an ordinary party's invoice debits ${JSON.stringify(plainDebit)} with ${(await w.state(plain)).remaining} left, expected 1201 and open`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'colleague and partner invoices go to 3208 and 4101 and are settled from the running account; returns and voids follow';
    }));
  }

  const rules = 'reg_colleague_sales_rules_v12';
  if (shouldRun(rules, 'v12', 'colleague_sales', 'documents', 'customers')) {
    await runCase(results, rules, 'v12 colleague sales: a colleague has one linked party (409), a supplier takes no link (422), a link needs both the colleague and the account (422); an invoice issued before the link stays on 1201 even when its voucher is written again; a linked party\'s invoice in another currency is refused (422); a proforma with a receipt on it is not finalized onto the running account (409)', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      const colleague = await newWorker('همکار آزمون قاعده فروش');
      const party = await createTestCustomer();
      const second = await createTestCustomer();

      // an invoice issued before the link
      const before = await w.doc('invoice', party, 300_000);
      const linked = await linkParty(admin, party.id, colleague, 'colleague');
      if (!ok(linked)) throw new Error(`setup: linking answered ${brief(linked)}`);
      await orm.transaction(tx => VoucherSyncService.syncSalesInvoiceVoucher(before, { username: 'inv' }, tx));
      const beforeDebit = (await voucherRows(before)).find(r => fin(r.debit).isPositive() && ['3208', '1201'].includes(String(r.code)));
      if (beforeDebit?.code !== '1201') problems.push(`an invoice issued before the link debits ${JSON.stringify(beforeDebit)} after its voucher is written again, expected 1201`);

      const taken = await linkParty(admin, second.id, colleague, 'colleague');
      if (taken.status !== 409 || codeOf(taken) !== 'PARTY_RUNNING_ACCOUNT_TAKEN') problems.push(`a second party for the same colleague answered ${brief(taken)}, expected 409 PARTY_RUNNING_ACCOUNT_TAKEN`);
      const half = await linkParty(admin, second.id, null, 'colleague');
      if (half.status !== 422 || codeOf(half) !== 'PARTY_RUNNING_ACCOUNT_INCOMPLETE') problems.push(`a link without the colleague answered ${brief(half)}, expected 422`);
      const supplierLink = await linkParty(admin, w.supplier.id, colleague, 'partner');
      if (supplierLink.status !== 422 || codeOf(supplierLink) !== 'PARTY_RUNNING_ACCOUNT_SUPPLIER') problems.push(`linking a supplier answered ${brief(supplierLink)}, expected 422`);

      const foreign = await admin.post('/api/documents', {
        docType: 'invoice', status: 'final', refNumber: 'auto', date: w.today, location: w.main, buyer_name: party.name, partyId: party.id,
        inOut: 'out', currency: 'USD', exchangeRate: 500_000, items: [{ itemId: w.item.id, quantity: 1, unit_price: 10 }],
      });
      if (foreign.status !== 422 || codeOf(foreign) !== 'RUNNING_ACCOUNT_INVOICE_CURRENCY') problems.push(`a linked party's dollar invoice answered ${brief(foreign)}, expected 422 RUNNING_ACCOUNT_INVOICE_CURRENCY`);

      // a proforma with a receipt on it
      const proforma = await w.doc('invoice', party, 500_000, 'proforma');
      const receipt = await admin.post('/api/accounting/treasury', {
        type: 'receipt', method: 'bank_transfer', bankAccountId: w.bank, amount: 200_000, date: w.today,
        partyType: 'customer', partyId: party.id, partyName: party.name, documentId: proforma,
      });
      if (!ok(receipt)) problems.push(`setup: the receipt on the proforma answered ${brief(receipt)}`);
      else {
        const finalized = await admin.put(`/api/documents/${proforma}/finalize`, {});
        if (finalized.status !== 409 || codeOf(finalized) !== 'RUNNING_ACCOUNT_INVOICE_HAS_RECEIPTS') problems.push(`finalizing a proforma with a receipt onto the running account answered ${brief(finalized)}, expected 409 RUNNING_ACCOUNT_INVOICE_HAS_RECEIPTS`);
      }
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'links are one per colleague and never on a supplier; issued invoices keep 1201; foreign invoices and proformas with receipts are refused';
    }));
  }

  return results;
}
