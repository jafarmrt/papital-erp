/**
 * v10.0.151 (TD-1175): one outgoing (item, warehouse) of a document with its stock and sellable quantity, shared by
 * `GET /documents/:id/line-stock` and the warehouse approval task window
 */
export interface DocumentLineStock {
  itemId: number;
  /** warehouse code */
  location: string;
  warehouseName: string;
  requested: number;
  locationStock: number;
  reservedForOthers: number;
  sellable: number;
}

/** The line stock of an item at a warehouse; a line without its own warehouse is read at the default one */
export function lineStockOf(rows: readonly DocumentLineStock[], itemId: unknown, location: unknown): DocumentLineStock | undefined {
  const id = Number(itemId);
  const code = String(location ?? '').trim();
  const ofItem = rows.filter(r => r.itemId === id);
  return ofItem.find(r => r.location === code) ?? (ofItem.length === 1 ? ofItem[0] : undefined);
}
