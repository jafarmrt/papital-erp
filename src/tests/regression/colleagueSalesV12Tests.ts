import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, customers, documents, journalVoucherItems, journalVouchers, personnel } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { VoucherSyncService } from '../../services/accounting/voucherSync.service.js';
import { createTestCustomer } from '../fixtures/factories.js';
import { checkPartyBalances } from '../invariants/partyBalanceInvariant.js';
import { addLog, newTask, newWorker, personNet } from '../invariants/payrollScenarios.js';
import { checkPayrollInvariants } from '../invariants/payrollInvariants.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
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

      // a partner's debt is fixed in euros (part B2): a rial invoice is refused, a euro one goes to 4101
      const rialPartner = await admin.post('/api/documents', {
        docType: 'invoice', status: 'final', refNumber: 'auto', date: w.today, location: w.main, buyer_name: partnerParty.name, partyId: partnerParty.id,
        inOut: 'out', items: [{ itemId: w.item.id, quantity: 1, unit_price: 700_000 }],
      });
      if (rialPartner.status !== 422 || codeOf(rialPartner) !== 'RUNNING_ACCOUNT_INVOICE_CURRENCY') problems.push(`a partner's rial invoice answered ${brief(rialPartner)}, expected 422 RUNNING_ACCOUNT_INVOICE_CURRENCY`);
      const partnerInvoice = await w.doc('invoice', partnerParty, 350, 'final', { currency: 'EUR', exchangeRate: 2_000_000 });
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

  const review = 'reg_colleague_sales_review_v12';
  if (shouldRun(review, 'v12', 'colleague_sales', 'documents', 'customers', 'migration')) {
    await runCase(results, review, 'v12 colleague sales, review of #508: the migration stamps only final documents, so a proforma open at deploy time is stamped with the running account when it is finalized; a return with no invoice for a linked party is refused (422); the party balance invariant I8 leaves the running account out; a kept link is not checked again (the colleague left) and a linked party cannot become a supplier (422)', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      for (let i = 0; i < 4; i++) await w.doc('receipt', w.supplier, 900_000);
      const colleague = await newWorker('ERP-TEST-MARKER review colleague');
      const party = await createTestCustomer();

      // a proforma open before the deploy: migration 0038's own backfill statement runs over it, then the party is linked
      const open = await w.doc('invoice', party, 400_000, 'proforma');
      const migration = fs.readFileSync(path.resolve(process.cwd(), 'drizzle/0038_colleague_sales.sql'), 'utf8');
      const backfill = migration.split('--> statement-breakpoint').map(x => x.replace(/^\s*--.*$/gm, '').trim()).find(x => x.startsWith('UPDATE documents'));
      if (!backfill) throw new Error('setup: migration 0038 has no backfill of documents');
      await orm.update(documents).set({ runningAccount: null, runningAccountPersonnelId: null }).where(eq(documents.id, open));
      await orm.execute(sql.raw(backfill));
      const linked = await linkParty(admin, party.id, colleague, 'colleague');
      if (!ok(linked)) throw new Error(`setup: linking answered ${brief(linked)}`);
      const finalized = await admin.put(`/api/documents/${open}/finalize`, {});
      const [stamp] = await orm.select({ runningAccount: documents.runningAccount }).from(documents).where(eq(documents.id, open));
      const debit = (await voucherRows(open)).find(r => fin(r.debit).isPositive() && ['3208', '1201'].includes(String(r.code)));
      if (!ok(finalized) || stamp?.runningAccount !== 'colleague' || debit?.code !== '3208' || (await w.state(open)).remaining !== 0) {
        problems.push(`a proforma open at deploy time, finalized after the link: ${brief(finalized)}, stamp ${JSON.stringify(stamp?.runningAccount)}, debit ${debit?.code}, expected colleague and 3208 settled`);
      }

      // the party balance invariant over the linked party
      const i8 = await checkPartyBalances([party.id]);
      if (i8.length !== 0) problems.push(`I8 over a linked party reads ${JSON.stringify(i8)}`);

      // a return with no invoice
      const free = await admin.post('/api/documents', {
        docType: 'return', status: 'final', refNumber: 'auto', date: w.today, location: w.main, buyer_name: party.name, partyId: party.id,
        inOut: 'in', items: [{ itemId: w.item.id, quantity: 1, unit_price: 100_000 }],
      });
      if (free.status !== 422 || codeOf(free) !== 'RUNNING_ACCOUNT_RETURN_NEEDS_INVOICE') problems.push(`a linked party's return with no invoice answered ${brief(free)}, expected 422 RUNNING_ACCOUNT_RETURN_NEEDS_INVOICE`);

      // the colleague leaves: the party stays editable with its link; it cannot become a supplier while linked
      await orm.update(personnel).set({ isDeleted: 1 }).where(eq(personnel.id, colleague));
      const [row] = await orm.select({ version: customers.version }).from(customers).where(eq(customers.id, party.id));
      const renamed = await admin.put(`/api/customers/${party.id}`, { version: row?.version, name: `${party.name} ویرایش`, personnelId: colleague, runningAccount: 'colleague' });
      if (!ok(renamed)) problems.push(`editing a party whose colleague left answered ${brief(renamed)}, expected 200`);
      const [row2] = await orm.select({ version: customers.version }).from(customers).where(eq(customers.id, party.id));
      const supplier = await admin.put(`/api/customers/${party.id}`, { version: row2?.version, partyType: 'supplier' });
      if (supplier.status !== 422 || codeOf(supplier) !== 'PARTY_RUNNING_ACCOUNT_SUPPLIER') problems.push(`making a linked party a supplier answered ${brief(supplier)}, expected 422 PARTY_RUNNING_ACCOUNT_SUPPLIER`);
      // nor through the Excel import of parties (delta review)
      const imported = await admin.post('/api/customers/bulk-import', { updateIfExists: true, rows: [{ name: `${party.name} ویرایش`, partyType: 'تأمین‌کننده' }] });
      const [after] = await orm.select({ partyType: customers.partyType, personnelId: customers.personnelId }).from(customers).where(eq(customers.id, party.id));
      if (imported.status !== 200 || (imported.body?.errors ?? []).length !== 1
        || !String(imported.body?.errors?.[0]?.message ?? '').includes('تأمین‌کننده نمی‌شود') || after?.partyType === 'supplier' || after?.personnelId !== colleague) {
        problems.push(`importing a linked party as a supplier answered ${brief(imported)} and left ${JSON.stringify(after)}, expected one row error and the party unchanged`);
      }
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'open proformas reach the running account; free returns are refused; I8 and the party edits follow the link';
    }));
  }

  const euro = 'reg_colleague_sales_partner_euro_v12';
  if (shouldRun(euro, 'v12', 'colleague_sales', 'treasury', 'accounting', 'currency')) {
    await runCase(results, euro, 'v12 colleague sales part B2: a partner\'s debt on 4101 is in euros; a partner running-account receipt or payment (euro, or rials at a typed euro rate) leaves the open balance at its average rate and posts the rial difference to exchange gain (5201) or loss (7008); euros beyond the balance go at the move\'s own rate; a void reverses the exchange row; a rial move without a euro rate and a move on an invoice are refused', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      for (let i = 0; i < 4; i++) await w.doc('receipt', w.supplier, 900_000);
      const partner = await newWorker('ERP-TEST-MARKER euro partner');
      const party = await createTestCustomer();
      const linked = await linkParty(admin, party.id, partner, 'partner');
      if (!ok(linked)) throw new Error(`setup: linking answered ${brief(linked)}`);
      await w.doc('invoice', party, 500, 'final', { currency: 'EUR', exchangeRate: 2_000_000 });
      await w.doc('invoice', party, 300, 'final', { currency: 'EUR', exchangeRate: 2_200_000 });
      const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
      const [ledger] = await orm.insert(accounts).values({
        code: `1003${String(Date.now()).slice(-5)}`, name: 'ERP-TEST-MARKER euro bank', level: 'subsidiary', parentId: parent?.id ?? null,
        accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
      }).returning({ id: accounts.id });
      const euroBank = await BankAccountService.createBankAccount({ title: 'ERP-TEST-MARKER euro bank', type: 'bank', accountId: ledger.id, initialBalance: 0, currency: 'EUR', openingDate: '2026-03-21' });

      const balance = async () => {
        const [row] = (await orm.execute(sql`SELECT COALESCE(SUM(CASE WHEN i.currency = 'EUR' THEN i.debit - i.credit ELSE 0 END), 0)::text AS euro,
            COALESCE(SUM(ROUND((i.debit - i.credit) * i.exchange_rate, 0)), 0)::text AS rial
          FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
          WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND a.code = '4101' AND i.detailed_type = 'personnel' AND i.detailed_id = ${partner}`)).rows as Array<{ euro: string; rial: string }>;
        return { euro: fin(row?.euro ?? 0).toNumber(), rial: fin(row?.rial ?? 0).toNumber() };
      };
      const fx = async () => ({ gain: -fin(await personNet('5201', partner)).toNumber(), loss: fin(await personNet('7008', partner)).toNumber() });
      const move = (type: 'receipt' | 'payment', amount: number, extra: Record<string, unknown>) => admin.post('/api/accounting/treasury', {
        type, method: 'bank_transfer', amount, date: w.today, partyType: 'personnel', partyId: partner, partyName: 'partner', purpose: 'partner_account', ...extra,
      });
      const opening = await balance();
      if (opening.euro !== 800 || opening.rial !== 1_660_000_000) problems.push(`two euro invoices put ${JSON.stringify(opening)} on 4101, expected 800 euros and 1660000000 rials`);

      // 400 euros at 2,100,000 against an average of 2,075,000: 10,000,000 gain
      const first = await move('receipt', 400, { bankAccountId: euroBank.id, currency: 'EUR', exchangeRate: 2_100_000 });
      let b = await balance();
      if (!ok(first) || b.euro !== 400 || b.rial !== 830_000_000 || (await fx()).gain !== 10_000_000) problems.push(`a 400-euro receipt answered ${brief(first)} and left ${JSON.stringify(b)} with ${JSON.stringify(await fx())}, expected 400 euros, 830000000 rials and a 10000000 gain`);
      // 420,000,000 rials at a euro rate of 2,100,000 are 200 euros: 5,000,000 gain
      const noRate = await move('receipt', 420_000_000, { bankAccountId: w.bank });
      if (noRate.status !== 422 || codeOf(noRate) !== 'TREASURY_PARTNER_EURO_RATE_REQUIRED') problems.push(`a rial receipt without a euro rate answered ${brief(noRate)}, expected 422 TREASURY_PARTNER_EURO_RATE_REQUIRED`);
      const rial = await move('receipt', 420_000_000, { bankAccountId: w.bank, partnerEuroRate: 2_100_000 });
      b = await balance();
      if (!ok(rial) || b.euro !== 200 || b.rial !== 415_000_000 || (await fx()).gain !== 15_000_000) problems.push(`a rial receipt answered ${brief(rial)} and left ${JSON.stringify(b)} with ${JSON.stringify(await fx())}, expected 200 euros, 415000000 rials and 15000000 of gain`);
      // 300 euros at 2,000,000 against 200 open: 200 at the average, 100 at its own rate; 15,000,000 loss
      const over = await move('receipt', 300, { bankAccountId: euroBank.id, currency: 'EUR', exchangeRate: 2_000_000 });
      b = await balance();
      if (!ok(over) || b.euro !== -100 || b.rial !== -200_000_000 || (await fx()).loss !== 15_000_000) problems.push(`an overpaying receipt answered ${brief(over)} and left ${JSON.stringify(b)} with ${JSON.stringify(await fx())}, expected -100 euros, -200000000 rials and a 15000000 loss`);
      // paying the 100 euros back at 2,100,000 against their 2,000,000: another 10,000,000 loss; its void takes it back
      const back = await move('payment', 100, { bankAccountId: euroBank.id, currency: 'EUR', exchangeRate: 2_100_000 });
      b = await balance();
      if (!ok(back) || b.euro !== 0 || b.rial !== 0 || (await fx()).loss !== 25_000_000) problems.push(`paying the partner back answered ${brief(back)} and left ${JSON.stringify(b)} with ${JSON.stringify(await fx())}, expected 0 and a 25000000 loss`);
      const voided = await admin.post(`/api/accounting/treasury/${Number(back.body?.id)}/void`, { reason: 'test' });
      b = await balance();
      if (!ok(voided) || b.euro !== -100 || (await fx()).loss !== 15_000_000) problems.push(`voiding the payment answered ${brief(voided)} and left ${JSON.stringify(b)} with ${JSON.stringify(await fx())}, expected -100 euros and the 15000000 loss`);
      // a move on an invoice is refused
      const linkedMove = await move('receipt', 10, { bankAccountId: euroBank.id, currency: 'EUR', exchangeRate: 2_000_000, documentId: 1 });
      if (linkedMove.status !== 422 || codeOf(linkedMove) !== 'TREASURY_PARTNER_ACCOUNT_NO_DOCUMENT') problems.push(`a partner move on an invoice answered ${brief(linkedMove)}, expected 422`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'a partner\'s euro account settles at its average rate, with exchange gain and loss rows';
    }));
  }

  const payslip = 'reg_colleague_sales_payslip_deduction_v12';
  if (shouldRun(payslip, 'v12', 'colleague_sales', 'payroll', 'accounting')) {
    await runCase(results, payslip, 'v12 colleague sales part B: a payslip deducts from the colleague\'s running account at most what they owe on 3208 (above it 400 PAYROLL_RUNNING_ACCOUNT_DEDUCTION_EXCEEDS_DEBT, no payslip), its voucher credits 3208 on the colleague\'s detail and the net comes down; the form reads the debt; a draft edit keeps the same ceiling; I10 holds; voiding the payslip gives the debt back', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      for (let i = 0; i < 2; i++) await w.doc('receipt', w.supplier, 900_000);
      const colleague = await newWorker('ERP-TEST-MARKER payslip colleague');
      const party = await createTestCustomer();
      const linked = await linkParty(admin, party.id, colleague, 'colleague');
      if (!ok(linked)) throw new Error(`setup: linking answered ${brief(linked)}`);
      await w.doc('invoice', party, 400_000);
      const owed = await personNet('3208', colleague);
      if (fin(owed).toNumber() !== 400_000) throw new Error(`setup: the colleague owes ${owed} on 3208, expected 400000`);
      const [watermark] = (await orm.execute(sql`SELECT COALESCE(MAX(id), 0)::int AS id FROM piecework_payrolls`)).rows as Array<{ id: number }>;

      const day = new Date(`${w.today}T00:00:00Z`); day.setUTCDate(day.getUTCDate() - 1);
      const yesterday = day.toISOString().slice(0, 10);
      await addLog(colleague, await newTask(), yesterday, 1_000_000);
      const balance = await admin.get(`/api/piecework/personnel/${colleague}/advance-balance`);
      if (Number(balance.body?.runningAccountDebt) !== 400_000) problems.push(`the payslip form read the debt ${JSON.stringify(balance.body)}, expected runningAccountDebt 400000`);

      const issue = (runningAccountDeduction: number) => admin.post('/api/piecework/payrolls', { personnelId: colleague, startDate: yesterday, endDate: yesterday, runningAccountDeduction });
      const over = await issue(400_001);
      const [count] = (await orm.execute(sql`SELECT COUNT(*)::int AS n FROM piecework_payrolls WHERE personnel_id = ${colleague} AND is_deleted = 0`)).rows as Array<{ n: number }>;
      if (over.status !== 400 || codeOf(over) !== 'PAYROLL_RUNNING_ACCOUNT_DEDUCTION_EXCEEDS_DEBT' || count?.n !== 0) problems.push(`a deduction above the debt answered ${brief(over)} with ${count?.n} payslips, expected 400 PAYROLL_RUNNING_ACCOUNT_DEDUCTION_EXCEEDS_DEBT and none`);
      const issued = await issue(400_000);
      const payrollId = Number(issued.body?.id);
      if (issued.status !== 201 || Number(issued.body?.netPayable) !== 600_000 || Number(issued.body?.runningAccountDeduction) !== 400_000) {
        throw new Error(`a deduction of the whole debt answered ${brief(issued)}, expected 201 with net 600000`);
      }
      const after = await personNet('3208', colleague);
      if (!fin(after).isZero()) problems.push(`the colleague's 3208 after the payslip reads ${after}, expected 0`);
      const i10 = await checkPayrollInvariants(watermark?.id ?? 0);
      if (i10.length !== 0) problems.push(`I10 reads ${JSON.stringify(i10)}`);

      // a draft edit: the ceiling is the debt plus this payslip's own deduction
      const lower = await admin.put(`/api/piecework/payrolls/${payrollId}`, { runningAccountDeduction: 300_000 });
      if (!ok(lower) || Number(lower.body?.netPayable) !== 700_000 || fin(await personNet('3208', colleague)).toNumber() !== 100_000) {
        problems.push(`lowering the deduction to 300000 answered ${brief(lower)} with 3208 at ${await personNet('3208', colleague)}, expected net 700000 and 100000 owed`);
      }
      const above = await admin.put(`/api/piecework/payrolls/${payrollId}`, { runningAccountDeduction: 400_001 });
      if (above.status !== 422 || codeOf(above) !== 'PAYROLL_RUNNING_ACCOUNT_DEDUCTION_EXCEEDS_DEBT') problems.push(`raising the deduction above the debt answered ${brief(above)}, expected 422`);

      // voiding the payslip gives the debt back
      const voided = await admin.del(`/api/piecework/payrolls/${payrollId}`);
      if (!ok(voided) || fin(await personNet('3208', colleague)).toNumber() !== 400_000) problems.push(`voiding the payslip answered ${brief(voided)} with 3208 at ${await personNet('3208', colleague)}, expected 400000 owed again`);

      // the ceiling holds when the payslip is issued; an invoice voided afterwards leaves 3208 in credit (the company owes the
      // colleague), the documented outcome of any later move that lowers the debt
      const later = await w.doc('invoice', party, 200_000);
      const reissued = await issue(600_000);
      const voidedLater = await admin.del(`/api/documents/${later}`);
      if (reissued.status !== 201 || !ok(voidedLater) || fin(await personNet('3208', colleague)).toNumber() !== -200_000) {
        problems.push(`a deduction of 600000 then the void of a 200000 invoice answered ${brief(reissued)} / ${brief(voidedLater)} with 3208 at ${await personNet('3208', colleague)}, expected 200000 in credit`);
      }
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'the payslip deducts the running-account debt up to its balance, credits 3208 and gives it back when voided';
    }));
  }

  return results;
}
