/**
 * Stock availability & sellable calculation helper for frontend components.
 * Consolidates inventory location checks and reservation deductions.
 */

export interface SellableStockResult {
  loc: number;
  total: number;
  reserved: number;
  sellable: number;
}

/**
 * Calculates sellable stock bounded by location stock and total available stock after reservations.
 * sellable = max(0, min(locationStock, totalStock - reservedStock))
 */
export function getSellableStock(item: object | null | undefined, location: string): SellableStockResult {
  if (!item) {
    return { loc: 0, total: 0, reserved: 0, sellable: 0 };
  }

  // کالای ورودی از API می‌آید (کلیدهای پویای stock_<کد انبار>)؛ فیلدها با narrowing خوانده می‌شوند
  const record = item as Record<string, unknown>;
  const stocks = record.stocks;
  const locKey = location ? `stock_${location}` : '';
  let loc = 0;
  if (locKey && record[locKey] !== undefined) {
    loc = Number(record[locKey]) || 0;
  } else if (stocks && typeof stocks === 'object' && location && (stocks as Record<string, unknown>)[location] !== undefined) {
    loc = Number((stocks as Record<string, unknown>)[location]) || 0;
  } else if (!location) {
    // If no specific location is requested, loc defaults to total current stock
    loc = Number(record.current_stock ?? record.currentStock ?? 0) || 0;
  } else {
    // Location specified but not found in item stocks -> 0 in that location
    loc = 0;
  }

  const total = Number(record.current_stock ?? record.currentStock ?? 0) || 0;
  const reserved = Number(record.reserved_stock ?? record.reservedStock ?? 0) || 0;
  const availableFromTotal = Math.max(0, total - reserved);
  const sellable = Math.max(0, Math.min(loc, availableFromTotal));

  return {
    loc,
    total,
    reserved,
    sellable
  };
}
