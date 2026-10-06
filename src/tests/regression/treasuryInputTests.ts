import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { journalVouchers } from '../../db/schema.js';
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

  return results;
}
