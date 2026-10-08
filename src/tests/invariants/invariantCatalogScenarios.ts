import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts, productionProjects } from '../../db/schema.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { ChequeLifecycleService } from '../../services/accounting/treasury/chequeLifecycle.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { FiscalYearService } from '../../services/accounting/fiscalYear.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { DocumentService } from '../../services/document.service.js';
import { createTestCustomer, createTestItem } from '../fixtures/factories.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { checkBusinessInvariants, checkGuardedReservations, type InvariantId, type InvariantScope } from './businessInvariants.js';
import { watermarks } from './scenarioHelpers.js';

/**
 * v10.0.10 (TD-982, I-01) — one check per invariant added in series 10 (I7, I8, I9, I11, I12, I17-I20): the data a
 * correct flow records passes, and a row broken by hand is reported under the expected invariant and key. Each broken
 * row is put back before the check returns, so later checks of the suite never read it.
 */

let seq = 0;
const tag = (prefix: string) => `${prefix}${Date.now().toString().slice(-7)}${++seq}`;

async function accountIdByCode(code: string): Promise<number> {
  const [row] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, code), eq(accounts.isDeleted, 0)));
  if (!row) throw new Error(`account ${code} is not in the test chart of accounts`);
  return row.id;
}

async function scopeFrom(extra: Partial<InvariantScope> = {}): Promise<InvariantScope> {
  const mark = await watermarks();
  const res = await pool.query<{ t: string; c: string }>(
    `SELECT (SELECT COALESCE(MAX(id), 0) FROM treasury_transactions)::text AS t, (SELECT COALESCE(MAX(id), 0) FROM cheques)::text AS c`);
  return { itemIds: [], ...mark, treasuryIdAfter: Number(res.rows[0].t), chequeIdAfter: Number(res.rows[0].c), ...extra };
}

/** Problems when the scope has violations other than the expected one, or when the expected one is missing */
async function expectViolations(scope: InvariantScope, when: string, expected?: { invariant: InvariantId; keyPrefix: string }): Promise<string[]> {
  const found = await checkBusinessInvariants(scope);
  const wanted = expected ? found.filter(v => v.invariant === expected.invariant && v.key.startsWith(expected.keyPrefix)) : [];
  const others = found.filter(v => !wanted.includes(v));
  const problems = others.map(v => `${when}: unexpected ${v.invariant} ${v.key}: ${v.message}`);
  if (expected && wanted.length === 0) problems.push(`${when}: ${expected.invariant} did not report ${expected.keyPrefix}`);
  return problems;
}

async function stockedItem(wh: string, date: string, quantity = 20, unitPrice = 100000): Promise<number> {
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date, user: 'inv', buyerName: 'ERP-TEST-MARKER I-01 supplier',
    items: [{ itemId: item.id, quantity, unitPrice, location: wh }],
  });
  return item.id;
}

async function invoice(wh: string, itemId: number, partyId: number, date: string, quantity: number, vatPercent?: number): Promise<number> {
  return DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status: 'final', date, user: 'inv', partyId, vatPercent,
    items: [{ itemId, quantity, unitPrice: 250000, location: wh }],
  });
}

