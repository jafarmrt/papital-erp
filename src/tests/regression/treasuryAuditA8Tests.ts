import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';
import { AccountMappingService, DEFAULT_ACCOUNT_MAPPINGS } from '../../services/accounting/accountMapping.service.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { resolveChequePartyAccountId } from '../../services/accounting/treasury/chequePartyAccount.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { fundedBank } from '../invariants/payrollScenarios.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Series 10 phase 3 lane L1, package A8 (v10.0.262): treasury audit rows are written with the write's own transaction
 * (TD-934, OBS-R1-63), so a refused audit row leaves no treasury write behind; and a missing mapped account never sends a
 * treasury or cheque party row to the general account (OWN-03, OBS-R2-04). Each test is red on the version before its fix.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;

async function adminClient() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s = await getAdminSession();
  const send = (r: request.Test, body: object) => r.set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body);
  return {
    post: (url: string, body: object = {}) => send(request(app).post(url), body),
    put: (url: string, body: object = {}) => send(request(app).put(url), body),
    del: (url: string) => send(request(app).delete(url), {}),
  };
}

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

/** Audit rows of the treasury writes are refused by a trigger while the check runs */
const REFUSE_TREASURY_AUDIT = `
CREATE OR REPLACE FUNCTION a8_refuse_treasury_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity IN ('treasury_transaction', 'treasury_transfer', 'bank_account', 'bank_reconciliation')
     OR (NEW.entity = 'cheque' AND NEW.action = 'CREATE') THEN
    RAISE EXCEPTION 'a8 audit refused';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a8_refuse_treasury_audit ON activity_logs;
CREATE TRIGGER a8_refuse_treasury_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION a8_refuse_treasury_audit();`;
const ALLOW_TREASURY_AUDIT = 'DROP TRIGGER IF EXISTS a8_refuse_treasury_audit ON activity_logs; DROP FUNCTION IF EXISTS a8_refuse_treasury_audit();';

const count = async (sqlText: string, params: unknown[]) => Number((await pool.query<{ n: string }>(sqlText, params)).rows[0]?.n ?? 0);

