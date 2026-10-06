import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { accounts, journalVoucherItems, personnel, treasuryTransactions } from '../../db/schema.js';

/**
 * Package 4 (treasury and cheques), PR «ب» party accounts: real Express routes on PostgreSQL. Each test is red on the
 * version before its fix.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;

async function client() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s = await getAdminSession();
  return {
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
    post: (url: string, body: object = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
  };
}

async function accountId(code: string): Promise<number> {
  const [row] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, code), eq(accounts.isDeleted, 0)));
  if (!row) throw new Error(`account ${code} is missing`);
  return row.id;
}

/** A bank with a ledger account of its own under 1003 */
async function createBank(title: string): Promise<{ id: number; ledgerId: number }> {
  const api = await client();
  const [ledger] = await orm.insert(accounts).values({
    code: `1003${tagOf()}`, name: `${title} (test ledger)`, level: 'subsidiary', parentId: await accountId('1003'),
    accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  const res = await api.post('/api/accounting/bank-accounts', { title: `${title} ${tagOf()}`, type: 'bank', accountId: ledger.id, initialBalance: 0 });
  if (res.status !== 201 && res.status !== 200) throw new Error(`bank create returned ${res.status}: ${JSON.stringify(res.body)}`);
  return { id: Number(res.body.id), ledgerId: ledger.id };
}

async function voucherRows(voucherId: number) {
  return orm.select({
    accountId: journalVoucherItems.accountId, debit: journalVoucherItems.debit, credit: journalVoucherItems.credit,
    detailedType: journalVoucherItems.detailedType, detailedId: journalVoucherItems.detailedId,
  }).from(journalVoucherItems).where(and(eq(journalVoucherItems.voucherId, voucherId), eq(journalVoucherItems.isDeleted, 0)));
}

const errorCode = (res: request.Response) => String(res.body?.code ?? '');

async function runCase(results: TestCaseResult[], id: string, name: string, body: () => Promise<string>): Promise<void> {
  const tStart = Date.now();
  try {
    const details = await body();
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

function assertNoProblems(problems: string[]): void {
  if (problems.length > 0) throw new Error(problems.join(' | '));
}

export async function runTreasuryPartyTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const contraId = 'reg_treasury_misc_contra_account_td_507';
  if (shouldRun(contraId, 'td507', 'treasury', 'contra', 'package4')) {
    await runCase(results, contraId, 'v9.0.72: a misc receipt or payment and a personnel «other» payment post to the counter account the user chose, the personnel purpose is required and stored, and trade receivables / payables / wages are refused as a chosen account (TD-507)', async () => {
      const api = await client();
      const problems: string[] = [];
      const bank = await createBank('Misc contra bank');
      const rent = await accountId('7002');
      const receivables = await accountId('1201');
      const wages = await accountId('3201');
      const base = { method: 'bank_transfer', bankAccountId: bank.id, date: '2026-04-01' };

      // the choosable list: rent yes; trade receivables, wages and the bank's own ledger account no
      const list = await api.get('/api/accounting/treasury/contra-accounts');
      const listed = new Set<number>((Array.isArray(list.body?.data) ? list.body.data : []).map((a: { id: number }) => a.id));
      if (list.status !== 200) problems.push(`contra account list returned ${list.status}`);
      else {
        if (!listed.has(rent)) problems.push('contra account list does not offer 7002 (rent)');
        for (const [label, id] of [['1201', receivables], ['3201', wages], ['bank ledger', bank.ledgerId]] as const) {
          if (listed.has(id)) problems.push(`contra account list offers ${label}`);
        }
      }

      const noAccount = await api.post('/api/accounting/treasury', { ...base, type: 'receipt', amount: 50_000_000, partyType: 'other', partyName: 'bank loan' });
      if (noAccount.status !== 422 || errorCode(noAccount) !== 'TREASURY_CONTRA_ACCOUNT_REQUIRED') {
        problems.push(`misc receipt without a counter account returned ${noAccount.status} ${errorCode(noAccount)}, expected 422 TREASURY_CONTRA_ACCOUNT_REQUIRED`);
      }
      const intoReceivables = await api.post('/api/accounting/treasury', { ...base, type: 'receipt', amount: 50_000_000, partyType: 'other', partyName: 'bank loan', contraAccountId: receivables });
      if (intoReceivables.status !== 422 || errorCode(intoReceivables) !== 'TREASURY_CONTRA_ACCOUNT_INVALID') {
        problems.push(`misc receipt into 1201 returned ${intoReceivables.status} ${errorCode(intoReceivables)}, expected 422 TREASURY_CONTRA_ACCOUNT_INVALID`);
      }

      // a misc receipt 10,000,000 so the bank can pay, then rent 2,000,000 paid to the chosen 7002
      const funding = await api.post('/api/accounting/treasury', { ...base, type: 'receipt', amount: 10_000_000, partyType: 'other', partyName: 'owner deposit', contraAccountId: await accountId('4101') });
      if (funding.status !== 201) throw new Error(`funding receipt returned ${funding.status}: ${JSON.stringify(funding.body).slice(0, 200)}`);
      const rentPaid = await api.post('/api/accounting/treasury', { ...base, type: 'payment', amount: 2_000_000, partyType: 'other', partyName: 'workshop rent', contraAccountId: rent });
      if (rentPaid.status !== 201) throw new Error(`rent payment returned ${rentPaid.status}: ${JSON.stringify(rentPaid.body).slice(0, 200)}`);
      const rentRows = await voucherRows(Number(rentPaid.body.voucherId));
      const rentDebit = rentRows.find(r => r.debit.toNumber() > 0);
      if (rentDebit?.accountId !== rent) problems.push(`rent payment debited account ${rentDebit?.accountId}, expected 7002 (${rent}); before v9.0.72 it went to 1201`);
      const [rentRow] = await orm.select({ contra: treasuryTransactions.contraAccountId, purpose: treasuryTransactions.purpose })
        .from(treasuryTransactions).where(eq(treasuryTransactions.id, Number(rentPaid.body.id)));
      if (rentRow?.contra !== rent) problems.push(`rent treasury row keeps contra account ${rentRow?.contra}, expected ${rent}`);

      // personnel: purpose required; «other» posts to the chosen account with the personnel detail; advance to 1301
      const [worker] = await orm.insert(personnel).values({ fullName: `ERP-TEST-MARKER p04 worker ${tagOf()}` }).returning({ id: personnel.id });
      const person = { partyType: 'personnel', partyId: worker.id, partyName: 'p04 worker' };
      const noPurpose = await api.post('/api/accounting/treasury', { ...base, type: 'payment', amount: 300_000, ...person });
      if (noPurpose.status !== 422 || errorCode(noPurpose) !== 'TREASURY_PURPOSE_REQUIRED') {
        problems.push(`personnel payment without a purpose returned ${noPurpose.status} ${errorCode(noPurpose)}, expected 422 TREASURY_PURPOSE_REQUIRED`);
      }
      const otherNoAccount = await api.post('/api/accounting/treasury', { ...base, type: 'payment', amount: 300_000, ...person, purpose: 'other' });
      if (otherNoAccount.status !== 422 || errorCode(otherNoAccount) !== 'TREASURY_CONTRA_ACCOUNT_REQUIRED') {
        problems.push(`personnel «other» payment without a counter account returned ${otherNoAccount.status} ${errorCode(otherNoAccount)}, expected 422`);
      }
      const intoWages = await api.post('/api/accounting/treasury', { ...base, type: 'payment', amount: 300_000, ...person, purpose: 'other', contraAccountId: wages });
      if (intoWages.status !== 422) problems.push(`personnel «other» payment into 3201 returned ${intoWages.status}, expected 422`);
      const otherPaid = await api.post('/api/accounting/treasury', { ...base, type: 'payment', amount: 300_000, ...person, purpose: 'other', contraAccountId: await accountId('7009') });
      if (otherPaid.status !== 201) throw new Error(`personnel «other» payment returned ${otherPaid.status}: ${JSON.stringify(otherPaid.body).slice(0, 200)}`);
      const otherDebit = (await voucherRows(Number(otherPaid.body.voucherId))).find(r => r.debit.toNumber() > 0);
      if (otherDebit?.accountId !== await accountId('7009') || otherDebit?.detailedType !== 'personnel' || otherDebit?.detailedId !== worker.id) {
        problems.push(`personnel «other» payment debited ${otherDebit?.accountId} ${otherDebit?.detailedType} ${otherDebit?.detailedId}, expected 7009 personnel ${worker.id}`);
      }
      const advance = await api.post('/api/accounting/treasury', { ...base, type: 'payment', amount: 400_000, ...person, purpose: 'advance' });
      if (advance.status !== 201) throw new Error(`advance returned ${advance.status}: ${JSON.stringify(advance.body).slice(0, 200)}`);
      const advanceDebit = (await voucherRows(Number(advance.body.voucherId))).find(r => r.debit.toNumber() > 0);
      if (advanceDebit?.accountId !== await accountId('1301')) problems.push(`advance debited ${advanceDebit?.accountId}, expected 1301`);
      const stored = await orm.select({ id: treasuryTransactions.id, purpose: treasuryTransactions.purpose })
        .from(treasuryTransactions).where(eq(treasuryTransactions.partyId, worker.id));
      const purposes = stored.filter(r => r.id === Number(otherPaid.body.id) || r.id === Number(advance.body.id)).map(r => r.purpose).sort().join(',');
      if (purposes !== 'advance,other') problems.push(`stored personnel purposes are [${purposes}], expected [advance,other]`);

      // voiding the rent payment keeps the purpose and counter account on the reversal row
      const voided = await api.post(`/api/accounting/treasury/${rentPaid.body.id}/void`, { reason: 'test' });
      if (voided.status !== 200) problems.push(`rent void returned ${voided.status}`);
      else {
        const [rev] = await orm.select({ contra: treasuryTransactions.contraAccountId }).from(treasuryTransactions).where(eq(treasuryTransactions.id, Number(voided.body.id)));
        if (rev?.contra !== rent) problems.push(`reversal row keeps contra account ${rev?.contra}, expected ${rent}`);
      }
      assertNoProblems(problems);
      return 'Misc receipt without an account 422, into 1201 422; rent 2,000,000 Dr 7002 / Cr bank; personnel without purpose 422, «other» 300,000 Dr 7009 (personnel detail), advance 400,000 Dr 1301; purposes stored';
    });
  }

  const linkId = 'reg_treasury_document_and_party_links_td_501';
  if (shouldRun(linkId, 'td501', 'treasury', 'invoice', 'party', 'package4')) {
    await runCase(results, linkId, 'v9.0.73: a treasury receipt or payment links only to an active document of its own direction and party, and its party id must exist in the table of its party type (TD-501)', async () => {
      const { createTestCustomer, createTestDocument } = await import('../fixtures/factories.js');
      const api = await client();
      const problems: string[] = [];
      const bank = await createBank('Link bank');
      const customerA = await createTestCustomer({ name: `ERP-TEST-MARKER p04 customer A ${tagOf()}` });
      const customerB = await createTestCustomer({ name: `ERP-TEST-MARKER p04 customer B ${tagOf()}` });
      const supplier = await createTestCustomer({ name: `ERP-TEST-MARKER p04 supplier ${tagOf()}`, partyType: 'supplier' });
      const { document: invoiceB } = await createTestDocument({ type: 'invoice', buyerName: customerB.name });
      const { document: purchase } = await createTestDocument({ type: 'purchase', buyerName: supplier.name });
      const { document: voidedB } = await createTestDocument({ type: 'invoice', buyerName: customerB.name, isDeleted: 1 });
      const base = { method: 'bank_transfer', bankAccountId: bank.id, date: '2026-04-01' };
      const asB = { partyType: 'customer', partyId: customerB.id, partyName: customerB.name };
      const funded = await api.post('/api/accounting/treasury', { ...base, type: 'receipt', amount: 10_000_000, ...asB });
      if (funded.status !== 201) throw new Error(`funding receipt returned ${funded.status}: ${JSON.stringify(funded.body).slice(0, 200)}`);

      const expect422 = async (label: string, body: object, code: string) => {
        const res = await api.post('/api/accounting/treasury', { ...base, ...body });
        if (res.status !== 422 || errorCode(res) !== code) problems.push(`${label} returned ${res.status} ${errorCode(res)}, expected 422 ${code}`);
      };
      await expect422('receipt from customer A on customer B\'s invoice', { type: 'receipt', amount: 2_000_000, partyType: 'customer', partyId: customerA.id, partyName: customerA.name, documentId: invoiceB.id }, 'TREASURY_DOCUMENT_PARTY_MISMATCH');
      await expect422('supplier payment on a sales invoice', { type: 'payment', amount: 400_000, partyType: 'supplier', partyId: supplier.id, partyName: supplier.name, documentId: invoiceB.id }, 'TREASURY_DOCUMENT_INVALID');
      await expect422('receipt on a document that does not exist', { type: 'receipt', amount: 1_000, ...asB, documentId: 999_999_999 }, 'TREASURY_DOCUMENT_INVALID');
      await expect422('receipt on a voided invoice', { type: 'receipt', amount: 1_000, ...asB, documentId: voidedB.id }, 'TREASURY_DOCUMENT_INVALID');
      await expect422('receipt from a customer id that does not exist', { type: 'receipt', amount: 1_000, partyType: 'customer', partyId: 999_999_999, partyName: 'nobody' }, 'TREASURY_PARTY_INVALID');
      await expect422('supplier payment to a customer-only party', { type: 'payment', amount: 1_000, partyType: 'supplier', partyId: customerA.id, partyName: customerA.name }, 'TREASURY_PARTY_INVALID');
      await expect422('personnel payment to an id that is no personnel', { type: 'payment', amount: 1_000, partyType: 'personnel', partyId: 999_999_999, partyName: 'nobody', purpose: 'advance' }, 'TREASURY_PARTY_INVALID');

      const rows = await orm.select({ id: treasuryTransactions.id }).from(treasuryTransactions).where(eq(treasuryTransactions.bankAccountId, bank.id));
      if (rows.length !== 1) problems.push(`bank has ${rows.length} treasury rows after the refused entries, expected 1 (the funding receipt)`);

      const good = await api.post('/api/accounting/treasury', { ...base, type: 'receipt', amount: 2_000_000, ...asB, documentId: invoiceB.id });
      if (good.status !== 201) problems.push(`receipt from customer B on its own invoice returned ${good.status}: ${JSON.stringify(good.body).slice(0, 200)}`);
      const paid = await api.post('/api/accounting/treasury', { ...base, type: 'payment', amount: 400_000, partyType: 'supplier', partyId: supplier.id, partyName: supplier.name, documentId: purchase.id });
      if (paid.status !== 201) problems.push(`supplier payment on its purchase returned ${paid.status}: ${JSON.stringify(paid.body).slice(0, 200)}`);
      assertNoProblems(problems);
      return 'Receipt from A on B\'s invoice, supplier payment on a sales invoice, missing or voided document and party ids that do not exist in their table: all 422 with no row; B on its own invoice and the supplier on its purchase: 201';
    });
  }

  return results;
}
