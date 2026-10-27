import type { Customer } from '../../types';

type PartyLabelFields = Pick<Customer, 'id' | 'name' | 'city' | 'phone' | 'supplierCategory'>;

/**
 * v11 phase 6.1ch (C13): a customer's option in the treasury and cheque forms, one label for the party list (cut at the cap)
 * and the server's matches, as `personnelPartyOption` for personnel
 */
export function customerPartyOption(c: PartyLabelFields): { value: string; label: string } {
  return { value: String(c.id), label: `${c.name}${c.city ? ` (${c.city})` : ''}${c.phone ? ` - ${c.phone}` : ''}` };
}

/** The same for a supplier, with its supply category */
export function supplierPartyOption(s: PartyLabelFields): { value: string; label: string } {
  return {
    value: String(s.id),
    label: `${s.name}${s.supplierCategory ? ` [${s.supplierCategory}]` : ''}${s.city ? ` (${s.city})` : ''}${s.phone ? ` - ${s.phone}` : ''}`,
  };
}
