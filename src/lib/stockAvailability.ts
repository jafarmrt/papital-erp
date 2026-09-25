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
export function getSellableStock(item: any, location: string): SellableStockResult {
  if (!item) {
    return { loc: 0, total: 0, reserved: 0, sellable: 0 };
  }

  const locKey = location ? `stock_${location}` : '';
  let loc = 0;
  if (locKey && item[locKey] !== undefined) {
    loc = Number(item[locKey]) || 0;
  } else if (item.stocks && typeof item.stocks === 'object' && location && item.stocks[location] !== undefined) {
    loc = Number(item.stocks[location]) || 0;
  } else if (!location) {
    // If no specific location is requested, loc defaults to total current stock
    loc = Number(item.current_stock ?? item.currentStock ?? 0) || 0;
  } else {
    // Location specified but not found in item stocks -> 0 in that location
    loc = 0;
  }

  const total = Number(item.current_stock ?? item.currentStock ?? 0) || 0;
  const reserved = Number(item.reserved_stock ?? item.reservedStock ?? 0) || 0;
  const availableFromTotal = Math.max(0, total - reserved);
  const sellable = Math.max(0, Math.min(loc, availableFromTotal));

  return {
    loc,
    total,
    reserved,
    sellable
  };
}
