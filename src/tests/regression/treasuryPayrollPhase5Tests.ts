import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, customers } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { createTestCustomer, createTestItem } from '../fixtures/factories.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { addLog, newTask, newWorker } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';
import { type Row, q } from './projectStageIntegrityTests.js';

/**
 * Phase 5 (series 9 closing review), PR «ج»: treasury and payroll. Real Express routes on PostgreSQL in an isolated
 * schema with the standard chart of accounts; each case is red on the version before its fix.
 */

type Api = Awaited<ReturnType<typeof sandboxAdminClient>>;
type Res = { status: number; body?: unknown };

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;
const brief = (res: Res) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 220)}`;
const codeOf = (res: Res) => String((res.body as { code?: unknown } | undefined)?.code ?? '');
const docIdOf = (res: Res) => Number((res.body as { docId?: unknown } | undefined)?.docId);
const num = (value: unknown) => Number(value ?? 0);

/** A treasury account with its own ledger account under 1003, funded through a receipt from «other» (counter account 7009) */
async function fundedBank(api: Api, currency: string, funding: number, exchangeRate?: number): Promise<number> {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
  const [ledger] = await orm.insert(accounts).values({
    code: `1003${tagOf()}`, name: `Phase 5 bank ledger ${tagOf()}`, level: 'subsidiary', parentId: parent?.id ?? null,
    accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  const bank = await api.post('/api/accounting/bank-accounts', { title: `Phase 5 bank ${tagOf()}`, type: 'bank', accountId: ledger.id, initialBalance: 0, currency });
  const bankId = Number((bank.body as { id?: unknown } | undefined)?.id);
  if ((bank.status !== 200 && bank.status !== 201) || !bankId) throw new Error(`setup: bank account ${brief(bank)}`);
  if (funding > 0) {
    const fund = await api.post('/api/accounting/treasury', {
      type: 'receipt', method: 'bank_transfer', amount: funding, currency, exchangeRate, bankAccountId: bankId, partyType: 'other',
      contraAccountId: await miscContraAccountId(), partyName: 'Phase 5 funding', date: await businessTodayIsoDate(),
    });
    if (fund.status !== 201) throw new Error(`setup: bank funding ${brief(fund)}`);
  }
  return bankId;
}

/** Approves every voucher of these ids (the account card reads approved vouchers only) */
async function approveVouchers(api: Api, voucherIds: number[]): Promise<void> {
  for (const id of voucherIds) {
    const res = await api.put(`/api/accounting/vouchers/${id}/status`, { status: 'approved' });
    if (res.status !== 200) throw new Error(`setup: approving voucher ${id} ${brief(res)}`);
  }
}

const documentVoucherIds = async (documentId: number) =>
  (await q('SELECT id FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0', [documentId])).map(r => Number(r.id));

const cardBalance = async (api: Api, partyId: number): Promise<string> => {
  const res = await api.get(`/api/customers/${partyId}/account-card`);
  return res.status === 200 ? String((res.body as { finalBalance?: unknown } | undefined)?.finalBalance) : `HTTP ${res.status}`;
};

async function renameParty(api: Api, partyId: number, name: string, partyType: string): Promise<void> {
  const [row] = await orm.select({ version: customers.version }).from(customers).where(eq(customers.id, partyId));
  const res = await api.put(`/api/customers/${partyId}`, { name, partyType, phone: `0912${String(Date.now()).slice(-7)}`, version: Number(row?.version ?? 1) });
  if (res.status !== 200) throw new Error(`setup: renaming party ${partyId} ${brief(res)}`);
}

/** The party rows (detailed type customer or supplier) of a treasury row's voucher */
const treasuryPartyRows = async (treasuryId: number): Promise<Row[]> => q(
  `SELECT i.detailed_type, i.detailed_id, i.detailed_name, i.debit::text AS debit, i.credit::text AS credit
     FROM treasury_transactions t JOIN journal_voucher_items i ON i.voucher_id = t.voucher_id AND i.is_deleted = 0
    WHERE t.id = $1 AND i.detailed_type IN ('customer', 'supplier')`, [treasuryId]);

export async function runTreasuryPayrollPhase5Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const partyId = 'reg_treasury_document_party_td_907';
  if (shouldRun(partyId, 'td907', 'treasury', 'settlement', 'party', 'phase5')) {
    await runCase(results, partyId, 'v9.0.459: a receipt or payment linked to a document without a party id takes the document\'s party id and current name, so the party\'s account card and delete guard still see it after a rename; a legacy document without a party keeps the exact-name rule (TD-907)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const wh = String(await getDefaultWarehouseCode(orm));
      const item = await createTestItem({ type: 'product', stocks: { [wh]: 20 }, weightedAverageCost: 600_000 } as never);
      const bankId = await fundedBank(api, 'IRR', 10_000_000);
      const createDoc = async (body: Record<string, unknown>, label: string) => {
        const res = await api.post('/api/documents', { refNumber: 'auto', date: today, location: wh, ...body });
        const id = docIdOf(res);
        if (res.status !== 200 || !id) throw new Error(`setup: ${label} ${brief(res)}`);
        return id;
      };
      /** the body the invoice settlement form sent: the document's buyer name, no party id */
      const settle = (type: 'receipt' | 'payment', documentId: number, partyName: string, amount: number) => api.post('/api/accounting/treasury', {
        type, date: today, method: 'bank_transfer', amount, currency: 'IRR', bankAccountId: bankId,
        partyType: type === 'receipt' ? 'customer' : 'supplier', partyName, documentId, createVoucher: true,
      });
      const treasuryParty = async (treasuryId: number) => (await q('SELECT party_id, party_name FROM treasury_transactions WHERE id = $1', [treasuryId]))[0];

      // 1) sales: invoice 1,100,000 (VAT 10%) with its party, settlement-form receipt 1,000,000 without a party id
      const customer = await createTestCustomer({ name: `TD-907 customer ${tagOf()}`, partyType: 'customer' });
      const invoiceId = await createDoc({ docType: 'invoice', status: 'final', partyId: customer.id, buyer_name: customer.name, vatPercent: 10, items: [{ itemId: item.id, quantity: 1, unit_price: 1_000_000 }] }, 'invoice');
      await approveVouchers(api, await documentVoucherIds(invoiceId));
      // a receipt naming another party on this invoice is still refused, never written to the invoice's party
      const treasuryCount = async () => num((await q('SELECT count(*)::int AS n FROM treasury_transactions'))[0]?.n);
      const countBefore = await treasuryCount();
      const strayName = await settle('receipt', invoiceId, `${customer.name} other`, 1_000_000);
      if (strayName.status !== 422 || codeOf(strayName) !== 'TREASURY_DOCUMENT_PARTY_MISMATCH') problems.push(`a receipt with another party's name on the invoice answered ${brief(strayName)}, expected 422 TREASURY_DOCUMENT_PARTY_MISMATCH`);
      if (await treasuryCount() !== countBefore) problems.push('the refused receipt wrote a treasury row');
      const receipt = await settle('receipt', invoiceId, customer.name, 1_000_000);
      const receiptId = Number((receipt.body as { id?: unknown } | undefined)?.id);
      if (receipt.status !== 201 || !receiptId) throw new Error(`setup: settlement receipt ${brief(receipt)}`);
      if (num((receipt.body as { partyId?: unknown }).partyId) !== customer.id) problems.push(`the receipt answered partyId ${String((receipt.body as { partyId?: unknown }).partyId)}, expected the invoice's party ${customer.id}`);
      const receiptRow = await treasuryParty(receiptId);
      if (num(receiptRow?.party_id) !== customer.id) problems.push(`the receipt row stores party_id ${String(receiptRow?.party_id)}, expected ${customer.id}`);
      const receiptRows = await treasuryPartyRows(receiptId);
      if (receiptRows.length !== 1 || num(receiptRows[0]?.detailed_id) !== customer.id || receiptRows[0]?.detailed_type !== 'customer') {
        problems.push(`the receipt voucher party rows are ${JSON.stringify(receiptRows)}, expected one customer row with detailed_id ${customer.id}`);
      }
      await approveVouchers(api, [Number((await q('SELECT voucher_id FROM treasury_transactions WHERE id = $1', [receiptId]))[0]?.voucher_id)]);
      const beforeRename = await cardBalance(api, customer.id);
      if (beforeRename !== '100000') problems.push(`the customer card before the rename is ${beforeRename}, expected 100000`);
      await renameParty(api, customer.id, `${customer.name} renamed`, 'customer');
      const afterRename = await cardBalance(api, customer.id);
      if (afterRename !== '100000') problems.push(`the customer card after the rename is ${afterRename}, expected 100000 (the receipt row must follow the party id)`);

      // the receipt moves on account, the invoice is voided: the customer holds 1,000,000 credit and is not deleted
      const onAccount = await api.put(`/api/accounting/treasury/${receiptId}/document`, { documentId: null });
      if (onAccount.status !== 200) problems.push(`moving the receipt on account answered ${brief(onAccount)}`);
      const voided = await api.del(`/api/documents/${invoiceId}`);
      if (voided.status !== 200) problems.push(`voiding the invoice answered ${brief(voided)}`);
      const afterVoid = await cardBalance(api, customer.id);
      if (afterVoid !== '-1000000') problems.push(`the customer card after the void is ${afterVoid}, expected -1000000`);
      const deleted = await api.del(`/api/customers/${customer.id}`);
      if (deleted.status !== 409) problems.push(`deleting the renamed customer holding 1,000,000 credit answered ${brief(deleted)}, expected 409`);
      const [stillThere] = await q('SELECT is_deleted FROM customers WHERE id = $1', [customer.id]);
      if (num(stillThere?.is_deleted) !== 0) problems.push('the customer with a balance was deleted');

      // 2) purchase: receipt 2,000,000 with its supplier, settlement-form payment of all of it without a party id
      const supplier = await createTestCustomer({ name: `TD-907 supplier ${tagOf()}`, partyType: 'supplier' });
      const purchaseId = await createDoc({ docType: 'receipt', status: 'final', partyId: supplier.id, buyer_name: supplier.name, items: [{ itemId: item.id, quantity: 2, unit_price: 1_000_000 }] }, 'purchase receipt');
      await approveVouchers(api, await documentVoucherIds(purchaseId));
      const payment = await settle('payment', purchaseId, supplier.name, 2_000_000);
      const paymentId = Number((payment.body as { id?: unknown } | undefined)?.id);
      if (payment.status !== 201 || !paymentId) throw new Error(`setup: settlement payment ${brief(payment)}`);
      const paymentRows = await treasuryPartyRows(paymentId);
      if (num((await treasuryParty(paymentId))?.party_id) !== supplier.id || paymentRows.length !== 1 || num(paymentRows[0]?.detailed_id) !== supplier.id) {
        problems.push(`the payment row and its voucher party rows are ${JSON.stringify(await treasuryParty(paymentId))} / ${JSON.stringify(paymentRows)}, expected supplier ${supplier.id}`);
      }
      await approveVouchers(api, [Number((await q('SELECT voucher_id FROM treasury_transactions WHERE id = $1', [paymentId]))[0]?.voucher_id)]);
      await renameParty(api, supplier.id, `${supplier.name} renamed`, 'supplier');
      const supplierCard = await cardBalance(api, supplier.id);
      if (supplierCard !== '0') problems.push(`the supplier card after the rename is ${supplierCard}, expected 0 (paid in full)`);

      // 3) a legacy document without a party keeps the exact-name rule: the receipt is recorded with the name and no id
      const walkIn = `TD-907 walk-in ${tagOf()}`;
      const legacyId = await createDoc({ docType: 'invoice', status: 'final', buyer_name: walkIn, items: [{ itemId: item.id, quantity: 1, unit_price: 500_000 }] }, 'legacy invoice');
      const legacy = await settle('receipt', legacyId, walkIn, 500_000);
      const legacyTreasuryId = Number((legacy.body as { id?: unknown } | undefined)?.id);
      if (legacy.status !== 201) problems.push(`settling the invoice without a party answered ${brief(legacy)}, expected 201`);
      else {
        const row = await treasuryParty(legacyTreasuryId);
        if (row?.party_id !== null || row?.party_name !== walkIn) problems.push(`the receipt of the invoice without a party stored ${JSON.stringify(row)}, expected no party id and the buyer name`);
      }
      const otherName = await settle('receipt', legacyId, `${walkIn} other`, 100_000);
      if (otherName.status !== 422 || codeOf(otherName) !== 'TREASURY_DOCUMENT_PARTY_MISMATCH') problems.push(`a receipt with another name on the invoice without a party answered ${brief(otherName)}, expected 422 TREASURY_DOCUMENT_PARTY_MISMATCH`);

      // 4) a sales document whose party is a supplier record: the receipt keeps the name rule instead of being refused
      const supplierBuyer = await createTestCustomer({ name: `TD-907 supplier buyer ${tagOf()}`, partyType: 'supplier' });
      const mixedId = await createDoc({ docType: 'invoice', status: 'final', partyId: supplierBuyer.id, buyer_name: supplierBuyer.name, items: [{ itemId: item.id, quantity: 1, unit_price: 300_000 }] }, 'invoice of a supplier record');
      const mixed = await settle('receipt', mixedId, supplierBuyer.name, 300_000);
      if (mixed.status !== 201) problems.push(`settling an invoice whose party is a supplier record answered ${brief(mixed)}, expected 201 by the name rule`);

      assertNoProblems(problems);
      return 'The settlement receipt and payment took the document party id (row and voucher); after a rename the customer card stayed 100,000 and -1,000,000 after the void with the delete refused (409), the supplier card stayed 0; the invoice without a party kept the exact-name rule.';
    }));
  }

  const currencyId = 'reg_treasury_document_currency_td_908';
  if (shouldRun(currencyId, 'td908', 'treasury', 'currency', 'settlement', 'phase5')) {
    await runCase(results, currencyId, 'v9.0.460: a new receipt or payment is linked only to a document of its own currency (422 TREASURY_DOCUMENT_CURRENCY_MISMATCH, nothing written), as the relink already was; a matching currency still settles the document (TD-908)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const wh = String(await getDefaultWarehouseCode(orm));
      const item = await createTestItem({ type: 'product', stocks: { [wh]: 0 }, weightedAverageCost: 0 } as never);
      const supplier = await createTestCustomer({ name: `TD-908 supplier ${tagOf()}`, partyType: 'supplier' });
      // receipt 10 x 50 USD with a line discount of 20: 480 USD at 600,000 = 288,000,000 rial
      const created = await api.post('/api/documents', {
        docType: 'receipt', status: 'final', refNumber: 'auto', date: today, location: wh, partyId: supplier.id, buyer_name: supplier.name,
        currency: 'USD', exchangeRate: 600_000, items: [{ itemId: item.id, quantity: 10, unit_price: 50, discount: 20 }],
      });
      const usdDoc = docIdOf(created);
      if (created.status !== 200 || !usdDoc) throw new Error(`setup: USD receipt ${brief(created)}`);
      const irrBank = await fundedBank(api, 'IRR', 5_000_000);
      const usdBank = await fundedBank(api, 'USD', 1_000, 600_000);
      const view = async () => {
        const body = (await api.get(`/api/documents/${usdDoc}`)).body as { paidAmount?: unknown; settlementStatus?: unknown };
        return `${String(body?.paidAmount)} ${String(body?.settlementStatus)}`;
      };
      const snapshot = async () => JSON.stringify({
        banks: (await q('SELECT id, current_balance::text AS b FROM bank_accounts ORDER BY id')).map(r => `${String(r.id)}:${String(r.b)}`),
        treasury: num((await q('SELECT count(*)::int AS n FROM treasury_transactions'))[0]?.n),
        vouchers: num((await q('SELECT count(*)::int AS n FROM journal_vouchers WHERE is_deleted = 0'))[0]?.n),
        settlement: await view(),
      });
      const payment = (body: Record<string, unknown>) => api.post('/api/accounting/treasury', {
        type: 'payment', method: 'bank_transfer', partyType: 'supplier', partyName: supplier.name, date: today, ...body,
      });

      // 480 rial from the rial bank on the USD receipt (finding P5-P08), with the party id and as the settlement form sends it
      const before = await snapshot();
      for (const extra of [{ partyId: supplier.id }, {}]) {
        const res = await payment({ amount: 480, currency: 'IRR', bankAccountId: irrBank, documentId: usdDoc, ...extra });
        if (res.status !== 422 || codeOf(res) !== 'TREASURY_DOCUMENT_CURRENCY_MISMATCH') {
          problems.push(`a rial payment ${'partyId' in extra ? 'with' : 'without'} a party id on the USD receipt answered ${brief(res)}, expected 422 TREASURY_DOCUMENT_CURRENCY_MISMATCH`);
        }
      }
      const after = await snapshot();
      if (after !== before) problems.push(`the refused payments changed the data: ${before} -> ${after}`);
      if (await view() !== '0 unpaid') problems.push(`the USD receipt shows ${await view()} after the refused payments, expected 0 unpaid`);

      // a payment in the document's currency still settles it
      const usdPay = await payment({ amount: 100, currency: 'USD', bankAccountId: usdBank, partyId: supplier.id, documentId: usdDoc });
      if (usdPay.status !== 201) problems.push(`a USD payment on the USD receipt answered ${brief(usdPay)}, expected 201`);
      if (await view() !== '100 partially_paid') problems.push(`the USD receipt shows ${await view()} after a 100 USD payment, expected 100 partially_paid`);

      // the relink keeps its own 422 for a rial row moved onto the USD receipt
      const onAccount = await payment({ amount: 480, currency: 'IRR', bankAccountId: irrBank, partyId: supplier.id });
      const onAccountId = Number((onAccount.body as { id?: unknown } | undefined)?.id);
      if (onAccount.status !== 201 || !onAccountId) throw new Error(`setup: on-account payment ${brief(onAccount)}`);
      const relink = await api.put(`/api/accounting/treasury/${onAccountId}/document`, { documentId: usdDoc });
      if (relink.status !== 422 || codeOf(relink) !== 'TREASURY_DOCUMENT_CURRENCY_MISMATCH') problems.push(`moving the rial payment onto the USD receipt answered ${brief(relink)}, expected 422 TREASURY_DOCUMENT_CURRENCY_MISMATCH`);
      const [stillOnAccount] = await q('SELECT document_id FROM treasury_transactions WHERE id = $1', [onAccountId]);
      if (stillOnAccount?.document_id !== null) problems.push(`the refused relink left the payment on document ${String(stillOnAccount?.document_id)}`);

      assertNoProblems(problems);
      return 'Rial payments on the USD receipt refused with 422 (with and without a party id) and nothing written; a 100 USD payment settled 100; moving a rial row onto it is still 422.';
    }));
  }

  const payDateId = 'reg_payroll_payment_future_date_td_927';
  if (shouldRun(payDateId, 'td927', 'payroll', 'payment', 'date', 'phase5')) {
    await runCase(results, payDateId, 'v9.0.461: a payroll payment date follows the treasury date rule: a date after the business today is 422 TREASURY_DATE_IN_FUTURE and a non-existent day 422, with nothing written; today, a past date and an empty date (today) still pay (TD-927)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const worker = await newWorker('TD-927 worker');
      await addLog(worker, await newTask(), '2026-04-08', 900_000);
      const issued = await api.post('/api/piecework/payrolls/generate', { personnelId: worker, startDate: '2026-04-01', endDate: '2026-04-30' });
      const payrollId = Number((issued.body as { id?: unknown } | undefined)?.id);
      if ((issued.status !== 200 && issued.status !== 201) || !payrollId) throw new Error(`setup: payslip ${brief(issued)}`);
      const bankId = await fundedBank(api, 'IRR', 5_000_000);
      const pay = (body: Record<string, unknown>) => api.post(`/api/piecework/payrolls/${payrollId}/register-payment`, { bankAccountId: bankId, method: 'bank_transfer', ...body });
      const snapshot = async () => JSON.stringify({
        bank: (await q('SELECT current_balance::text AS b FROM bank_accounts WHERE id = $1', [bankId]))[0]?.b,
        payroll: (await q('SELECT status, paid_amount::text AS paid, payment_date FROM piecework_payrolls WHERE id = $1', [payrollId]))[0],
        treasury: num((await q('SELECT count(*)::int AS n FROM treasury_transactions'))[0]?.n),
        vouchers: num((await q('SELECT count(*)::int AS n FROM journal_vouchers WHERE is_deleted = 0'))[0]?.n),
      });
      const datesOf = async (res: Res) => {
        const body = res.body as { transactionId?: unknown; voucherId?: unknown } | undefined;
        const [row] = await q('SELECT date FROM treasury_transactions WHERE id = $1', [Number(body?.transactionId)]);
        const [voucher] = await q('SELECT date FROM journal_vouchers WHERE id = $1', [Number(body?.voucherId)]);
        return `${String(row?.date)} ${String(voucher?.date)}`;
      };

      // a date after the business today (ISO or Jalali) and a non-existent day write nothing (finding P5-W04)
      const before = await snapshot();
      const future = new Date(Date.parse(`${today}T00:00:00Z`) + 24 * 86_400_000).toISOString().slice(0, 10);
      for (const date of [future, isoToJalaliDate(future)]) {
        const res = await pay({ amount: 300_000, paymentDate: date });
        if (res.status !== 422 || codeOf(res) !== 'TREASURY_DATE_IN_FUTURE') problems.push(`a payment dated ${date} (today ${today}) answered ${brief(res)}, expected 422 TREASURY_DATE_IN_FUTURE`);
      }
      const missingDay = await pay({ amount: 300_000, paymentDate: '1404/12/30' });
      if (missingDay.status !== 422) problems.push(`a payment dated on a non-existent day answered ${brief(missingDay)}, expected 422`);
      const after = await snapshot();
      if (after !== before) problems.push(`the refused payments changed the data: ${before} -> ${after}`);

      // today, a past date and an empty date (the business today) still pay
      const todayPay = await pay({ amount: 300_000, paymentDate: today });
      if (todayPay.status !== 200) problems.push(`a payment dated today answered ${brief(todayPay)}, expected 200`);
      else if (await datesOf(todayPay) !== `${today} ${today}`) problems.push(`the payment dated today stored ${await datesOf(todayPay)}, expected ${today} for the row and the voucher`);
      const pastPay = await pay({ amount: 300_000, paymentDate: '2026-05-01' });
      if (pastPay.status !== 200) problems.push(`a payment dated 2026-05-01 answered ${brief(pastPay)}, expected 200`);
      else if (await datesOf(pastPay) !== '2026-05-01 2026-05-01') problems.push(`the past payment stored ${await datesOf(pastPay)}, expected 2026-05-01`);
      const emptyPay = await pay({ paymentDate: '' });
      if (emptyPay.status !== 200) problems.push(`a payment without a date answered ${brief(emptyPay)}, expected 200`);
      else if (await datesOf(emptyPay) !== `${today} ${today}`) problems.push(`the payment without a date stored ${await datesOf(emptyPay)}, expected today ${today}`);
      const [paid] = await q('SELECT status, paid_amount::text AS paid FROM piecework_payrolls WHERE id = $1', [payrollId]);
      if (paid?.status !== 'paid' || num(paid?.paid) !== 900_000) problems.push(`the payslip is ${JSON.stringify(paid)} after three payments, expected paid 900000`);

      assertNoProblems(problems);
      return `Payments dated ${future} (ISO and Jalali) refused with 422 TREASURY_DATE_IN_FUTURE and a non-existent day with 422, nothing written; payments dated today, 2026-05-01 and without a date paid the 900,000 payslip.`;
    }));
  }

  return results;
}
