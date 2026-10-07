import { describe, expect, it } from 'vitest';
import { selectedPartyId } from '../../lib/documents/partySelection';
import { invoiceFormFromDocument } from '../../lib/invoices/invoiceForm';

/**
 * v9.0.287 (TD-778, finding B08-09): the invoice form and the stock document page send the party picked in the picker as
 * `partyId`, and editing a stored invoice restores the picker from the document's party id instead of matching the name.
 */
describe('document party selection (TD-778)', () => {
  it('sends a picked party id and nothing for an empty or invalid pick', () => {
    expect(selectedPartyId('12')).toBe(12);
    expect(selectedPartyId(7)).toBe(7);
    expect(selectedPartyId('')).toBeUndefined();
    expect(selectedPartyId(null)).toBeUndefined();
    expect(selectedPartyId(undefined)).toBeUndefined();
    expect(selectedPartyId('0')).toBeUndefined();
    expect(selectedPartyId('1.5')).toBeUndefined();
  });

  it('restores the party of a stored invoice by id, whatever its buyer name', () => {
    const form = invoiceFormFromDocument({ type: 'invoice', status: 'proforma', buyer_name: 'علي رضايي', partyId: 42 }, '1001');
    expect(form.partyId).toBe(42);
    expect(form.buyerName).toBe('علي رضايي');
    expect(invoiceFormFromDocument({ type: 'invoice', buyer_name: 'x' }, '1').partyId).toBeNull();
  });
});
