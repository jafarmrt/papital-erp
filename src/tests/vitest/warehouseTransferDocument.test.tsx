import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WarehouseTransfersListTab } from '../../components/inventory/WarehouseTransfersListTab';
import { TransferDocumentDetailModal } from '../../components/inventory/InventoryDocumentDetailModals';
import { useTransferVoid } from '../../hooks/inventoryAudit/useTransferVoid';

// Package 6 transfer document (TD-489 / B06-10, decision t2): the transfers tab lists the document with its source and
// destination warehouse and voids it through DELETE /documents/:id after a Persian confirmation; the detail shows both
// warehouses and offers a print.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
const confirmAction = vi.fn();
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: (...args: unknown[]) => confirmAction(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast: t, default: t };
});

const TRANSFER = {
  id: 77, refNumber: '12', date: '2026-10-06 00:00:00', user: 'انباردار', notes: 'جابه‌جایی برای فروشگاه',
  sourceLocation: 'انبار مرکزی', destinationLocation: 'فروشگاه',
  items: [{ code: 'A-501', name: 'سنگ فیروزه', unit: 'عدد', quantity: 4, location: 'main' }],
};

function ListHarness({ onVoided }: { onVoided: () => void }) {
  const { voidingId, voidTransfer } = useTransferVoid(onVoided);
  return (
    <WarehouseTransfersListTab
      transfersLoading={false}
      transfers={[TRANSFER]}
      handleViewTransfer={() => undefined}
      onOpenTransferModal={() => undefined}
      onVoidTransfer={(t) => { void voidTransfer(t); }}
      voidingId={voidingId}
    />
  );
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  confirmAction.mockReset();
});

describe('warehouse transfer document (TD-489)', () => {
  it('lists the source and destination warehouse of the transfer document', () => {
    render(<ListHarness onVoided={() => undefined} />);
    expect(screen.getByText('انبار مرکزی')).toBeTruthy();
    expect(screen.getByText('فروشگاه')).toBeTruthy();
  });

  it('voids the transfer through DELETE /documents/:id after confirmation', async () => {
    confirmAction.mockResolvedValue(true);
    fetchJson.mockResolvedValue({ success: true });
    const onVoided = vi.fn();
    render(<ListHarness onVoided={onVoided} />);
    fireEvent.click(screen.getByRole('button', { name: /ابطال/ }));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/documents/77', { method: 'DELETE' }));
    expect(String(confirmAction.mock.calls[0][0].message)).toContain('«12»');
    await waitFor(() => expect(onVoided).toHaveBeenCalledTimes(1));
  });

  it('does not void when the confirmation is cancelled', async () => {
    confirmAction.mockResolvedValue(false);
    render(<ListHarness onVoided={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /ابطال/ }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('shows both warehouses and the notes in the detail, and opens the print view', () => {
    render(<TransferDocumentDetailModal doc={TRANSFER} loading={false} onClose={() => undefined} />);
    expect(screen.getByText('انبار مرکزی')).toBeTruthy();
    expect(screen.getByText('فروشگاه')).toBeTruthy();
    expect(screen.getByText('جابه‌جایی برای فروشگاه')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /چاپ حواله/ }));
    expect(screen.getByText('حواله انتقال بین انبارها')).toBeTruthy();
  });
});
