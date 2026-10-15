import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import type { AgingBucketKey, AgingReport, AgingRow } from '../../lib/reports/agingReport.js';

/**
 * Series 10.1, D-03 PR2 (reports plan §3, owner decisions t7 to t11): the receivables and payables aging tab of the
 * management reports page. Through the real Express routes with real sessions; every case is red on the code before the
 * report (404).
 */
export async function runAgingReportTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_aging_report_fifo_d03',
      'v10.1.10: the aging report settles each party oldest first from the ledger, ages what is left by its voucher date, keeps drafts apart, skips closing runs and deleted vouchers and reads cheques, legacy names and currencies (D-03)',
      ['d03', 'reports', 'aging', 'receivable', 'payable', 'currency', 'cheque'], agingFifoCase],
    ['reg_aging_report_ledger_match_d03',
      'v10.1.10: after an invoice, a treasury receipt and a received cheque the aging balance of the customer equals its ledger balance, its drafts and its last settlement (D-03)',
      ['d03', 'reports', 'aging', 'ledger', 'treasury', 'cheque'], agingLedgerCase],
    ['reg_aging_report_access_d03',
      'v10.1.10: GET /reports/aging needs accounting.reports and refuses an unknown or invalid query (D-03)',
      ['d03', 'reports', 'aging', 'permission'], agingAccessCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    let h: Harness | undefined;
    try {
      h = await createHarness();
      const wrong: string[] = [];
      const details = await run(h, wrong);
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      await h?.cleanup();
    }
  }
  return results;
}

async function report(h: Harness, query: string, session = h.admin): Promise<AgingReport> {
  const res = await h.get(`/api/reports/aging?${query}`, session);
  if (res.status !== 200) throw new Error(`GET /api/reports/aging?${query} answered ${brief(res)}`);
  return res.body as AgingReport;
}

function expectEqual(wrong: string[], label: string, got: unknown, expected: unknown): void {
  if (String(got) !== String(expected)) wrong.push(`${label}: got ${String(got)}, expected ${String(expected)}`);
}

type Expected = Partial<Record<AgingBucketKey | 'balance' | 'advance' | 'draft' | 'pendingCheques' | 'bouncedCheques', number | null>>;

/** compares one row (or the totals) with the expected amounts; a bucket left out is expected to be zero */
function expectAmounts(wrong: string[], label: string, row: Pick<AgingRow, 'balance' | 'buckets' | 'advance' | 'draft' | 'pendingCheques' | 'bouncedCheques'> | undefined, expected: Expected): void {
  if (!row) { wrong.push(`${label}: no row`); return; }
  for (const key of ['upTo30', 'upTo60', 'upTo90', 'upTo180', 'over180'] as const) {
    expectEqual(wrong, `${label} ${key}`, row.buckets[key], expected[key] ?? 0);
  }
  expectEqual(wrong, `${label} balance`, row.balance, expected.balance ?? 0);
  expectEqual(wrong, `${label} advance`, row.advance, expected.advance ?? 0);
  if ('draft' in expected) expectEqual(wrong, `${label} draft`, row.draft, expected.draft);
  if ('pendingCheques' in expected) expectEqual(wrong, `${label} pending cheques`, row.pendingCheques, expected.pendingCheques);
  if ('bouncedCheques' in expected) expectEqual(wrong, `${label} bounced cheques`, row.bouncedCheques, expected.bouncedCheques);
}

const daysBefore = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

interface Line {
  account: number;
  debit?: number;
  credit?: number;
  detail?: { type: string; id: number | null; name: string };
  currency?: string;
  rate?: number;
}

/** a balanced voucher written straight to the ledger tables, as an accountant's manual voucher or a closing run stores it */
async function voucher(h: Harness, date: string, status: string, lines: Line[], extra: { sourceFiscalYear?: number; deleted?: boolean } = {}): Promise<number> {
  const total = lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
  const [v] = await h.q(
    `INSERT INTO journal_vouchers (voucher_number, date, voucher_type, status, total_debit, total_credit, description, source_fiscal_year, is_deleted)
     VALUES (nextval('journal_voucher_number_seq'), $1, 'general', $2, $3, $3, $4, $5, $6) RETURNING id`,
    [date, status, total, `ERP-TEST-MARKER D03 aging ${h.tag}`, extra.sourceFiscalYear ?? null, extra.deleted ? 1 : 0],
  );
  for (const [i, l] of lines.entries()) {
    await h.q(
      `INSERT INTO journal_voucher_items (voucher_id, account_id, row_order, debit, credit, detailed_type, detailed_id, detailed_name, currency, exchange_rate, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ERP-TEST-MARKER D03 aging')`,
      [v.id, l.account, i + 1, l.debit ?? 0, l.credit ?? 0, l.detail?.type ?? 'none', l.detail?.id ?? null, l.detail?.name ?? '', l.currency ?? 'IRR', l.rate ?? 1],
    );
  }
  return Number(v.id);
}

