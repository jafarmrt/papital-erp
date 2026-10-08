import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  ITEM_COST_READ_PERMISSIONS, reservedItemsReportForAccess, type ReservedItemsFullReport,
} from '../../lib/inventory/reservedItemsReport';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('react-hot-toast', () => { const toast = { error: vi.fn(), success: vi.fn() }; return { default: toast, toast }; });

import ReservedItemsReportPage from '../../pages/ReservedItemsReportPage';

afterEach(() => { cleanup(); fetchJson.mockReset(); });

const entry = {
  id: 'proforma-1-7', sourceType: 'proforma' as const, sourceLabel: 'پیش‌فاکتور فروش', sourceId: 1, sourceRef: '1001',
  sourceTitle: 'پیش‌فاکتور 1001 (مشتری محرمانه)', buyerOrCustomer: 'مشتری محرمانه', itemId: 7, itemCode: 'P-7', itemName: 'گردنبند',
  category: 'گردنبند', unit: 'عدد', reservedQty: 2, unitCost: 123456, totalCost: 246912, date: '2026-10-01',
};
const report: ReservedItemsFullReport = {
  summaryMetrics: { totalReservedItemsCount: 1, totalReservedQty: 2, totalReservedCost: 246912, proformaReservationsCount: 1, projectReservationsCount: 0 },
  itemSummaries: [{
    itemId: 7, itemCode: 'P-7', itemName: 'گردنبند', category: 'گردنبند', unit: 'عدد', currentStock: 10, weightedAverageCost: 123456,
    proformaReservedQty: 2, projectReservedQty: 0, totalReservedQty: 2, availableStock: 8, totalReservedCost: 246912, reservations: [entry],
  }],
  allReservationEntries: [entry],
};

// v9.0.381 (TD-829، یافته B07-13، تصمیم ت۶ «الف»): بها و ارزش رزرو فقط برای خوانندگان بها و خریدار پیش‌فاکتور فقط برای
// دارندگان «مشاهده اسناد»؛ پیش‌تر هر خواننده گزارش بها و خریدار پیش‌فاکتورهای همه مشتریان را می‌دید.
describe('reserved items report by reader (TD-829)', () => {
  it('drops cost and buyer for a reader without their keys', () => {
    const scoped = reservedItemsReportForAccess(report, { cost: false, buyer: false });
    const text = JSON.stringify(scoped);
    expect(text).not.toContain('123456');
    expect(text).not.toContain('246912');
    expect(text).not.toContain('مشتری محرمانه');
    expect(scoped.allReservationEntries[0].sourceTitle).toBe('پیش‌فاکتور 1001');
    expect(scoped.itemSummaries[0].totalReservedQty).toBe(2);
    expect(scoped.access).toEqual({ cost: false, buyer: false });
  });

  it('keeps what the reader may see', () => {
    const scoped = reservedItemsReportForAccess(report, { cost: true, buyer: true });
    expect(scoped.itemSummaries[0].totalReservedCost).toBe(246912);
    expect(scoped.allReservationEntries[0].buyerOrCustomer).toBe('مشتری محرمانه');
  });

  it('reads cost with the item cost keys of P05 decision t10-2', () => {
    expect(ITEM_COST_READ_PERMISSIONS).toEqual(expect.arrayContaining(['products.view', 'products.edit_price', 'warehouse.in', 'accounting.view']));
    expect(ITEM_COST_READ_PERMISSIONS).not.toEqual(expect.arrayContaining(['documents.create']));
    expect(ITEM_COST_READ_PERMISSIONS).not.toContain('reports.view');
    expect(ITEM_COST_READ_PERMISSIONS).not.toContain('documents.view');
  });

  it('shows no cost column when the report has no cost', async () => {
    fetchJson.mockResolvedValueOnce(reservedItemsReportForAccess(report, { cost: false, buyer: false }));
    render(<MemoryRouter><ReservedItemsReportPage /></MemoryRouter>);
    expect(await screen.findByText('P-7')).toBeTruthy();
    expect(screen.queryByText(/بهای تمام‌شده/)).toBeNull();
  });

  it('shows the cost column to a cost reader', async () => {
    fetchJson.mockResolvedValueOnce(reservedItemsReportForAccess(report, { cost: true, buyer: false }));
    render(<MemoryRouter><ReservedItemsReportPage /></MemoryRouter>);
    expect(await screen.findByText('P-7')).toBeTruthy();
    expect(screen.getAllByText(/بهای تمام‌شده/).length).toBeGreaterThan(0);
  });
});
