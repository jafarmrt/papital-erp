import request from 'supertest';
import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, journalVoucherItems, journalVouchers } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Package 3 (accounting and money core), PR «الف» reports and lists in the UI: real Express routes on PostgreSQL. Each test
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

function assertNoProblems(problems: string[]): void {
  if (problems.length > 0) throw new Error(problems.join(' | '));
}

async function insertVoucher(values: { date: string; voucherType: string; status: string; description: string }): Promise<{ id: number; voucherNumber: number }> {
  const voucherNumber = Number((await orm.execute(sql`SELECT nextval('journal_voucher_number_seq')::text AS n`)).rows[0].n);
  const [row] = await orm.insert(journalVouchers).values({
    voucherNumber, ...values, totalDebit: money(1000), totalCredit: money(1000), isDeleted: 0,
  }).returning({ id: journalVouchers.id, voucherNumber: journalVouchers.voucherNumber });
  return row;
}

async function insertAccount(code: string, name: string, level: string, parentId: number | null): Promise<number> {
  const [row] = await orm.insert(accounts).values({ code, name, level, parentId, accountType: 'asset', nature: 'debit' }).returning({ id: accounts.id });
  return row.id;
}

/** An approved balanced voucher: debit one account, credit another */
async function postApproved(date: string, debitAccountId: number, creditAccountId: number, amount: number, description: string): Promise<void> {
  const v = await insertVoucher({ date, voucherType: 'general', status: 'approved', description });
  await orm.update(journalVouchers).set({ totalDebit: money(amount), totalCredit: money(amount) }).where(sql`${journalVouchers.id} = ${v.id}`);
  await orm.insert(journalVoucherItems).values([
    { voucherId: v.id, accountId: debitAccountId, debit: money(amount), credit: money(0), rowOrder: 1 },
    { voucherId: v.id, accountId: creditAccountId, debit: money(0), credit: money(amount), rowOrder: 2 },
  ]);
}