interface Accounts { receivable: number; payable: number; counter: number }

/** the mapped trade receivables and payables accounts and a fresh counter account no other report reads */
async function ledgerAccounts(h: Harness): Promise<Accounts> {
  const { AccountMappingService } = await import('../../services/accounting/accountMapping.service.js');
  const receivable = await AccountMappingService.getTradeReceivablesAccount();
  const payable = await AccountMappingService.getTradePayablesAccount();
  const revenue = await AccountMappingService.getSalesRevenueAccount();
  if (!receivable || !payable || !revenue) throw new Error('setup: the trade receivables, payables or sales revenue account is not mapped');
  const parentId = revenue.parentId ?? revenue.parent_id ?? null;
  const [counter] = await h.q(
    `INSERT INTO accounts (code, name, level, parent_id, account_type, nature, is_system, is_active, is_deleted)
     VALUES ($1, $2, 'subsidiary', $3, 'revenue', 'credit', 0, 1, 0) RETURNING id`,
    [`88${h.tag}${Math.floor(Math.random() * 1e4)}`, `ERP-TEST-MARKER D03 aging counter ${h.tag}`, parentId],
  );
  return { receivable: receivable.id, payable: payable.id, counter: Number(counter.id) };
}

async function cheque(h: Harness, type: 'received' | 'paid', party: { type: string; id: number; name: string }, issueDate: string, amount: number, status: string): Promise<void> {
  await h.q(
    `INSERT INTO cheques (type, cheque_number, bank_name, issue_date, due_date, amount, party_type, party_id, party_name, status, description)
     VALUES ($1, $2, 'ملت', $3, $3, $4, $5, $6, $7, $8, 'ERP-TEST-MARKER D03 aging')`,
    [type, `D03-${h.tag}-${Math.floor(Math.random() * 1e6)}`, issueDate, amount, party.type, party.id, party.name, status],
  );
}

/**
 * Customer A: 500k (d200), 300k (d100, permanent), 400k (d45), a receipt of 600k (d20) and a draft of 300k (d5); a closing
 * run row (d10) and a deleted voucher (d15) must not count. B owes nothing and paid 250k ahead, with cheques. C has only a
 * legacy row by name and is deleted. D owes 100 USD. S is a supplier. A loose name has no party.
 */
