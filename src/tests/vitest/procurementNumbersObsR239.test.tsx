import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ProcurementOrder } from '../../types';
import { lineAmount, readDecimalText, sumAmounts } from '../../lib/procurement/procurementNumbers';
import type { RialDisplayUnit } from '../../lib/rialDisplay';

const displayUnit: { current: RialDisplayUnit } = { current: 'IRR' };
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => displayUnit.current, useRialDisplay: () => rialDisplayOf(displayUnit.current) };
});

import { RequisitionItemRowEditor, type NewRequisitionRow } from '../../components/procurement/RequisitionItemRowEditor';
import { ConfirmWarehouseDeliveryModal } from '../../components/procurement/ConfirmWarehouseDeliveryModal';

// OBS-R2-39 (TD-992): the procurement screens summed amounts with JavaScript numbers, read the requisition quantity and
// price through type="number" (Persian digits dropped, an invalid entry became 0) and printed «ریال» whatever the
// display unit setting said.

const QTY_LABEL = 'مقدار درخواستی ردیف ۱';
const PRICE_LABEL = 'برآورد قیمت واحد ردیف ۱';
const TOMAN_TOTAL = '۱۲٬۵۰۰ تومان';
const RIAL_TOTAL = '۱۲۵٬۰۰۰ ریال';

const row: NewRequisitionRow = { id: 'r1', itemId: null, itemCode: '', itemName: 'سنگ', unit: 'عدد', requestedQty: 0, unitPriceEstimate: 0, notes: '' };

const order = (id: number, totalAmount: number): ProcurementOrder => ({
  id, refNumber: `R-${id}`, docType: 'receipt', status: 'draft', date: '2026-10-06T10:00:00', supplierName: 'تامین',
  notes: '', requisitionId: 1, requisitionCode: 'PR-1', projectName: null, location: 'WH1', totalAmount, itemsCount: 1, user: 'admin', items: [],
});

beforeEach(() => { displayUnit.current = 'IRR'; });
afterEach(cleanup);

function renderRow(onChange: (field: string, value: unknown) => void) {
  render(<table><tbody>
    <RequisitionItemRowEditor row={row} index={0} errors={{}} onSelectItem={() => undefined}
      onChange={(_id, field, value) => onChange(String(field), value)} onRemove={() => undefined} />
  </tbody></table>);
}

describe('procurement amounts are exact decimals (OBS-R2-39)', () => {
  it('multiplies and sums without floating point drift', () => {
    expect(lineAmount(0.1, 3)).toBe(0.3);
    expect(sumAmounts([{ a: 0.1 }, { a: 0.2 }], r => r.a)).toBe(0.3);
    expect(sumAmounts([{ q: 1.1, p: 3 }, { q: 2.2, p: 3 }], r => lineAmount(r.q, r.p))).toBe(9.9);
  });
});

describe('requisition quantity and price are read as text (OBS-R2-39)', () => {
  it('reads Persian digits and the Persian decimal separator', () => {
    const changes: [string, unknown][] = [];
    renderRow((f, v) => changes.push([f, v]));
    fireEvent.change(screen.getByLabelText(QTY_LABEL), { target: { value: '۲٫۵' } });
    fireEvent.change(screen.getByLabelText(PRICE_LABEL), { target: { value: '۱۲۰۰' } });
    expect(changes).toEqual([['requestedQty', 2.5], ['unitPriceEstimate', 1200]]);
    expect((screen.getByLabelText(QTY_LABEL) as HTMLInputElement).type).toBe('text');
  });

  it('never turns an invalid entry into zero and says why under the field', () => {
    const changes: [string, unknown][] = [];
    renderRow((f, v) => changes.push([f, v]));
    fireEvent.change(screen.getByLabelText(QTY_LABEL), { target: { value: '2x' } });
    fireEvent.change(screen.getByLabelText(PRICE_LABEL), { target: { value: '12.5' } });
    expect(changes).toEqual([]);
    expect(screen.getAllByRole('alert').length).toBe(2);
    expect(readDecimalText('1.23456', 4, 'مقدار').ok).toBe(false);
  });
});

describe('rial amounts follow the display unit (OBS-R2-39)', () => {
  it('shows the bulk delivery total in toman when the setting says so', () => {
    displayUnit.current = 'TOMAN';
    render(<ConfirmWarehouseDeliveryModal isOpen isSubmitting={false} onClose={() => undefined} onConfirm={() => undefined} order={null} bulkOrders={[order(1, 100000), order(2, 25000)]} />);
    expect(screen.queryByText(TOMAN_TOTAL)).not.toBeNull();
  });

  it('shows it in rial by default', () => {
    render(<ConfirmWarehouseDeliveryModal isOpen isSubmitting={false} onClose={() => undefined} onConfirm={() => undefined} order={null} bulkOrders={[order(1, 100000), order(2, 25000)]} />);
    expect(screen.queryByText(RIAL_TOTAL)).not.toBeNull();
  });
});
