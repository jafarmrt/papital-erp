import * as xlsx from 'xlsx';
import type { InventoryIntegrityReport, ItemIntegrityAuditResult } from '../../types';

/**
 * v9.0.83 (TD-485): زبانه «بررسی سلامت و تطبیق موجودی» همان شکل پاسخ سرور (`InventoryIntegrityReport`، مشترک در
 * `src/types/inventory.types.ts`) را می‌خواند: آرایه `audits` با `scalarCurrentStock`، `whStocksSum`، `kardexNetBalance`،
 * `recordedWac` و `computedWac`. پیش‌تر `report.items` و فیلدهایی را می‌خواند که سرور نمی‌فرستاد، پس جدول همیشه خالی بود
 * و خروجی اکسل کاری نمی‌کرد.
 */

/** کالای بی مغایرت */
export function isIntegrityItemSynchronized(item: ItemIntegrityAuditResult): boolean {
  return (item.discrepancies ?? []).length === 0;
}

/** مغایرت مقداری: موجودی ثبت‌شده در انبارها منهای مانده کاردکس */
export function integrityVariance(item: ItemIntegrityAuditResult): number {
  return Math.round(((item.whStocksSum ?? 0) - (item.kardexNetBalance ?? 0)) * 10000) / 10000;
}

/** برچسب فارسی وضعیت انطباق یک کالا */
export function integrityStatusLabel(item: ItemIntegrityAuditResult): string {
  const kinds = item.discrepancies ?? [];
  if (kinds.length === 0) return 'منطبق';
  if (kinds.includes('kardex_negative')) return 'موجودی منفی';
  const variance = integrityVariance(item);
  if (variance < 0) return 'کسری در انبار';
  if (variance > 0) return 'مازاد در انبار';
  if (kinds.every(k => k === 'kardex_wac_mismatch')) return 'مغایرت بهای میانگین';
  return 'مغایرت انبار با کاردکس';
}

export function filterIntegrityItems(report: InventoryIntegrityReport | null, search: string, discrepancyOnly: boolean): ItemIntegrityAuditResult[] {
  const audits = Array.isArray(report?.audits) ? report.audits : [];
  const q = search.trim().toLowerCase();
  return audits.filter(item => {
    if (discrepancyOnly && isIntegrityItemSynchronized(item)) return false;
    if (!q) return true;
    return (
      item.itemName?.toLowerCase().includes(q) ||
      item.itemCode?.toLowerCase().includes(q) ||
      item.category?.toLowerCase().includes(q)
    );
  });
}

/** ردیف‌های خروجی اکسل گزارش (همه کالاهای پاسخ) */
export function integrityExcelRows(report: InventoryIntegrityReport | null): Array<Record<string, string | number>> {
  const audits = Array.isArray(report?.audits) ? report.audits : [];
  return audits.map((i, idx) => ({
    'ردیف': idx + 1,
    'کد کالا': i.itemCode,
    'نام کالا': i.itemName,
    'دسته‌بندی': i.category,
    'واحد': i.unit,
    'موجودی کل کالا': i.scalarCurrentStock,
    'مجموع موجودی انبارها': i.whStocksSum,
    'مانده کاردکس': i.kardexNetBalance,
    'مغایرت مقداری': integrityVariance(i),
    'وضعیت تطبیق': integrityStatusLabel(i),
    'شرح مغایرت': (i.anomalyDetails ?? []).join(' '),
    'ورود کاردکس': i.kardexTotalIn,
    'خروج کاردکس': i.kardexTotalOut,
    'میانگین بهای ثبت‌شده': i.recordedWac,
    'میانگین بهای بازپخش کاردکس': i.computedWac,
  }));
}

export function exportIntegrityExcel(report: InventoryIntegrityReport | null): void {
  const rows = integrityExcelRows(report);
  if (rows.length === 0) return;
  try {
    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'ممیزی سلامت انبار');
    xlsx.writeFile(wb, `Inventory_Integrity_Audit.xlsx`);
  } catch (err) {
    console.error(err);
  }
}
