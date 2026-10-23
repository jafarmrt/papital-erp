import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { warehouseLabel } from '../../lib/inventory/warehouseLabel';
import { kardexDocumentTypeLabel, isKardexOpeningRef, KARDEX_OPENING_LABEL } from '../../lib/documents/documentTypeTitles';
import { MATERIALS_THEME, PRODUCTS_THEME } from '../../components/reorder/reorderSectionThemes';

const WAREHOUSES = [
  { id: 7, code: 'prod', name: 'انبار محصول', isActive: 1 },
  { id: 3, code: 'raw', name: 'انبار مواد اولیه', isActive: 1 },
  { id: 1, code: 'old', name: 'انبار قدیمی', isActive: 0 },
];
const WAC_WORDS = 'میانگین موزون بها';
const BOM_ALLOCATION_LABEL = 'تخصیص مواد به پروژه';
const BOM_RELEASE_LABEL = 'آزادسازی تخصیص مواد پروژه';
const AUDIT_LABEL = 'سند انبارگردانی';
const EXCEL_REF = 'درون‌ریزی اکسل';

const source = (path: string) => readFileSync(path, 'utf8');

describe('TD-1208 warehouse words of finding B-08', () => {
  it('shows a warehouse by its name, never its code', () => {
    expect(warehouseLabel('raw', WAREHOUSES)).toBe('انبار مواد اولیه');
    expect(warehouseLabel(' RAW ', WAREHOUSES)).toBe('انبار مواد اولیه');
    expect(warehouseLabel('unknown', WAREHOUSES)).toBe('unknown');
  });

  it('reads an empty or default location as the active warehouse with the lowest id', () => {
    expect(warehouseLabel('', WAREHOUSES)).toBe('انبار مواد اولیه');
    expect(warehouseLabel('default', WAREHOUSES)).toBe('انبار مواد اولیه');
    expect(warehouseLabel(null, [])).toBe('انبار پیش‌فرض');
  });

  it('names project allocation rows without the word BOM', () => {
    expect(kardexDocumentTypeLabel('تخصیص مواد BOM')).toBe(BOM_ALLOCATION_LABEL);
    expect(kardexDocumentTypeLabel('آزادسازی تخصیص BOM')).toBe(BOM_RELEASE_LABEL);
  });

  it('names an item opening row as opening stock, not a stock count', () => {
    expect(kardexDocumentTypeLabel('audit', 'ثبت اولیه کالا')).toBe(KARDEX_OPENING_LABEL);
    expect(kardexDocumentTypeLabel('audit', 'ثبت موجودی افتتاحیه')).toBe(KARDEX_OPENING_LABEL);
    expect(kardexDocumentTypeLabel('audit', 'AUD-12')).toBe(AUDIT_LABEL);
    expect(kardexDocumentTypeLabel('audit', EXCEL_REF)).toBe(AUDIT_LABEL);
    expect(kardexDocumentTypeLabel('audit')).toBe(AUDIT_LABEL);
  });

  it('keeps the opening refs equal to the refs the server writes', () => {
    const backfill = source('src/services/inventory/kardexBackfill.service.ts').match(/KARDEX_BACKFILL_REF = '([^']+)'/)?.[1];
    expect(backfill).toBeTruthy();
    expect(isKardexOpeningRef(backfill)).toBe(true);
    const catalog = source('src/services/items/itemCatalog.service.ts');
    for (const ref of [...catalog.matchAll(/documentType: 'audit',\s*documentRef: '([^']+)'/g)].map((m) => m[1])) {
      expect(isKardexOpeningRef(ref)).toBe(true);
    }
  });

  it('heads the reorder cost column with the weighted average cost', () => {
    expect(MATERIALS_THEME.costHeader).toBe(WAC_WORDS);
    expect(PRODUCTS_THEME.costHeader).not.toMatch(/میانگین بهای خرید/);
  });

  it('puts warehouse names on the Kardex and allocation screens and type labels in the transactions export', () => {
    expect(source('src/components/RunningKardexModal.tsx')).not.toMatch(/\{entry\.location \|\||\{loc\}<\/option>|': e\.location,/);
    for (const file of ['ProjectBomAllocationsTab.tsx', 'allocations/AllocationTable.tsx', 'allocations/AllocationTraceDialog.tsx', 'allocations/useBomAllocations.ts']) {
      expect(source(`src/components/inventory/${file}`)).not.toMatch(/\{alloc\.sourceLocation \|\||': a\.sourceLocation,/);
    }
    expect(source('src/hooks/transactions/useTransactionsExport.ts')).not.toMatch(/'نوع سند': t\.document_type\n/);
  });
});
