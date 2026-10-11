// @vitest-environment node
/**
 * v10.0.260 (OWN-01): the treasury contra-account check read twelve mapped accounts with `Promise.all` on one transaction,
 * so pg sent several queries on the same client at once (pg 8 warns "client is already executing a query", pg 9 refuses).
 * The reads now run one after the other: at most one mapped-account read is in flight at any moment.
 */
import { describe, expect, it, vi } from 'vitest';

const state = { inFlight: 0, maxInFlight: 0, calls: 0 };

vi.mock('../../db/drizzle.js', () => ({ orm: {} }));
vi.mock('../../services/accounting/accountMapping.service.js', () => {
  const read = async () => {
    state.calls += 1;
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    await new Promise(resolve => setTimeout(resolve, 1));
    state.inFlight -= 1;
    return null;
  };
  const names = [
    'getTradeReceivablesAccount', 'getTradePayablesAccount', 'getWagesPayableAccount', 'getChequeReceivableAccount',
    'getChequeInCollectionAccount', 'getChequeProtestAccount', 'getChequePayableAccount', 'getInventoryRawMaterialsAccount',
    'getWorkInProgressAccount', 'getInventoryFinishedGoodsAccount', 'getSummaryProfitLossAccount', 'getClosingBalanceAccount',
  ];
  return { AccountMappingService: Object.fromEntries(names.map(n => [n, read])) };
});

import { choosableContraAccounts } from '../../services/accounting/treasury/partyContraAccount';

/** A query builder whose every step returns itself and which resolves to no rows */
function emptyExecutor(): unknown {
  const chain: Record<string, unknown> = {};
  for (const step of ['select', 'from', 'where', 'orderBy']) chain[step] = () => chain;
  chain.then = (resolve: (rows: unknown[]) => unknown) => resolve([]);
  return chain;
}

describe('contra_account_sequential_reads_own_01', () => {
  it('reads the twelve mapped accounts one at a time on the transaction', async () => {
    await choosableContraAccounts(emptyExecutor() as never);
    expect(state.calls).toBe(12);
    expect(state.maxInFlight).toBe(1);
  });
});
