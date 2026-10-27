import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryWrapper } from './helpers/queryWrapper';
import type { PurchaseRequisition } from '../../types';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => ({ toast: { error: () => undefined, success: () => undefined } }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userPermissions: { permissions: ['procurement.view'], isAdmin: false } }),
  useHasPermission: (key: string) => key === 'procurement.view',
}));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});

import { RequisitionDetailModal } from '../../components/procurement/RequisitionDetailModal';

// OBS-R2-40 (TD-992): the requisition window swallowed an error reading its orders and then said no purchase order had
// been issued, read them without an abort signal, printed the update date with toLocaleDateString, and the procurement
// windows were taller than the 90vh the iframe preview allows.

const NO_ORDERS = /هنوز سفارش خریدی برای این درخواست صادر نشده است/;
const READ_FAILED = /سفارش‌های خرید این درخواست خوانده نشد/;
const SERVER_DOWN = 'Server unavailable';

const requisition: PurchaseRequisition = {
  id: 9, code: 'PR-1405-0009', title: 'درخواست', status: 'ordered', priority: 'normal', notes: '', totalEstimatedAmount: 1000,
  updatedAt: '2026-10-06T10:00:00.000Z',
  items: [{ id: 'r1', itemId: 9, itemCode: 'RM-9', itemName: 'سنگ', unit: 'عدد', requestedQty: 1, orderedQty: 1, remainingQty: 0, unitPriceEstimate: 1000, linkedDocumentIds: [] }],
};

const open = () => render(<RequisitionDetailModal isOpen requisition={requisition} onClose={() => undefined} onOpenSplitOrder={() => undefined} />, { wrapper: QueryWrapper });

beforeEach(() => fetchJson.mockReset());
afterEach(cleanup);

describe('requisition window reads its orders (OBS-R2-40)', () => {
  it('shows a read error, never "no purchase order yet"', async () => {
    fetchJson.mockImplementation(async (u: unknown) => {
      if (String(u).startsWith('/api/procurement/orders')) throw new Error(SERVER_DOWN);
      return { success: true, data: [] };
    });
    open();
    expect(await screen.findByText(READ_FAILED)).not.toBeNull();
    expect(screen.queryByText(NO_ORDERS)).toBeNull();
  });

  it('reads them with an abort signal and says so when there are none', async () => {
    fetchJson.mockResolvedValue({ success: true, data: [], total: 0 });
    open();
    expect(await screen.findByText(NO_ORDERS)).not.toBeNull();
    const call = fetchJson.mock.calls.find(c => String(c[0]).startsWith('/api/procurement/orders'));
    expect(String(call?.[0])).toContain('requisitionId=9');
    expect((call?.[1] as RequestInit | undefined)?.signal).toBeInstanceOf(AbortSignal);
  });

  it('prints the update date in Jalali', async () => {
    fetchJson.mockResolvedValue({ success: true, data: [], total: 0 });
    open();
    await waitFor(() => expect(screen.queryByText(/۱۴۰۵\/۰۷\/۱۴/)).not.toBeNull());
  });
});

describe('procurement windows fit the preview frame (OBS-R2-40)', () => {
  it('no window is taller than 90vh and the consolidation window scrolls', () => {
    for (const name of ['RequisitionDetailModal', 'CreateRequisitionModal', 'SplitOrderModal', 'ConsolidateRequisitionsModal']) {
      const source = readFileSync(`src/components/procurement/${name}.tsx`, 'utf8');
      expect(source.includes('92vh'), name).toBe(false);
      expect(source.includes('max-h-[90vh]'), name).toBe(true);
    }
  });
});