/** A treasury account with a subsidiary ledger account of its own under general account 10 (a posting account, so I18 holds) */
async function cashBox(type: 'cash' | 'bank' = 'cash'): Promise<number> {
  const [ledger] = await orm.insert(accounts).values({
    code: `10${tag('')}`, name: `ERP-TEST-MARKER I-01 ${type} ledger`, level: 'subsidiary', parentId: await accountIdByCode('10'),
    accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  const bank = await BankAccountService.createBankAccount({
    title: `ERP-TEST-MARKER I-01 ${type} ${tag('B')}`, type, accountId: ledger.id, initialBalance: 0, currency: 'IRR',
  });
  return bank.id;
}

/** A voucher row on the given account of the given voucher, for breaking and putting back */
async function rowOf(voucherSql: string, params: unknown[]): Promise<{ id: number; debit: string; credit: string; account_id: number }> {
  const res = await pool.query<{ id: number; debit: string; credit: string; account_id: number }>(voucherSql, params);
  if (!res.rows[0]) throw new Error('no voucher row to break');
  return res.rows[0];
}

/** I8 and I20: invoices with VAT, a return, a receipt and a received cheque of one customer */
export async function checkCustomerBalanceAndVat(wh: string): Promise<string[]> {
  const customer = await createTestCustomer({ name: `ERP-TEST-MARKER I-01 customer ${tag('C')}`, partyType: 'customer' });
  const scope = await scopeFrom({ partyIds: [customer.id] });
  const itemId = await stockedItem(wh, '2026-03-01');
  scope.itemIds = [itemId];
  const invoiceId = await invoice(wh, itemId, customer.id, '2026-03-02', 4, 10);
  await DocumentService.createDocument({
    docType: 'return', inOut: 'in', status: 'final', date: '2026-03-03', user: 'inv', partyId: customer.id, returnOfDocumentId: invoiceId,
    items: [{ itemId, quantity: 1, location: wh }],
  });
  const bankAccountId = await cashBox();
  await TreasuryTransactionService.createTreasuryTransaction({
    type: 'receipt', method: 'cash', amount: 300000, bankAccountId, date: '2026-03-04',
    partyType: 'customer', partyId: customer.id, partyName: customer.name, username: 'inv',
  });
  await ChequeLifecycleService.createCheque({
    type: 'received', chequeNumber: tag('Q'), bankName: 'Mellat', issueDate: '2026-03-05', dueDate: '2026-05-01', amount: 200000,
    partyType: 'customer', partyId: customer.id, partyName: customer.name, username: 'inv',
  });
  const problems = await expectViolations(scope, 'customer flows');

  const receivable = await rowOf(
    `SELECT i.id, i.debit::text AS debit, i.credit::text AS credit, i.account_id FROM journal_voucher_items i
       JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 AND i.detailed_type = 'customer' AND i.debit > 0`, [invoiceId]);
  await pool.query(`UPDATE journal_voucher_items SET debit = debit + 5000 WHERE id = $1`, [receivable.id]);
  problems.push(...(await checkBusinessInvariants(scope)).some(v => v.invariant === 'I8_customer_balance' && v.key === `party:${customer.id}`)
    ? [] : ['I8 did not report a receivable row raised by 5,000']);
  await pool.query(`UPDATE journal_voucher_items SET debit = $2 WHERE id = $1`, [receivable.id, receivable.debit]);

  await pool.query(`UPDATE documents SET vat_amount = vat_amount + 7000 WHERE id = $1`, [invoiceId]);
  problems.push(...await expectViolations(scope, 'invoice VAT raised by 7,000 without its voucher', { invariant: 'I20_vat_payable_matches_documents', keyPrefix: 'vat-payable' })
    .then(p => p.filter(x => !x.includes('I8_customer_balance') && !x.includes('I5_invoice_receivable'))));
  await pool.query(`UPDATE documents SET vat_amount = vat_amount - 7000 WHERE id = $1`, [invoiceId]);
  return problems;
}

/** I9: a received cheque deposited and cleared; a history step outside the transition table and a lost voucher are reported */
export async function checkChequeTransitionChain(): Promise<string[]> {
  const scope = await scopeFrom();
  const bankAccountId = await cashBox('bank');
  const cheque = await ChequeLifecycleService.createCheque({
    type: 'received', chequeNumber: tag('Q'), bankName: 'Melli', issueDate: '2026-03-01', dueDate: '2026-04-01', amount: 900000,
    partyName: 'ERP-TEST-MARKER I-01 drawer', username: 'inv',
  });
  await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'in_collection', actionDate: '2026-03-10', bankAccountId, username: 'inv' });
  await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'passed', actionDate: '2026-04-02', bankAccountId, username: 'inv' });
  const problems = await expectViolations(scope, 'cheque received, in collection, cleared');

  const history = (await pool.query<{ h: unknown }>(`SELECT status_history AS h FROM cheques WHERE id = $1`, [cheque.id])).rows[0].h;
  const skipped = (history as Array<Record<string, unknown>>).filter(s => s.status !== 'in_collection');
  await pool.query(`UPDATE cheques SET status_history = $2::jsonb WHERE id = $1`, [cheque.id, JSON.stringify([...skipped, { status: 'returned' }])]);
  problems.push(...await expectViolations(scope, 'history ending in a step the status does not allow', { invariant: 'I9_cheque_transitions', keyPrefix: `cheque:${cheque.id}` }));
  await pool.query(`UPDATE cheques SET status_history = $2::jsonb WHERE id = $1`, [cheque.id, JSON.stringify(history)]);

  const [collected] = (await pool.query<{ id: number }>(
    `SELECT id FROM journal_vouchers WHERE source_cheque_id = $1 AND is_deleted = 0 ORDER BY id LIMIT 1 OFFSET 1`, [cheque.id])).rows;
  await pool.query(`UPDATE journal_vouchers SET is_deleted = 1 WHERE id = $1`, [collected.id]);
  problems.push(...await expectViolations(scope, 'cheque with its in-collection voucher deleted', { invariant: 'I9_cheque_transitions', keyPrefix: `cheque:${cheque.id}:vouchers` })
    .then(p => p.filter(x => !x.includes('I15') && !x.includes('I8'))));
  await pool.query(`UPDATE journal_vouchers SET is_deleted = 0 WHERE id = $1`, [collected.id]);
  return problems;
}

