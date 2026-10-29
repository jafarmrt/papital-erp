// @vitest-environment node
/**
 * v10.0.262 (OWN-01): the treasury contra-account check read twelve mapped accounts with `Promise.all` on one transaction,
 * so pg sent several queries on the same client at once (pg 8 warns "client is already executing a query", pg 9 refuses).
 * The reads now run one after the other: at most one mapped-account read is in flight at any moment.
 * v11 phase 6.1b (M6): the excluded accounts are the control accounts (`AccountMappingService.controlAccountsById`, fifteen
 * mapped concepts) and the two year-closing accounts. v11 tool 4 adds the colleague current account (sixteen).
 */
import { describe, expect, it, vi } from 'vitest';

const state = { inFlight: 0, maxInFlight: 0, calls: 0 };

vi.mock('../../db/drizzle.js', () => ({ orm: {} }));

import { AccountMappingService } from '../../services/accounting/accountMapping.service';
import { choosableContraAccounts } from '../../services/accounting/treasury/partyContraAccount';

const read = async () => {
  state.calls += 1;
  state.inFlight += 1;
  state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
  await new Promise(resolve => setTimeout(resolve, 1));
  state.inFlight -= 1;
  return null;
};

/** A query builder whose every step returns itself and which resolves to no rows */
function emptyExecutor(): unknown {
  const chain: Record<string, unknown> = {};
  for (const step of ['select', 'from', 'innerJoin', 'where', 'orderBy']) chain[step] = () => chain;
  chain.then = (resolve: (rows: unknown[]) => unknown) => resolve([]);
  return chain;
}

describe('contra_account_sequential_reads_own_01', () => {
  it('reads the sixteen control and two year-closing mapped accounts one at a time on the transaction', async () => {
    vi.spyOn(AccountMappingService, 'resolveAccount').mockImplementation(read);
    vi.spyOn(AccountMappingService, 'getSummaryProfitLossAccount').mockImplementation(read);
    vi.spyOn(AccountMappingService, 'getClosingBalanceAccount').mockImplementation(read);
    await choosableContraAccounts(emptyExecutor() as never);
    expect(state.calls).toBe(18);
    expect(state.maxInFlight).toBe(1);
  });
});
