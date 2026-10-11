import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blankContactPerson } from '../../lib/customers/contactPerson';

const PAGE = readFileSync(join(__dirname, '../../pages/CustomersPage.tsx'), 'utf8');
const DEFAULT_ROLE = /role:\s*(?:activeTab|form\.partyType|rawPartyType|'[^']+'|\(rawPartyType)/;

describe('Customer contact role starts empty (TD-1176)', () => {
  it('builds a new contact without a role', () => {
    expect(blankContactPerson('7', true)).toEqual({ id: '7', name: '', role: '', phone: '', isPrimary: true });
  });

  it('never pre-fills the role of a contact on the customers page', () => {
    const lines = PAGE.split('\n').filter(line => DEFAULT_ROLE.test(line));
    expect(lines).toEqual([]);
  });
});
