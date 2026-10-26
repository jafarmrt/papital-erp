import { pool } from '../../db/drizzle.js';
import { fundedBank } from '../invariants/payrollScenarios.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { TestCaseResult } from '../types.js';
import { adminClient, brief, keyState, lapseLock, runCase, tagOf, withCrashAfterCommit, type ShouldRun } from './idempotencyCrashTests.js';

import { testSupplier } from '../fixtures/factories.js';
/**
 * 10.3 (ARCH review finding 1): every money and stock write completes its resubmission key in its own transaction, as
 * payroll and piecework have since v10.2.35. Before, the key was completed only after the answer was ready, so a process
 * that died between the commit and that step left it `processing`, and once its lock lapsed a resend recorded the receipt,
 * transfer, cheque, voucher, document, stock transfer, requisition, raw material request or project a second time (the
 * review probed the first four on PostgreSQL). Each case sends a write whose `saveResponse` never lands, lapses its lock,
 * resends the same request with the same key and counts the records. Red on v10.2.39: every resend records again.
 */

const count = async (sql: string, params: unknown[]) => Number((await pool.query<{ n: string }>(sql, params)).rows[0]?.n ?? 0);

interface CrashProbe {
  url: string;
  body: object;
  /** what the write records; one more after the first send, and no more after the resend */
  records: () => Promise<number>;
  /** a check of the state left behind, e.g. a balance or a stock */
  after?: () => Promise<string | null>;
}

async function crashThenResend(key: string, probe: CrashProbe): Promise<string> {
  const problems: string[] = [];
  const api = await adminClient();
  const before = await probe.records();
  const first = await withCrashAfterCommit(() => api.post(probe.url, key, probe.body));
  if (first.status < 200 || first.status >= 300) throw new Error(`setup: the write answered ${brief(first)}`);
  const afterCrash = await keyState(key);
  if (afterCrash !== 'completed') problems.push(`after the crash the key is "${afterCrash}", expected completed with the write`);
  await lapseLock(key);

  const resend = await api.post(probe.url, key, probe.body);
  if (resend.status !== 200 || resend.body?.idempotentReplay !== true || resend.headers['x-idempotency-hit'] !== 'true') {
    problems.push(`the resend answered ${brief(resend)}, expected the replay notice`);
  }
  const recorded = (await probe.records()) - before;
  if (recorded !== 1) problems.push(`${recorded} records written, expected 1`);
  const state = await probe.after?.();
  if (state) problems.push(state);
  if (problems.length > 0) throw new Error(problems.join(' | '));
  return 'key completed with the write; resend replayed; recorded once';
}

export async function runIdempotencyCrashMoneyStockTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const { createTestItem, createTestWarehouse } = await import('../fixtures/factories.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  const { accountIdsByCode } = await import('./fiscalClosingTests.js');
  const { orm } = await import('../../db/drizzle.js');
  const today = await businessTodayIsoDate();
  const stockOf = (itemId: number, warehouse: string) => count(
    `SELECT COALESCE(SUM(s.current_stock), 0)::int::text AS n FROM item_warehouse_stocks s JOIN warehouses w ON w.id = s.warehouse_id WHERE s.item_id = $1 AND w.code = $2`,
    [itemId, warehouse]);

  const cases: Array<{ id: string; tags: string[]; name: string; probe: () => Promise<CrashProbe> }> = [
    {
      id: 'reg_idempotency_treasury_receipt_crash_records_once', tags: ['treasury'],
      name: 'a treasury receipt whose process dies after the commit is recorded once and the bank balance rises once',
      probe: async () => {
        const bankId = await fundedBank();
        const partyName = `ERP-TEST-MARKER crash receipt ${tagOf()}`;
        const balance = async () => Number((await pool.query<{ b: string }>('SELECT current_balance::text AS b FROM bank_accounts WHERE id = $1', [bankId])).rows[0]?.b);
        const start = await balance();
        return {
          url: '/api/accounting/treasury',
          body: { type: 'receipt', method: 'bank_transfer', amount: 111_000, bankAccountId: bankId, partyType: 'other', contraAccountId: await miscContraAccountId(), partyName },
          records: () => count('SELECT count(*)::text AS n FROM treasury_transactions WHERE party_name = $1', [partyName]),
          after: async () => (await balance()) - start === 111_000 ? null : `the bank balance rose by ${(await balance()) - start}, expected 111000`,
        };
      },
    },
    {
      id: 'reg_idempotency_treasury_transfer_crash_records_once', tags: ['treasury'],
      name: 'a transfer between two banks whose process dies after the commit moves the money once',
      probe: async () => {
        const from = await fundedBank();
        const to = await fundedBank();
        return {
          url: '/api/accounting/treasury/transfer',
          body: { amount: 222_000, fromBankAccountId: from, toBankAccountId: to, date: today },
          records: () => count(`SELECT count(*)::text AS n FROM treasury_transactions WHERE bank_account_id = $1 AND type = 'receipt' AND amount = 222000`, [to]),
        };
      },
    },
    {
      id: 'reg_idempotency_cheque_crash_records_once', tags: ['treasury', 'cheques'],
      name: 'a received cheque whose process dies after the commit is recorded once',
      probe: async () => {
        const chequeNumber = `9${tagOf()}`;
        return {
          url: '/api/accounting/cheques',
          body: { type: 'received', chequeNumber, bankName: 'ملت', issueDate: today, dueDate: today, amount: 333_000, partyType: 'other', contraAccountId: await miscContraAccountId(), partyName: 'ERP-TEST-MARKER crash cheque' },
          records: () => count('SELECT count(*)::text AS n FROM cheques WHERE cheque_number = $1', [chequeNumber]),
        };
      },
    },
    {
      id: 'reg_idempotency_manual_voucher_crash_records_once', tags: ['accounting', 'vouchers'],
      name: 'a manual accounting voucher whose process dies after the commit is recorded once',
      probe: async () => {
        const acc = await accountIdsByCode('7003', '1001');
        const description = `ERP-TEST-MARKER crash voucher ${tagOf()}`;
        return {
          url: '/api/accounting/vouchers',
          body: { date: today, status: 'draft', description, items: [{ accountId: acc['7003'], debit: 44_000, credit: 0 }, { accountId: acc['1001'], debit: 0, credit: 44_000 }] },
          records: () => count('SELECT count(*)::text AS n FROM journal_vouchers WHERE description = $1', [description]),
        };
      },
    },
    {
      id: 'reg_idempotency_final_receipt_crash_records_once', tags: ['documents', 'inventory'],
      name: 'a final stock receipt whose process dies after the commit is recorded once and the stock rises once',
      probe: async () => {
        const main = (await getDefaultWarehouseCode(orm)) as string;
        const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
        return {
          url: '/api/documents',
          body: { docType: 'receipt', inOut: 'in', status: 'final', refNumber: 'auto', date: today, buyer_name: await testSupplier('ERP-TEST-MARKER crash supplier'), location: main, items: [{ itemId: item.id, quantity: 5, unit_price: 1_000, location: main }] },
          records: () => count(`SELECT count(DISTINCT di.document_id)::text AS n FROM document_items di JOIN documents d ON d.id = di.document_id WHERE di.item_id = $1 AND d.type = 'receipt'`, [item.id]),
          after: async () => { const stock = await stockOf(item.id, main); return stock === 5 ? null : `the stock is ${stock}, expected 5`; },
        };
      },
    },
    {
      id: 'reg_idempotency_stock_transfer_crash_moves_once', tags: ['inventory', 'transfers'],
      name: 'a transfer between warehouses whose process dies after the commit moves the goods once',
      probe: async () => {
        const main = (await getDefaultWarehouseCode(orm)) as string;
        const target = await createTestWarehouse();
        const item = await createTestItem({ type: 'raw_material', stocks: { [main]: 10 }, weightedAverageCost: 1_000 });
        return {
          url: '/api/inventory/transfer',
          body: { itemId: item.id, fromLocation: main, toLocation: target.code, quantity: 3, date: today, refNumber: 'auto' },
          records: () => count(`SELECT count(DISTINCT di.document_id)::text AS n FROM document_items di JOIN documents d ON d.id = di.document_id WHERE di.item_id = $1 AND d.type = 'transfer'`, [item.id]),
          after: async () => {
            const [left, moved] = [await stockOf(item.id, main), await stockOf(item.id, target.code)];
            return left === 7 && moved === 3 ? null : `the warehouses hold ${left} and ${moved}, expected 7 and 3`;
          },
        };
      },
    },
    {
      id: 'reg_idempotency_requisition_crash_records_once', tags: ['procurement'],
      name: 'a purchase requisition whose process dies after the commit is recorded once',
      probe: async () => {
        const item = await createTestItem({ type: 'raw_material', stocks: {} });
        const title = `ERP-TEST-MARKER crash requisition ${tagOf()}`;
        return {
          url: '/api/procurement/requisitions',
          body: { title, items: [{ itemId: item.id, itemName: item.name, requestedQty: 3 }] },
          records: () => count('SELECT count(*)::text AS n FROM purchase_requisitions WHERE title = $1', [title]),
        };
      },
    },
    {
      id: 'reg_idempotency_raw_material_request_crash_records_once', tags: ['inventory', 'pending_materials'],
      name: 'a raw material request whose process dies after the commit is recorded once',
      probe: async () => {
        const name = `ERP-TEST-MARKER crash material ${tagOf()}`;
        return {
          url: '/api/pending-materials',
          body: { name },
          records: () => count('SELECT count(*)::text AS n FROM pending_materials WHERE name = $1', [name]),
        };
      },
    },
    {
      id: 'reg_idempotency_project_crash_records_once', tags: ['projects'],
      name: 'a production project whose process dies after the commit is recorded once',
      probe: async () => {
        const title = `ERP-TEST-MARKER crash project ${tagOf()}`;
        return {
          url: '/api/projects',
          body: { title, products: [] },
          records: () => count('SELECT count(*)::text AS n FROM production_projects WHERE title = $1', [title]),
        };
      },
    },
  ];

  for (const c of cases) {
    if (!shouldRun(c.id, 'idempotency', 'resubmission', 'crash', 'package10_3', ...c.tags)) continue;
    const key = `crash-${c.id.slice(16, 40)}-${tagOf()}`;
    await runCase(results, c.id, `10.3: ${c.name}; a resend after the lock lapses gets the «already registered» notice`, [key],
      async () => crashThenResend(key, await c.probe()));
  }
  return results;
}
