import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { kardexDocumentTypeLabel } from '../../lib/documents/documentTypeTitles';
import { ConfirmWarehouseDeliveryModal } from '../../components/procurement/ConfirmWarehouseDeliveryModal';

afterEach(cleanup);

/**
 * v10.0.47 (TD-1131): the Kardex shows a document type by its Persian name, never its code, and the delivery window
 * names the destination warehouse instead of its code.
 */
describe('Kardex document type label (TD-1131)', () => {
  it('names a document type code in Persian', () => {
    expect(kardexDocumentTypeLabel('remittance')).toBe('حواله خروج');
    expect(kardexDocumentTypeLabel('audit')).toBe('سند انبارگردانی');
    expect(kardexDocumentTypeLabel('transfer')).toBe('حواله انتقال');
  });

  it('keeps a stored Persian label and never shows an unknown code', () => {
    expect(kardexDocumentTypeLabel('ورود دستی')).toBe('ورود دستی');
    expect(kardexDocumentTypeLabel('some_code')).toBe('سند');
    expect(kardexDocumentTypeLabel(null)).toBe('');
  });
});

describe('procurement delivery warehouse name (TD-1131)', () => {
  it('shows the warehouse name, not its code', () => {
    const order = { id: 1, refNumber: 'R-1', supplierName: 'تامین الماس', location: 'raw', locationName: 'انبار مواد اولیه', items: [] };
    render(<ConfirmWarehouseDeliveryModal isOpen isSubmitting={false} onClose={() => undefined} onConfirm={() => undefined} order={order} />);
    expect(screen.queryByText('انبار مواد اولیه')).not.toBeNull();
    expect(screen.queryByText('raw')).toBeNull();
  });
});