/** Jalali years closed by the I11 check: before every other test's dates (1387 is closed by the leap-year check); each closing carries its opening voucher, so stock keeps its ledger value (I3) */
const CATALOG_CLOSING_YEAR = 1380;

/** I11: a year closed with its opening voucher, the next year closed too; a row changed in the closed year is reported */
export async function checkClosedYearInvariant(wh: string): Promise<string[]> {
  const years = [CATALOG_CLOSING_YEAR, CATALOG_CLOSING_YEAR + 1];
  const customer = await createTestCustomer({ name: `ERP-TEST-MARKER I-01 closing ${tag('C')}`, partyType: 'customer' });
  const scope = await scopeFrom({ fiscalYears: years });
  const itemId = await stockedItem(wh, '2001-06-01');
  scope.itemIds = [itemId];
  await invoice(wh, itemId, customer.id, '2001-07-01', 3);
  const drafts = await pool.query<{ id: number }>(`SELECT id FROM journal_vouchers WHERE id > $1 AND is_deleted = 0 AND status = 'draft'`, [scope.voucherIdAfter]);
  await VoucherService.approveJournalVouchers(drafts.rows.map(r => r.id), undefined, 'inv');
  await FiscalYearService.executeFiscalYearClosing({ year: CATALOG_CLOSING_YEAR, createOpeningVoucher: true, username: 'inv' });
  await FiscalYearService.executeFiscalYearClosing({ year: CATALOG_CLOSING_YEAR + 1, createOpeningVoucher: true, username: 'inv' });
  const problems = await expectViolations(scope, `fiscal years ${years.join(' and ')} closed`);

  const sales = await rowOf(
    `SELECT i.id, i.debit::text AS debit, i.credit::text AS credit, i.account_id FROM journal_voucher_items i
       JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE v.id > $1 AND v.is_deleted = 0 AND i.is_deleted = 0 AND v.voucher_type <> 'closing' AND v.voucher_type <> 'opening'
        AND v.date < '2002-03-21' AND i.credit > 0
      ORDER BY i.id LIMIT 1`, [scope.voucherIdAfter]);
  await pool.query(`UPDATE journal_voucher_items SET credit = credit + 1000 WHERE id = $1`, [sales.id]);
  const found = await checkBusinessInvariants(scope);
  if (!found.some(v => v.invariant === 'I11_fiscal_year_closing' && v.key === `fy:${CATALOG_CLOSING_YEAR}:account:${sales.account_id}`)) {
    problems.push('I11 did not report an account left nonzero in the closed year');
  }
  await pool.query(`UPDATE journal_voucher_items SET credit = $2 WHERE id = $1`, [sales.id, sales.credit]);
  return problems;
}

