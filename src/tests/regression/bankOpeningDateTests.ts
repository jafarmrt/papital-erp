import request from 'supertest';
import { and, asc, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts, bankAccounts, journalVouchers, treasuryTransactions, workflowInstances } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { WorkflowTransitionExecutor } from '../../services/workflow/workflowTransitionExecutor.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * 10.3 package 4 (accounting and treasury, xhigh): real Express routes and services on PostgreSQL, each red on v10.3.18.
 *  - OBS-R1-65 (TD-986, decision ت۴۷ item 2): the opening voucher of a treasury account is dated with the account's start
 *    date («تاریخ آغاز حساب», default the business today), also when the workflow approval or a first opening balance
 *    issues it later; the start date is fixed once the voucher is issued (from v11 phase 3.1, M2: once it is approved; a
 *    draft opening voucher moves with it). On v10.3.18 the voucher always took the day it was issued and the route dropped
 *    the field.
 *  - 10.2 backlog (second review of #320): an account saved with the currency «irr» before v9.0.99 is a rial account for
 *    the transfer and the voucher preview. On v10.3.18 a transfer between it and an IRR account was refused.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
export const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;

export async function client() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s = await getAdminSession();
  return {
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
    post: (url: string, body: object = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    put: (url: string, body: object = {}) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    delete: (url: string) => request(app).delete(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
  };
}

export const brief = (res: request.Response) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 220)}`;
export const errorCode = (res: request.Response) => String(res.body?.code ?? res.body?.error?.code ?? '');

export async function runCase(results: TestCaseResult[], id: string, name: string, body: () => Promise<string>): Promise<void> {
  const tStart = Date.now();
  try {
    const details = await body();
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      // a failed query keeps the database's own reason in `cause`
      error: err instanceof Error ? [err.message, (err.cause as Error | undefined)?.message].filter(Boolean).join(' | cause: ') : String(err),
    }));
  }
}

/** a ledger account of its own under 1003, so no other test's bank touches this bank's ledger */
export async function ownLedgerAccount(title: string): Promise<number> {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
  const [ledger] = await orm.insert(accounts).values({
    code: `1003${tagOf()}`, name: `${title} (test ledger)`, level: 'subsidiary', parentId: parent?.id ?? null,
    accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  return ledger.id;
}

/** the opening vouchers of a bank (not its adjustments), oldest first */
export async function openingVouchersOf(bankId: number) {
  return orm.select({ id: journalVouchers.id, date: journalVouchers.date, status: journalVouchers.status }).from(journalVouchers)
    .where(and(eq(journalVouchers.referenceModule, 'treasury_opening'), eq(journalVouchers.referenceId, bankId),
      eq(journalVouchers.voucherType, 'opening'), eq(journalVouchers.isDeleted, 0)))
    .orderBy(asc(journalVouchers.id));
}

export async function storedOpeningDate(bankId: number): Promise<string> {
  const [row] = await orm.select({ openingDate: bankAccounts.openingDate }).from(bankAccounts).where(eq(bankAccounts.id, bankId));
  return String(row?.openingDate ?? '');
}

/** an ISO day `days` after the business today */
async function dayAfterToday(days: number): Promise<string> {
  const today = new Date(`${await businessTodayIsoDate()}T00:00:00Z`);
  today.setUTCDate(today.getUTCDate() + days);
  return today.toISOString().slice(0, 10);
}

export async function runBankOpeningDateTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const datedId = 'reg_bank_opening_voucher_start_date_obs_r1_65';
  if (shouldRun(datedId, 'obs-r1-65', 'td-986', 'treasury', 'bank', 'opening', 'package4')) {
    await runCase(results, datedId, '10.3 package 4: the opening voucher of a bank account is dated with its start date (default today), a later start date is refused, and the start date is fixed once the voucher is approved (OBS-R1-65, TD-986; v11 M2)', async () => {
      const api = await client();
      const problems: string[] = [];
      const today = await businessTodayIsoDate();
      const create = async (title: string, body: object) => {
        const res = await api.post('/api/accounting/bank-accounts', { title: `${title} ${tagOf()}`, type: 'bank', accountId: await ownLedgerAccount(title), ...body });
        return res;
      };

      // 1) a start date in the past dates the opening voucher and is returned and listed
      const dated = await create('Dated bank', { initialBalance: 3_000_000, openingDate: '2026-04-05' });
      if (dated.status !== 201) throw new Error(`bank create with a start date returned ${brief(dated)}`);
      const datedId = Number(dated.body.id);
      if (dated.body.openingDate !== '2026-04-05') problems.push(`the create answer has start date ${String(dated.body.openingDate)}, expected 2026-04-05`);
      if (await storedOpeningDate(datedId) !== '2026-04-05') problems.push(`stored start date ${await storedOpeningDate(datedId)}, expected 2026-04-05`);
      const [datedVoucher] = await openingVouchersOf(datedId);
      if (datedVoucher?.date !== '2026-04-05') problems.push(`the opening voucher is dated ${datedVoucher?.date ?? 'missing'}, expected the start date 2026-04-05`);
      const listed = await api.get('/api/accounting/bank-accounts');
      const listedRow = (Array.isArray(listed.body) ? listed.body : []).find((b: { id: number }) => b.id === datedId);
      if (listedRow?.openingDate !== '2026-04-05' || listedRow?.openingVoucherIssued !== true) {
        problems.push(`the list shows start date ${String(listedRow?.openingDate)} and issued ${String(listedRow?.openingVoucherIssued)}, expected 2026-04-05 and true`);
      }

      // 2) a Jalali start date is read as its Gregorian day; none is the business today
      const jalali = await create('Jalali bank', { initialBalance: 1_000_000, openingDate: '۱۴۰۵/۰۱/۲۰' });
      if (jalali.status !== 201) problems.push(`bank create with a Jalali start date returned ${brief(jalali)}`);
      else {
        const [voucher] = await openingVouchersOf(Number(jalali.body.id));
        if (voucher?.date !== '2026-04-09') problems.push(`the Jalali start date 1405/01/20 dated the voucher ${voucher?.date ?? 'missing'}, expected 2026-04-09`);
      }
      const plain = await create('Plain bank', { initialBalance: 1_000_000 });
      if (plain.status !== 201) throw new Error(`bank create without a start date returned ${brief(plain)}`);
      const plainId = Number(plain.body.id);
      if (await storedOpeningDate(plainId) !== today) problems.push(`without a start date the stored one is ${await storedOpeningDate(plainId)}, expected today ${today}`);
      const [plainVoucher] = await openingVouchersOf(plainId);
      if (plainVoucher?.date !== today) problems.push(`without a start date the voucher is dated ${plainVoucher?.date ?? 'missing'}, expected today ${today}`);

      // 3) a start date after today is refused and nothing is written
      const futureTitle = `Future bank ${tagOf()}`;
      const future = await api.post('/api/accounting/bank-accounts', {
        title: futureTitle, type: 'bank', accountId: await ownLedgerAccount('Future bank'), initialBalance: 1_000_000, openingDate: await dayAfterToday(3),
      });
      if (future.status !== 422 || errorCode(future) !== 'TREASURY_DATE_IN_FUTURE') problems.push(`a start date after today returned ${brief(future)}, expected 422 TREASURY_DATE_IN_FUTURE`);
      const futureRows = await orm.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.title, futureTitle));
      if (futureRows.length > 0) problems.push('the refused bank with a later start date was saved');

      // 4) v11 phase 3.1 (M2): a draft opening voucher moves with the start date (the voucher page no longer edits it); once
      // the voucher is approved the start date is fixed; sending the same date is no change
      const moved = await api.put(`/api/accounting/bank-accounts/${datedId}`, { openingDate: '2026-04-06' });
      if (moved.status !== 200) problems.push(`moving the start date of a draft opening voucher returned ${brief(moved)}, expected 200`);
      const [movedVoucher] = await openingVouchersOf(datedId);
      if (await storedOpeningDate(datedId) !== '2026-04-06' || movedVoucher?.date !== '2026-04-06') {
        problems.push(`the move left start date ${await storedOpeningDate(datedId)} and voucher date ${movedVoucher?.date ?? 'missing'}, expected 2026-04-06`);
      }
      const approved = await api.put(`/api/accounting/vouchers/${movedVoucher?.id}/status`, { status: 'approved' });
      if (approved.status !== 200) problems.push(`approving the opening voucher returned ${brief(approved)}`);
      const locked = await api.put(`/api/accounting/bank-accounts/${datedId}`, { openingDate: '2026-04-07' });
      if (locked.status !== 422 || errorCode(locked) !== 'BANK_OPENING_DATE_LOCKED') problems.push(`moving the start date after the approval returned ${brief(locked)}, expected 422 BANK_OPENING_DATE_LOCKED`);
      if (await storedOpeningDate(datedId) !== '2026-04-06') problems.push(`the refused move left start date ${await storedOpeningDate(datedId)}`);
      const same = await api.put(`/api/accounting/bank-accounts/${datedId}`, { openingDate: '2026-04-06', title: `Dated bank renamed ${tagOf()}` });
      if (same.status !== 200) problems.push(`an edit sending the same start date returned ${brief(same)}`);

      // 5) an account without an opening balance keeps a free start date; its first opening balance is dated with it
      const empty = await create('Empty bank', { initialBalance: 0, openingDate: '2026-04-07' });
      if (empty.status !== 201) throw new Error(`bank create without a balance returned ${brief(empty)}`);
      const emptyId = Number(empty.body.id);
      const beforeList = (await api.get('/api/accounting/bank-accounts')).body as Array<{ id: number; openingVoucherIssued?: boolean }>;
      if (beforeList.find(b => b.id === emptyId)?.openingVoucherIssued !== false) problems.push('an account without an opening voucher is listed as issued');
      const changed = await api.put(`/api/accounting/bank-accounts/${emptyId}`, { openingDate: '2026-04-08' });
      if (changed.status !== 200 || await storedOpeningDate(emptyId) !== '2026-04-08') problems.push(`changing the start date before any voucher returned ${brief(changed)}, stored ${await storedOpeningDate(emptyId)}`);
      const funded = await api.put(`/api/accounting/bank-accounts/${emptyId}`, { initialBalance: 2_000_000 });
      if (funded.status !== 200) problems.push(`the first opening balance returned ${brief(funded)}`);
      const [lateVoucher] = await openingVouchersOf(emptyId);
      if (lateVoucher?.date !== '2026-04-08') problems.push(`the first opening balance issued a voucher dated ${lateVoucher?.date ?? 'missing'}, expected the start date 2026-04-08`);

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'start date 2026-04-05 dated the voucher and was listed; Jalali 1405/01/20 → 2026-04-09; none → today; a later day 422; a draft voucher moved with its date (200), after the approval 422, same date 200; a zero-balance account moved its date and its first balance took it';
    });
  }

  const workflowId = 'reg_bank_opening_start_date_workflow_obs_r1_65';
  if (shouldRun(workflowId, 'obs-r1-65', 'td-986', 'treasury', 'bank', 'opening', 'workflow', 'package4')) {
    await runCase(results, workflowId, '10.3 package 4: the workflow approval issues the opening voucher with the start date the account has at the approval, which may still move while the approval is open (OBS-R1-65)', async () => {
      const { createTestUser, createTestWorkflow } = await import('../fixtures/factories.js');
      const api = await client();
      // a real approver: the voucher's creator is a foreign key to users, and user 1 is not there in every run
      const approver = await createTestUser({ role: 'admin' });
      const problems: string[] = [];
      const wf = await createTestWorkflow({
        definition: { entityType: 'bank_account' },
        states: [{ key: 'draft', title: 'Draft', type: 'initial' }, { key: 'approved', title: 'Approved', type: 'terminal' }],
        transitions: [{ fromKey: 'draft', toKey: 'approved', actionKey: 'approve_obs_r1_65', title: 'Approve' }],
      });
      let bankId = 0;
      try {
        const res = await api.post('/api/accounting/bank-accounts', {
          title: `Approved bank ${tagOf()}`, type: 'bank', accountId: await ownLedgerAccount('Approved bank'), initialBalance: 4_000_000, openingDate: '2026-04-09',
        });
        if (res.status !== 201) throw new Error(`bank create under the workflow returned ${brief(res)}`);
        bankId = Number(res.body.id);
      } finally {
        // only this bank starts under the test definition
        await wf.restore();
      }
      const [instance] = await orm.select({ id: workflowInstances.id, status: workflowInstances.status }).from(workflowInstances)
        .where(and(eq(workflowInstances.entityType, 'bank_account'), eq(workflowInstances.entityId, String(bankId))));
      if (instance?.status !== 'IN_PROGRESS') throw new Error(`bank workflow instance is ${instance?.status ?? 'missing'}, expected IN_PROGRESS`);
      if ((await openingVouchersOf(bankId)).length !== 0) problems.push('the bank has an opening voucher before its approval');

      // no voucher yet: the start date still moves, and the approval takes the moved one
      const pending = await api.put(`/api/accounting/bank-accounts/${bankId}`, { openingDate: '2026-04-10' });
      if (pending.status !== 200) problems.push(`moving the start date while the approval is open returned ${brief(pending)}, expected 200`);
      if (await storedOpeningDate(bankId) !== '2026-04-10') problems.push(`the move left start date ${await storedOpeningDate(bankId)}, expected 2026-04-10`);
      const balance = await api.put(`/api/accounting/bank-accounts/${bankId}`, { initialBalance: 5_000_000 });
      if (balance.status !== 409) problems.push(`changing the opening balance while the approval is open returned ${brief(balance)}, expected 409 (TD-504)`);

      await WorkflowTransitionExecutor.executeTransition({
        instanceId: instance.id, transitionId: wf.transitions[0].id, userId: approver.id, userName: approver.username, userRole: 'admin', userPermissions: ['*'],
      });
      const vouchers = await openingVouchersOf(bankId);
      if (vouchers.length !== 1) problems.push(`the approval issued ${vouchers.length} opening vouchers, expected 1`);
      else if (vouchers[0].date !== '2026-04-10') problems.push(`the approval dated the opening voucher ${vouchers[0].date}, expected the start date 2026-04-10`);

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'start date 2026-04-09 under approval: moved to 2026-04-10 (200), balance change 409, the approval issued one voucher dated 2026-04-10';
    });
  }

  const closedYearId = 'reg_bank_opening_start_date_closed_year_obs_r1_65';
  if (shouldRun(closedYearId, 'obs-r1-65', 'td-986', 'treasury', 'bank', 'opening', 'workflow', 'fiscal', 'package4')) {
    await runCase(results, closedYearId, '10.3 package 4: a start date in a closed fiscal year is refused with a message naming it, at create, at the approval and at the first balance, and moving it lets each go on (OBS-R1-65)', async () => {
      const { createTestUser, createTestWorkflow } = await import('../fixtures/factories.js');
      const { FiscalPeriodService } = await import('../../services/accounting/fiscalPeriod.service.js');
      const api = await client();
      const approver = await createTestUser({ role: 'admin' });
      const problems: string[] = [];
      // 1385 (2006-2007): a year no other test uses; closed only inside this case
      const YEAR = 1385;
      const before = (await pool.query('SELECT status FROM fiscal_periods WHERE fiscal_year = $1', [YEAR])).rows[0] as { status: string } | undefined;
      const setYear = async (status: 'open' | 'closed') => {
        await pool.query(`INSERT INTO fiscal_periods (fiscal_year, status) VALUES ($1, $2)
          ON CONFLICT (fiscal_year) DO UPDATE SET status = EXCLUDED.status`, [YEAR, status]);
        FiscalPeriodService.resetCache();
      };
      try {
        await setYear('open');
        // 1) under approval, the start date's year closes before the approval
        const wf = await createTestWorkflow({
          definition: { entityType: 'bank_account' },
          states: [{ key: 'draft', title: 'Draft', type: 'initial' }, { key: 'approved', title: 'Approved', type: 'terminal' }],
          transitions: [{ fromKey: 'draft', toKey: 'approved', actionKey: 'approve_obs_r1_65_year', title: 'Approve' }],
        });
        let bankId = 0;
        try {
          const res = await api.post('/api/accounting/bank-accounts', {
            title: `Old bank ${tagOf()}`, type: 'bank', accountId: await ownLedgerAccount('Old bank'), initialBalance: 2_000_000, openingDate: '2006-06-01',
          });
          if (res.status !== 201) throw new Error(`bank create under the workflow returned ${brief(res)}`);
          bankId = Number(res.body.id);
        } finally {
          await wf.restore();
        }
        const [instance] = await orm.select({ id: workflowInstances.id }).from(workflowInstances)
          .where(and(eq(workflowInstances.entityType, 'bank_account'), eq(workflowInstances.entityId, String(bankId))));
        if (!instance) throw new Error('the bank has no workflow instance');
        await setYear('closed');
        const approve = () => WorkflowTransitionExecutor.executeTransition({
          instanceId: instance.id, transitionId: wf.transitions[0].id, userId: approver.id, userName: approver.username, userRole: 'admin', userPermissions: ['*'],
        });
        const refusedCode = await approve().then(() => 'none', (err: unknown) => String((err as { code?: string }).code ?? (err as Error).message));
        if (refusedCode !== 'BANK_OPENING_DATE_YEAR_CLOSED') problems.push(`the approval in a closed start year ended with ${refusedCode}, expected BANK_OPENING_DATE_YEAR_CLOSED`);
        if ((await openingVouchersOf(bankId)).length !== 0) problems.push('the refused approval left an opening voucher');
        const moved = await api.put(`/api/accounting/bank-accounts/${bankId}`, { openingDate: '2026-04-09' });
        if (moved.status !== 200) problems.push(`moving the start date out of the closed year while the approval is open returned ${brief(moved)}, expected 200`);
        await approve();
        const approved = await openingVouchersOf(bankId);
        if (approved.length !== 1 || approved[0].date !== '2026-04-09') problems.push(`after the move the approval issued ${JSON.stringify(approved)}, expected one voucher dated 2026-04-09`);

        // 2) a zero-balance account whose start year closed gets its first balance
        const zero = await api.post('/api/accounting/bank-accounts', {
          title: `Old zero bank ${tagOf()}`, type: 'bank', accountId: await ownLedgerAccount('Old zero bank'), initialBalance: 0, openingDate: '2006-06-02',
        });
        if (zero.status !== 201) throw new Error(`zero-balance bank create returned ${brief(zero)}`);
        const zeroId = Number(zero.body.id);
        const first = await api.put(`/api/accounting/bank-accounts/${zeroId}`, { initialBalance: 1_000_000 });
        if (first.status !== 422 || errorCode(first) !== 'BANK_OPENING_DATE_YEAR_CLOSED') problems.push(`a first balance in a closed start year returned ${brief(first)}, expected 422 BANK_OPENING_DATE_YEAR_CLOSED`);
        const firstMoved = await api.put(`/api/accounting/bank-accounts/${zeroId}`, { initialBalance: 1_000_000, openingDate: '2026-04-08' });
        if (firstMoved.status !== 200) problems.push(`a first balance with a start date moved to an open year returned ${brief(firstMoved)}, expected 200`);
        const zeroVouchers = await openingVouchersOf(zeroId);
        if (zeroVouchers.length !== 1 || zeroVouchers[0].date !== '2026-04-08') problems.push(`the first balance issued ${JSON.stringify(zeroVouchers)}, expected one voucher dated 2026-04-08`);

        // 3) a new account with a balance dated in the closed year
        const direct = await api.post('/api/accounting/bank-accounts', {
          title: `Closed year bank ${tagOf()}`, type: 'bank', accountId: await ownLedgerAccount('Closed year bank'), initialBalance: 1_000_000, openingDate: '2006-06-03',
        });
        if (direct.status !== 422 || errorCode(direct) !== 'BANK_OPENING_DATE_YEAR_CLOSED') problems.push(`a create with a balance in a closed start year returned ${brief(direct)}, expected 422 BANK_OPENING_DATE_YEAR_CLOSED`);
      } finally {
        if (before) await pool.query('UPDATE fiscal_periods SET status = $2 WHERE fiscal_year = $1', [YEAR, before.status]);
        else await pool.query('DELETE FROM fiscal_periods WHERE fiscal_year = $1', [YEAR]);
        FiscalPeriodService.resetCache();
      }
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'closed start year: approval 422 BANK_OPENING_DATE_YEAR_CLOSED, moved under approval then one voucher on the new date; first balance 422 then 200 with a moved date; create 422';
    });
  }

  const currencyId = 'reg_treasury_lowercase_currency_account_10_3_package4';
  if (shouldRun(currencyId, 'treasury', 'currency', 'transfer', 'preview', 'cheque', 'package4')) {
    await runCase(results, currencyId, '10.3 package 4: an account saved with the currency «irr» is a rial account for the transfer, the voucher preview and the cheque clearing (10.2 backlog, review of #320)', async () => {
      const api = await client();
      const problems: string[] = [];
      const make = async (title: string, initialBalance: number) => {
        const res = await api.post('/api/accounting/bank-accounts', {
          title: `${title} ${tagOf()}`, type: 'bank', accountId: await ownLedgerAccount(title), initialBalance, currency: 'IRR',
        });
        if (res.status !== 201) throw new Error(`bank create returned ${brief(res)}`);
        return Number(res.body.id);
      };
      const rial = await make('Rial bank', 5_000_000);
      const old = await make('Old irr bank', 0);
      // an account saved before v9.0.99 kept the code as typed; the save normalizes it now, so the old value is written here
      await pool.query(`UPDATE bank_accounts SET currency = 'irr' WHERE id = $1`, [old]);

      const into = await api.post('/api/accounting/treasury/transfer', { fromBankAccountId: rial, toBankAccountId: old, amount: 1_000_000 });
      const intoOk = into.status === 200 || into.status === 201;
      if (!intoOk) problems.push(`a transfer from an IRR account into the «irr» account returned ${brief(into)}`);
      const back = await api.post('/api/accounting/treasury/transfer', { fromBankAccountId: old, toBankAccountId: rial, amount: 400_000, currency: 'IRR' });
      if (back.status !== 200 && back.status !== 201) problems.push(`an IRR transfer out of the «irr» account returned ${brief(back)}`);
      else {
        const rows = await orm.select({ currency: treasuryTransactions.currency }).from(treasuryTransactions)
          .where(eq(treasuryTransactions.bankAccountId, old)).orderBy(asc(treasuryTransactions.id));
        if (rows.some(r => r.currency !== 'IRR')) problems.push(`the transfer rows of the «irr» account carry ${rows.map(r => r.currency).join(',')}, expected IRR`);
      }

      const preview = await TreasuryTransactionService.previewTreasuryVoucher({ type: 'receipt', method: 'bank_transfer', amount: 100_000, currency: 'IRR', bankAccountId: old, partyType: 'customer', partyName: 'Preview party' });
      if (preview.warnings.some(w => w.includes('هم‌خوانی ندارد'))) problems.push(`the preview of an IRR receipt on the «irr» account warns: ${preview.warnings.join(' / ')}`);

      // a received IRR cheque clears into the «irr» account
      const cheque = await api.post('/api/accounting/cheques', {
        type: 'received', chequeNumber: `IRR${tagOf()}`, amount: 250_000, partyType: 'other', contraAccountId: await miscContraAccountId(),
        partyName: 'Cheque party', bankName: 'ملت', issueDate: '2026-03-01', dueDate: '2026-04-01',
      });
      if (cheque.status !== 201 && cheque.status !== 200) problems.push(`the cheque create returned ${brief(cheque)}`);
      else {
        const cleared = await api.put(`/api/accounting/cheques/${cheque.body.id}/status`, { status: 'passed', bankAccountId: old });
        if (cleared.status !== 200) problems.push(`clearing an IRR cheque into the «irr» account returned ${brief(cleared)}`);
      }

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return '«irr» account: transfer in and IRR transfer out accepted with IRR rows, preview without a currency warning, IRR cheque cleared into it';
    });
  }

  return results;
}
