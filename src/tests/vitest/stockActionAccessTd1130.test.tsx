import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => granted.has(key),
  useHasAnyPermission: (keys: readonly string[]) => keys.some(key => granted.has(key)),
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: { success: vi.fn(), error: vi.fn() } }));
const design = {
  id: 1, code: '003', title: 'طرح نمونه', image: '', thumbnail: '', notes: '',
  createdAt: null, updatedAt: null, productCount: 0, products: [],
};
vi.mock('../../hooks/queries', () => ({
  useTransfersQuery: () => ({
    data: { data: [design], total: 1, summary: { totalCodes: 1, withImage: 0, linkedProducts: 0 } },
    isLoading: false, isFetching: false, refetch: vi.fn(),
  }),
  useSaveTransferMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteTransferMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

import inventoryRouter from '../../routes/inventory.routes';
import { buildRouteGuardTable, recordMountPaths } from '../../lib/routeGuardTable';
import { PAGE_ACCESS } from '../../lib/permissions/pageAccess';
import { ITEM_COST_READ_PERMISSIONS } from '../../lib/inventory/reservedItemsReport';
import { ITEM_KARDEX_READ_PERMISSIONS } from '../../lib/permissions/stockActionPermissions';
import { useInventoryAuditActionAccess } from '../../hooks/inventoryAudit/useStockActionAccess';
import { InventoryAuditHeader } from '../../components/inventory/InventoryAuditHeader';
import { WarehouseTransfersListTab } from '../../components/inventory/WarehouseTransfersListTab';
import TransfersPage from '../../pages/TransfersPage';

afterEach(() => { cleanup(); granted.clear(); });

const grant = (...keys: string[]) => { granted.clear(); keys.forEach(key => granted.add(key)); };
const noop = () => undefined;

/** wires the audit page buttons the way InventoryAuditPage does */
const STOCK_TOOLS = 'ابزارهای موجودی';

function AuditButtons() {
  const access = useInventoryAuditActionAccess();
  return (
    <>
      <InventoryAuditHeader
        activeTab="transfers"
        onTabChange={noop}
        discrepancyItems={0}
        onOpenRebuild={access.canRebuild ? noop : undefined}
        onOpenTransfer={access.canTransfer ? noop : undefined}
      />
      <WarehouseTransfersListTab
        transfersLoading={false}
        transfers={[{ id: 5, refNumber: 'TR-5', date: '2026-10-01', items: [] } as never]}
        handleViewTransfer={noop}
        onOpenTransferModal={access.canTransfer ? noop : undefined}
        onVoidTransfer={access.canVoidTransfer ? noop : undefined}
        voidingId={null}
      />
      {access.canOpenKardex && <span>kardex-button</span>}
    </>
  );
}

// v10.0.249 (TD-1130): stock buttons and the item Kardex route asked other keys than the pages that show them
describe('stock buttons follow the key of their API (TD-1130)', () => {
  it('opens the item Kardex for every reader of the stock movements page, and only for cost readers', () => {
    const app = express();
    recordMountPaths(app);
    app.use('/api/inventory', inventoryRouter);
    const row = buildRouteGuardTable(app).find(r => r.method === 'GET' && r.path === '/api/inventory/item-kardex/:itemId');
    expect(row?.guards).toEqual([[...ITEM_KARDEX_READ_PERMISSIONS]]);
    const transactionsGate = PAGE_ACCESS['/transactions'].gate;
    const pageKeys = typeof transactionsGate === 'object' ? transactionsGate.anyOf : [];
    expect(pageKeys.length).toBeGreaterThan(0);
    for (const key of pageKeys) expect(ITEM_KARDEX_READ_PERMISSIONS).toContain(key);
    for (const key of ITEM_KARDEX_READ_PERMISSIONS) expect(ITEM_COST_READ_PERMISSIONS).toContain(key);
    expect(ITEM_KARDEX_READ_PERMISSIONS).not.toContain('audit.view');
  });

  it('hides rebuild, transfer, void and Kardex from a stock counter with audit.view only', () => {
    grant('audit.view');
    render(<AuditButtons />);
    expect(screen.queryByTitle(STOCK_TOOLS)).toBeNull();
    expect(screen.queryByText('بازسازی موجودی از روی کاردکس')).toBeNull();
    expect(screen.queryByText('ثبت حواله انتقال انبار')).toBeNull();
    expect(screen.queryByText('ثبت حواله انتقال جدید')).toBeNull();
    expect(screen.queryByText('ابطال')).toBeNull();
    expect(screen.queryByText('kardex-button')).toBeNull();
  });

  it('shows each button with its own key', () => {
    grant('audit.view', 'inventory.reconcile');
    render(<AuditButtons />);
    // v11 phase 6.3a (U24): the rebuild is in the three-dot menu of the header
    fireEvent.click(screen.getByTitle(STOCK_TOOLS));
    expect(screen.getByText('بازسازی موجودی از روی کاردکس')).toBeTruthy();
    expect(screen.queryByText('ثبت حواله انتقال انبار')).toBeNull();
    cleanup();
    // v11 phase 6.1j (S7): a transfer is voided with the stock document key, not with «حذف فاکتور»
    grant('audit.view', 'warehouse.transfer', 'documents.delete', 'accounting.view');
    render(<AuditButtons />);
    expect(screen.queryByText('ابطال')).toBeNull();
    cleanup();
    grant('audit.view', 'warehouse.transfer', 'documents.void_stock', 'accounting.view');
    render(<AuditButtons />);
    expect(screen.getByText('ثبت حواله انتقال انبار')).toBeTruthy();
    expect(screen.getByText('ثبت حواله انتقال جدید')).toBeTruthy();
    expect(screen.getByText('ابطال')).toBeTruthy();
    expect(screen.getByText('kardex-button')).toBeTruthy();
    expect(screen.queryByTitle(STOCK_TOOLS)).toBeNull();
    expect(screen.queryByText('بازسازی موجودی از روی کاردکس')).toBeNull();
  });

  it('shows transfer design create, save and delete only with the product keys', () => {
    grant('products.view');
    render(<TransfersPage />);
    expect(screen.queryByText('ثبت طرح ترنسفر جدید')).toBeNull();
    expect(screen.queryByText('بارگذاری تصویر')).toBeNull();
    fireEvent.click(screen.getByText('مدیریت تصویر و محصولات'));
    expect(screen.queryByText('ذخیره تغییرات')).toBeNull();
    expect(screen.queryByText('حذف طرح')).toBeNull();
    cleanup();

    grant('products.view', 'products.edit');
    render(<TransfersPage />);
    expect(screen.getAllByText('ثبت طرح ترنسفر جدید').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('مدیریت تصویر و محصولات'));
    expect(screen.getByText('ذخیره تغییرات')).toBeTruthy();
    expect(screen.queryByText('حذف طرح')).toBeNull();
    cleanup();

    grant('products.view', 'products.delete');
    render(<TransfersPage />);
    fireEvent.click(screen.getByText('مدیریت تصویر و محصولات'));
    expect(screen.getByText('حذف طرح')).toBeTruthy();
    expect(screen.queryByText('ذخیره تغییرات')).toBeNull();
  });
});
