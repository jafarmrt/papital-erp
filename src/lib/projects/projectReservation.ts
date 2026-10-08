/**
 * v8.0.58 (TD-306، تصمیم مالک محصول — گزینه الف): رزرو پروژه («ثبت نهایی و فریز اقلام») از بخش‌های کنترل موجودی
 * پروژه ساخته می‌شود؛ سرور آن را هنگام ثبت نهایی اجرا می‌کند و `reservedItems` بدنه درخواست را نادیده می‌گیرد
 * (همان قاعده‌ای که پیش‌تر مرورگر در buildReservedItemsToFreeze اجرا می‌کرد). هر قلم به مقدار لازم پروژه رزرو
 * می‌شود، حداکثر تا موجودی کل کالا.
 */

import { findProjectItemMatch } from './projectItemMatch.js';

/** کالای انبار برای تطبیق ردیف‌های کنترل موجودی (findProjectItemMatch: کد، سپس نام دقیق) */
export interface ReservationStockItem {
  id: number;
  code?: string | null;
  name?: string | null;
  category?: string | null;
  unit?: string | null;
  currentStock: number;
}

export interface ProjectReservedItem {
  itemId?: number;
  itemCode: string;
  itemName: string;
  category?: string;
  reservedQty: number;
  originalQty: number;
  unit: string;
  originalUnit?: string;
  reservedAt: string;
}

type Row = Record<string, unknown>;

const asRow = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null);
const asRows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(asRow).filter((r): r is Row => r !== null) : []);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const optText = (v: unknown): string | undefined => text(v) || undefined;

interface Total {
  itemCode: string;
  itemName: string;
  category?: string;
  unit: string;
  totalRequiredQty: number;
}

function addTotal(totals: Map<string, Total>, code: string, name: string, qty: number, category: string | undefined, unit: string): void {
  if ((!code && !name) || !(qty > 0)) return;
  const key = code ? `C_${code.toUpperCase()}` : `N_${name.toLowerCase()}`;
  const cur = totals.get(key) || { itemCode: code, itemName: name, category, unit, totalRequiredQty: 0 };
  cur.totalRequiredQty += qty;
  totals.set(key, cur);
}

export function buildProjectReservation(
  sections: unknown,
  products: unknown,
  stockItems: ReservationStockItem[],
  manualPurchaseItems: unknown,
  reservedAt: string
): ProjectReservedItem[] {
  const totals = new Map<string, Total>();
  const productList = asRows(products);

  for (const sec of asRows(sections)) {
    const title = optText(sec.title);
    const perItemResults = asRow(sec.perItemResults);
    if (sec.checkType === 'per_item' && perItemResults) {
      for (const prod of productList) {
        const prodRes = asRow(perItemResults[text(prod.id)]) || {};
        const results = Object.values(prodRes).map(asRow).filter((r): r is Row => r !== null);
        const rows = results.length > 0
          ? results
          : asRows(sec.itemsSchema).map(s => ({ itemCode: s.itemCode, name: s.name, unit: s.unit || 'عدد', requiredQty: 1 }) as Row);
        for (const r of rows) {
          const qty = Number(r.requiredQty !== undefined ? r.requiredQty : 1);
          addTotal(totals, text(r.itemCode), text(r.name), qty, optText(r.category) || title, text(r.unit) || 'عدد');
        }
      }
    } else if (sec.checkType === 'global') {
      for (const g of asRows(sec.globalItems)) {
        addTotal(totals, text(g.itemCode), text(g.name), Number(g.requiredQty || 0), optText(g.category) || title, text(g.unit) || 'عدد');
      }
    }
  }

  for (const m of asRows(manualPurchaseItems)) {
    if (m.procurementStatus === 'reserved' || m.toPurchaseQty === 0) {
      addTotal(totals, text(m.itemCode), text(m.itemName), Number(m.totalRequiredQty || 0), optText(m.category) || 'اقلام دستی', text(m.unit) || 'عدد');
    }
  }

  const reserved: ProjectReservedItem[] = [];
  for (const tot of totals.values()) {
    // v9.0.363 (TD-749، TD-768): قاعده مشترک تطبیق با مرورگر؛ کد کالا بر نام کالای دیگر مقدم است
    const match = findProjectItemMatch({ code: tot.itemCode, name: tot.itemName }, stockItems);
    const stock = match ? Number(match.currentStock) || 0 : 0;
    if (!match || stock <= 0) continue;
    const reservedQty = Math.min(stock, tot.totalRequiredQty);
    if (reservedQty <= 0) continue;
    reserved.push({
      itemId: match.id,
      itemCode: match.code || tot.itemCode,
      itemName: match.name || tot.itemName,
      category: match.category || tot.category,
      reservedQty,
      originalQty: tot.totalRequiredQty,
      unit: match.unit || tot.unit || 'عدد',
      originalUnit: tot.unit || 'عدد',
      reservedAt,
    });
  }
  return reserved;
}
