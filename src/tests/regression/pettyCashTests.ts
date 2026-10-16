import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { fin } from '../../lib/financialDecimal.js';

/** seller name sent with a line and read back unchanged */
const SELLER = 'لوازم‌التحریر مهر';

/**
 * v10.1.32 (D-16, decision t30 «fluctuating»): a petty cash fund is a rial treasury account of type petty_cash on 1006.
 * Any amount is charged into it with the treasury transfer and the unused cash goes back the same way. An expense
 * statement is one treasury payment from the fund: its draft voucher debits each line's expense account (less the line's
 * optional VAT, which is part of the amount paid and goes to the purchase-VAT mapping account 1303) and credits the fund's
 * ledger account with the fund as detail. The fund balance drops by the total at once and never below zero, so a second
 * statement above what is left is refused while the first voucher is still a draft. The lines (account, amount, VAT,
 * optional description, seller and invoice number) are kept and listed. A line on a non-expense account, a VAT not below
 * its line, a fund that is not petty cash and a foreign petty cash fund are 422; voiding a statement drops its draft
 * voucher and restores the balance, and the bank invariants (I15/I16) hold for the fund and the bank. Through the real
 * Express routes with a real session; red on the code before the change (the statement route did not exist, a USD petty
 * cash fund was accepted and a line took no VAT).
 */
export async function runPettyCashTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_petty_cash_fluctuating_d16';
  if (!shouldRun(id, 'd16', 'petty_cash', 'treasury', 'vouchers')) return results;
  const name = 'v10.1.32: a rial petty cash fund on 1006 is charged and emptied by transfer, an expense statement posts a balanced draft voucher (expenses less optional VAT, VAT on 1303 / 1006 with the fund detail) and keeps its lines, a non-expense line, a VAT not below its line, a non-petty account, an amount above the balance (draft statements counted) and a foreign fund are 422, and voiding restores the balance (D-16)';
  const tStart = Date.now();
  let h: Harness | undefined;
  try {
    h = await createHarness();
    const wrong: string[] = [];
    const details = await pettyCashCase(h, wrong);
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
  return results;
}

type Body = Record<string, unknown>;
const codeOf = (res: { body?: unknown }) => String((res.body as { code?: unknown })?.code ?? '');

