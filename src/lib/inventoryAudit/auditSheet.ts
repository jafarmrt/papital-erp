import type { User } from '../../types';
import { getTodayIsoDate, parseCleanNumber } from '../../utils';

/**
 * صفحه انبارگردانی: انواع داده و محاسبات خالص برگه شمارش و گزارش سلامت موجودی.
 * همان محاسبات و همان بدنه درخواست InventoryAuditPage پیش از انتقال به React Query.
 */

/** ردیف اقلام شمارش (GET /documents/audit-items) پس از نرمال‌سازی موجودی سیستمی */
export interface AuditItemRow {
  id: number;
  code: string;
  name: string;
  category: string;
  unit: string;
  system_stock_computed: number;
  [key: string]: unknown;
}

/** ردیف برگه شمارش با مقدار شمارش‌شده (رشته ورودی کاربر) */
export interface AuditSheetItem extends AuditItemRow {
  physical_stock: string;
}

export type AuditedItemsMap = Record<number, AuditSheetItem>;

export interface AuditSummary {
  list: AuditSheetItem[];
  counted: number;
  matched: number;
  surplus: number;
  shortage: number;
  surplusQty: number;
  shortageQty: number;
}

export interface AuditSavePayload {
  docType: 'audit';
  refNumber: string;
  date: string;
  location: string;
  user: string;
  notes: string;
  status: 'final';
  items: Array<{ itemId: number; system_stock: number; physical_stock: number; quantity: number; location: string }>;
}


type RawAuditItem = Partial<AuditItemRow> & {
  id: number;
  system_stock?: unknown;
  current_stock?: unknown;
  currentStock?: unknown;
};

/** موجودی سیستمی هر ردیف: system_stock_computed، system_stock، current_stock یا currentStock */
export function normalizeAuditItems(raw: unknown[]): AuditItemRow[] {
  return (raw as RawAuditItem[]).map(i => ({
    ...i,
    system_stock_computed: Number(i.system_stock_computed ?? i.system_stock ?? i.current_stock ?? i.currentStock ?? 0),
  }) as AuditItemRow);
}

/** ردیف‌های برگه با مقدار شمارش‌شده‌ای که کاربر وارد کرده است */
export function withPhysicalStock(items: AuditItemRow[], audited: AuditedItemsMap): AuditSheetItem[] {
  return items.map(i => ({ ...i, physical_stock: audited[i.id]?.physical_stock || '' }));
}

/** خلاصه شمارش برای مودال تایید پیش از ثبت نهایی (V10-3.4) */
export function summarizeAudit(list: AuditSheetItem[]): AuditSummary {
  let matched = 0;
  let surplus = 0;
  let shortage = 0;
  let surplusQty = 0;
  let shortageQty = 0;
  for (const it of list) {
    const phys = Number(it.physical_stock) || 0;
    const sys = Number(it.system_stock_computed) || 0;
    const variance = phys - sys;
    if (Math.abs(variance) < 1e-9) {
      matched += 1;
    } else if (variance > 0) {
      surplus += 1;
      surplusQty += variance;
    } else {
      shortage += 1;
      shortageQty += Math.abs(variance);
    }
  }
  return { list, counted: list.length, matched, surplus, shortage, surplusQty, shortageQty };
}

/** بدنه POST /documents برای سند انبارگردانی نهایی */
export function buildAuditPayload(
  list: AuditSheetItem[],
  opts: { location: string; locationLabel?: string; notes: string; user: User | null | undefined },
): AuditSavePayload {
  // location کد انبار است (TD-480)؛ نام انبار فقط در توضیح پیش‌فرض سند
  const { location, locationLabel, notes, user } = opts;
  return {
    docType: 'audit',
    // v9.0.285 (TD-783): شماره برگه فقط نمایشی است؛ سرور شماره آزاد بعدی سری را می‌دهد تا دو برگه هم‌زمان ۴۰۹ شماره تکراری نگیرند
    refNumber: 'auto',
    date: getTodayIsoDate(), // v8.0.49 (TD-312): روز تهران، نه روز UTC
    location,
    user: user?.full_name || user?.username || 'انباردار',
    notes: notes || `ثبت انبارگردانی در موقعیت ${locationLabel || location}`,
    status: 'final',
    items: list.map(i => {
      const phys = parseCleanNumber(i.physical_stock, 0);
      return {
        itemId: i.id,
        system_stock: i.system_stock_computed,
        physical_stock: phys,
        quantity: phys,
        location,
      };
    }),
  };
}

export function filterAuditItems(items: AuditSheetItem[], categoryFilter: string, searchQuery: string): AuditSheetItem[] {
  return items.filter(i => {
    if (categoryFilter !== 'all' && i.category !== categoryFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return i.name?.toLowerCase().includes(q) || i.code?.toLowerCase().includes(q);
  });
}

export function auditCategories(items: AuditSheetItem[]): string[] {
  return Array.from(new Set(items.map(i => i.category).filter(Boolean)));
}