export async function runAccountingReportsTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const pagingId = 'reg_voucher_list_paging_and_status_counts_td_565';
  if (shouldRun(pagingId, 'td565', 'vouchers', 'accounting', 'package3')) {
    await runCase(results, pagingId, 'v9.0.109: GET /accounting/vouchers pages and filters on the server, counts every status under the other filters and searches case-insensitively (TD-565)', async () => {
      const admin = await adminClient();
      const problems: string[] = [];
      const today = await businessTodayIsoDate();
      const token = `td565-${tagOf()}`;
      // 25 vouchers of one search token: 12 general drafts, 8 approved sales, 5 permanent general
      const plan = [
        ...Array.from({ length: 12 }, () => ({ voucherType: 'general', status: 'draft' })),
        ...Array.from({ length: 8 }, () => ({ voucherType: 'sales', status: 'approved' })),
        ...Array.from({ length: 5 }, () => ({ voucherType: 'general', status: 'permanent' })),
      ];
      const created: Array<{ id: number; voucherNumber: number; status: string }> = [];
      for (const [i, p] of plan.entries()) {
        const row = await insertVoucher({ date: today, ...p, description: `Paging ${token} row ${i + 1}` });
        created.push({ ...row, status: p.status });
      }
      const newestFirst = [...created].sort((a, b) => b.voucherNumber - a.voucherNumber);
      const search = encodeURIComponent(token.toUpperCase());

      const page2 = await admin.get(`/api/accounting/vouchers?search=${search}&page=2&limit=10`);
      if (page2.status !== 200) throw new Error(`page 2 returned ${page2.status}: ${JSON.stringify(page2.body).slice(0, 200)}`);
      const ids = (page2.body?.data ?? []).map((v: { id: number }) => v.id);
      if (page2.body?.total !== 25) problems.push(`search «${token.toUpperCase()}» total ${page2.body?.total}, expected 25 (a case-insensitive match of the description)`);
      if (JSON.stringify(ids) !== JSON.stringify(newestFirst.slice(10, 20).map(v => v.id))) problems.push(`page 2 ids ${JSON.stringify(ids)}, expected vouchers 11..20 newest first`);
      if (JSON.stringify(page2.body?.statusCounts) !== JSON.stringify({ draft: 12, approved: 8, permanent: 5 })) {
        problems.push(`status counts ${JSON.stringify(page2.body?.statusCounts)}, expected {"draft":12,"approved":8,"permanent":5}`);
      }

      // a status filter narrows the page and the total, not the counters of the status tabs
      const drafts = await admin.get(`/api/accounting/vouchers?search=${search}&status=draft&page=1&limit=100`);
      if (drafts.body?.total !== 12 || drafts.body?.data?.length !== 12 || drafts.body?.data?.some((v: { status: string }) => v.status !== 'draft')) {
        problems.push(`status=draft total ${drafts.body?.total} rows ${drafts.body?.data?.length}, expected 12 drafts`);
      }
      if (drafts.body?.statusCounts?.approved !== 8 || drafts.body?.statusCounts?.permanent !== 5) problems.push(`status=draft counters ${JSON.stringify(drafts.body?.statusCounts)}, expected the counters of every status`);

      // the type filter is read as voucherType and narrows the counters too
      const sales = await admin.get(`/api/accounting/vouchers?search=${search}&voucherType=sales&page=1&limit=100`);
      if (sales.body?.total !== 8 || JSON.stringify(sales.body?.statusCounts) !== JSON.stringify({ draft: 0, approved: 8, permanent: 0 })) {
        problems.push(`voucherType=sales total ${sales.body?.total} counters ${JSON.stringify(sales.body?.statusCounts)}, expected 8 approved`);
      }
      assertNoProblems(problems);
      return `page 2 of 25: ${ids.length} rows, counters ${JSON.stringify(page2.body?.statusCounts)}`;
    });
  }

  const subtreeId = 'reg_account_card_rolls_up_sub_accounts_td_570';
  if (shouldRun(subtreeId, 'td570', 'ledger', 'accounting', 'package3')) {
    await runCase(results, subtreeId, 'v9.0.111: the account card of a group or general account carries the rows, opening balance and final balance of all its sub-accounts, as the trial balance shows them (TD-570)', async () => {
      const admin = await adminClient();
      const problems: string[] = [];
      const today = await businessTodayIsoDate();
      const shift = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
      const tag = tagOf().slice(-6);
      // group 9…1 → general → subsidiaries A and B; a second group holds the counter account
      const group = await insertAccount(`91${tag}`, `TD-570 group ${tag}`, 'group', null);
      const general = await insertAccount(`91${tag}1`, `TD-570 general ${tag}`, 'general', group);
      const subA = await insertAccount(`91${tag}11`, `TD-570 cash ${tag}`, 'subsidiary', general);
      const subB = await insertAccount(`91${tag}12`, `TD-570 bank ${tag}`, 'subsidiary', general);
      const counterGroup = await insertAccount(`92${tag}`, `TD-570 counter group ${tag}`, 'group', null);
      const counterGeneral = await insertAccount(`92${tag}1`, `TD-570 counter general ${tag}`, 'general', counterGroup);
      const counter = await insertAccount(`92${tag}11`, `TD-570 owner ${tag}`, 'subsidiary', counterGeneral);
      await postApproved(shift(-10), subA, counter, 500_000, `TD-570 opening cash ${tag}`);
      await postApproved(shift(-1), subB, counter, 200_000, `TD-570 bank deposit ${tag}`);
      await postApproved(shift(-1), subB, subA, 50_000, `TD-570 cash to bank ${tag}`);

      for (const [label, accountId] of [['group', group], ['general', general]] as const) {
        const res = await admin.get(`/api/accounting/reports/ledger?accountId=${accountId}&startDate=${shift(-5)}`);
        const card = res.body?.report ?? res.body;
        if (res.status !== 200) { problems.push(`${label} card returned ${res.status}`); continue; }
        // opening 500,000 (cash before the period); in the period +200,000 deposit, and the cash-to-bank transfer both ways
        if (card?.openingBalance !== 500_000) problems.push(`${label} card opening ${card?.openingBalance}, expected 500000 (the sub-accounts before the period)`);
        if (card?.finalBalance !== 700_000) problems.push(`${label} card final ${card?.finalBalance}, expected 700000`);
        if (card?.totalDebit !== 250_000 || card?.totalCredit !== 50_000) problems.push(`${label} card turnover ${card?.totalDebit}/${card?.totalCredit}, expected 250000/50000`);
        const codes = (card?.items ?? []).filter((i: { isOpening?: boolean }) => !i.isOpening).map((i: { accountCode: string }) => i.accountCode).sort();
        if (JSON.stringify(codes) !== JSON.stringify([`91${tag}11`, `91${tag}12`, `91${tag}12`].sort())) problems.push(`${label} card rows ${JSON.stringify(codes)}, expected the three sub-account rows`);
      }
      // a subsidiary card is unchanged: only its own rows
      const own = await admin.get(`/api/accounting/reports/ledger?accountId=${subB}`);
      const ownCard = own.body?.report ?? own.body;
      if (ownCard?.finalBalance !== 250_000 || ownCard?.items?.length !== 2) problems.push(`subsidiary B card final ${ownCard?.finalBalance} rows ${ownCard?.items?.length}, expected 250000 / 2`);
      assertNoProblems(problems);
      return 'group and general cards roll up opening 500000, final 700000';
    });
  }

  return results;
}