/** I12: a document numbered in another year than its date, and two live treasury rows with one number, are reported */
export async function checkNumberingInvariant(wh: string): Promise<string[]> {
  const scope = await scopeFrom();
  const itemId = await stockedItem(wh, '2026-03-01');
  scope.itemIds = [itemId];
  const bankAccountId = await cashBox();
  const base = { method: 'cash' as const, bankAccountId, date: '2026-03-02', partyType: 'other' as const, contraAccountId: await miscContraAccountId(), username: 'inv' };
  await TreasuryTransactionService.createTreasuryTransaction({ ...base, type: 'receipt', amount: 100000, partyName: 'ERP-TEST-MARKER I-01 r' });
  const first = await TreasuryTransactionService.createTreasuryTransaction({ ...base, type: 'payment', amount: 10000, partyName: 'ERP-TEST-MARKER I-01 a' });
  const second = await TreasuryTransactionService.createTreasuryTransaction({ ...base, type: 'payment', amount: 20000, partyName: 'ERP-TEST-MARKER I-01 b' });
  const problems = await expectViolations(scope, 'receipt and two treasury payments');

  const doc = (await pool.query<{ id: number; ref_fiscal_year: number }>(`SELECT id, ref_fiscal_year FROM documents WHERE id > $1 ORDER BY id LIMIT 1`, [scope.documentIdAfter])).rows[0];
  await pool.query(`UPDATE documents SET ref_fiscal_year = ref_fiscal_year - 50 WHERE id = $1`, [doc.id]);
  problems.push(...await expectViolations(scope, 'document numbered fifty years earlier', { invariant: 'I12_unique_numbers', keyPrefix: `doc-year:${doc.id}` }));
  await pool.query(`UPDATE documents SET ref_fiscal_year = $2 WHERE id = $1`, [doc.id, doc.ref_fiscal_year]);

  const number = (await pool.query<{ n: string }>(`SELECT transaction_number AS n FROM treasury_transactions WHERE id = $1`, [second.id])).rows[0].n;
  const firstNumber = (await pool.query<{ n: string }>(`SELECT transaction_number AS n FROM treasury_transactions WHERE id = $1`, [first.id])).rows[0].n;
  await pool.query(`UPDATE treasury_transactions SET transaction_number = $2 WHERE id = $1`, [second.id, firstNumber]);
  problems.push(...await expectViolations(scope, 'two treasury rows with one number', { invariant: 'I12_unique_numbers', keyPrefix: `treasury-number:${firstNumber}` }));
  await pool.query(`UPDATE treasury_transactions SET transaction_number = $2 WHERE id = $1`, [second.id, number]);
  return problems;
}

/** I17 and I18: a sales voucher passes; a foreign row without a rate, an unbalanced foreign row and a row on a group account are reported */
export async function checkLedgerRowInvariants(wh: string): Promise<string[]> {
  const customer = await createTestCustomer({ name: `ERP-TEST-MARKER I-01 ledger ${tag('C')}`, partyType: 'customer' });
  const scope = await scopeFrom();
  const itemId = await stockedItem(wh, '2026-03-01');
  scope.itemIds = [itemId];
  const invoiceId = await invoice(wh, itemId, customer.id, '2026-03-02', 2);
  const problems = await expectViolations(scope, 'sales invoice');
  const row = await rowOf(
    `SELECT i.id, i.debit::text AS debit, i.credit::text AS credit, i.account_id FROM journal_voucher_items i
       JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 AND i.credit > 0 ORDER BY i.id LIMIT 1`, [invoiceId]);
  const voucherId = (await pool.query<{ v: number }>(`SELECT voucher_id AS v FROM journal_voucher_items WHERE id = $1`, [row.id])).rows[0].v;

  await pool.query(`UPDATE journal_voucher_items SET currency = 'USD', exchange_rate = NULL WHERE id = $1`, [row.id]);
  problems.push(...await expectViolations(scope, 'foreign row without a rate', { invariant: 'I17_voucher_rial_balance', keyPrefix: `voucher-rate:${voucherId}` })
    .then(p => p.filter(x => !x.includes('I1_') && !x.includes('I3_'))));
  await pool.query(`UPDATE journal_voucher_items SET exchange_rate = 2 WHERE id = $1`, [row.id]);
  problems.push(...await expectViolations(scope, 'foreign row at rate 2 on a rial voucher', { invariant: 'I17_voucher_rial_balance', keyPrefix: `voucher:${voucherId}` })
    .then(p => p.filter(x => !x.includes('I1_') && !x.includes('I3_'))));
  await pool.query(`UPDATE journal_voucher_items SET currency = NULL, exchange_rate = NULL WHERE id = $1`, [row.id]);

  const group = await accountIdByCode('5');
  await pool.query(`UPDATE journal_voucher_items SET account_id = $2 WHERE id = $1`, [row.id, group]);
  problems.push(...await expectViolations(scope, 'row moved to a group account', { invariant: 'I18_rows_on_posting_accounts', keyPrefix: `account:${group}` }));
  await pool.query(`UPDATE journal_voucher_items SET account_id = $2 WHERE id = $1`, [row.id, row.account_id]);
  return problems.length ? problems : await expectViolations(scope, 'after putting the rows back');
}

