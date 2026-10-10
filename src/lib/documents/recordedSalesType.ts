/**
 * v10.0.86 (TD-1190): the type a sales document is stored as, shared by `POST /documents` and the invoice form. An `invoice`
 * recorded as a proforma by a user who cannot finalize sales documents is stored as type `proforma` (its own number series;
 * the invoice number and date come at finalization, TD-317 / TD-410). The form asks the next number of this type, so the
 * read-only number it shows is the number the saved document gets. Before, the form always showed the invoice series
 * (1000) while a seller's proforma was saved with the proforma series (1), which the print and the inbox showed.
 */
export function recordedSalesType(type: string, status: string | null | undefined, mayFinalizeSales: boolean): string {
  return type === 'invoice' && status === 'proforma' && !mayFinalizeSales ? 'proforma' : type;
}
