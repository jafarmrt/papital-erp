import { describe, expect, it } from 'vitest';
import { purchaseRefKey, purchaseRefKeys } from '../../lib/historyImport/purchaseRef';

describe('history import purchase numbers (tool 6)', () => {
  it('compares a number without spaces, letter case or Persian digits', () => {
    expect(purchaseRefKey(' B-۲۰۰ ')).toBe('b-200');
  });

  it('reads the rows that paid one purchase from one cell, each once', () => {
    expect(purchaseRefKeys('۹، 10;11 + 12\n9')).toEqual(['9', '10', '11', '12']);
    expect(purchaseRefKeys('  ')).toEqual([]);
    expect(purchaseRefKeys(undefined)).toEqual([]);
  });
});
