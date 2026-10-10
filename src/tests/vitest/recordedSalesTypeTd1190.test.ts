import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { recordedSalesType } from '../../lib/documents/recordedSalesType';

// v10.0.88 (TD-1190): the invoice form shows the number of the series the document is really saved in
describe('recordedSalesType (TD-1190)', () => {
  it('stores a proforma of a user who cannot finalize as type proforma', () => {
    expect(recordedSalesType('invoice', 'proforma', false)).toBe('proforma');
  });
  it('keeps the invoice type for a user who can finalize, and for a final invoice', () => {
    expect(recordedSalesType('invoice', 'proforma', true)).toBe('invoice');
    expect(recordedSalesType('invoice', 'final', false)).toBe('invoice');
    expect(recordedSalesType('return', 'proforma', false)).toBe('return');
  });
  it('is the type the invoice form asks the next number of', () => {
    const page = readFileSync('src/pages/CreateInvoicePage.tsx', 'utf8');
    expect(page).toContain('useInvoiceReferenceData(recordedSalesType(docType, status, canFinalizeSales))');
  });
});
