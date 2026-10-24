import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { personnelPartyName, personnelPartyOption } from '../../lib/treasury/personnelPartyName';

/**
 * v10.0.259 (TD-953): personnel imported from Excel with only a full name have empty first and last names; the treasury
 * and cheque forms built the party name from those two and sent an empty name (400 from the server).
 */
const FULL_NAME = 'رضا کریمی';
const FIRST = 'مینا';
const LAST = 'احمدی';

describe('TD-953 personnel party name in the treasury and cheque forms', () => {
  it('takes the full name of a personnel imported with only a full name', () => {
    expect(personnelPartyName({ fullName: FULL_NAME, firstName: '', lastName: '' })).toBe(FULL_NAME);
  });

  it('falls back to first and last name when the full name is empty', () => {
    expect(personnelPartyName({ fullName: '', firstName: FIRST, lastName: LAST })).toBe(`${FIRST} ${LAST}`);
  });

  it('gives the picker option the same name', () => {
    expect(personnelPartyOption({ id: 4, fullName: FULL_NAME, firstName: '', lastName: '' })).toEqual({ value: '4', label: FULL_NAME });
  });

  it('is used by both forms instead of joining first and last name', () => {
    for (const file of ['src/components/accounting/treasury/TreasuryTransactionModal.tsx', 'src/components/accounting/ChequesTab.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toContain('${p.firstName} ${p.lastName}');
      // the chosen party's name, and (10.3 package 6, TD-1362) the options of the list and of the server search
      expect(source.match(/personnelPartyName\(p\)/g)?.length ?? 0, file).toBe(1);
      expect(source.match(/\.map\(personnelPartyOption\)|mapResultToOption=\{personnelPartyOption\}/g)?.length ?? 0, file).toBe(2);
    }
  });
});
