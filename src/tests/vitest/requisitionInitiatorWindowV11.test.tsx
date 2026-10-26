import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PurchaseRequisition } from '../../types';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('react-hot-toast', () => ({ toast: { error: () => undefined, success: () => undefined } }));
const granted = new Set(['procurement.view', 'procurement.order', 'procurement.approve']);
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userPermissions: { permissions: [...granted], isAdmin: false } }),
  useHasPermission: (key: string) => granted.has(key),
}));

import { RequisitionDetailModal } from '../../components/procurement/RequisitionDetailModal';
import { INITIATOR_CANNOT_APPROVE } from '../../lib/procurement/requisitionActions';
import { requisitionActionLabel } from '../../lib/procurement/requisitionFields';

// v11 phase 6.3a (reviews of #406, U10): the requisition window of a requester whom the approval step leaves out shows
// the split and order buttons off with the reason and offers only «رد» on a requisition that has no workflow yet; the
// mark comes from the window's own read of the requisition.

const SPLIT = 'تفکیک تأمین‌کننده و صدور سفارش خرید';
const ISSUE = 'صدور فاکتور تامین‌کننده';

const pending = (initiatorCannotApprove: boolean): PurchaseRequisition => ({
  id: 5, code: 'PR-1405-0005', title: 'open requisition', status: 'pending', priority: 'normal', notes: '', totalEstimatedAmount: 3000,
  items: [{ id: 'r1', itemId: 9, itemCode: 'RM-9', itemName: 'item', unit: 'unit', requestedQty: 3, orderedQty: 0, remainingQty: 3, unitPriceEstimate: 1000, linkedDocumentIds: [] }],
  ...(initiatorCannotApprove ? { initiatorCannotApprove: true } : {}),
});

function serve(read: PurchaseRequisition) {
  fetchJson.mockImplementation(async (u: unknown) => {
    const url = String(u ?? '');
    if (url.includes('/workflow-actions')) return { success: true, data: { hasInstance: false, actions: [] } };
    if (url === '/api/procurement/requisitions/5') return { success: true, data: read };
    if (url.startsWith('/api/procurement/orders')) return { success: true, data: [], total: 0, page: 1, limit: 50 };
    return { success: true, data: [] };
  });
}

function Provider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const openWindow = (opened: PurchaseRequisition) => render(
  <Provider><RequisitionDetailModal isOpen requisition={opened} onClose={() => undefined} onOpenSplitOrder={() => undefined} /></Provider>,
);

beforeEach(() => fetchJson.mockReset());
afterEach(cleanup);

describe('requisition window for its initiator (U10)', () => {
  it('takes the mark from its own read: split and order off with the reason, only the reject action offered', async () => {
    serve(pending(true));
    // the desk row it was opened from carries no mark; the window's read does
    openWindow(pending(false));
    await waitFor(() => expect(screen.getByText(SPLIT).closest('button')?.disabled).toBe(true));
    const split = screen.getByText(SPLIT).closest('button') as HTMLButtonElement;
    const issue = screen.getByText(ISSUE).closest('button') as HTMLButtonElement;
    expect(issue.disabled).toBe(true);
    const reason = screen.getByText(INITIATOR_CANNOT_APPROVE);
    expect(split.getAttribute('aria-describedby')).toBe(reason.id);
    expect(issue.getAttribute('aria-describedby')).toBe(reason.id);
    expect(await screen.findByText(requisitionActionLabel('reject_request'))).toBeTruthy();
    expect(screen.queryByText(requisitionActionLabel('approve_request'))).toBeNull();
  });

  it('an unmarked requisition keeps every button on and both actions', async () => {
    serve(pending(false));
    openWindow(pending(false));
    expect(await screen.findByText(requisitionActionLabel('approve_request'))).toBeTruthy();
    expect(screen.getByText(requisitionActionLabel('reject_request'))).toBeTruthy();
    expect((screen.getByText(SPLIT).closest('button') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(INITIATOR_CANNOT_APPROVE)).toBeNull();
  });
});
