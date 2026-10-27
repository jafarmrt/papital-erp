import { getSellableStock } from '../stockAvailability';
import { formatPersianNumber } from '../../utils/persianNumber';
import { isReservingDocument } from '../documents/reservingDocuments';
import { lineLocationOf, type InvoiceDocItem } from './invoiceForm';

/**
 * v11 phase 6.3b (U26, evaluation finding F26): a sales proforma line that asks more than the sellable stock of its
 * warehouse is kept (decision t14 «هشدار», TD-1138), but the form now says so on the line itself; before, the picker read
 * «قابل فروش: ۳ عدد», a line of 10 went into the table without a word, and the shortage showed only in the save message.
 * Only a line whose item came from the picker carries stock figures; a line read back from a stored proforma has none and
 * is left to the server's warning on save. While a proforma is edited the picker already reads the reservations of the
 * other documents only (`itemPickWithReservedUrl(editingDocId)`, TD-1209), so its own reservation is not in the figures.
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

export function proformaLineShortages(
  lines: readonly InvoiceDocItem[],
  doc: { docType: string; status: string; headerLocation: string },
): (ProformaLineShortage | null)[] {
  if (!isReservingDocument(doc.docType, doc.status)) return lines.map(() => null);
  return lines.map(line => {
    if (!hasStockFigures(line.item)) return null;
    const record = line.item as unknown as Record<string, unknown>;
    const { sellable } = getSellableStock(record, lineLocationOf(line, doc.headerLocation));
    return line.quantity > sellable ? { requested: line.quantity, sellable } : null;
  });
}
