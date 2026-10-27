import { getSellableStock } from '../stockAvailability';
import { formatPersianNumber } from '../../utils/persianNumber';
import { isReservingDocument } from '../documents/reservingDocuments';
import { lineLocationOf, type InvoiceDocItem } from './invoiceForm';

/**
 * v11 phase 6.3b (U26, evaluation finding F26): a sales proforma line that asks more than the sellable stock of its
 * warehouse is kept (decision t14 «هشدار», TD-1138), but the form now says so on the line itself; before, the picker read
 * «قابل فروش: ۳ عدد», a line of 10 went into the table without a word, and the shortage showed only in the save message.
 * Only a line whose item came from the picker carries stock figures; a line read back from a stored proforma has none and
 * is left to the server's warning on save. While editing a proforma its own reservation (`ownReserved`, quantity per item)
 * is not counted against it, as the server does (`proformaStockWarnings`).
 */
export interface ProformaLineShortage {
  requested: number;
  sellable: number;
}

/** the line's note: what it asks, what can be sold, and that the proforma is still kept */
export function proformaShortageText(shortage: ProformaLineShortage, unit: string): string {
  return `بیش از موجودی قابل فروش: این ردیف ${formatPersianNumber(shortage.requested)} ${unit} می‌خواهد و قابل فروش `
    + `${formatPersianNumber(shortage.sellable)} ${unit} است. پیش‌فاکتور ذخیره می‌شود، ولی تا تأمین کالا قطعی نمی‌شود.`;
}

/** whether the item object carries stock figures (an item of the picker's list) */
export function hasStockFigures(item: object | null | undefined): boolean {
  const record = (item ?? {}) as Record<string, unknown>;
  return record.current_stock !== undefined || record.currentStock !== undefined;
}

/** the quantity per item of a stored reserving proforma, the reservation that is its own while it is edited */
export function ownReservationOf(lines: readonly InvoiceDocItem[]): Map<number, number> {
  const own = new Map<number, number>();
  for (const line of lines) own.set(line.item.id, (own.get(line.item.id) ?? 0) + Number(line.quantity || 0));
  return own;
}

export function proformaLineShortages(
  lines: readonly InvoiceDocItem[],
  doc: { docType: string; status: string; headerLocation: string },
  ownReserved: ReadonlyMap<number, number>,
): (ProformaLineShortage | null)[] {
  if (!isReservingDocument(doc.docType, doc.status)) return lines.map(() => null);
  return lines.map(line => {
    if (!hasStockFigures(line.item)) return null;
    const record = line.item as unknown as Record<string, unknown>;
    const reserved = Number(record.reserved_stock ?? record.reservedStock ?? 0) || 0;
    const others = Math.max(0, reserved - (ownReserved.get(line.item.id) ?? 0));
    const { sellable } = getSellableStock({ ...record, reserved_stock: others }, lineLocationOf(line, doc.headerLocation));
    return line.quantity > sellable ? { requested: line.quantity, sellable } : null;
  });
}