async function newLedgerAccount(): Promise<number> {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
  const [ledger] = await orm.insert(accounts).values({
    code: `1003${tagOf()}`, name: 'بانک آزمون ممیزی', level: 'subsidiary', parentId: parent?.id ?? null, accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  return ledger.id;
}

export async function runTreasuryAuditA8Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const auditId = 'reg_treasury_audit_in_write_tx_td_934';
  if (shouldRun(auditId, 'td934', 'treasury', 'cheque', 'bank', 'audit', 'a8')) {
    await runCase(results, auditId, 'v10.0.262: a treasury receipt, transfer, void, cheque, bank account create / edit / delete and the bank balance sync write their audit row in their own transaction, so a refused audit row leaves nothing written (TD-934)', async () => {
      const problems: string[] = [];
      const api = await adminClient();
      const bankA = await fundedBank();
      const bankB = await fundedBank();
      const contra = await miscContraAccountId();
      const spare = await BankAccountService.createBankAccount({ title: `بانک آزمون حذف ${tagOf()}`, type: 'bank', accountId: await newLedgerAccount(), initialBalance: 0, currency: 'IRR' });
      const toVoid = await TreasuryTransactionService.createTreasuryTransaction({
        type: 'receipt', method: 'bank_transfer', amount: 50_000, bankAccountId: bankA, partyType: 'other', contraAccountId: contra, partyName: 'دریافت آزمون ابطال', date: '2026-04-02', username: 'a8',
      });
      const ledgerForNew = await newLedgerAccount();
      const chequeNumber = `A8${tagOf()}`;
      const newBankTitle = `بانک آزمون تازه ${tagOf()}`;
      const rowsOf = (bankId: number) => count('SELECT count(*)::text AS n FROM treasury_transactions WHERE bank_account_id = $1', [bankId]);
      const rowsA = await rowsOf(bankA);
      const rowsB = await rowsOf(bankB);
      // the sync only writes a balance that differs from the treasury balance
      await pool.query('UPDATE bank_accounts SET current_balance = current_balance + 7 WHERE id = $1', [bankA]);
      const driftedBalance = (await pool.query<{ b: string }>('SELECT current_balance::text AS b FROM bank_accounts WHERE id = $1', [bankA])).rows[0]?.b;

      await pool.query(REFUSE_TREASURY_AUDIT);
      try {
        const receipt = await api.post('/api/accounting/treasury', {
          type: 'receipt', method: 'bank_transfer', amount: 10_000, bankAccountId: bankA, partyType: 'other', contraAccountId: contra, partyName: 'دریافت آزمون ممیزی',
        });
        if (receipt.status < 400) problems.push(`the receipt answered ${receipt.status} although its audit row was refused`);
        const transfer = await api.post('/api/accounting/treasury/transfer', { amount: 1_000, fromBankAccountId: bankA, toBankAccountId: bankB });
        if (transfer.status < 400) problems.push(`the transfer answered ${transfer.status}`);
        if (await rowsOf(bankA) !== rowsA || await rowsOf(bankB) !== rowsB) problems.push('a treasury row was committed although its audit row was refused');

        const voided = await api.post(`/api/accounting/treasury/${toVoid.id}/void`, { reason: 'ابطال آزمون ممیزی' });
        if (voided.status < 400) problems.push(`the void answered ${voided.status}`);
        const status = (await pool.query<{ status: string }>('SELECT status FROM treasury_transactions WHERE id = $1', [toVoid.id])).rows[0]?.status;
        if (status !== 'completed') problems.push(`the voided row is ${status} although the void's audit row was refused`);

        const cheque = await api.post('/api/accounting/cheques', {
          type: 'received', chequeNumber, bankName: 'ملت', issueDate: '2026-04-02', dueDate: '2026-05-02', amount: 20_000,
          partyType: 'other', contraAccountId: contra, partyName: 'چک آزمون ممیزی',
        });
        if (cheque.status < 400) problems.push(`the cheque answered ${cheque.status}`);
        if (await count('SELECT count(*)::text AS n FROM cheques WHERE cheque_number = $1', [chequeNumber]) !== 0) problems.push('the cheque was committed although its audit row was refused');

        const created = await api.post('/api/accounting/bank-accounts', { title: newBankTitle, type: 'bank', accountId: ledgerForNew, initialBalance: 0, currency: 'IRR' });
        if (created.status < 400) problems.push(`the bank account create answered ${created.status}`);
        if (await count('SELECT count(*)::text AS n FROM bank_accounts WHERE title = $1', [newBankTitle]) !== 0) problems.push('the bank account was committed although its audit row was refused');

        const edited = await api.put(`/api/accounting/bank-accounts/${spare.id}`, { title: `${spare.title} ویرایش` });
        if (edited.status < 400) problems.push(`the bank account edit answered ${edited.status}`);
        const removed = await api.del(`/api/accounting/bank-accounts/${spare.id}`);
        if (removed.status < 400) problems.push(`the bank account delete answered ${removed.status}`);
        const spareNow = (await pool.query<{ title: string; is_deleted: number }>('SELECT title, is_deleted FROM bank_accounts WHERE id = $1', [spare.id])).rows[0];
        if (spareNow?.title !== spare.title || Number(spareNow?.is_deleted) !== 0) problems.push(`the bank account edit or delete was committed (${JSON.stringify(spareNow)})`);

        const synced = await api.post('/api/accounting/bank-accounts/sync-reconcile');
        if (synced.status < 400) problems.push(`the bank balance sync answered ${synced.status}`);
        const balanceNow = (await pool.query<{ b: string }>('SELECT current_balance::text AS b FROM bank_accounts WHERE id = $1', [bankA])).rows[0]?.b;
        if (balanceNow !== driftedBalance) problems.push(`the bank balance sync was committed (${driftedBalance} -> ${balanceNow})`);
      } finally {
        await pool.query(ALLOW_TREASURY_AUDIT);
        await pool.query('UPDATE bank_accounts SET current_balance = current_balance - 7 WHERE id = $1 AND current_balance::text = $2', [bankA, driftedBalance]);
      }

      // with the audit allowed, the receipt's row carries the write's own snapshot
      const ok = await api.post('/api/accounting/treasury', {
        type: 'receipt', method: 'bank_transfer', amount: 10_000, bankAccountId: bankA, partyType: 'other', contraAccountId: contra, partyName: 'دریافت آزمون ممیزی',
      });
      const okId = Number((ok.body as { id?: unknown } | undefined)?.id);
      if (ok.status !== 201 || !okId) problems.push(`the receipt with the audit allowed answered ${ok.status}`);
      const audit = (await pool.query<{ details: { before?: unknown; after?: { id?: number } } }>(
        `SELECT details FROM activity_logs WHERE entity = 'treasury_transaction' AND entity_id = $1 AND action = 'CREATE'`, [String(okId)])).rows;
      if (audit.length !== 1 || audit[0].details?.before !== null || Number(audit[0].details?.after?.id) !== okId) problems.push(`the receipt's audit rows are ${JSON.stringify(audit).slice(0, 200)}`);

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'every treasury write rolls back with its refused audit row';
    });
  }

  const fallbackId = 'reg_treasury_party_account_no_general_fallback_own_03';
  if (shouldRun(fallbackId, 'own03', 'obsr204', 'treasury', 'cheque', 'mapping', 'a8')) {
    await runCase(results, fallbackId, 'v10.0.262: with the trade receivables account and its default missing, a treasury or cheque party row gets no account instead of the general account (OWN-03, OBS-R2-04)', async () => {
      let found: number | null | undefined;
      let generalId: number | undefined;
      await orm.transaction(async (tx) => {
        const mapped = await AccountMappingService.getTradeReceivablesAccount(tx);
        const codes = [mapped?.code, DEFAULT_ACCOUNT_MAPPINGS.tradeReceivablesAccountCode].filter((c): c is string => Boolean(c));
        for (const code of codes) await tx.update(accounts).set({ isDeleted: 1 }).where(eq(accounts.code, code));
        const [general] = await tx.select({ id: accounts.id }).from(accounts)
          .where(and(eq(accounts.code, (mapped?.code ?? DEFAULT_ACCOUNT_MAPPINGS.tradeReceivablesAccountCode).slice(0, 2)), eq(accounts.isDeleted, 0)));
        generalId = general?.id;
        found = await resolveChequePartyAccountId(tx, 'customer', null, null);
        tx.rollback();
      }).catch((err: unknown) => {
        if (!(err instanceof Error && err.message.toLowerCase().includes('rollback'))) throw err;
      });
      if (found !== null) throw new Error(`the party row got account ${found} (general account ${generalId}) instead of none`);
      return 'no general account fallback';
    });
  }

  return results;
}