async function agingFifoCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { createTestCustomer } = await import('../fixtures/factories.js');
  const acc = await ledgerAccounts(h);
  const d = (days: number) => daysBefore(f.today, days);
  const party = async (label: string, partyType = 'customer') => {
    const row = await createTestCustomer({ name: `D03 aging ${label} ${h.tag}`, partyType } as never);
    return { id: Number(row.id), name: String(row.name) };
  };
  const a = await party('A');
  const b = await party('B');
  const c = await party('C');
  const dd = await party('D');
  const s = await party('S', 'supplier');
  const loose = `D03 aging loose ${h.tag}`;
  const onR = (id: number | null, name: string, debit: number, credit = 0, type = 'customer'): Line[] => [
    { account: acc.receivable, debit, credit, detail: { type, id, name } },
    { account: acc.counter, debit: credit, credit: debit },
  ];

  await voucher(h, d(200), 'approved', onR(a.id, a.name, 500_000));
  await voucher(h, d(100), 'permanent', onR(a.id, a.name, 300_000));
  await voucher(h, d(45), 'approved', onR(a.id, a.name, 400_000));
  await voucher(h, d(20), 'approved', onR(a.id, a.name, 0, 600_000));
  await voucher(h, d(5), 'draft', onR(a.id, a.name, 300_000));
  await voucher(h, d(10), 'approved', onR(a.id, a.name, 0, 900_000), { sourceFiscalYear: 1404 });
  await voucher(h, d(15), 'approved', onR(a.id, a.name, 1_000_000), { deleted: true });

  await voucher(h, d(10), 'approved', onR(b.id, b.name, 0, 250_000));
  await cheque(h, 'received', { type: 'customer', ...b }, d(3), 120_000, 'received');
  await cheque(h, 'received', { type: 'customer', ...b }, d(4), 999, 'passed');
  await cheque(h, 'received', { type: 'customer', ...b }, d(50), 80_000, 'bounced');

  await voucher(h, d(400), 'approved', onR(null, ` ${c.name} `, 70_000));
  await h.q(`UPDATE customers SET is_deleted = 1 WHERE id = $1`, [c.id]);

  await voucher(h, d(70), 'approved', [
    { account: acc.receivable, debit: 100, detail: { type: 'customer', id: dd.id, name: dd.name }, currency: 'USD', rate: 500_000 },
    { account: acc.counter, credit: 100, currency: 'USD', rate: 500_000 },
  ]);
  await voucher(h, d(10), 'approved', onR(null, loose, 30_000, 0, 'other'));

  await voucher(h, d(150), 'approved', [
    { account: acc.payable, credit: 800_000, detail: { type: 'supplier', id: s.id, name: s.name } },
    { account: acc.counter, debit: 800_000 },
  ]);
  await voucher(h, d(60), 'approved', [
    { account: acc.payable, debit: 300_000, detail: { type: 'supplier', id: s.id, name: s.name } },
    { account: acc.counter, credit: 300_000 },
  ]);
  await cheque(h, 'paid', { type: 'supplier', ...s }, d(2), 100_000, 'in_treasury');

  // 1) A as of today: the receipt settles the 500k of d200 and 100k of d100; drafts count and are shown apart
  const ofA = await report(h, `partyId=${a.id}`);
  expectEqual(wrong, 'A rows', ofA.rows.length, 1);
  expectEqual(wrong, 'A party', JSON.stringify(ofA.rows[0]?.party), JSON.stringify({ id: a.id, name: a.name, kind: 'party', deleted: false }));
  expectAmounts(wrong, 'A', ofA.rows[0], { balance: 900_000, upTo30: 300_000, upTo60: 400_000, upTo180: 200_000, draft: 300_000, pendingCheques: 0, bouncedCheques: 0 });
  expectAmounts(wrong, 'A totals', ofA.totals, { balance: 900_000, upTo30: 300_000, upTo60: 400_000, upTo180: 200_000, draft: 300_000 });
  expectEqual(wrong, 'A last settlement', ofA.rows[0]?.lastSettlement, null);
  expectEqual(wrong, 'A bucket percents', JSON.stringify(ofA.bucketPercents), JSON.stringify({ upTo30: 33.3, upTo60: 44.4, upTo90: 0, upTo180: 22.2, over180: 0 }));
  expectEqual(wrong, 'A defaults', `${ofA.kind}|${ofA.currency}|${ofA.asOf}|${ofA.approvedOnly}|${ofA.chequesApply}`, `receivable|all|${f.today}|false|true`);

  // 2) approved only: the draft goes and the draft column is null
  const approved = await report(h, `partyId=${a.id}&approvedOnly=true`);
  expectAmounts(wrong, 'A approved only', approved.rows[0], { balance: 600_000, upTo60: 400_000, upTo180: 200_000, draft: null });

  // 3) thirty days ago: the receipt and the draft are later; ages count from the report date
  const earlier = await report(h, `partyId=${a.id}&asOf=${d(30)}`);
  expectAmounts(wrong, 'A thirty days ago', earlier.rows[0], { balance: 1_200_000, upTo30: 400_000, upTo90: 300_000, upTo180: 500_000, draft: 0 });

  // 4) B paid ahead: no age, an advance, its cheques; the last settlement is the latest cheque that did not bounce
  const ofB = await report(h, `partyId=${b.id}`);
  expectAmounts(wrong, 'B', ofB.rows[0], { balance: -250_000, advance: 250_000, pendingCheques: 120_000, bouncedCheques: 80_000 });
  expectEqual(wrong, 'B last settlement', JSON.stringify(ofB.rows[0]?.lastSettlement), JSON.stringify({ date: d(3), amount: '120000', byCheque: true }));
  const bEarlier = await report(h, `partyId=${b.id}&asOf=${d(30)}`);
  expectAmounts(wrong, 'B thirty days ago (bounced cheque only)', bEarlier.rows[0], { balance: 0, pendingCheques: 0, bouncedCheques: 80_000 });

  // 5) C: a legacy row without an id belongs to the party of that exact name, deleted or not
  const ofC = await report(h, `partyId=${c.id}`);
  expectAmounts(wrong, 'C', ofC.rows[0], { balance: 70_000, over180: 70_000 });
  expectEqual(wrong, 'C party', JSON.stringify(ofC.rows[0]?.party), JSON.stringify({ id: c.id, name: c.name, kind: 'party', deleted: true }));

  // 6) D: all currencies at the row's own rate; the USD view at its own amount and without cheque columns
  expectAmounts(wrong, 'D in rials', (await report(h, `partyId=${dd.id}`)).rows[0], { balance: 50_000_000, upTo90: 50_000_000 });
  const inUsd = await report(h, `partyId=${dd.id}&currency=usd`);
  expectAmounts(wrong, 'D in USD', inUsd.rows[0], { balance: 100, upTo90: 100, pendingCheques: null, bouncedCheques: null });
  expectEqual(wrong, 'USD view currency and cheques', `${inUsd.currency}|${inUsd.chequesApply}`, 'USD|false');

  // 7) S on the payables side: credit increases, the paid cheque is pending, no bounced column
  const ofS = await report(h, `kind=payable&partyId=${s.id}`);
  expectAmounts(wrong, 'S', ofS.rows[0], { balance: 500_000, upTo180: 500_000, pendingCheques: 100_000, bouncedCheques: null });
  expectEqual(wrong, 'S last settlement', JSON.stringify(ofS.rows[0]?.lastSettlement), JSON.stringify({ date: d(2), amount: '100000', byCheque: true }));
  expectEqual(wrong, 'payables account', ofS.account.code.length > 0, true);
  expectEqual(wrong, 'S not among receivables', (await report(h, `partyId=${s.id}`)).rows.length, 0);

  // 8) the whole report: the loose name is its own row, and the totals are the sum of every row
  const all = await report(h, 'export=true');
  const looseRow = all.rows.find(r => r.key === `n${loose}`);
  expectEqual(wrong, 'loose name row', JSON.stringify(looseRow?.party), JSON.stringify({ id: null, name: loose, kind: 'name', deleted: false }));
  expectAmounts(wrong, 'loose name', looseRow, { balance: 30_000, upTo30: 30_000 });
  expectEqual(wrong, 'export rows', all.rows.length, all.total);
  const { fin } = await import('../../lib/financialDecimal.js');
  const sum = (pick: (r: AgingRow) => string | null) => all.rows.reduce((acc, r) => acc.add(pick(r) ?? '0'), fin(0)).round(4).toString();
  expectEqual(wrong, 'total balance is the sum of the rows', all.totals.balance, sum(r => r.balance));
  expectEqual(wrong, 'total over 180 is the sum of the rows', all.totals.buckets.over180, sum(r => r.buckets.over180));
  expectEqual(wrong, 'total advance is the sum of the rows', all.totals.advance, sum(r => r.advance));
  expectEqual(wrong, 'party count', all.totals.partyCount, all.total);
  return `A ${ofA.rows[0]?.balance}, B advance ${ofB.rows[0]?.advance}, ${all.total} receivable rows`;
}

