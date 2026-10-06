import request from 'supertest';
import pg from 'pg';
import { and, eq, ne, or, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { bankAccounts, cheques, journalVoucherItems, journalVouchers, treasuryTransactions } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { accountId, createBank } from './treasuryPartyTests.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Package 4 (treasury and cheques), PR «د» lists, reconciliation, audit and UI: real Express routes on PostgreSQL. Each test
 * is red on the version before its fix.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;

async function adminClient() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s = await getAdminSession();
  return {
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
    post: (url: string, body: object = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    patch: (url: string, body: object = {}) => request(app).patch(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    del: (url: string) => request(app).delete(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
  };
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

/** Rows the database sent back to this process while `fn` ran (every pg client query of the pool) */
async function rowsFetchedDuring(fn: () => Promise<unknown>): Promise<number> {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const original = proto.query;
  let rows = 0;
  const count = (res: { rows?: unknown[] } | undefined) => { if (Array.isArray(res?.rows)) rows += res.rows.length; };
  proto.query = function patched(this: unknown, ...args: unknown[]) {
    // pg-pool calls the client with a callback; drizzle inside a transaction awaits the promise
    const last = args.length - 1;
    if (typeof args[last] === 'function') {
      const callback = args[last] as (err: unknown, res?: { rows?: unknown[] }) => void;
      args[last] = (err: unknown, res?: { rows?: unknown[] }) => { if (!err) count(res); callback(err, res); };
      return original.apply(this, args);
    }
    const result = original.apply(this, args);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<{ rows?: unknown[] }>).then(res => { count(res); return res; });
    }
    return result;
  };
  try {
    await fn();
  } finally {
    proto.query = original;
  }
  return rows;
}

/** The pre-v9.0.102 balance rule, kept as the oracle: every approved ledger row, treasury row and cleared cheque matched in JS */
async function referenceBalances(bankId: number) {
  const [bank] = await orm.select().from(bankAccounts).where(eq(bankAccounts.id, bankId));
  const items = await orm.select({ accountId: journalVoucherItems.accountId, detailedType: journalVoucherItems.detailedType, detailedId: journalVoucherItems.detailedId, debit: journalVoucherItems.debit, credit: journalVoucherItems.credit })
    .from(journalVoucherItems).innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .where(and(eq(journalVouchers.isDeleted, 0), eq(journalVoucherItems.isDeleted, 0), or(eq(journalVouchers.status, 'approved'), eq(journalVouchers.status, 'permanent'))));
  let debit = fin(0);
  let credit = fin(0);
  for (const it of items) {
    const tagged = it.detailedType === 'bank_account' && it.detailedId ? it.detailedId : null;
    if ((bank.accountId && it.accountId === bank.accountId && tagged === null) || tagged === bank.id) {
      debit = debit.add(it.debit);
      credit = credit.add(it.credit);
    }
  }
  let treasury = fin(bank.initialBalance);
  const txs = await orm.select().from(treasuryTransactions).where(and(eq(treasuryTransactions.isDeleted, 0), ne(treasuryTransactions.method, 'cheque'), eq(treasuryTransactions.bankAccountId, bankId)));
  for (const tx of txs) treasury = tx.type === 'receipt' ? treasury.add(tx.amount) : tx.type === 'payment' ? treasury.subtract(tx.amount) : treasury;
  const passed = await orm.select().from(cheques).where(and(eq(cheques.isDeleted, 0), eq(cheques.status, 'passed'), eq(cheques.bankAccountId, bankId)));
  for (const c of passed) treasury = c.type === 'received' ? treasury.add(c.amount) : treasury.subtract(c.amount);
  return { debit: debit.toNumber(), credit: credit.toNumber(), treasury: treasury.toNumber() };
}

export async function runTreasuryListTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const pagingId = 'reg_treasury_list_paging_and_bank_balances_td_509';
  if (shouldRun(pagingId, 'td509', 'treasury', 'performance', 'package4')) {
    await runCase(results, pagingId, 'v9.0.102: bank balances are summed in SQL (no longer every approved ledger row read into memory) and GET /accounting/treasury honours page and limit with a total and a running balance for one bank (TD-509)', async () => {
      const admin = await adminClient();
      const problems: string[] = [];
      const today = await businessTodayIsoDate();
      const shift = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
      const bank = await createBank('Paging bank');
      const contra = await accountId('4101');
      const base = { method: 'bank_transfer', bankAccountId: bank.id, partyType: 'other', contraAccountId: contra };
      const posted: Array<{ id: number }> = [];
      for (const [type, amount, days, partyName] of [
        ['receipt', 1_000_000, -5, `Owner deposit ${tagOf()}`],
        ['payment', 300_000, -3, `Rent ${tagOf()}`],
        ['receipt', 200_000, -1, `Refund ${tagOf()}`],
        ['receipt', 50_000, 0, `Late deposit ${tagOf()}`],
      ] as const) {
        const res = await admin.post('/api/accounting/treasury', { ...base, type, amount, date: shift(days), partyName });
        if (res.status !== 201) throw new Error(`${type} ${amount} returned ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
        posted.push({ id: Number(res.body.id) });
      }

      // ledger rows: the bank's own ledger account, a row tagged with the bank on another account, and 400 unrelated rows
      const [voucher] = await orm.insert(journalVouchers).values({
        voucherNumber: Number((await orm.execute(sql`SELECT nextval('journal_voucher_number_seq')::text AS n`)).rows[0].n),
        date: today, voucherType: 'general', status: 'approved', totalDebit: money(0), totalCredit: money(0), description: 'TD-509 ledger rows', isDeleted: 0,
      }).returning({ id: journalVouchers.id });
      const unrelated = await accountId('6001');
      await orm.insert(journalVoucherItems).values([
        { voucherId: voucher.id, accountId: bank.ledgerId, debit: money(700_000), credit: money(0) },
        { voucherId: voucher.id, accountId: contra, detailedType: 'bank_account', detailedId: bank.id, debit: money(0), credit: money(120_000) },
        ...Array.from({ length: 400 }, (_, i) => ({ voucherId: voucher.id, accountId: unrelated, debit: money(i + 1), credit: money(0) })),
      ]);

      const { AccountingService } = await import('../../services/accounting.service.js');
      let list: Awaited<ReturnType<typeof AccountingService.getBankAccounts>> = [];
      const rows = await rowsFetchedDuring(async () => { list = await AccountingService.getBankAccounts(); });
      const banks = await orm.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.isDeleted, 0));
      // the bank list itself, a few grouped sums and the opening vouchers; before: every approved ledger row (> 400)
      if (rows > banks.length + 200) problems.push(`GET bank accounts fetched ${rows} rows for ${banks.length} banks (before: every approved ledger row, treasury row and cleared cheque)`);
      for (const b of banks) {
        const got = list.find(x => x.id === b.id);
        const want = await referenceBalances(b.id);
        if (!got || got.totalDebit !== want.debit || got.totalCredit !== want.credit || got.treasuryBalance !== want.treasury) {
          problems.push(`bank ${b.id}: debit/credit/treasury ${got?.totalDebit}/${got?.totalCredit}/${got?.treasuryBalance}, reference ${want.debit}/${want.credit}/${want.treasury}`);
        }
      }
      const mine = list.find(x => x.id === bank.id);
      if (mine?.totalDebit !== 700_000 || mine?.totalCredit !== 120_000 || mine?.treasuryBalance !== 950_000) {
        problems.push(`paging bank: debit ${mine?.totalDebit} credit ${mine?.totalCredit} treasury ${mine?.treasuryBalance}, expected 700000 / 120000 / 950000`);
      }

      // page 2 of 2 rows, newest first: the payment of 300,000 (balance 700,000) then the receipt of 1,000,000 (balance 1,000,000)
      const page2 = await admin.get(`/api/accounting/treasury?bankAccountId=${bank.id}&page=2&limit=2`);
      if (page2.status !== 200 || !Array.isArray(page2.body?.data)) {
        problems.push(`page 2 returned ${page2.status} ${Array.isArray(page2.body) ? `an array of ${page2.body.length} rows (page ignored)` : JSON.stringify(page2.body).slice(0, 120)}`);
      } else {
        const ids = page2.body.data.map((t: { id: number }) => t.id);
        if (page2.body.total !== 4 || page2.body.page !== 2 || page2.body.limit !== 2) problems.push(`page 2 meta total ${page2.body.total} page ${page2.body.page} limit ${page2.body.limit}, expected 4 / 2 / 2`);
        if (JSON.stringify(ids) !== JSON.stringify([posted[1].id, posted[0].id])) problems.push(`page 2 rows ${JSON.stringify(ids)}, expected ${JSON.stringify([posted[1].id, posted[0].id])}`);
        const balances = page2.body.data.map((t: { runningBalance?: number }) => t.runningBalance);
        if (JSON.stringify(balances) !== JSON.stringify([700_000, 1_000_000])) problems.push(`page 2 running balances ${JSON.stringify(balances)}, expected [700000, 1000000]`);
      }
      // the running balance does not depend on the other filters: only payments, the one payment still shows 700,000
      const payments = await admin.get(`/api/accounting/treasury?bankAccountId=${bank.id}&type=payment&page=1&limit=10`);
      if (payments.body?.total !== 1 || payments.body?.data?.[0]?.runningBalance !== 700_000) problems.push(`payments page total ${payments.body?.total} balance ${payments.body?.data?.[0]?.runningBalance}, expected 1 / 700000`);
      const search = await admin.get(`/api/accounting/treasury?bankAccountId=${bank.id}&q=${encodeURIComponent('rent')}&page=1&limit=10`);
      if (search.body?.total !== 1 || search.body?.data?.[0]?.id !== posted[1].id) problems.push(`search «rent» total ${search.body?.total}, expected the one rent payment`);
      const cash = await admin.get(`/api/accounting/treasury?bankAccountId=${bank.id}&method=cash&page=1&limit=10`);
      if (cash.body?.total !== 0) problems.push(`method=cash total ${cash.body?.total}, expected 0`);
      const full = await admin.get(`/api/accounting/treasury?bankAccountId=${bank.id}`);
      if (!Array.isArray(full.body) || full.body.length !== 4) problems.push(`without page the list returned ${Array.isArray(full.body) ? full.body.length : typeof full.body} rows, expected the 4-row array`);
      assertNoProblems(problems);
      return `fetched ${rows} rows for ${banks.length} banks; page 2 = ${JSON.stringify(page2.body?.data?.map((t: { runningBalance?: number }) => t.runningBalance))}`;
    });
  }

  void errorCode;
  return results;
}
