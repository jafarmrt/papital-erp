import { describe, expect, it } from 'vitest';
import {
  matchStatementWithTransactions,
  newMatchedIdsBySource,
  type StatementRow,
  type TreasuryTxCandidate,
} from '../../components/accounting/reconciliation/bankStatementMatcher';

/** v10.0.254 (TD-971): a cleared cheque is matched as its own candidate, never mixed up with a treasury row of the same id */
describe('bank statement matcher with cleared cheques (TD-971)', () => {
  const statement: StatementRow[] = [
    { rowNo: 1, date: '2026-04-02', amount: 700000, type: 'receipt', description: 'cheque', tracking: '' },
    { rowNo: 2, date: '2026-04-03', amount: 500000, type: 'receipt', description: 'transfer', tracking: '' },
  ];
  const candidates: TreasuryTxCandidate[] = [
    { id: 7, transactionNumber: 'TR-7', date: '2026-04-03', type: 'receipt', amount: 500000 },
    { id: 7, source: 'cheque', transactionNumber: 'چک 1234', date: '2026-04-02', type: 'receipt', amount: 700000 },
  ];

  it('matches a statement line to the cleared cheque even when a treasury row has the same id', () => {
    const rows = matchStatementWithTransactions(statement, candidates);
    expect(rows[0]).toMatchObject({ matchedTxId: 7, matchedSource: 'cheque', matchedTxNumber: 'چک 1234' });
    expect(rows[1]).toMatchObject({ matchedTxId: 7, matchedSource: 'treasury', matchedTxNumber: 'TR-7' });
  });

  it('sends the new matches split by source', () => {
    const rows = matchStatementWithTransactions(statement, candidates);
    expect(newMatchedIdsBySource(rows)).toEqual({ txIds: [7], chequeIds: [7] });
    expect(newMatchedIdsBySource(rows.map(r => ({ ...r, alreadyReconciled: true })))).toEqual({ txIds: [], chequeIds: [] });
  });
});
