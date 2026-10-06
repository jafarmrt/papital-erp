import request from 'supertest';
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

  return results;
}
