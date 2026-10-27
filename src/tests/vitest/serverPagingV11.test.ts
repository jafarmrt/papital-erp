import { describe, expect, it } from 'vitest';
import { accountCardPageCount, setAccountCardPage } from '../../lib/accounting/accountCard';
import { customerAccountCardUrl } from '../../lib/customers/customerAccountCard';
import { groupRowsBy } from '../../lib/groupRows';
import {
  normalizeRunningKardex, runningKardexEntryMatches, runningKardexPageCount, runningKardexUrl,
} from '../../lib/transactions/runningKardex';
import {
  BANK_STATEMENT_DATE_MARGIN_DAYS, statementCandidateRange,
} from '../../components/accounting/reconciliation/bankStatementMatcher';

/**
 * v11 phase 6.1ch (M13, S11, C7): the addresses and helpers of the server-paged account card and Kardex window, the
 * days a bank statement reads, and the one-pass grouping of a list's child rows. The server side is in
 * src/tests/regression/serverPagingV11Tests.ts.
 */
describe('account card pages (M13)', () => {
  it('keeps the bare address for the first page and asks a later page or every row', () => {
    expect(setAccountCardPage(new URLSearchParams('accountId=5')).toString()).toBe('accountId=5');
    expect(setAccountCardPage(new URLSearchParams('accountId=5'), 3).toString()).toBe('accountId=5&page=3');
    expect(setAccountCardPage(new URLSearchParams('accountId=5'), 3, true).toString()).toBe('accountId=5&export=true');
    expect(customerAccountCardUrl(7)).toBe('/customers/7/account-card');
    expect(customerAccountCardUrl(7, 2)).toBe('/customers/7/account-card?page=2');
  });

  it('counts at least one page', () => {
    expect(accountCardPageCount(null)).toBe(1);
    expect(accountCardPageCount({ total: 0, limit: 200 })).toBe(1);
    expect(accountCardPageCount({ total: 200, limit: 200 })).toBe(1);
    expect(accountCardPageCount({ total: 201, limit: 200 })).toBe(2);
  });
});

describe('Kardex window pages (S11)', () => {
  it('sends only the filters that narrow and the page after the first', () => {
    expect(runningKardexUrl(4)).toBe('/inventory/item-kardex/4');
    expect(runningKardexUrl(4, { type: 'all', location: 'all', search: '  ', page: 1 })).toBe('/inventory/item-kardex/4');
    expect(runningKardexUrl(4, { from: '2025-02-01', to: '2025-02-28', type: 'out', location: 'W2', search: ' INV-9 ', page: 2 }))
      .toBe('/inventory/item-kardex/4?from=2025-02-01&to=2025-02-28&type=out&location=W2&search=INV-9&page=2');
    expect(runningKardexUrl(4, { type: 'in', page: 3 }, true)).toBe('/inventory/item-kardex/4?type=in&export=true');
  });

  it('matches the direction, the warehouse and a folded search over the document kind and reference', () => {
    const sale = { type: 'out', location: 'W1', documentType: 'invoice', documentRef: 'INV-12', notes: '', createdBy: 'علی' };
    expect(runningKardexEntryMatches(sale, {})).toBe(true);
    expect(runningKardexEntryMatches(sale, { type: 'in' })).toBe(false);
    expect(runningKardexEntryMatches(sale, { location: 'W2' })).toBe(false);
    expect(runningKardexEntryMatches(sale, { search: 'inv-12' })).toBe(true);
    expect(runningKardexEntryMatches(sale, { search: 'فاکتور' })).toBe(true);
    // the Arabic yeh of a keyboard folds to the Persian one
    expect(runningKardexEntryMatches(sale, { search: 'علي' })).toBe(true);
    expect(runningKardexEntryMatches(sale, { search: 'رسید' })).toBe(false);
    expect(runningKardexEntryMatches({ ...sale, isVoided: true }, { search: 'باطل' })).toBe(true);
  });

  it('reads a page answer and an answer of every row the same way', () => {
    const paged = normalizeRunningKardex({
      item: null, summary: null, entries: [{ date: '2025-02-10', type: 'out', quantity: 3, unitPrice: 1 }],
      opening: { date: '2025-02-01', runningBalance: 10, runningWac: 5, runningTotalValue: 50 }, locations: ['W1', 'W2'],
      total: 3, page: 2, limit: 1,
    });
    expect([paged.total, paged.page, paged.limit, paged.opening?.runningBalance, paged.locations.join()]).toEqual([3, 2, 1, 10, 'W1,W2']);
    expect(runningKardexPageCount(paged)).toBe(3);
    const bare = normalizeRunningKardex({ item: null, summary: null, entries: [{ date: '2025-02-10', type: 'out', quantity: 3, unitPrice: 1, location: 'W1' }] });
    expect([bare.total, bare.page, bare.opening, bare.locations.join()]).toEqual([1, 1, null, 'W1']);
  });
});

describe('bank statement days (M13)', () => {
  it('reads the treasury days of the statement widened by the margin on each side', () => {
    expect(BANK_STATEMENT_DATE_MARGIN_DAYS).toBe(31);
    expect(statementCandidateRange([{ date: '1404/07/15' }, { date: '2025-10-01' }, { date: '1404/07/01' }]))
      .toEqual({ startDate: '2025-08-23', endDate: '2025-11-07' });
  });

  it('skips a row without a date and reads every row when no date can be read', () => {
    expect(statementCandidateRange([{ date: '' }, { date: 'نامعلوم' }, { date: '2025-03-01' }]))
      .toEqual({ startDate: '2025-01-29', endDate: '2025-04-01' });
    expect(statementCandidateRange([{ date: '' }, { date: 'نامعلوم' }])).toBeNull();
    expect(statementCandidateRange([])).toBeNull();
  });
});

describe('groupRowsBy (C7)', () => {
  it('groups in one pass and keeps the order of the rows in each group', () => {
    const lines = [{ doc: 2, n: 'a' }, { doc: 1, n: 'b' }, { doc: 2, n: 'c' }, { doc: 3, n: 'd' }, { doc: 1, n: 'e' }];
    const groups = groupRowsBy(lines, line => line.doc);
    expect([...groups.keys()]).toEqual([2, 1, 3]);
    expect(groups.get(2)?.map(line => line.n)).toEqual(['a', 'c']);
    expect(groups.get(1)?.map(line => line.n)).toEqual(['b', 'e']);
    expect(groups.get(9)).toBeUndefined();
  });
});
