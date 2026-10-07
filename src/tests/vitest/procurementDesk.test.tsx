import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ProcurementOrder, PurchaseRequisition } from '../../types';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => ({ toast: { error: () => undefined, success: () => undefined } }));

import { ConfirmWarehouseDeliveryModal } from '../../components/procurement/ConfirmWarehouseDeliveryModal';
import { RequisitionDetailModal } from '../../components/procurement/RequisitionDetailModal';

/** an order exactly as `GET /api/procurement/orders` returns it (`listProcurementOrders`) */
const serverOrder: ProcurementOrder = {
  id: 41, refNumber: 'R-1405-0009', docType: 'receipt', status: 'draft', date: '2026-10-06T10:00:00', supplierName: 'تامین الماس',
  notes: '[تدارکات: درخواست PR-1405-0005]', requisitionId: 5, requisitionCode: 'PR-1405-0005', projectName: null, location: 'WH1',
  totalAmount: 50000, itemsCount: 1, user: 'admin',
  items: [{ id: 1, itemId: 9, itemName: 'سنگ فیروزه', itemCode: 'RM-9', unit: 'عدد', quantity: 5, unitPrice: 10000, totalPrice: 50000, location: 'WH1' }],
};

const requisition: PurchaseRequisition = {
  id: 5, code: 'PR-1405-0005', title: 'درخواست آزمون', status: 'ordered', priority: 'normal', notes: '', totalEstimatedAmount: 50000,
  items: [{ id: 'r1', itemId: 9, itemCode: 'RM-9', itemName: 'سنگ فیروزه', unit: 'عدد', requestedQty: 5, orderedQty: 5, remainingQty: 0, unitPriceEstimate: 10000, linkedDocumentIds: [41] }],
};

beforeEach(() => fetchJson.mockReset());
afterEach(cleanup);

/**
 * v9.0.276 (TD-701، B10-14): مودال‌های سفارش همان فیلدهایی را می‌خوانند که سرور برمی‌گرداند. پیش‌تر تأیید تحویل
 * `buyerName` را می‌خواند و به‌جای تأمین‌کننده سفارش «تامین‌کننده تدارکات» نشان می‌داد، و جزئیات درخواست
 * `orderNumber` / `orderDate` را می‌خواند و شماره و تاریخ سفارش خالی می‌ماند.
 */
describe('procurement order fields (TD-701)', () => {
  it('delivery confirmation shows the supplier of the order', () => {
    render(<ConfirmWarehouseDeliveryModal isOpen isSubmitting={false} onClose={() => undefined} onConfirm={() => undefined} order={serverOrder} />);
    expect(screen.queryByText('تامین الماس')).not.toBeNull();
    expect(screen.queryByText('تامین‌کننده تدارکات')).toBeNull();
  });

  it('bulk delivery lists the supplier of each order', () => {
    const second = { ...serverOrder, id: 42, refNumber: 'R-1405-0010', supplierName: 'تامین یاقوت' };
    render(<ConfirmWarehouseDeliveryModal isOpen isSubmitting={false} onClose={() => undefined} onConfirm={() => undefined} order={null} bulkOrders={[serverOrder, second]} />);
    expect(screen.queryByText('تامین الماس')).not.toBeNull();
    expect(screen.queryByText('تامین یاقوت')).not.toBeNull();
  });

  it('requisition detail shows the number and the Jalali date of each purchase order', async () => {
    fetchJson.mockResolvedValue({ success: true, data: [serverOrder] });
    render(<RequisitionDetailModal isOpen requisition={requisition} warehouseItems={[]} onClose={() => undefined} onRefresh={() => undefined} onOpenSplitOrder={() => undefined} />);
    await waitFor(() => expect(screen.queryAllByText(/تامین الماس/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/R-1405-0009/)).not.toBeNull();
    expect(screen.queryByText(/۱۴۰۵\/۰۷\/۱۴/)).not.toBeNull();
  });
});
