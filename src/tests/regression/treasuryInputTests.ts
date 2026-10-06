import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, journalVouchers } from '../../db/schema.js';
import { accountId, createBank } from './treasuryPartyTests.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Package 4 (treasury and cheques), PR «ج» input and access: real Express routes on PostgreSQL. Each test is red on the
 * version before its fix.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;

async function adminClient() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s = await getAdminSession();
  return {
    app,
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
    post: (url: string, body: object = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    put: (url: string, body: object = {}) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    patch: (url: string, body: object = {}) => request(app).patch(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
  };
}

/** A logged-in user whose role holds exactly these permissions */
async function sessionWith(permissions: string[]) {
  const { getTestApp, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
  const app = await getTestApp();
  const role = await createTestRole({ permissions });
  const user = await createTestUser({ role: role.code });
  const s = await loginTestUserWithSession(app, user.username);
  return {
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
  };
}

export const errorCode = (res: request.Response) => String(res.body?.code ?? '');

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

const SENSITIVE_BANK_KEYS = ['accountNumber', 'cardNumber', 'shebaNumber', 'currentBalance', 'ledgerBalance', 'treasuryBalance', 'discrepancy', 'initialBalance'];

export async function runTreasuryInputTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const optionsId = 'reg_bank_account_options_td_505';
  if (shouldRun(optionsId, 'td505', 'bank', 'permission', 'package4')) {
    await runCase(results, optionsId, 'v9.0.86: warehouse, document and cheque users read only the bank account pick list (id, code, title, type, bank, currency, has-ledger); the full list with numbers and balances needs a treasury read permission (TD-505)', async () => {
      const admin = await adminClient();
      const problems: string[] = [];
      const created = await admin.post('/api/accounting/bank-accounts', {
        title: `Options bank ${tagOf()}`, type: 'bank', bankName: 'ملت', accountNumber: '0101234567', cardNumber: '6104337712345678',
        shebaNumber: 'IR120120000000000101234567', initialBalance: 0,
      });
      if (created.status !== 201 && created.status !== 200) throw new Error(`bank create returned ${created.status}: ${JSON.stringify(created.body).slice(0, 200)}`);
      const bankId = Number(created.body.id);

      for (const perm of ['warehouse.in', 'warehouse.out', 'documents.view', 'documents.create', 'accounting.cheques', 'accounting.vouchers']) {
        const user = await sessionWith([perm]);
        for (const url of ['/api/accounting/bank-accounts', '/api/accounting/banks']) {
          const full = await user.get(url);
          if (full.status !== 403) problems.push(`${perm} read ${url} with ${full.status}, expected 403 (before: 200 with numbers and balances)`);
        }
        const options = await user.get('/api/accounting/bank-accounts/options');
        const rows: Array<Record<string, unknown>> = Array.isArray(options.body?.data) ? options.body.data : [];
        const row = rows.find(r => r.id === bankId);
        if (options.status !== 200 || !row) {
          problems.push(`${perm} pick list returned ${options.status} without the new bank`);
          continue;
        }
        const leaked = SENSITIVE_BANK_KEYS.filter(k => k in row);
        if (leaked.length > 0) problems.push(`${perm} pick list row carries ${leaked.join(', ')}`);
        if (row.title === undefined || row.currency !== 'IRR' || typeof row.hasLedgerAccount !== 'boolean') {
          problems.push(`${perm} pick list row is missing title / currency / hasLedgerAccount: ${JSON.stringify(row)}`);
        }
      }
      const payroll = await sessionWith(['personnel.manage']);
      const payrollOptions = await payroll.get('/api/accounting/bank-accounts/options');
      if (payrollOptions.status !== 200) problems.push(`personnel.manage (payroll payment) pick list returned ${payrollOptions.status}`);

      for (const perm of ['accounting.treasury', 'accounting.view']) {
        const reader = await sessionWith([perm]);
        const full = await reader.get('/api/accounting/bank-accounts');
        const row = (Array.isArray(full.body) ? full.body : []).find((r: { id: number }) => r.id === bankId);
        if (full.status !== 200 || row?.accountNumber !== '0101234567') problems.push(`${perm} full list returned ${full.status} without the account number`);
      }
      assertNoProblems(problems);
      return 'warehouse.in/out, documents.view/create, accounting.cheques/vouchers: full list 403, pick list 200 without account, card, Sheba or balances; personnel.manage pick list 200; accounting.treasury / accounting.view full list 200';
    });
  }

  const datesId = 'reg_cheque_and_treasury_dates_td_506';
  if (shouldRun(datesId, 'td506', 'td669', 'cheque', 'date', 'package4')) {
    await runCase(results, datesId, 'v9.0.87: a non-existent day (1404/12/30, 1404/07/31) is refused by treasury receipts, bank transfers and cheque actions instead of moving to another day or fiscal year, and a cheque issue or action date after the business today is refused (TD-506, TD-669)', async () => {
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
      const admin = await adminClient();
      const problems: string[] = [];
      const today = await businessTodayIsoDate();
      const shift = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
      const bank = await createBank('Dates bank');
      const other = await createBank('Dates bank two');
      const receipt = { type: 'receipt', method: 'bank_transfer', bankAccountId: bank.id, amount: 1_000_000, partyType: 'other', partyName: 'owner deposit', contraAccountId: await accountId('4101') };

      // 1404 is not a leap year: 1404/12/30 used to become 2026-03-21 (1 Farvardin 1405, next fiscal year), 1404/07/31 became 1 Aban
      for (const date of ['1404/12/30', '1404/07/31', '1404/13/01']) {
        const res = await admin.post('/api/accounting/treasury', { ...receipt, date });
        if (res.status !== 422) problems.push(`receipt dated ${date} returned ${res.status}, expected 422 (before: 201 on another day)`);
        const transfer = await admin.post('/api/accounting/treasury/transfer', { date, amount: 1_000, fromBankAccountId: bank.id, toBankAccountId: other.id });
        if (transfer.status !== 422) problems.push(`bank transfer dated ${date} returned ${transfer.status}, expected 422`);
      }
      const future = await admin.post('/api/accounting/treasury', { ...receipt, date: shift(30) });
      if (future.status !== 422 || errorCode(future) !== 'TREASURY_DATE_IN_FUTURE') problems.push(`future receipt returned ${future.status} ${errorCode(future)}, expected 422 TREASURY_DATE_IN_FUTURE`);
      const valid = await admin.post('/api/accounting/treasury', { ...receipt, date: '1405/01/15' });
      if (valid.status !== 201 && valid.status !== 200) problems.push(`receipt dated 1405/01/15 returned ${valid.status}: ${JSON.stringify(valid.body).slice(0, 200)}`);
      else if (valid.body?.date !== '2026-04-04') problems.push(`receipt dated 1405/01/15 stored ${valid.body?.date}, expected 2026-04-04`);

      // cheque: issue date five months ahead used to post its registration voucher in the future
      const cheque = { type: 'received', bankName: 'ملت', amount: 4_000_000, partyType: 'other', partyName: 'misc drawer', contraAccountId: await accountId('4101'), dueDate: shift(200) };
      const ahead = await admin.post('/api/accounting/cheques', { ...cheque, chequeNumber: `D${tagOf()}`, issueDate: shift(150) });
      if (ahead.status !== 422 || errorCode(ahead) !== 'TREASURY_DATE_IN_FUTURE') problems.push(`cheque issued ${shift(150)} returned ${ahead.status} ${errorCode(ahead)}, expected 422 TREASURY_DATE_IN_FUTURE (before: 201)`);
      const created = await admin.post('/api/accounting/cheques', { ...cheque, chequeNumber: `D${tagOf()}`, issueDate: shift(-10) });
      if (created.status !== 201) throw new Error(`cheque create returned ${created.status}: ${JSON.stringify(created.body).slice(0, 200)}`);
      const chequeId = Number(created.body.id);

      for (const actionDate of [shift(30), '1404/12/30']) {
        const res = await admin.patch(`/api/accounting/cheques/${chequeId}/status`, { status: 'in_collection', actionDate });
        if (res.status !== 422) problems.push(`cheque action dated ${actionDate} returned ${res.status}, expected 422 (before: 200, voucher on another day)`);
      }
      const yesterday = shift(-1);
      const moved = await admin.patch(`/api/accounting/cheques/${chequeId}/status`, { status: 'in_collection', actionDate: yesterday });
      if (moved.status !== 200) problems.push(`cheque action dated yesterday returned ${moved.status}: ${JSON.stringify(moved.body).slice(0, 200)}`);
      const vouchers = await orm.select({ date: journalVouchers.date, description: journalVouchers.description }).from(journalVouchers)
        .where(and(eq(journalVouchers.sourceChequeId, chequeId), eq(journalVouchers.isDeleted, 0)));
      if (vouchers.length !== 2 || !vouchers.some(v => v.date === yesterday)) problems.push(`cheque vouchers dated ${vouchers.map(v => v.date).join(', ')}, expected registration and in-collection on ${yesterday}`);
      assertNoProblems(problems);
      return `1404/12/30, 1404/07/31, 1404/13/01: receipt and transfer 422 (before: 2026-03-21, 2025-10-23, 2026-03-22); receipt ${shift(30)}: 422; 1405/01/15 stored 2026-04-04; cheque issued ${shift(150)}: 422; cheque action ${shift(30)} and 1404/12/30: 422; action ${yesterday}: voucher dated ${yesterday}`;
    });
  }

  const currencyId = 'reg_bank_account_currency_td_508';
  if (shouldRun(currencyId, 'td508', 'bank', 'currency', 'package4')) {
    await runCase(results, currencyId, 'v9.0.88: a bank account takes its currency from the supported list on create and edit, and the currency is fixed after its first treasury row, cheque or opening balance (422 instead of a silently ignored edit) (TD-508)', async () => {
      const admin = await adminClient();
      const problems: string[] = [];
      const lower = await admin.post('/api/accounting/bank-accounts', { title: `Dollar bank ${tagOf()}`, type: 'bank', currency: 'usd', initialBalance: 0 });
      if (lower.status !== 201 || lower.body?.currency !== 'USD') problems.push(`create with currency usd returned ${lower.status} ${lower.body?.currency}, expected 201 USD`);
      const unknown = await admin.post('/api/accounting/bank-accounts', { title: `Odd bank ${tagOf()}`, type: 'bank', currency: 'XYZ', initialBalance: 0 });
      if (unknown.status !== 422) problems.push(`create with currency XYZ returned ${unknown.status}, expected 422 (before: 201)`);

      // a fresh rial account becomes a dollar account (before: 200 and the currency stayed IRR)
      const bank = await createBank('Currency bank');
      const toUsd = await admin.put(`/api/accounting/bank-accounts/${bank.id}`, { currency: 'USD' });
      if (toUsd.status !== 200 || toUsd.body?.currency !== 'USD') problems.push(`fresh account PUT currency USD returned ${toUsd.status} ${toUsd.body?.currency}, expected 200 USD`);
      const receipt = await admin.post('/api/accounting/treasury', {
        type: 'receipt', method: 'bank_transfer', bankAccountId: bank.id, amount: 100, currency: 'USD', exchangeRate: 1_000_000,
        partyType: 'other', partyName: 'dollar deposit', contraAccountId: await accountId('4101'),
      });
      if (receipt.status !== 201) problems.push(`USD receipt on the dollar account returned ${receipt.status}: ${JSON.stringify(receipt.body).slice(0, 200)}`);
      const same = await admin.put(`/api/accounting/bank-accounts/${bank.id}`, { currency: 'USD', title: `Currency bank renamed ${tagOf()}` });
      if (same.status !== 200) problems.push(`PUT with the same currency after a receipt returned ${same.status}`);
      const toEur = await admin.put(`/api/accounting/bank-accounts/${bank.id}`, { currency: 'EUR' });
      if (toEur.status !== 422 || errorCode(toEur) !== 'BANK_ACCOUNT_CURRENCY_LOCKED') problems.push(`PUT currency EUR after a receipt returned ${toEur.status} ${errorCode(toEur)}, expected 422 BANK_ACCOUNT_CURRENCY_LOCKED`);

      // an opening balance fixes the currency too (its opening voucher is in that currency)
      const opened = await admin.post('/api/accounting/bank-accounts', { title: `Opened bank ${tagOf()}`, type: 'bank', initialBalance: 5_000_000, accountId: bank.ledgerId });
      if (opened.status !== 201) throw new Error(`opened bank create returned ${opened.status}: ${JSON.stringify(opened.body).slice(0, 200)}`);
      const openedToUsd = await admin.put(`/api/accounting/bank-accounts/${opened.body.id}`, { currency: 'USD' });
      if (openedToUsd.status !== 422 || errorCode(openedToUsd) !== 'BANK_ACCOUNT_CURRENCY_LOCKED') problems.push(`PUT currency USD on an account with an opening balance returned ${openedToUsd.status} ${errorCode(openedToUsd)}, expected 422`);
      const list = await admin.get('/api/accounting/bank-accounts');
      const stored = (Array.isArray(list.body) ? list.body : []).find((b: { id: number }) => b.id === bank.id);
      if (stored?.currency !== 'USD') problems.push(`dollar account currency is ${stored?.currency} after the refused edit, expected USD`);
      assertNoProblems(problems);
      return 'create usd: 201 USD; create XYZ: 422; fresh IRR account → USD: 200; USD receipt 100 at 1,000,000: 201; → EUR: 422 BANK_ACCOUNT_CURRENCY_LOCKED; account with opening balance 5,000,000 → USD: 422';
    });
  }

  const linksId = 'reg_bank_ledger_and_cheque_bank_td_510';
  if (shouldRun(linksId, 'td510', 'bank', 'cheque', 'ledger', 'package4')) {
    await runCase(results, linksId, 'v9.0.89: a bank account links only to an active subsidiary ledger account under general account 10 (cash and bank), and a cheque only to an active bank account (TD-510)', async () => {
      const admin = await adminClient();
      const problems: string[] = [];
      const [inactive] = await orm.insert(accounts).values({
        code: `1003${tagOf()}`, name: 'inactive test bank ledger', level: 'subsidiary', parentId: await accountId('1003'),
        accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 0, isDeleted: 0,
      }).returning({ id: accounts.id });
      const refused: Array<[string, number]> = [
        ['missing account 999999', 999_999],
        ['1201 trade receivables', await accountId('1201')],
        ['general account 10', await accountId('10')],
        ['inactive subsidiary under 1003', inactive.id],
      ];
      for (const [label, ledgerId] of refused) {
        const res = await admin.post('/api/accounting/bank-accounts', { title: `Link bank ${tagOf()}`, type: 'bank', accountId: ledgerId, initialBalance: 0 });
        if (res.status !== 422 || errorCode(res) !== 'BANK_LEDGER_ACCOUNT_INVALID') problems.push(`bank on ${label} returned ${res.status} ${errorCode(res)}, expected 422 BANK_LEDGER_ACCOUNT_INVALID (before: 201)`);
      }
      const ok = await admin.post('/api/accounting/bank-accounts', { title: `Link bank ${tagOf()}`, type: 'bank', accountId: await accountId('1003'), initialBalance: 0 });
      if (ok.status !== 201) problems.push(`bank on 1003 returned ${ok.status}: ${JSON.stringify(ok.body).slice(0, 200)}`);
      else {
        const moved = await admin.put(`/api/accounting/bank-accounts/${ok.body.id}`, { accountId: await accountId('1201') });
        if (moved.status !== 422) problems.push(`moving the bank to 1201 returned ${moved.status}, expected 422`);
        const renamed = await admin.put(`/api/accounting/bank-accounts/${ok.body.id}`, { title: `Link bank renamed ${tagOf()}`, accountId: await accountId('1003') });
        if (renamed.status !== 200) problems.push(`editing the bank with its own ledger account returned ${renamed.status}`);
      }

      const cheque = { type: 'received', bankName: 'ملت', amount: 1_000_000, issueDate: '1405/07/01', dueDate: '1405/09/01', partyType: 'other', partyName: 'misc drawer', contraAccountId: await accountId('4101') };
      const ghost = await admin.post('/api/accounting/cheques', { ...cheque, chequeNumber: `L${tagOf()}`, bankAccountId: 999_999 });
      if (ghost.status !== 422 || errorCode(ghost) !== 'CHEQUE_BANK_ACCOUNT_INVALID') problems.push(`cheque on bank 999999 returned ${ghost.status} ${errorCode(ghost)}, expected 422 CHEQUE_BANK_ACCOUNT_INVALID (before: 201)`);
      if (ok.status === 201) {
        const real = await admin.post('/api/accounting/cheques', { ...cheque, chequeNumber: `L${tagOf()}`, bankAccountId: ok.body.id });
        if (real.status !== 201 || Number(real.body?.bankAccountId ?? real.body?.bank_account_id) !== Number(ok.body.id)) problems.push(`cheque on an active bank returned ${real.status} bank ${real.body?.bankAccountId}`);
      }
      assertNoProblems(problems);
      return 'bank on 999999, 1201, 10 and an inactive 1003 child: 422 BANK_LEDGER_ACCOUNT_INVALID; bank on 1003: 201; moved to 1201: 422; cheque on bank 999999: 422 CHEQUE_BANK_ACCOUNT_INVALID; on an active bank: 201';
    });
  }

  const decimalId = 'reg_treasury_decimal_inputs_td_514';
  if (shouldRun(decimalId, 'td514', 'treasury', 'decimal', 'currency', 'package4')) {
    await runCase(results, decimalId, 'v9.0.90: treasury and cheque amounts, opening balances and exchange rates accept Persian digits and thousands separators, text is refused with a Persian message, and the currency comes from the supported list (TD-514)', async () => {
      const admin = await adminClient();
      const problems: string[] = [];
      const bank = await createBank('Decimal bank');
      const other = await createBank('Decimal bank two');
      const receipt = { type: 'receipt', method: 'bank_transfer', bankAccountId: bank.id, partyType: 'other', partyName: 'owner deposit', contraAccountId: await accountId('4101') };

      for (const [input, expected] of [['۲۵۰۰۰۰۰', 2_500_000], ['2,500,000', 2_500_000], ['۱٬۲۵۰٫۵', 1_250.5]] as const) {
        const res = await admin.post('/api/accounting/treasury', { ...receipt, amount: input });
        if (res.status !== 201 || Number(res.body?.amount) !== expected) problems.push(`receipt amount ${input} returned ${res.status} ${res.body?.amount}, expected 201 ${expected} (before: 400 «expected number, received NaN»)`);
      }
      const text = await admin.post('/api/accounting/treasury', { ...receipt, amount: 'دو میلیون' });
      const textMessage = JSON.stringify(text.body);
      if (text.status < 400 || text.status >= 500 || !textMessage.includes('مبلغ تراکنش') || /Invalid input|NaN/.test(textMessage)) problems.push(`receipt amount as words returned ${text.status} ${textMessage.slice(0, 200)}, expected a Persian message naming the amount`);
      const zero = await admin.post('/api/accounting/treasury', { ...receipt, amount: '۰' });
      if (zero.status < 400 || zero.status >= 500) problems.push(`receipt amount ۰ returned ${zero.status}, expected a 4xx`);

      const transfer = await admin.post('/api/accounting/treasury/transfer', { amount: '۱٬۰۰۰', fromBankAccountId: bank.id, toBankAccountId: other.id });
      if (transfer.status !== 201 && transfer.status !== 200) problems.push(`transfer amount ۱٬۰۰۰ returned ${transfer.status}: ${JSON.stringify(transfer.body).slice(0, 200)}`);

      const cheque = await admin.post('/api/accounting/cheques', {
        type: 'received', chequeNumber: `N${tagOf()}`, bankName: 'ملت', amount: '۱٬۰۰۰٬۰۰۰', issueDate: '1405/07/01', dueDate: '1405/09/01',
        partyType: 'other', partyName: 'misc drawer', contraAccountId: await accountId('4101'),
      });
      if (cheque.status !== 201 || Number(cheque.body?.amount) !== 1_000_000) problems.push(`cheque amount ۱٬۰۰۰٬۰۰۰ returned ${cheque.status} ${cheque.body?.amount}, expected 201 1000000`);

      const opened = await admin.post('/api/accounting/bank-accounts', { title: `Decimal opening ${tagOf()}`, type: 'bank', initialBalance: '۵۰۰۰', accountId: bank.ledgerId });
      if (opened.status !== 201 || Number(opened.body?.initialBalance) !== 5000) problems.push(`bank initial balance ۵۰۰۰ returned ${opened.status} ${opened.body?.initialBalance}, expected 201 5000`);

      const lower = await admin.post('/api/accounting/treasury', { ...receipt, amount: 1000, currency: 'usd', exchangeRate: '۱٬۰۰۰٬۰۰۰' });
      if (lower.status !== 422 || !JSON.stringify(lower.body).includes('(USD)')) problems.push(`receipt currency usd on a rial bank returned ${lower.status} ${JSON.stringify(lower.body).slice(0, 160)}, expected the currency mismatch naming USD (before: «usd»)`);
      const odd = await admin.post('/api/accounting/treasury', { ...receipt, amount: 1000, currency: 'XYZ' });
      if (odd.status < 400 || odd.status >= 500 || !JSON.stringify(odd.body).includes('ارز پشتیبانی نمی‌شود')) problems.push(`receipt currency XYZ returned ${odd.status} ${JSON.stringify(odd.body).slice(0, 160)}, expected «ارز پشتیبانی نمی‌شود»`);
      assertNoProblems(problems);
      return 'receipt ۲۵۰۰۰۰۰ / 2,500,000: 201 2500000; ۱٬۲۵۰٫۵: 1250.5; words: Persian message; transfer ۱٬۰۰۰: 201; cheque ۱٬۰۰۰٬۰۰۰: 201 1000000; opening ۵۰۰۰: 5000; usd: mismatch names USD; XYZ: «ارز پشتیبانی نمی‌شود»';
    });
  }

  return results;
}
