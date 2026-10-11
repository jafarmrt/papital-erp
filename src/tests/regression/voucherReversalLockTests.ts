import { eq } from 'drizzle-orm';
import type request from 'supertest';
import { orm } from '../../db/drizzle.js';
import { journalVouchers } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, accountIdsByCode, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * TD-1239 (roles-c Rc3): a reversed voucher reports its active reversal, so the row menu stops offering reverse and
 * correct again, and a reversal voucher does not go back to draft. Red on v10.0.166, where the list carried no reversal
 * and PUT /status moved a reversal voucher back to draft.
 */

const brief = (res: request.Response) => `${res.status} ${JSON.stringify(res.body ?? {}).slice(0, 220)}`;
const expect = (cond: boolean, message: string) => { if (!cond) throw new Error(message); };

async function statusOf(id: number): Promise<string> {
  const [row] = await orm.select({ status: journalVouchers.status }).from(journalVouchers).where(eq(journalVouchers.id, id));
  return row?.status ?? 'missing';
}

export async function runVoucherReversalLockTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('reg_voucher_reversal_lock_td_1239', 'td-1239', 'reversal_lock')) {
    await runCase(results, 'reg_voucher_reversal_lock_td_1239', 'TD-1239: a reversed voucher names its reversal and a reversal voucher stays out of draft', () => inFiscalSandbox(async () => {
      const admin = await sandboxAdminClient();
      const acc = await accountIdsByCode('7001', '1001');
      const created = await admin.post('/api/accounting/vouchers', {
        date: await businessTodayIsoDate(), description: 'Reversal lock test voucher', status: 'approved',
        items: [
          { accountId: acc['7001'], debit: 1000, credit: 0 },
          { accountId: acc['1001'], debit: 0, credit: 1000 },
        ],
      });
      expect(created.status === 201, `voucher create returned ${brief(created)}`);
      const originalId = Number(created.body.id);
      if (await statusOf(originalId) !== 'approved') {
        const approved = await admin.put(`/api/accounting/vouchers/${originalId}/status`, { status: 'approved' });
        expect(approved.status === 200, `approve returned ${brief(approved)}`);
      }
      const before = await admin.get(`/api/accounting/vouchers/${originalId}`);
      expect(before.status === 200 && before.body.reversedByVoucherNumber === null, `fresh voucher reversal is not null: ${brief(before)}`);

      const reversed = await admin.post(`/api/accounting/vouchers/${originalId}/reverse`, { reason: 'Reversal lock test' });
      expect(reversed.status === 201, `reverse returned ${brief(reversed)}`);
      const reversalId = Number(reversed.body.voucher?.id);
      const reversalNumber = String(reversed.body.voucher?.voucherNumber);

      const detail = await admin.get(`/api/accounting/vouchers/${originalId}`);
      expect(String(detail.body.reversedByVoucherNumber) === reversalNumber, `detail reversal ${brief(detail)}, expected ${reversalNumber}`);
      const list = await admin.get('/api/accounting/vouchers?limit=100');
      const row = (Array.isArray(list.body?.data) ? list.body.data : []).find((v: { id: number }) => v.id === originalId);
      expect(Boolean(row) && String(row.reversedByVoucherNumber) === reversalNumber, `list row reversal ${JSON.stringify(row ?? null).slice(0, 200)}`);
      const reversalRow = (Array.isArray(list.body?.data) ? list.body.data : []).find((v: { id: number }) => v.id === reversalId);
      expect(Boolean(reversalRow) && reversalRow.reversedByVoucherNumber === null, `reversal row should carry no reversal: ${JSON.stringify(reversalRow ?? null).slice(0, 200)}`);

      const toDraft = await admin.put(`/api/accounting/vouchers/${reversalId}/status`, { status: 'draft' });
      expect(toDraft.status === 409 && toDraft.body?.code === 'VOUCHER_REVERSAL_LOCKED', `reversal to draft returned ${brief(toDraft)}`);
      const reversalStatus = await statusOf(reversalId);
      expect(reversalStatus !== 'draft', `reversal voucher went back to draft (${reversalStatus})`);
      return `original ${originalId} reversed by ${reversalNumber}; reversal ${reversalId} stays ${reversalStatus}`;
    }));
  }

  return results;
}