async function pettyCashCase(h: Harness, wrong: string[]): Promise<string> {
  const accountId = async (code: string) => Number((await h.q(`SELECT id FROM accounts WHERE code = $1 AND is_deleted = 0`, [code]))[0]?.id);
  const balance = async (bankId: number) => fin(String((await h.q(`SELECT current_balance::text AS b FROM bank_accounts WHERE id = $1`, [bankId]))[0]?.b ?? '0')).toString();
  const expect = (label: string, actual: unknown, expected: unknown) => {
    if (String(actual) !== String(expected)) wrong.push(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  };
  const tag = `${h.tag}-${Math.floor(Math.random() * 1e5)}`;

  // a bank that holds cash: its own test ledger under 10, filled by a receipt from «other»
  const [parent] = await h.q(`SELECT id FROM accounts WHERE code = '10' AND is_deleted = 0`);
  const [ledger] = await h.q(
    `INSERT INTO accounts (code, name, level, parent_id, account_type, nature, is_system, is_active, is_deleted)
     VALUES ($1, $2, 'subsidiary', $3, 'asset', 'debit', 0, 1, 0) RETURNING id`,
    [`10D16${tag.replace(/\D/g, '').slice(-8)}`, `D16 bank ledger ${tag}`, parent?.id ?? null],
  );
  const bankRes = await h.post('/api/accounting/bank-accounts', { title: `بانک تنخواه ${tag}`, type: 'bank', accountId: Number(ledger.id) });
  if (bankRes.status >= 300) throw new Error(`bank create returned ${bankRes.status}: ${JSON.stringify(bankRes.body)}`);
  const bankId = Number((bankRes.body as Body).id);
  const fill = await h.post('/api/accounting/treasury', {
    type: 'receipt', method: 'cash', amount: 10_000_000, bankAccountId: bankId, partyType: 'other', partyName: `واریز ${tag}`,
    contraAccountId: await miscContraAccountId(),
  });
  expect('fill the bank', fill.status, 201);

  // 1. a foreign petty cash fund is refused, a rial one on 1006 is created
  const pettyLedger = await accountId('1006');
  if (!pettyLedger) throw new Error('standard account 1006 is missing from the test chart of accounts');
  const usd = await h.post('/api/accounting/bank-accounts', { title: `تنخواه ارزی ${tag}`, type: 'petty_cash', currency: 'USD', accountId: pettyLedger });
  expect('USD petty cash create', `${usd.status} ${codeOf(usd)}`, '422 PETTY_CASH_RIAL_ONLY');
  const usdBank = await h.post('/api/accounting/bank-accounts', { title: `بانک ارزی ${tag}`, type: 'bank', currency: 'USD', accountId: Number(ledger.id) });
  const toPetty = await h.put(`/api/accounting/bank-accounts/${Number((usdBank.body as Body).id)}`, { type: 'petty_cash' });
  expect('USD bank turned into petty cash', `${toPetty.status} ${codeOf(toPetty)}`, '422 PETTY_CASH_RIAL_ONLY');
  const fundRes = await h.post('/api/accounting/bank-accounts', { title: `تنخواه کارگاه ${tag}`, type: 'petty_cash', accountId: pettyLedger });
  if (fundRes.status >= 300) throw new Error(`petty cash create returned ${fundRes.status}: ${JSON.stringify(fundRes.body)}`);
  const fundId = Number((fundRes.body as Body).id);

  // 2. any amount is charged by transfer
  const charge = await h.post('/api/accounting/treasury/transfer', { fromBankAccountId: bankId, toBankAccountId: fundId, amount: 5_000_000 });
  expect('charge transfer', charge.status, 201);
  expect('fund balance after charge', await balance(fundId), '5000000');

  // 3. the expense account list holds expense accounts only
  const optionsRes = await h.get('/api/accounting/treasury/petty-cash/expense-accounts');
  const options = ((optionsRes.body as { data?: Array<{ id: number; code: string; accountType: string }> }).data ?? []);
  expect('expense accounts status', optionsRes.status, 200);
  if (options.some(o => !['expense', 'cost_of_sales'].includes(o.accountType))) wrong.push('expense account list holds a non-expense account');
  if (options.some(o => o.code === '1006' || o.code === '1201')) wrong.push('expense account list holds 1006 or 1201');
  const expenseA = options.find(o => o.code === '7009')?.id ?? options[0]?.id;
  const expenseB = options.find(o => o.id !== expenseA)?.id;
  if (!expenseA || !expenseB) throw new Error('fewer than two expense accounts in the test chart of accounts');

  // 4. refusals leave the fund untouched
  const url = `/api/accounting/treasury/petty-cash/${fundId}/expenses`;
  const onBank = await h.post(`/api/accounting/treasury/petty-cash/${bankId}/expenses`, { lines: [{ accountId: expenseA, amount: 1000 }] });
  expect('statement on a bank', `${onBank.status} ${codeOf(onBank)}`, '422 PETTY_CASH_FUND_INVALID');
  const onReceivables = await h.post(url, { lines: [{ accountId: await accountId('1201'), amount: 1000 }] });
  expect('line on trade receivables', `${onReceivables.status} ${codeOf(onReceivables)}`, '422 PETTY_CASH_EXPENSE_ACCOUNT_INVALID');
  const tooMuch = await h.post(url, { lines: [{ accountId: expenseA, amount: 3_000_000 }, { accountId: expenseB, amount: 2_000_001 }] });
  expect('statement above the balance', `${tooMuch.status} ${codeOf(tooMuch)}`, '422 PETTY_CASH_INSUFFICIENT_BALANCE');
  const empty = await h.post(url, { lines: [] });
  expect('statement without lines', empty.status, 400);
  const unknownKey = await h.post(url, { lines: [{ accountId: expenseA, amount: 1000, vat: 90 }] });
  expect('line with an unknown key', unknownKey.status, 400);
  const vatAll = await h.post(url, { lines: [{ accountId: expenseA, amount: 1000, vatAmount: '۱٬۰۰۰' }] });
  expect('VAT equal to its line', `${vatAll.status} ${codeOf(vatAll)}`, '422 PETTY_CASH_LINES_INVALID');
  const vatNegative = await h.post(url, { lines: [{ accountId: expenseA, amount: 1000, vatAmount: -1 }] });
  expect('negative VAT', vatNegative.status, 400);
  const viewer = await h.sessionWith(['accounting.view']);
  const forbidden = await h.post(url, { lines: [{ accountId: expenseA, amount: 1000 }] }, viewer);
  expect('statement without accounting.treasury', forbidden.status, 403);
  expect('fund balance after refusals', await balance(fundId), '5000000');

  // 5. a line without VAT or invoice data stays whole in its expense; a line's VAT moves to 1303; the voucher balances
  const vatLedger = await accountId('1303');
  if (!vatLedger) throw new Error('standard account 1303 is missing from the test chart of accounts');
  const statement = await h.post(url, {
    description: `خرج‌های هفته ${tag}`,
    lines: [
      { accountId: expenseA, amount: '۱٬۲۰۰٬۰۰۰', description: 'کرایه حمل' },
      { accountId: expenseB, amount: 300_000, vatAmount: '۲۷٬۰۰۰', sellerName: SELLER, invoiceNumber: '۴۵۶' },
    ],
  });
  expect('statement status', statement.status, 201);
  const row = statement.body as Body;
  const txId = Number(row.id);
  expect('statement amount', row.amount, 1_500_000);
  expect('fund balance after statement', await balance(fundId), '3500000');
  const [stored] = await h.q(`SELECT type, bank_account_id, voucher_id, party_type, contra_account_id FROM treasury_transactions WHERE id = $1`, [txId]);
  expect('statement row', `${stored?.type} ${stored?.bank_account_id} ${stored?.party_type} ${stored?.contra_account_id}`, `payment ${fundId} other null`);
  const voucherRows = await h.q(
    `SELECT i.account_id, i.debit::float8 AS debit, i.credit::float8 AS credit, i.detailed_type, i.detailed_id, v.status
       FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE v.id = $1 AND i.is_deleted = 0 ORDER BY i.credit, i.debit DESC`,
    [stored?.voucher_id],
  );
  const shape = voucherRows.map(r => `${r.account_id}:${r.debit}/${r.credit}:${r.detailed_type}:${r.detailed_id ?? ''}:${r.status}`).join(' ');
  expect('statement voucher', shape,
    `${expenseA}:1200000/0:none::draft ${expenseB}:273000/0:none::draft ${vatLedger}:27000/0:none::draft ${pettyLedger}:0/1500000:bank_account:${fundId}:draft`);
  const lines = await h.get(`/api/accounting/treasury/${txId}/petty-cash-lines`);
  const lineData = ((lines.body as { data?: Array<Body> }).data ?? []);
  expect('stored lines', lineData.map(l => `${l.lineNo}:${l.accountId}:${l.amount}:${l.vatAmount}:${l.sellerName}:${l.invoiceNumber}`).join(' '),
    `1:${expenseA}:1200000:0:: 2:${expenseB}:300000:27000:${SELLER}:456`);
  const page = await h.get(`/api/accounting/treasury?bankAccountId=${fundId}&page=1&limit=20`);
  const listed = (((page.body as { data?: Array<Body> }).data) ?? []).find(r => Number(r.id) === txId);
  expect('line count in the treasury list', listed?.pettyCashLineCount, 2);

  // 6. the balance already counts the draft statement: a second one fits, a third above what is left is refused
  const second = await h.post(url, { lines: [{ accountId: expenseA, amount: 2_000_000 }] });
  expect('second statement status', second.status, 201);
  expect('fund balance after two draft statements', await balance(fundId), '1500000');
  const third = await h.post(url, { lines: [{ accountId: expenseB, amount: 1_500_001 }] });
  expect('third statement above what the drafts left', `${third.status} ${codeOf(third)}`, '422 PETTY_CASH_INSUFFICIENT_BALANCE');
  const draftCount = await h.q(
    `SELECT count(*)::int AS n FROM journal_vouchers v JOIN treasury_transactions t ON t.voucher_id = v.id
      WHERE t.bank_account_id = $1 AND t.type = 'payment' AND v.status = 'draft' AND v.is_deleted = 0`,
    [fundId],
  );
  expect('statement vouchers still draft', draftCount[0]?.n, 2);
  const secondVoid = await h.post(`/api/accounting/treasury/${Number((second.body as Body).id)}/void`, { reason: 'آزمون ابطال صورت‌هزینه دوم' });
  expect('second void status', secondVoid.status, 200);
  expect('fund balance after the second void', await balance(fundId), '3500000');

  // 7. voiding the statement drops its draft voucher and restores the balance; the rest goes back to the bank
  const voided = await h.post(`/api/accounting/treasury/${txId}/void`, { reason: 'آزمون ابطال صورت‌هزینه' });
  expect('void status', voided.status, 200);
  expect('fund balance after void', await balance(fundId), '5000000');
  const [voucher] = await h.q(`SELECT is_deleted FROM journal_vouchers WHERE id = $1`, [stored?.voucher_id]);
  expect('draft voucher after void', voucher?.is_deleted, 1);
  const back = await h.post('/api/accounting/treasury/transfer', { fromBankAccountId: fundId, toBankAccountId: bankId, amount: 5_000_000 });
  expect('return transfer', back.status, 201);
  expect('fund balance after return', await balance(fundId), '0');
  const { checkBankInvariants } = await import('../invariants/bankInvariants.js');
  const violations = await checkBankInvariants([bankId, fundId]);
  if (violations.length > 0) wrong.push(`bank invariants: ${violations.map(v => `${v.invariant} ${v.key}`).join(', ')}`);
  return `fund ${fundId}, statement ${txId}, expense accounts ${expenseA} and ${expenseB}`;
}
