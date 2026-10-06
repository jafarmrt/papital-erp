import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { accounts, cheques, journalVoucherItems, journalVouchers, personnel, treasuryTransactions } from '../../db/schema.js';

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
    patch: (url: string, body: object = {}) => request(app).patch(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
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

/** Rows of a cheque's vouchers (registration and lifecycle), in voucher order */
async function chequeVoucherRows(chequeId: number) {
  return orm.select({
    voucherId: journalVoucherItems.voucherId, accountId: journalVoucherItems.accountId, debit: journalVoucherItems.debit,
    credit: journalVoucherItems.credit, detailedType: journalVoucherItems.detailedType, detailedId: journalVoucherItems.detailedId,
  }).from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .where(and(eq(journalVouchers.sourceChequeId, chequeId), eq(journalVouchers.isDeleted, 0), eq(journalVoucherItems.isDeleted, 0)))
    .orderBy(journalVoucherItems.voucherId, journalVoucherItems.id);
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

  const chequeId = 'reg_cheque_voucher_follows_party_type_td_497';
  if (shouldRun(chequeId, 'td497', 'cheque', 'party', 'package4')) {
    await runCase(results, chequeId, 'v9.0.74: a cheque voucher posts to the account and detail of its party type (personnel by purpose, misc to the chosen account), its bounce and return use the same party, and legacy mismatches are listed by the health check (TD-497)', async () => {
      const { findLegacyChequePartyMismatches } = await import('../../services/accounting/treasury/chequePartyAccount.js');
      const api = await client();
      const problems: string[] = [];
      const [worker] = await orm.insert(personnel).values({ fullName: `ERP-TEST-MARKER p04 cheque worker ${tagOf()}` }).returning({ id: personnel.id });
      const advanceAcc = await accountId('1301');
      const wagesAcc = await accountId('3201');
      const partnerAcc = await accountId('4101');
      const protestAcc = await accountId('1103');
      const base = { bankName: 'ملت', issueDate: '2026-03-01', dueDate: '2026-04-01' };
      const person = { partyType: 'personnel', partyId: worker.id, partyName: 'p04 cheque worker' };
      const create = async (body: object) => {
        const res = await api.post('/api/accounting/cheques', { ...base, chequeNumber: `P04${tagOf()}`, ...body });
        if (res.status !== 201) throw new Error(`cheque create returned ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
        return Number(res.body.id);
      };
      const partyRow = (rows: Awaited<ReturnType<typeof chequeVoucherRows>>, accountIdWanted: number) => rows.find(r => r.accountId === accountIdWanted);

      const noPurpose = await api.post('/api/accounting/cheques', { ...base, chequeNumber: `P04${tagOf()}`, type: 'received', amount: 4_000_000, ...person });
      if (noPurpose.status !== 422 || errorCode(noPurpose) !== 'TREASURY_PURPOSE_REQUIRED') problems.push(`personnel cheque without a purpose returned ${noPurpose.status} ${errorCode(noPurpose)}, expected 422`);

      // received 4,000,000 from personnel (advance repayment): Dr 1101 / Cr 1301 personnel
      const received = await create({ type: 'received', amount: 4_000_000, ...person, purpose: 'advance' });
      const recRows = await chequeVoucherRows(received);
      const recParty = recRows.find(r => r.credit.toNumber() > 0);
      if (recParty?.accountId !== advanceAcc || recParty?.detailedType !== 'personnel' || recParty?.detailedId !== worker.id) {
        problems.push(`received personnel cheque credited ${recParty?.accountId} ${recParty?.detailedType} ${recParty?.detailedId}, expected 1301 personnel ${worker.id} (before: 1201 customer)`);
      }
      // paid 1,500,000 to personnel (wages): Dr 3201 personnel / Cr 3101
      const paid = await create({ type: 'paid', amount: 1_500_000, ...person, purpose: 'settlement' });
      const paidParty = (await chequeVoucherRows(paid)).find(r => r.debit.toNumber() > 0);
      if (paidParty?.accountId !== wagesAcc || paidParty?.detailedType !== 'personnel' || paidParty?.detailedId !== worker.id) {
        problems.push(`paid personnel cheque debited ${paidParty?.accountId} ${paidParty?.detailedType} ${paidParty?.detailedId}, expected 3201 personnel ${worker.id} (before: 3001 supplier)`);
      }
      // misc 700,000 received: Cr the chosen 4101
      const misc = await create({ type: 'received', amount: 700_000, partyType: 'other', partyName: 'partner deposit', contraAccountId: partnerAcc });
      const miscParty = (await chequeVoucherRows(misc)).find(r => r.credit.toNumber() > 0);
      if (miscParty?.accountId !== partnerAcc || miscParty?.detailedType !== 'other') problems.push(`misc cheque credited ${miscParty?.accountId} ${miscParty?.detailedType}, expected 4101 other`);

      // no row of these cheques sits on a customer or supplier detail
      const allRows = [...await chequeVoucherRows(received), ...await chequeVoucherRows(paid), ...await chequeVoucherRows(misc)];
      if (allRows.some(r => r.detailedType === 'customer' || r.detailedType === 'supplier')) problems.push('a personnel or misc cheque voucher row sits on a customer or supplier detail');

      // bounce and return of the received personnel cheque: Dr 1103 personnel, then Dr 1301 personnel / Cr 1103 personnel
      const bounced = await api.patch(`/api/accounting/cheques/${received}/status`, { status: 'bounced' });
      if (bounced.status !== 200) problems.push(`bounce returned ${bounced.status}: ${JSON.stringify(bounced.body).slice(0, 160)}`);
      const returned = await api.patch(`/api/accounting/cheques/${received}/status`, { status: 'returned' });
      if (returned.status !== 200) problems.push(`return returned ${returned.status}: ${JSON.stringify(returned.body).slice(0, 160)}`);
      const lifecycle = (await chequeVoucherRows(received)).filter(r => r.accountId === protestAcc || r.accountId === advanceAcc);
      const protestRows = lifecycle.filter(r => r.accountId === protestAcc);
      if (protestRows.length !== 2 || protestRows.some(r => r.detailedType !== 'personnel' || r.detailedId !== worker.id)) {
        problems.push(`protest rows: ${JSON.stringify(protestRows.map(r => [r.detailedType, r.detailedId]))}, expected two personnel rows (before: customer)`);
      }
      const backToPerson = partyRow((await chequeVoucherRows(received)).filter(r => r.debit.toNumber() > 0), advanceAcc);
      if (!backToPerson || backToPerson.detailedType !== 'personnel') problems.push('return did not debit 1301 with the personnel detail (before: 1201 customer)');
      // bounce of the paid personnel cheque: Cr 3201 personnel
      const paidBounce = await api.patch(`/api/accounting/cheques/${paid}/status`, { status: 'bounced' });
      if (paidBounce.status !== 200) problems.push(`paid bounce returned ${paidBounce.status}`);
      const paidBack = (await chequeVoucherRows(paid)).find(r => r.credit.toNumber() > 0 && r.accountId === wagesAcc);
      if (!paidBack || paidBack.detailedType !== 'personnel') problems.push('paid personnel cheque bounce did not credit 3201 with the personnel detail (before: 3001 supplier)');

      // legacy: a cheque written before v9.0.74 (no party account) from personnel is listed by the health check
      await orm.update(cheques).set({ partyAccountId: null, purpose: null }).where(eq(cheques.id, misc));
      try {
        const listed = (await findLegacyChequePartyMismatches()).map(e => e.id);
        if (!listed.includes(misc)) problems.push('health check «cheque_party_account_legacy» does not list a legacy misc cheque');
        if (listed.includes(paid)) problems.push('health check lists a cheque registered under the new rule');
      } finally {
        await orm.update(cheques).set({ partyAccountId: partnerAcc }).where(eq(cheques.id, misc));
      }
      assertNoProblems(problems);
      return 'Personnel cheque without purpose 422; received 4,000,000 Cr 1301 personnel, paid 1,500,000 Dr 3201 personnel, misc 700,000 Cr 4101; bounce/return on 1103 and 1301 with the personnel detail; paid bounce Cr 3201 personnel; legacy cheque listed';
    });
  }

  const spentId = 'reg_cheque_spent_needs_supplier_td_498';
  if (shouldRun(spentId, 'td498', 'cheque', 'spent', 'party', 'package4')) {
    await runCase(results, spentId, 'v9.0.75: spending a received cheque needs a supplier id, the voucher debits trade payables with that supplier\'s detail and the payee name comes from the supplier row (TD-498)', async () => {
      const { createTestCustomer } = await import('../fixtures/factories.js');
      const api = await client();
      const problems: string[] = [];
      const payablesAcc = await accountId('3001');
      const customer = await createTestCustomer({ name: `ERP-TEST-MARKER p04 spend customer ${tagOf()}` });
      const supplier = await createTestCustomer({ name: `ERP-TEST-MARKER p04 spend supplier ${tagOf()}`, partyType: 'supplier' });
      const base = { type: 'received', bankName: 'ملت', issueDate: '2026-03-01', dueDate: '2026-04-01', partyType: 'customer', partyId: customer.id, partyName: customer.name };
      const create = async (amount: number) => {
        const res = await api.post('/api/accounting/cheques', { ...base, chequeNumber: `S04${tagOf()}`, amount });
        if (res.status !== 201) throw new Error(`cheque create returned ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
        return Number(res.body.id);
      };
      const first = await create(4_000_000);
      const second = await create(2_500_000);
      const spend = (id: number, body: object) => api.patch(`/api/accounting/cheques/${id}/status`, { status: 'spent', ...body });

      // the old status form sent only a typed name
      const nameOnly = await spend(first, { transfereePartyName: 'شرکت بازرگانی پارس' });
      if (nameOnly.status !== 422 || errorCode(nameOnly) !== 'CHEQUE_TRANSFEREE_REQUIRED') problems.push(`spend with a name only returned ${nameOnly.status} ${errorCode(nameOnly)}, expected 422 CHEQUE_TRANSFEREE_REQUIRED (before: 200 with detail «other»)`);
      const toCustomer = await spend(first, { transfereePartyId: customer.id });
      if (toCustomer.status !== 422 || errorCode(toCustomer) !== 'TREASURY_PARTY_INVALID') problems.push(`spend to a customer-only party returned ${toCustomer.status} ${errorCode(toCustomer)}, expected 422 TREASURY_PARTY_INVALID`);
      const [still] = await orm.select({ status: cheques.status }).from(cheques).where(eq(cheques.id, first));
      if (still?.status !== 'received') problems.push(`refused spends changed the cheque status to ${still?.status}`);

      for (const id of [first, second]) {
        const res = await spend(id, { transfereePartyId: supplier.id });
        if (res.status !== 200) problems.push(`spend of cheque ${id} to the supplier returned ${res.status}: ${JSON.stringify(res.body).slice(0, 160)}`);
        else if (res.body.payeeName !== supplier.name) problems.push(`payee name ${res.body.payeeName}, expected the supplier's name`);
      }
      const supplierDebits = [...await chequeVoucherRows(first), ...await chequeVoucherRows(second)]
        .filter(r => r.accountId === payablesAcc && r.debit.toNumber() > 0);
      const onSupplier = supplierDebits.filter(r => r.detailedType === 'supplier' && r.detailedId === supplier.id);
      const total = onSupplier.reduce((sum, r) => sum + r.debit.toNumber(), 0);
      if (onSupplier.length !== 2 || total !== 6_500_000) {
        problems.push(`supplier detail carries ${onSupplier.length} trade-payables debits totalling ${total}, expected 2 rows of 6,500,000 (before: only the API spend, 2,500,000)`);
      }
      assertNoProblems(problems);
      return 'Spend with a typed name only 422, to a customer-only party 422 (cheque stays received); two spends 4,000,000 + 2,500,000 to the supplier: 2 rows Dr 3001 with the supplier detail, 6,500,000, payee name from the supplier row';
    });
  }

  return results;
}
