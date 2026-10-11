import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReorderModalItem } from '../../lib/reorderAlerts/reorderItems';
import { openRequestedQuantities, unorderedRowQty } from '../../services/items/reorderOpenRequisitions';
import { openRequisitionQuestion } from '../../lib/reorderAlerts/openRequisitionQuestion';

const mutate = vi.fn();
const confirmAction = vi.fn<(opts: { message: string }) => Promise<boolean>>();
vi.mock('react-hot-toast', () => { const toast = { error: vi.fn(), success: vi.fn() }; return { default: toast, toast }; });
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: (opts: { message: string }) => confirmAction(opts) }));
vi.mock('../../hooks/reorderAlerts/useReorderAlertsQueries', () => ({ useReorderSuppliersQuery: () => [] }));
vi.mock('../../hooks/reorderAlerts/useReorderAlertsMutations', () => ({
  useReorderPurchaseSubmit: () => ({ mutate: (...args: unknown[]) => mutate(...args), isPending: false }),
}));
vi.mock('../../hooks/queries/useSettingsQueries', () => ({ useWarehousesQuery: () => ({ data: [{ id: 1, name: 'انبار اصلی', code: 'MAIN' }] }) }));
vi.mock('../../components/SearchableSelect', () => ({ SearchableSelect: () => null }));
vi.mock('../../components/common/FinancialAmountInput', () => ({ FinancialAmountInput: () => null }));
vi.mock('../../components/common/JalaliDateInput', () => ({ JalaliDateInput: () => null }));

import { ReorderPurchaseModal } from '../../components/reorder/ReorderPurchaseModal';

afterEach(() => { cleanup(); mutate.mockReset(); confirmAction.mockReset(); });

const line = (requested: number): ReorderModalItem => ({
  id: 7, name: 'مهره سفید', code: 'R-7', unit: 'عدد', current_stock: 0, reorder_point: 10, deficit: 10,
  weighted_average_cost: 100, type: 'raw_material', orderQty: 10, unitPrice: 100, requested_qty: requested,
});
const sendRequest = (item: ReorderModalItem) => {
  render(<ReorderPurchaseModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} selectedItems={[item]} />);
  fireEvent.click(screen.getByText('ثبت و ارسال درخواست خرید'));
};

// v10.0.255 (TD-1134): a reorder request ignored the open purchase requisitions of the same item
describe('open purchase requisitions on the reorder alert (TD-1134)', () => {
  it('counts only the unordered part of rows that are not closed', () => {
    expect(unorderedRowQty({ requestedQty: 4, orderedQty: 0 })).toBe(4);
    expect(unorderedRowQty({ requestedQty: 3, orderedQty: 1 })).toBe(2);
    expect(unorderedRowQty({ requestedQty: 5, orderedQty: 6 })).toBe(0);
    expect(unorderedRowQty({ requestedQty: 9, orderedQty: 0, closed: true })).toBe(0);
    const totals = openRequestedQuantities([
      { itemId: 7, requestedQty: 4 }, { itemId: '7', requestedQty: 3, orderedQty: 1 }, { itemId: 8, requestedQty: 9 }, { itemId: null, requestedQty: 2 },
    ], [7]);
    expect([...totals]).toEqual([[7, 6]]);
  });

  it('asks before a second request and sends it only after a yes', async () => {
    expect(openRequisitionQuestion([line(0)])).toBeNull();
    confirmAction.mockResolvedValueOnce(false);
    sendRequest(line(6));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(confirmAction.mock.calls[0][0].message).toContain('«مهره سفید» (۶ عدد)');
    await Promise.resolve();
    expect(mutate).not.toHaveBeenCalled();
    cleanup();

    confirmAction.mockResolvedValueOnce(true);
    sendRequest(line(6));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect((mutate.mock.calls[0][0] as { target: string }).target).toBe('requisition');
  });

  it('sends a request at once when no open requisition holds the item', () => {
    sendRequest(line(0));
    expect(confirmAction).not.toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
