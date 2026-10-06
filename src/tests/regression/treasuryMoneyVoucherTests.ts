import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { accounts, bankAccounts, cheques, journalVouchers, treasuryTransactions, workflowDefinitions, workflowInstances } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { fin } from '../../lib/financialDecimal.js';

/**
 * Package 4 (treasury and cheques), PR «الف» money and vouchers: real Express routes on PostgreSQL. Each test is red on
 * the version before its fix.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Session = { cookie: string; csrfToken: string };

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;

async function client(session?: Session) {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s: Session = session ?? await getAdminSession();
  return {
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
    post: (url: string, body: object = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    put: (url: string, body: object = {}) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    del: (url: string) => request(app).delete(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
  };
}

async function sessionWith(permissions: string[]): Promise<Session> {
  const { getTestApp, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
  const role = await createTestRole({ permissions });
  const user = await createTestUser({ role: role.code, username: `p04_${tagOf()}` });
  return loginTestUserWithSession(await getTestApp(), user.username);
}

/** A ledger account of its own under 1003, so other tests' banks never touch this bank's ledger balance */
async function ownLedgerAccount(title: string): Promise<number> {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
  const [ledger] = await orm.insert(accounts).values({
    code: `1003${tagOf()}`, name: `${title} (test ledger)`, level: 'subsidiary', parentId: parent?.id ?? null,
    accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  return ledger.id;
}

async function createBank(title: string, initialBalance = 0): Promise<number> {
  const api = await client();
  const res = await api.post('/api/accounting/bank-accounts', {
    title: `${title} ${tagOf()}`, type: 'bank', accountId: await ownLedgerAccount(title), initialBalance,
  });
  if (res.status !== 201 && res.status !== 200) throw new Error(`bank create returned ${res.status}: ${JSON.stringify(res.body)}`);
  return Number(res.body.id);
}

async function bankBalance(id: number): Promise<string> {
  const [row] = await orm.select({ current: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, id));
  return fin(row?.current ?? 0).toString();
}

const errorText = (res: request.Response) => String(res.body?.error ?? res.body?.message ?? '');

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

export async function runTreasuryMoneyVoucherTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const reversalId = 'reg_treasury_reversal_void_refused_td_499';
  if (shouldRun(reversalId, 'td499', 'treasury', 'void', 'package4')) {
    await runCase(results, reversalId, 'v9.0.67: voiding a treasury reversal row is refused with 409, the bank keeps matching its ledger, and a legacy revived row is listed by the health check and the bank invariants (TD-499)', async () => {
      const { checkBankInvariants } = await import('../invariants/bankInvariants.js');
      const { findTreasuryEntriesWithoutVoucher } = await import('../../services/accounting/treasury/noVoucherTreasury.js');
      const problems: string[] = [];
      const bankId = await createBank('Revive bank');
      // a treasurer with accounting.treasury only, not the no-voucher permission (TD-409)
      const treasurer = await client(await sessionWith(['accounting.treasury']));
      const receipt = await treasurer.post('/api/accounting/treasury', {
        type: 'receipt', method: 'bank_transfer', amount: 5_000_000, bankAccountId: bankId, partyType: 'other', partyName: 'test deposit',
      });
      if (receipt.status !== 201) throw new Error(`receipt returned ${receipt.status}: ${errorText(receipt)}`);
      const voided = await treasurer.post(`/api/accounting/treasury/${receipt.body.id}/void`, { reason: 'wrong entry' });
      if (voided.status !== 200) throw new Error(`void returned ${voided.status}: ${errorText(voided)}`);
      const revive = await treasurer.post(`/api/accounting/treasury/${voided.body.id}/void`, { reason: 'revive' });
      if (revive.status !== 409) problems.push(`voiding the reversal row returned ${revive.status}, expected 409`);
      else if (!errorText(revive).includes('تراکنش تازه')) problems.push(`409 message does not point to a new transaction: ${errorText(revive)}`);
      if (await bankBalance(bankId) !== '0') problems.push(`bank balance is ${await bankBalance(bankId)} after the refused revive, expected 0`);
      const bankRows = await orm.select({ id: treasuryTransactions.id, status: treasuryTransactions.status }).from(treasuryTransactions)
        .where(eq(treasuryTransactions.bankAccountId, bankId));
      if (bankRows.length !== 2) problems.push(`bank has ${bankRows.length} treasury rows, expected 2 (receipt + reversal)`);
      const clean = await checkBankInvariants([bankId]);
      if (clean.length > 0) problems.push(`bank invariants on a clean bank: ${clean.map(v => v.invariant).join(', ')}`);

      // legacy data written before v9.0.67: the reversal row voided and a revived row without a voucher
      await orm.update(treasuryTransactions).set({ status: 'voided' }).where(eq(treasuryTransactions.id, Number(voided.body.id)));
      const [legacy] = await orm.insert(treasuryTransactions).values({
        transactionNumber: `REC-LEGACY-${tagOf()}`, type: 'receipt', date: '2026-01-10', method: 'bank_transfer', amount: money(5_000_000),
        currency: 'IRR', exchangeRate: money(1), bankAccountId: bankId, partyType: 'other', partyName: 'test deposit',
        voucherId: null, reversalOfId: Number(voided.body.id), description: 'legacy revive', status: 'completed',
      }).returning({ id: treasuryTransactions.id });
      await orm.update(bankAccounts).set({ currentBalance: money(5_000_000) }).where(eq(bankAccounts.id, bankId));
      try {
        const listed = (await findTreasuryEntriesWithoutVoucher()).filter(e => e.kind === 'treasury' && e.id === legacy.id);
        if (listed.length !== 1) problems.push('health check «treasury_without_voucher» does not list the legacy revived row');
        const found = (await checkBankInvariants([bankId])).map(v => v.invariant).sort();
        if (found.join(',') !== 'I15_bank_balance_matches_ledger,I16_no_revived_treasury_without_voucher') {
          problems.push(`bank invariants on the revived bank: [${found.join(', ')}], expected I15 and I16`);
        }
      } finally {
        await orm.update(treasuryTransactions).set({ isDeleted: 1 }).where(eq(treasuryTransactions.id, legacy.id));
        await orm.update(treasuryTransactions).set({ status: 'completed' }).where(eq(treasuryTransactions.id, Number(voided.body.id)));
        await orm.update(bankAccounts).set({ currentBalance: money(0) }).where(eq(bankAccounts.id, bankId));
      }
      assertNoProblems(problems);
      return 'Receipt 5,000,000 voided (bank 0, ledger 0); voiding its reversal row gave 409 and the bank stayed 0; a legacy revived row was listed by the health check and broke I15 and I16';
    });
  }

  const settledId = 'reg_invoice_settled_after_void_and_rereceipt_td_500';
  if (shouldRun(settledId, 'td500', 'treasury', 'invoice', 'settlement', 'package4')) {
    await runCase(results, settledId, 'v9.0.68: an invoice whose receipt was voided and received again shows the new receipt as paid in its detail and in the invoice list (TD-500)', async () => {
      const { createTestItem, createTestCustomer } = await import('../fixtures/factories.js');
      const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
      const problems: string[] = [];
      const api = await client();
      const wh = (await getDefaultWarehouseCode(orm)) as string;
      const item = await createTestItem({ type: 'product', stocks: { [wh]: 5 }, weightedAverageCost: 1_000_000 });
      const customer = await createTestCustomer();
      const bankId = await createBank('Settlement bank');
      const invoice = await api.post('/api/documents', {
        docType: 'invoice', status: 'final', inOut: 'out', refNumber: 'auto', date: await businessTodayIsoDate(), buyer_name: customer.name,
        items: [{ itemId: item.id, quantity: 1, unit_price: 3_000_000, location: wh }],
      });
      if (invoice.status !== 201 && invoice.status !== 200) throw new Error(`invoice create returned ${invoice.status}: ${errorText(invoice)}`);
      const docId = Number(invoice.body?.id ?? invoice.body?.docId);
      const receive = async (label: string) => {
        const res = await api.post('/api/accounting/treasury', {
          type: 'receipt', method: 'bank_transfer', amount: 3_000_000, bankAccountId: bankId,
          partyType: 'customer', partyId: customer.id, partyName: customer.name, documentId: docId,
        });
        if (res.status !== 201) throw new Error(`${label} returned ${res.status}: ${errorText(res)}`);
        return Number(res.body.id);
      };
      const expectPaid = async (label: string, paid: number, status: string) => {
        const detail = await api.get(`/api/documents/${docId}`);
        if (detail.status !== 200) { problems.push(`${label}: invoice detail returned ${detail.status}`); return; }
        const got = `${Number(detail.body.paidAmount)}/${Number(detail.body.remainingAmount)}/${detail.body.settlementStatus}`;
        if (got !== `${paid}/${3_000_000 - paid}/${status}`) problems.push(`${label}: detail paid/remaining/status ${got}, expected ${paid}/${3_000_000 - paid}/${status}`);
        const list = await api.get(`/api/documents?type=invoice&search=${encodeURIComponent(String(customer.name))}&limit=200`);
        const rows: Array<{ id: number; paidAmount: number }> = Array.isArray(list.body?.data) ? list.body.data : (Array.isArray(list.body) ? list.body : []);
        const row = rows.find(r => Number(r.id) === docId);
        if (!row) problems.push(`${label}: invoice not found in the invoice list`);
        else if (Number(row.paidAmount) !== paid) problems.push(`${label}: invoice list paid ${row.paidAmount}, expected ${paid}`);
      };

      const first = await receive('first receipt');
      await expectPaid('after the first receipt', 3_000_000, 'fully_paid');
      const voided = await api.post(`/api/accounting/treasury/${first}/void`, { reason: 'wrong bank' });
      if (voided.status !== 200) throw new Error(`void returned ${voided.status}: ${errorText(voided)}`);
      await expectPaid('after the void', 0, 'unpaid');
      await receive('second receipt');
      await expectPaid('after receiving again', 3_000_000, 'fully_paid');
      assertNoProblems(problems);
      return 'Invoice 3,000,000: receipt (paid 3,000,000), void (paid 0), receipt again (paid 3,000,000, fully paid) in the detail and the list';
    });
  }

  const chequeId = 'reg_cheque_with_permanent_voucher_not_deleted_td_502';
  if (shouldRun(chequeId, 'td502', 'treasury', 'cheque', 'package4')) {
    await runCase(results, chequeId, 'v9.0.69: a cheque whose voucher is permanent is not deleted (409 naming the voucher) and its voucher stays; a cheque with an approved voucher is still deleted with a reversal voucher (TD-502)', async () => {
      const { createTestCustomer } = await import('../fixtures/factories.js');
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
      const problems: string[] = [];
      const api = await client();
      const customer = await createTestCustomer();
      const today = await businessTodayIsoDate();
      const newCheque = async (label: string) => {
        const res = await api.post('/api/accounting/cheques', {
          type: 'received', chequeNumber: `9${tagOf()}`, bankName: 'Test bank', issueDate: today, dueDate: today, amount: 6_000_000,
          partyType: 'customer', partyId: customer.id, partyName: customer.name,
        });
        if (res.status !== 201) throw new Error(`${label} cheque create returned ${res.status}: ${errorText(res)}`);
        const [row] = await orm.select({ voucherId: cheques.voucherId }).from(cheques).where(eq(cheques.id, Number(res.body.id)));
        if (!row?.voucherId) throw new Error(`${label} cheque has no voucher`);
        const approved = await api.put(`/api/accounting/vouchers/${row.voucherId}/status`, { status: 'approved' });
        if (approved.status !== 200) throw new Error(`${label} voucher approve returned ${approved.status}: ${errorText(approved)}`);
        return { id: Number(res.body.id), voucherId: row.voucherId };
      };
      const voucherOf = async (id: number) =>
        (await orm.select({ number: journalVouchers.voucherNumber, isDeleted: journalVouchers.isDeleted, status: journalVouchers.status })
          .from(journalVouchers).where(eq(journalVouchers.id, id)))[0];
      const chequeDeleted = async (id: number) => (await orm.select({ d: cheques.isDeleted }).from(cheques).where(eq(cheques.id, id)))[0]?.d === 1;

      const locked = await newCheque('permanent');
      const finalized = await api.post(`/api/accounting/vouchers/${locked.voucherId}/finalize`);
      if (finalized.status !== 200) throw new Error(`voucher finalize returned ${finalized.status}: ${errorText(finalized)}`);
      const lockedVoucher = await voucherOf(locked.voucherId);
      const refused = await api.del(`/api/accounting/cheques/${locked.id}`);
      if (refused.status !== 409) problems.push(`deleting the cheque with a permanent voucher returned ${refused.status}, expected 409`);
      else if (!errorText(refused).includes(String(lockedVoucher.number))) problems.push(`409 message does not name voucher ${lockedVoucher.number}: ${errorText(refused)}`);
      if (await chequeDeleted(locked.id)) problems.push('the cheque with a permanent voucher was deleted');
      const after = await voucherOf(locked.voucherId);
      if (after.isDeleted !== 0 || after.status !== 'permanent') problems.push(`the permanent voucher changed: deleted ${after.isDeleted}, status ${after.status}`);

      const open = await newCheque('approved');
      const deleted = await api.del(`/api/accounting/cheques/${open.id}`);
      if (deleted.status !== 200) problems.push(`deleting the cheque with an approved voucher returned ${deleted.status}: ${errorText(deleted)}`);
      if (!await chequeDeleted(open.id)) problems.push('the cheque with an approved voucher was not deleted');
      const openVoucher = await voucherOf(open.voucherId);
      const [reversal] = await orm.select({ id: journalVouchers.id }).from(journalVouchers)
        .where(and(eq(journalVouchers.referenceId, open.voucherId), eq(journalVouchers.referenceNumber, `REV-V${openVoucher.number}`), eq(journalVouchers.isDeleted, 0)));
      if (!reversal) problems.push('the approved voucher of the deleted cheque got no reversal voucher');
      assertNoProblems(problems);
      return `Cheque 6,000,000 with permanent voucher ${lockedVoucher.number}: delete 409, cheque and voucher kept; cheque with an approved voucher: deleted and reversed`;
    });
  }

  const bankDeleteId = 'reg_bank_delete_voids_opening_voucher_td_503';
  if (shouldRun(bankDeleteId, 'td503', 'treasury', 'bank', 'package4')) {
    await runCase(results, bankDeleteId, 'v9.0.70: deleting a bank account voids its opening vouchers (approved: reversal, draft adjustment: soft delete) so its ledger nets to zero; a permanent opening voucher refuses the delete with 409 (TD-503)', async () => {
      const problems: string[] = [];
      const api = await client();
      const openingVouchersOf = async (bankId: number) => orm.select({ id: journalVouchers.id, number: journalVouchers.voucherNumber, status: journalVouchers.status, isDeleted: journalVouchers.isDeleted, type: journalVouchers.voucherType })
        .from(journalVouchers).where(and(eq(journalVouchers.referenceModule, 'treasury_opening'), eq(journalVouchers.referenceId, bankId), eq(journalVouchers.referenceNumber, await bankCode(bankId))));
      const approve = async (voucherId: number) => {
        const res = await api.put(`/api/accounting/vouchers/${voucherId}/status`, { status: 'approved' });
        if (res.status !== 200) throw new Error(`voucher approve returned ${res.status}: ${errorText(res)}`);
      };
      const bankLedger = async (bankId: number) => {
        const r = await orm.execute(sql`SELECT COALESCE(SUM(i.debit - i.credit), 0)::text AS net FROM journal_voucher_items i
          JOIN journal_vouchers v ON v.id = i.voucher_id WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND i.detailed_type = 'bank_account' AND i.detailed_id = ${bankId}`);
        return fin(String((r.rows[0] as { net: string }).net)).toString();
      };
      const bankIsDeleted = async (bankId: number) => (await orm.select({ d: bankAccounts.isDeleted }).from(bankAccounts).where(eq(bankAccounts.id, bankId)))[0]?.d === 1;

      // 1) opening 1,000,000 approved, then +500,000 as a draft adjustment: the ledger shows 1,000,000 (the draft too: 1,500,000)
      const bankA = await createBank('Opening bank', 1_000_000);
      const [opening] = await openingVouchersOf(bankA);
      if (!opening) throw new Error('bank A has no opening voucher');
      await approve(opening.id);
      const edited = await api.put(`/api/accounting/bank-accounts/${bankA}`, { initialBalance: 1_500_000 });
      if (edited.status !== 200) throw new Error(`opening balance edit returned ${edited.status}: ${errorText(edited)}`);
      if (await bankLedger(bankA) !== '1500000') problems.push(`bank A ledger before delete ${await bankLedger(bankA)}, expected 1500000`);
      const delA = await api.del(`/api/accounting/bank-accounts/${bankA}`);
      if (delA.status !== 200) problems.push(`deleting bank A returned ${delA.status}: ${errorText(delA)}`);
      if (await bankLedger(bankA) !== '0') problems.push(`bank A ledger after delete ${await bankLedger(bankA)}, expected 0`);
      const vouchersA = await openingVouchersOf(bankA);
      const adjustment = vouchersA.find(v => v.type === 'adjustment');
      if (!adjustment || adjustment.isDeleted !== 1) problems.push('the draft adjustment voucher of bank A was not soft-deleted');
      const [reversal] = await orm.select({ id: journalVouchers.id }).from(journalVouchers)
        .where(and(eq(journalVouchers.referenceId, opening.id), eq(journalVouchers.referenceNumber, `REV-V${opening.number}`), eq(journalVouchers.isDeleted, 0)));
      if (!reversal) problems.push('the approved opening voucher of bank A got no reversal voucher');

      // 2) opening 7,000,000 made permanent: the delete is refused and nothing changes
      const bankB = await createBank('Locked bank', 7_000_000);
      const [lockedOpening] = await openingVouchersOf(bankB);
      await approve(lockedOpening.id);
      const finalized = await api.post(`/api/accounting/vouchers/${lockedOpening.id}/finalize`);
      if (finalized.status !== 200) throw new Error(`voucher finalize returned ${finalized.status}: ${errorText(finalized)}`);
      const delB = await api.del(`/api/accounting/bank-accounts/${bankB}`);
      if (delB.status !== 409) problems.push(`deleting bank B with a permanent opening voucher returned ${delB.status}, expected 409`);
      else if (!errorText(delB).includes(String(lockedOpening.number))) problems.push(`409 message does not name voucher ${lockedOpening.number}: ${errorText(delB)}`);
      if (await bankIsDeleted(bankB)) problems.push('bank B was deleted');
      if (await bankLedger(bankB) !== '7000000') problems.push(`bank B ledger ${await bankLedger(bankB)}, expected 7000000`);
      assertNoProblems(problems);
      return 'Bank A (opening 1,000,000 approved + draft adjustment 500,000): delete reversed the opening, removed the draft, ledger 0; bank B (opening 7,000,000 permanent): delete 409, bank and ledger 7,000,000 kept';
    });
  }

  const pendingId = 'reg_opening_balance_edit_refused_while_approval_pending_td_504';
  if (shouldRun(pendingId, 'td504', 'treasury', 'bank', 'workflow', 'package4')) {
    await runCase(results, pendingId, 'v9.0.71: while the approval workflow of a new bank account is open, editing its opening balance is refused with 409 and issues no opening voucher; other fields stay editable (TD-504)', async () => {
      const { createTestWorkflow } = await import('../fixtures/factories.js');
      const problems: string[] = [];
      const api = await client();
      const wf = await createTestWorkflow({
        definition: { entityType: 'bank_account' },
        states: [{ key: 'draft', title: 'Draft', type: 'initial' }, { key: 'approved', title: 'Approved', type: 'terminal' }],
        transitions: [{ fromKey: 'draft', toKey: 'approved', actionKey: 'approve_td504', title: 'Approve' }],
      });
      let bankId = 0;
      try {
        bankId = await createBank('Pending bank', 5_000_000);
      } finally {
        // only this bank starts under the test definition; later tests create banks without a workflow
        await orm.update(workflowDefinitions).set({ isActive: 0 }).where(eq(workflowDefinitions.id, wf.definition.id));
      }
      const [instance] = await orm.select({ id: workflowInstances.id, status: workflowInstances.status }).from(workflowInstances)
        .where(and(eq(workflowInstances.entityType, 'bank_account'), eq(workflowInstances.entityId, String(bankId))));
      if (instance?.status !== 'IN_PROGRESS') throw new Error(`bank workflow instance is ${instance?.status ?? 'missing'}, expected IN_PROGRESS`);
      const openings = async () => (await orm.select({ id: journalVouchers.id }).from(journalVouchers)
        .where(and(eq(journalVouchers.referenceModule, 'treasury_opening'), eq(journalVouchers.referenceId, bankId), eq(journalVouchers.isDeleted, 0),
          eq(journalVouchers.referenceNumber, await bankCode(bankId))))).length;
      if (await openings() !== 0) problems.push('the bank has an opening voucher before approval');

      const edit = await api.put(`/api/accounting/bank-accounts/${bankId}`, { initialBalance: 5_500_000 });
      if (edit.status !== 409) problems.push(`opening balance edit while pending returned ${edit.status}, expected 409`);
      if (await openings() !== 0) problems.push('the opening balance edit issued an opening voucher before approval');
      const [bank] = await orm.select({ initial: bankAccounts.initialBalance, current: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, bankId));
      if (fin(bank.initial).toString() !== '5000000' || fin(bank.current).toString() !== '5000000') {
        problems.push(`bank balances changed to initial ${fin(bank.initial).toString()} / current ${fin(bank.current).toString()}, expected 5000000`);
      }
      const rename = await api.put(`/api/accounting/bank-accounts/${bankId}`, { title: `Pending bank renamed ${tagOf()}`, initialBalance: 5_000_000 });
      if (rename.status !== 200) problems.push(`editing the title (same opening balance) while pending returned ${rename.status}: ${errorText(rename)}`);
      assertNoProblems(problems);
      return 'Bank 5,000,000 waiting for approval: opening balance edit to 5,500,000 gave 409, no opening voucher, balances 5,000,000; a title edit was accepted';
    });
  }

  return results;
}

async function bankCode(bankId: number): Promise<string> {
  const [row] = await orm.select({ code: bankAccounts.code }).from(bankAccounts).where(eq(bankAccounts.id, bankId));
  return String(row?.code ?? '');
}