/** an invoice through POST /documents, a treasury receipt and a received cheque through their services */
async function agingLedgerCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { createTestCustomer } = await import('../fixtures/factories.js');
  const { AccountMappingService } = await import('../../services/accounting/accountMapping.service.js');
  const { BankAccountService } = await import('../../services/accounting/treasury/bankAccount.service.js');
  const { TreasuryTransactionService } = await import('../../services/accounting/treasury/treasuryTransaction.service.js');
  const { ChequeLifecycleService } = await import('../../services/accounting/treasury/chequeLifecycle.service.js');
  const { checkPartyBalances } = await import('../invariants/partyBalanceInvariant.js');
  const d = (days: number) => daysBefore(f.today, days);
  const customer = await createTestCustomer({ name: `D03 aging ledger ${h.tag}` });
  const name = String(customer.name);
  const item = await f.item(10, 200_000);
  const sale = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: item, quantity: 2, unit_price: 500_000, location: f.wh }], { partyId: customer.id, buyer_name: name }));
  if (sale.status !== 200) throw new Error(`setup: invoice ${brief(sale)}`);

  const [cash] = await h.q(`SELECT id FROM accounts WHERE code = '10' AND is_deleted = 0 LIMIT 1`);
  const [ledger] = await h.q(
    `INSERT INTO accounts (code, name, level, parent_id, account_type, nature, is_system, is_active, is_deleted)
     VALUES ($1, $2, 'subsidiary', $3, 'asset', 'debit', 0, 1, 0) RETURNING id`,
    [`10${h.tag}${Math.floor(Math.random() * 1e3)}`, `ERP-TEST-MARKER D03 aging cash ${h.tag}`, cash?.id ?? null],
  );
  const bank = await BankAccountService.createBankAccount({ title: `ERP-TEST-MARKER D03 cash ${h.tag}`, type: 'cash', accountId: Number(ledger.id), initialBalance: 0, currency: 'IRR' });
  await TreasuryTransactionService.createTreasuryTransaction({
    type: 'receipt', method: 'cash', amount: 300_000, bankAccountId: bank.id, date: d(2),
    partyType: 'customer', partyId: Number(customer.id), partyName: name, username: 'd03',
  });
  await ChequeLifecycleService.createCheque({
    type: 'received', chequeNumber: `D03-${h.tag}`, bankName: 'ملی', issueDate: d(1), dueDate: f.today, amount: 200_000,
    partyType: 'customer', partyId: Number(customer.id), partyName: name, username: 'd03',
  });

  const receivable = await AccountMappingService.getTradeReceivablesAccount();
  const ledgerSum = async (statuses: string[]) => {
    const [row] = await h.q(
      `SELECT COALESCE(SUM(i.debit - i.credit), 0)::text AS s
         FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
        WHERE i.is_deleted = 0 AND v.is_deleted = 0 AND i.account_id = $1 AND i.detailed_type IN ('customer', 'supplier')
          AND i.detailed_id = $2 AND v.status = ANY($3::text[])`,
      [receivable?.id, customer.id, statuses],
    );
    return Number(row?.s ?? 0);
  };
  const all = await ledgerSum(['approved', 'permanent', 'draft']);
  const drafts = await ledgerSum(['draft']);
  const approvedSum = await ledgerSum(['approved', 'permanent']);
  expectEqual(wrong, 'ledger balance of the flows', all, 500_000);

  const r = await report(h, `partyId=${customer.id}`);
  const row = r.rows[0];
  expectAmounts(wrong, 'customer', row, { balance: all, upTo30: all, draft: drafts, pendingCheques: 200_000, bouncedCheques: 0 });
  expectEqual(wrong, 'last settlement', JSON.stringify(row?.lastSettlement), JSON.stringify({ date: d(1), amount: '200000', byCheque: true }));
  const approved = await report(h, `partyId=${customer.id}&approvedOnly=true`);
  expectEqual(wrong, 'approved only balance', approved.rows[0]?.balance ?? '0', approvedSum);
  expectEqual(wrong, 'party balance invariant (I8)', JSON.stringify(await checkPartyBalances([Number(customer.id)])), '[]');

  // the day before the cheque the last settlement is the treasury receipt
  const before = await report(h, `partyId=${customer.id}&asOf=${d(2)}`);
  expectEqual(wrong, 'last settlement before the cheque', JSON.stringify(before.rows[0]?.lastSettlement), JSON.stringify({ date: d(2), amount: '300000', byCheque: false }));
  return `balance ${row?.balance}, drafts ${row?.draft}`;
}

async function agingAccessCase(h: Harness, wrong: string[]): Promise<string> {
  const salesOnly = await h.sessionWith(['reports.sales']);
  const refused = await h.get('/api/reports/aging', salesOnly);
  expectEqual(wrong, 'without accounting.reports', refused.status, 403);
  const reader = await h.sessionWith(['accounting.reports']);
  const allowed = await h.get('/api/reports/aging?kind=payable', reader);
  expectEqual(wrong, 'with accounting.reports', allowed.status, 200);
  expectEqual(wrong, 'kind of the answer', (allowed.body as AgingReport)?.kind, 'payable');
  for (const query of ['unknown=1', 'kind=both', 'sort=age', 'approvedOnly=yes', 'asOf=1405-13-40', 'currency=12', 'partyId=abc', 'page=0']) {
    const res = await h.get(`/api/reports/aging?${query}`, reader);
    expectEqual(wrong, `query ${query}`, res.status, 400);
  }
  return 'guarded';
}
