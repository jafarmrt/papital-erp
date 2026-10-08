import { orm } from '../../db/drizzle.js';
import { customers, personnel } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { TestCaseResult } from '../types.js';
import {
  type ShouldRun, accountIdsByCode, amountOf, assertNoProblems, inFiscalSandbox, postApproved, runCase, sandboxAdminClient,
  sandboxClientWith,
} from './fiscalClosingTests.js';

interface DetailedLine { accountId: number; debit: number; credit: number; detailedType?: string; detailedId?: number | null; detailedName?: string }

async function postDetailed(date: string, description: string, lines: DetailedLine[]): Promise<void> {
  await VoucherService.createJournalVoucher({
    date, voucherType: 'general', status: 'approved', description, referenceModule: 'manual',
    items: lines.map(l => ({ ...l, description })),
  });
}

/**
 * Package 3 PR «د»: who reads the account card, the party statement and the party list, and what they return
 * (decision t5 «الف»). Each scenario runs in its own isolated schema with the standard chart of accounts and is red on
 * the version before its fix.
 */
export async function runAccountingReportAccessTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const accessId = 'reg_ledger_reports_need_accounting_keys_td_547';
  if (shouldRun(accessId, 'td547', 'accounting', 'permission', 'report', 'package3')) {
    await runCase(results, accessId,
      'v9.0.225: the account card, ledger, party statement and party list open only for accounting.reports or accounting.view, and a card or statement with no account or party is 422 (TD-547)',
      () => inFiscalSandbox(async () => {
        const problems: string[] = [];
        const today = await businessTodayIsoDate();
        const ids = await accountIdsByCode('1201', '5001');
        await postApproved(today, ids['1201'], ids['5001'], 1_000_000, 'TD-547 sale');
        const [customer] = await orm.insert(customers).values({ name: 'TD-547 customer', partyType: 'customer' }).returning({ id: customers.id });

        const urls = [
          `/api/accounting/reports/account-card?accountId=${ids['1201']}`,
          `/api/accounting/reports/ledger?accountId=${ids['1201']}`,
          `/api/accounting/reports/party-ledger?partyId=${customer.id}&partyType=customer`,
          '/api/accounting/reports/parties?type=personnel',
        ];
        // 1) B03-05 S05: «documents.view» and «customers.view» read the whole ledger, payroll amounts and personnel phones
        for (const keys of [['documents.view'], ['customers.view'], ['customers.view', 'customers.manage']]) {
          const client = await sandboxClientWith(keys);
          for (const url of urls) {
            const res = await client.get(url);
            if (res.status !== 403) problems.push(`${keys.join('+')} ${url} answered ${res.status}, expected 403`);
          }
          if (keys[0] === 'customers.view') {
            const own = await client.get(`/api/customers/${customer.id}/account-card`);
            if (own.status !== 200) problems.push(`the customer's own account card (TD-416) answered ${own.status} for ${keys.join('+')}, expected 200`);
          }
        }
        for (const key of ['accounting.reports', 'accounting.view']) {
          const client = await sandboxClientWith([key]);
          for (const url of urls) {
            const res = await client.get(url);
            if (res.status !== 200) problems.push(`${key} ${url} answered ${res.status}, expected 200`);
          }
        }

        // 2) a card with no account and no party returned every row of the ledger (22 MB in S19)
        const admin = await sandboxAdminClient();
        for (const url of ['/api/accounting/reports/account-card', `/api/accounting/reports/ledger?startDate=${today}`, '/api/accounting/reports/ledger?detailedName=%20']) {
          const res = await admin.get(url);
          if (res.status !== 422 || res.body?.code !== 'ACCOUNT_CARD_FILTER_REQUIRED') {
            problems.push(`${url} answered ${res.status} ${JSON.stringify(res.body).slice(0, 160)}, expected 422 ACCOUNT_CARD_FILTER_REQUIRED`);
          }
        }
        const byType = await admin.get('/api/accounting/reports/ledger?detailedType=customer');
        if (byType.status !== 200) problems.push(`a card filtered by detailed type answered ${byType.status}, expected 200`);
        const noParty = await admin.get(`/api/accounting/reports/party-ledger?startDate=${today}`);
        if (noParty.status !== 422 || noParty.body?.code !== 'PARTY_LEDGER_PARTY_REQUIRED') {
          problems.push(`a statement with no party answered ${noParty.status} ${JSON.stringify(noParty.body).slice(0, 160)}, expected 422 PARTY_LEDGER_PARTY_REQUIRED`);
        }
        assertNoProblems(problems);
        return 'documents.view and customers.view get 403 on the four routes and still read the customer card; accounting keys get 200; unfiltered card and statement 422';
      }));
  }

  const rowsId = 'reg_party_statement_rows_by_party_td_548';
  if (shouldRun(rowsId, 'td548', 'accounting', 'party', 'report', 'package3')) {
    await runCase(results, rowsId,
      'v9.0.226: a party statement counts only rows of the party\'s own detailed type and id, or legacy rows without an id under its exact current name; never another table\'s id or a longer name (TD-548)',
      () => inFiscalSandbox(async () => {
        const problems: string[] = [];
        const today = await businessTodayIsoDate();
        const acc = await accountIdsByCode('1201', '5001', '6002', '3201');
        // B03-06 S06: customer #1 bought 1,000,000 on credit, customer «… و پسران» 600,000, and personnel with the same id 1
        // has a 2,500,000 payslip
        const [a] = await orm.insert(customers).values({ name: 'مشتری رضایی TD-548', partyType: 'customer' }).returning({ id: customers.id, name: customers.name });
        const [b] = await orm.insert(customers).values({ name: 'مشتری رضایی TD-548 و پسران', partyType: 'customer' }).returning({ id: customers.id, name: customers.name });
        const [p] = await orm.insert(personnel).values({ id: a.id, fullName: 'کارگر حقوق TD-548' }).returning({ id: personnel.id, name: personnel.fullName });
        await postDetailed(today, 'TD-548 sale A', [
          { accountId: acc['1201'], debit: 1_000_000, credit: 0, detailedType: 'customer', detailedId: a.id, detailedName: a.name },
          { accountId: acc['5001'], debit: 0, credit: 1_000_000 },
        ]);
        await postDetailed(today, 'TD-548 sale B', [
          { accountId: acc['1201'], debit: 600_000, credit: 0, detailedType: 'customer', detailedId: b.id, detailedName: b.name },
          { accountId: acc['5001'], debit: 0, credit: 600_000 },
        ]);
        await postDetailed(today, 'TD-548 payslip', [
          { accountId: acc['6002'], debit: 2_500_000, credit: 0, detailedType: 'personnel', detailedId: p.id, detailedName: p.name },
          { accountId: acc['3201'], debit: 0, credit: 2_500_000, detailedType: 'personnel', detailedId: p.id, detailedName: p.name },
        ]);
        // a legacy row without an id under A's name with spaces around it belongs to A
        await postDetailed(today, 'TD-548 legacy A', [
          { accountId: acc['1201'], debit: 50_000, credit: 0, detailedType: 'customer', detailedId: null, detailedName: `  ${a.name} ` },
          { accountId: acc['5001'], debit: 0, credit: 50_000 },
        ]);

        const admin = await sandboxAdminClient();
        const statement = async (query: string) => {
          const res = await admin.get(`/api/accounting/reports/party-ledger?${query}`);
          const body = (res.body?.report ?? res.body) as { items?: unknown[]; totalDebit?: number; totalCredit?: number; finalBalance?: number } | undefined;
          return {
            status: res.status, code: res.body?.code as string | undefined, rows: Array.isArray(body?.items) ? body.items.length : -1,
            debit: amountOf(body?.totalDebit), credit: amountOf(body?.totalCredit), balance: amountOf(body?.finalBalance),
          };
        };
        const expect = (label: string, got: Awaited<ReturnType<typeof statement>>, want: { rows: number; debit: number; credit: number; balance: number }) => {
          if (got.status !== 200 || got.rows !== want.rows || got.debit !== want.debit || got.credit !== want.credit || got.balance !== want.balance) {
            problems.push(`${label}: ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
          }
        };
        const ownA = { rows: 2, debit: 1_050_000, credit: 0, balance: 1_050_000 };
        expect('customer A by id', await statement(`partyId=${a.id}&partyType=customer`), ownA);
        expect('customer A by its exact name', await statement(`partyName=${encodeURIComponent(a.name)}`), ownA);
        expect('customer B by id', await statement(`partyId=${b.id}&partyType=customer`), { rows: 1, debit: 600_000, credit: 0, balance: 600_000 });
        expect('personnel with A\'s id', await statement(`partyId=${p.id}&partyType=personnel`), { rows: 2, debit: 2_500_000, credit: 2_500_000, balance: 0 });
        expect('personnel by its exact name', await statement(`partyName=${encodeURIComponent(p.name)}&partyType=personnel`), { rows: 2, debit: 2_500_000, credit: 2_500_000, balance: 0 });
        const containedName = 'مشتری رضایی';
        expect('a name no party has, contained in two names', await statement(`partyName=${encodeURIComponent(containedName)}`), { rows: 0, debit: 0, credit: 0, balance: 0 });

        // the customer page's card (TD-416) and the accounting statement agree
        const card = await admin.get(`/api/customers/${a.id}/account-card`);
        const cardBody = (card.body?.report ?? card.body) as { finalBalance?: number } | undefined;
        if (card.status !== 200 || amountOf(cardBody?.finalBalance) !== ownA.balance) {
          problems.push(`customer A's own card answered ${card.status} with ${JSON.stringify(cardBody?.finalBalance)}, expected ${ownA.balance}`);
        }
        const missing = await statement('partyId=987654&partyType=customer');
        if (missing.status !== 404 || missing.code !== 'PARTY_LEDGER_PARTY_NOT_FOUND') {
          problems.push(`a statement of a missing party answered ${missing.status} ${missing.code}, expected 404 PARTY_LEDGER_PARTY_NOT_FOUND`);
        }
        assertNoProblems(problems);
        return 'customer A 1,050,000 (own and legacy rows) like its own card, B 600,000, personnel 2,500,000 both sides; contained name 0 rows; missing id 404';
      }));
  }

  const bookId = 'reg_journal_book_paged_td_561';
  if (shouldRun(bookId, 'td561', 'accounting', 'journal', 'report', 'package3')) {
    await runCase(results, bookId,
      'v9.0.227: the journal book returns one page of rows once, with row numbers and running balance counted from the start of the range and totals over the whole range (TD-561)',
      () => inFiscalSandbox(async () => {
        const problems: string[] = [];
        const today = await businessTodayIsoDate();
        const ids = await accountIdsByCode('1001', '5001');
        // three vouchers of two rows each: six rows
        for (const amount of [100_000, 200_000, 300_000]) await postApproved(today, ids['1001'], ids['5001'], amount, `TD-561 sale ${amount}`);
        const admin = await sandboxAdminClient();
        const read = async (query: string) => admin.get(`/api/accounting/reports/journal-book?startDate=${today}&endDate=${today}${query}`);

        const whole = await read('&limit=1000');
        const all = (whole.body?.items ?? []) as { rowNumber: number; runningBalance: number; debit: number; credit: number }[];
        if (whole.status !== 200 || all.length !== 6) problems.push(`the whole range answered ${whole.status} with ${all.length} rows, expected 6`);
        if (whole.body && 'report' in whole.body) problems.push('the journal book still sends every row twice ({ report, ...report })');

        const first = await read('&page=1&limit=4');
        const second = await read('&page=2&limit=4');
        const p1 = (first.body?.items ?? []) as typeof all;
        const p2 = (second.body?.items ?? []) as typeof all;
        if (p1.length !== 4 || p2.length !== 2) problems.push(`pages of 4 rows held ${p1.length} and ${p2.length} rows, expected 4 and 2`);
        if (p2.map(r => r.rowNumber).join(',') !== '5,6') problems.push(`page 2 row numbers ${p2.map(r => r.rowNumber).join(',')}, expected 5,6`);
        if (all.length === 6 && p2.length === 2) {
          for (const [i, row] of p2.entries()) {
            if (amountOf(row.runningBalance) !== amountOf(all[4 + i].runningBalance)) {
              problems.push(`page 2 row ${i + 1} running balance ${row.runningBalance}, expected ${all[4 + i].runningBalance} as in the whole range`);
            }
          }
        }
        for (const [label, body] of [['page 1', first.body], ['page 2', second.body]] as const) {
          if (amountOf(body?.totalDebit) !== 600_000 || amountOf(body?.totalCredit) !== 600_000 || body?.vouchersCount !== 3 || body?.total !== 6) {
            problems.push(`${label} totals ${JSON.stringify({ d: body?.totalDebit, c: body?.totalCredit, v: body?.vouchersCount, t: body?.total })}, expected 600000/600000, 3 vouchers, 6 rows`);
          }
        }
        if (second.body?.page !== 2 || second.body?.limit !== 4) problems.push(`page 2 answered page ${second.body?.page} limit ${second.body?.limit}`);
        const tooMany = await read('&limit=5000');
        if (tooMany.status !== 400) problems.push(`a page of 5000 rows answered ${tooMany.status}, expected 400`);
        assertNoProblems(problems);
        return 'six rows in pages of 4: rows 5,6 on page 2 with the whole-range running balance; totals 600,000 / 3 vouchers / 6 rows on each page; no report copy; limit 5000 is 400';
      }));
  }

  const periodId = 'reg_party_statement_echoes_period_td_572';
  if (shouldRun(periodId, 'td572', 'accounting', 'party', 'report', 'package3')) {
    await runCase(results, periodId,
      'v9.0.229: a party statement answers with the range and currency it was computed for, so the print header reads them from the data (TD-572)',
      () => inFiscalSandbox(async () => {
        const problems: string[] = [];
        const today = await businessTodayIsoDate();
        const [c] = await orm.insert(customers).values({ name: 'TD-572 customer', partyType: 'customer' }).returning({ id: customers.id });
        const admin = await sandboxAdminClient();
        const ranged = await admin.get(`/api/accounting/reports/party-ledger?partyId=${c.id}&partyType=customer&startDate=${today}&endDate=${today}&currency=USD`);
        if (ranged.status !== 200 || ranged.body?.startDate !== today || ranged.body?.endDate !== today || ranged.body?.currency !== 'USD') {
          problems.push(`a ranged USD statement answered ${ranged.status} ${JSON.stringify({ s: ranged.body?.startDate, e: ranged.body?.endDate, c: ranged.body?.currency })}, expected ${today}/${today}/USD`);
        }
        const open = await admin.get(`/api/accounting/reports/party-ledger?partyId=${c.id}&partyType=customer`);
        if (open.status !== 200 || open.body?.startDate !== null || open.body?.endDate !== null || open.body?.currency !== 'IRR') {
          problems.push(`an all-time statement answered ${open.status} ${JSON.stringify({ s: open.body?.startDate, e: open.body?.endDate, c: open.body?.currency })}, expected null/null/IRR`);
        }
        assertNoProblems(problems);
        return 'ranged USD statement echoes its dates and USD; all-time statement null dates and IRR';
      }));
  }

  return results;
}
