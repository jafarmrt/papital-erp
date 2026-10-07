import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PhysicalAuditSheetTab } from '../../components/inventory/PhysicalAuditSheetTab';
import { exportIntegrityExcel } from '../../lib/inventoryAudit/integrityReport';
import {
  EXPORT_FAILED_MESSAGE, INTEGRITY_EXPORT_FILE, TRANSACTIONS_EXPORT_FILE, bomAllocationsExportFileName, kardexExportFileName,
} from '../../lib/inventoryAudit/exportFileNames';
import type { InventoryIntegrityReport } from '../../types';

// Package 6 (TD-496 / B06-17, decision t6): the stock count sheet calls a count above the book stock «اضافی» and one
// below it «کسری» (as its confirmation does) with Persian digits; Excel exports have Persian file names; a failed
// export reaches the user (the production build drops console output).
const toastError = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: toastError });
  return { toast: t, default: t };
});
const writeFile = vi.hoisted(() => vi.fn());
vi.mock('xlsx', () => ({
  utils: { json_to_sheet: vi.fn(() => ({})), book_new: vi.fn(() => ({})), book_append_sheet: vi.fn() },
  writeFile: (...args: unknown[]) => writeFile(...args),
}));

afterEach(() => {
  cleanup();
  toastError.mockReset();
  writeFile.mockReset();
});

const item = (id: number, physical: string) => ({
  id, code: `C-${id}`, name: `کالای ${id}`, category: 'انگشتر', unit: 'عدد', system_stock_computed: 10, physical_stock: physical,
});

function renderSheet() {
  const rows = [item(1, '12'), item(2, '7')];
  const noop = () => undefined;
  render(
    <PhysicalAuditSheetTab
      selectedLocation="main" locationLabel="انبار مرکزی" warehouses={[]} warehousesFailed={false} onRequestLocationChange={noop}
      nextRef="12" notes="" setNotes={noop} searchQuery="" setSearchQuery={noop} categoryFilter="" setCategoryFilter={noop}
      categories={[]} filteredItems={rows} auditedItemsMap={{ 1: rows[0], 2: rows[1] }} submitting={false} errorMsg={null}
      successMsg={null} handlePhysicalChange={noop} handleApplyCurrentStockAsPhysical={noop} handleSubmitAudit={noop}
    />,
  );
}

describe('Warehouse UI copy (TD-496)', () => {
  it('labels a count above the book stock as surplus and one below as shortage, in Persian digits', () => {
    renderSheet();
    expect(screen.getByText('+۲ (اضافی)')).toBeTruthy();
    expect(screen.getByText('−۳ (کسری)')).toBeTruthy();
    expect(screen.queryByText(/کسری سیستمی/)).toBeNull();
    expect(screen.getAllByText(/موجودی دفتری/).length).toBeGreaterThan(0);
    expect(screen.getByText('ثبت نهایی سند انبارگردانی (۲ کالا)')).toBeTruthy();
  });

  it('gives every warehouse export a Persian file name', () => {
    const names = [INTEGRITY_EXPORT_FILE, TRANSACTIONS_EXPORT_FILE, kardexExportFileName('1403-B-003-01'), bomAllocationsExportFileName('1405/07/15')];
    for (const name of names) expect(name.replace(/\.xlsx$/, '').replace(/[0-9A-Z-]/g, '')).toMatch(/^[؀-ۿ‌-]+$/);
    expect(bomAllocationsExportFileName('1405/07/15')).toBe('تخصیص-مواد-اولیه-1405-07-15.xlsx');
  });

  it('tells the user when the integrity export fails and names the file in Persian when it works', () => {
    const report = { audits: [{ itemId: 1, itemCode: 'A', itemName: 'الف', issues: [] }] } as unknown as InventoryIntegrityReport;
    exportIntegrityExcel(report);
    expect(writeFile.mock.calls[0]?.[1]).toBe(INTEGRITY_EXPORT_FILE);
    writeFile.mockImplementation(() => { throw new Error('disk full'); });
    exportIntegrityExcel(report);
    expect(toastError).toHaveBeenCalledWith(EXPORT_FAILED_MESSAGE);
  });
});
