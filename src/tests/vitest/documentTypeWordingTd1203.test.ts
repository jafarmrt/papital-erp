import { describe, expect, it } from 'vitest';
import { INVOICE_TYPE_BADGES, resolveInvoiceRowFigures } from '../../lib/invoices/invoiceListDocuments';
import { treasuryRowsListText } from '../../services/documents/voidDependents';

/**
 * v10.0.101 (TD-1203): the documents list names a production receipt «رسید تولید» (not «سند انبار») and the void
 * refusal names the treasury rows' currency in Persian (not the raw code «IRR»).
 */
describe('TD-1203 document type and currency wording', () => {
  it('labels a production receipt row as a production receipt', () => {
    const { badgeKind } = resolveInvoiceRowFigures({ id: 1, type: 'production_receipt', status: 'final' });
    expect(badgeKind).toBe('production_receipt');
    expect(INVOICE_TYPE_BADGES[badgeKind].label).toBe('رسید تولید');
  });

  it('names the currency of the treasury rows in the void refusal in Persian', () => {
    const text = treasuryRowsListText([
      { transactionNumber: 'TR-1', type: 'receipt', amount: '1000000', currency: 'IRR' },
      { transactionNumber: 'TR-2', type: 'payment', amount: 25, currency: 'USD' },
      { transactionNumber: 'TR-3', type: 'receipt', amount: 5, currency: null },
    ]);
    expect(text).not.toMatch(/IRR|USD/);
    expect(text).toContain('ریال');
    expect(text).toContain('دلار');
  });
});