/** I7 and I19: a project reservation deducted by a remittance and restored by its void; broken rows are reported */
export async function checkReservationInvariants(wh: string): Promise<string[]> {
  const scope = await scopeFrom();
  const itemId = await stockedItem(wh, '2026-03-01', 10);
  const item = (await pool.query<{ code: string; name: string }>(`SELECT code, name FROM items WHERE id = $1`, [itemId])).rows[0];
  const [project] = await orm.insert(productionProjects).values({
    projectCode: `PROJ_I01_${tag('P')}`, title: 'ERP-TEST-MARKER I-01 reservation project', status: 'in_progress', version: 1,
    inventoryControl: { isFinalized: true, isReserved: true, reservedItems: [{ itemId, itemCode: item.code, itemName: item.name, reservedQty: 6, unit: 'عدد' }] },
  }).returning({ id: productionProjects.id });
  Object.assign(scope, { projectIds: [project.id], itemIds: [itemId] });
  const remittance = await DocumentService.createDocument({
    docType: 'remittance', inOut: 'out', status: 'final', date: '2026-03-02', user: 'inv', projectId: project.id,
    items: [{ itemId, quantity: 2, unitPrice: 0, location: wh }],
  });
  await DocumentService.deleteDocument(remittance, 'inv');
  const problems = await expectViolations(scope, 'project remittance and its void');
  problems.push(...(await checkGuardedReservations(scope)).map(v => `reservation 6 of stock 10: unexpected ${v.key}`));

  await pool.query(`UPDATE project_reservation_releases SET restored_at = NULL WHERE document_id = $1`, [remittance]);
  problems.push(...await expectViolations(scope, 'deduction of a voided remittance left unrestored', { invariant: 'I7_project_reservation', keyPrefix: 'release:' }));
  await pool.query(`UPDATE project_reservation_releases SET restored_at = now() WHERE document_id = $1`, [remittance]);

  const control = { isFinalized: false, reservedItems: [{ itemId, reservedQty: -1 }] };
  await orm.update(productionProjects).set({ inventoryControl: control }).where(eq(productionProjects.id, project.id));
  const found = await checkBusinessInvariants(scope);
  for (const key of [`project:${project.id}:negative`, `project:${project.id}:unfinalized`]) {
    if (!found.some(v => v.invariant === 'I7_project_reservation' && v.key === key)) problems.push(`I7 did not report ${key}`);
  }
  await orm.update(productionProjects).set({ inventoryControl: { isFinalized: true, reservedItems: [{ itemId, itemCode: item.code, reservedQty: 14 }] } })
    .where(eq(productionProjects.id, project.id));
  if (!(await checkGuardedReservations(scope)).some(v => v.key === `item:${itemId}`)) problems.push('I19 did not report a reservation of 14 on a stock of 10');
  await orm.update(productionProjects).set({ inventoryControl: {} }).where(eq(productionProjects.id, project.id));
  return problems;
}

export const INVARIANT_CATALOG_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_i8_i20_customer_balance_and_vat', 'v10.0.10: I8 customer receivable = invoices - returns - receipts - cheques and I20 VAT payable = invoice VAT - return VAT hold, and a broken row is reported (TD-982)',
    checkCustomerBalanceAndVat, 'invoice with VAT, return, receipt and cheque pass; raised receivable row and invoice VAT reported'],
  ['inv_i9_cheque_transitions', 'v10.0.10: I9 a cheque history is a chain of allowed transitions with one voucher per posting step, and a broken history or lost voucher is reported (TD-982)',
    checkChequeTransitionChain, 'received, in collection, cleared passes; history and lost voucher reported'],
  ['inv_i11_closed_year', 'v10.0.10: I11 a closed year balances to zero and its opening mirrors its closing, and a row changed after closing is reported (TD-982)',
    checkClosedYearInvariant, 'two years closed in order pass; changed sales row reported'],
  ['inv_i12_unique_numbers', 'v10.0.10: I12 a document is numbered in its own year and treasury numbers are unique, and a break of either is reported (TD-982)',
    checkNumberingInvariant, 'documents and treasury rows pass; wrong numbering year and duplicate treasury number reported'],
  ['inv_i17_i18_ledger_rows', 'v10.0.10: I17 every voucher balances in rials with a rate on each foreign row and I18 no row sits on a non-posting account, and a broken row is reported (TD-982)',
    checkLedgerRowInvariants, 'sales voucher passes; rateless row, unbalanced foreign row and group-account row reported'],
  ['inv_i7_i19_reservations', 'v10.0.10: I7 project reservation deductions agree with their sources and rows are never negative, and I19 reservations above stock are reported (TD-982)',
    checkReservationInvariants, 'remittance and void pass; unrestored deduction, negative and unfinalized rows and over-reservation reported'],
];
