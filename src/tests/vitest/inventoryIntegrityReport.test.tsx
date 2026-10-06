import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { InventoryIntegrityReport, ItemIntegrityAuditResult } from '../../types';
import { filterIntegrityItems, integrityExcelRows } from '../../lib/inventoryAudit/integrityReport';
import { Inventory3WayIntegrityTab } from '../../components/inventory/Inventory3WayIntegrityTab';

// Package 6 integrity report (TD-485 / B06-06): the tab reads the server's response shape ({ summary, audits, warehouses }
// with scalarCurrentStock, whStocksSum, kardexNetBalance, recordedWac, computedWac). On v9.0.82 it read report.items and
// other field names, so the table was always empty and the Excel export did nothing.
vi.mock('../../hooks/useAppCurrency', () => ({ useAppCurrency: () => 'IRR' }));

const audit = (over: Partial<ItemIntegrityAuditResult>): ItemIntegrityAuditResult => ({
  itemId: 1, itemCode: 'A-1', itemName: 'سنگ فیروزه', category: 'دستبند', unit: 'عدد',
  scalarCurrentStock: 5, whStocksSum: 5, kardexNetBalance: 5, recordedWac: 1000, computedWac: 1000,
  discrepancies: [], whBreakdown: { main: 5 }, kardexLocBreakdown: { main: 5 }, kardexTotalIn: 5, kardexTotalOut: 0,
  hasKardexAnomalies: false, anomalyDetails: [], ...over,
});

// the same shape as the stored server response of the review (p06/fe/integrity-report.sample.json)
const REPORT: InventoryIntegrityReport = {
  summary: {
    totalItems: 3, totalItemsChecked: 3, synchronizedItems: 1, healthyItemsCount: 1, discrepancyItems: 2, discrepantItemsCount: 2,
    negativeStockItems: 0, healthScorePercentage: 33, totalScalarStock: 21, totalKardexStock: 18, totalScalarStockValue: 21000,
    totalKardexStockValue: 18000, totalInventoryValuationStored: 21000, policy: 'forbidden',
  },
  audits: [
    audit({}),
    audit({
      itemId: 2, itemCode: 'B-2', itemName: 'زنجیر نقره', scalarCurrentStock: 10, whStocksSum: 10, kardexNetBalance: 7,
      discrepancies: ['scalar_vs_kardex', 'wh_sum_vs_kardex'], hasKardexAnomalies: true,
      anomalyDetails: ['مجموع انبارها (10) با مانده کاردکس (7) مغایرت دارد.'],
    }),
    audit({
      itemId: 3, itemCode: 'C-3', itemName: 'گوشواره آویز', scalarCurrentStock: 6, whStocksSum: 6, kardexNetBalance: 6,
      recordedWac: 250, computedWac: 200, discrepancies: ['kardex_wac_mismatch'], hasKardexAnomalies: true,
      anomalyDetails: ['نرخ میانگین موزون ثبتی (250) با بهای بازپخش کاردکس (200) مغایرت دارد.'],
    }),
  ],
  warehouses: [{ code: 'main', name: 'انبار مرکزی', totalStockJsonb: 21, totalStockLedger: 18, variance: 3, isBalanced: false }],
};

afterEach(() => cleanup());

describe('inventory integrity report (TD-485)', () => {
  it('lists the audits of the server response and filters the discrepant ones', () => {
    expect(filterIntegrityItems(REPORT, '', false).map(i => i.itemCode)).toEqual(['A-1', 'B-2', 'C-3']);
    expect(filterIntegrityItems(REPORT, '', true).map(i => i.itemCode)).toEqual(['B-2', 'C-3']);
    expect(filterIntegrityItems(REPORT, 'زنجیر', false).map(i => i.itemCode)).toEqual(['B-2']);
  });

  it('exports one Excel row per audit with the server values', () => {
    const rows = integrityExcelRows(REPORT);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ 'کد کالا': 'B-2', 'موجودی کل کالا': 10, 'مانده کاردکس': 7, 'مغایرت مقداری': 3, 'وضعیت تطبیق': 'مازاد در انبار' });
    expect(rows[2]).toMatchObject({ 'وضعیت تطبیق': 'مغایرت بهای میانگین', 'میانگین بهای بازپخش کاردکس': 200 });
  });

  it('renders the rows with stock, ledger balance and status from the server fields', () => {
    const items = filterIntegrityItems(REPORT, '', false);
    render(
      <Inventory3WayIntegrityTab
        integrityReport={REPORT} integrityLoading={false} integritySearch="" setIntegritySearch={() => undefined}
        integrityDiscrepancyOnly={false} setIntegrityDiscrepancyOnly={() => undefined} filteredIntegrityItems={items}
        loadIntegrityReport={() => undefined} onOpenRebuildModal={() => undefined} onExportExcel={() => undefined}
      />,
    );
    expect(screen.queryByText('هیچ کالایی با فیلترهای انتخابی یافت نشد.')).toBeNull();
    expect(screen.getByText('زنجیر نقره')).toBeTruthy();
    expect(screen.getByText('مازاد در انبار')).toBeTruthy();
    expect(screen.getByText('مغایرت بهای میانگین')).toBeTruthy();
    expect(screen.getByText('منطبق')).toBeTruthy();
  });
});
