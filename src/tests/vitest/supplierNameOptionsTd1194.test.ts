import { describe, expect, it } from 'vitest';
import { supplierNameOptions } from '../../lib/documents/documentPartyKind';

// TD-1194 (roles-b guide test bug 1): the purchase forms list only suppliers and «both», never a customer
describe('supplierNameOptions (TD-1194)', () => {
  const parties = [
    { id: 1, name: 'Supplier A', partyType: 'supplier' },
    { id: 2, name: 'Boutique', partyType: 'customer' },
    { id: 3, name: 'Both C', partyType: 'both', phone: '0912' },
    { id: 4, name: 'Legacy', partyType: '' },
    { id: 5, name: '  ', partyType: 'supplier' },
  ];

  it('leaves out customers, parties without a type and blank names', () => {
    expect(supplierNameOptions(parties).map(o => o.value)).toEqual(['Supplier A', 'Both C']);
  });

  it('keeps the party name as the value and the row as _raw', () => {
    const [both] = supplierNameOptions([parties[2]]);
    expect(both.value).toBe('Both C');
    expect(both._raw.id).toBe(3);
    expect(both.label).toContain('0912');
  });
});
