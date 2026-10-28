import type { DbExecutor } from '../../../db/drizzle.js';
import { ConflictError } from '../../../errors/customErrors.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../../lib/financialDecimal.js';
import { formatPersianNumber } from '../../../utils/persianNumber.js';
import { FiscalPeriodService } from '../fiscalPeriod.service.js';

/**
 * v11 phase 7.2 (finding F2 of the v11 full test, card ت۶۲): what a receipt, payment or cheque dated in a closed fiscal year
 * settles does not change any more (409 `SETTLEMENT_IN_CLOSED_YEAR`). Before, moving such a receipt's parts to another
 * invoice, taking a cheque's parts off, moving the receipt to another document and deleting a cheque without vouchers were
 * all accepted, so the closed year's receipts and the paid status of its invoices changed after the books were closed (the
 * vouchers never changed, only the settlement). The rule is the source's own date, as for recording one: a receipt in an
 * open year may still settle an invoice of a closed year, which is how an old invoice is paid. The year row stays FOR
 * SHARE locked (`isClosedShared`), so the year is not closed meanwhile. The caller checks only when something changes.
 */
export async function assertSettlementOutsideClosedYears(tx: DbExecutor, change: {
  /** the receipt or payment date, or the cheque issue date */
  sourceDate: string | null | undefined;
  /** shown in the message, e.g. «نشاندن چک «۱۲» روی سندها» */
  action: string;
}): Promise<void> {
  const date = String(change.sourceDate ?? '').slice(0, 10);
  if (!date || !(await FiscalPeriodService.isClosedShared(date, tx))) return;
  const year = FiscalPeriodService.yearOf(date);
  throw new ConflictError(
    `${change.action} انجام نمی‌شود: تاریخ آن در سال مالی ${formatPersianNumber(year, 0)} است که بسته شده است و آنچه تسویه `
      + 'می‌کند پس از بستن دفترها عوض نمی‌شود. اگر لازم است، سال را باز کنید یا اصلاح را در سال باز با دریافت یا پرداخت تازه ثبت کنید.',
    { closedYear: year },
    'SETTLEMENT_IN_CLOSED_YEAR',
  );
}

/** The documents whose settled amount differs between two sets of parts (a direct link counts as one part) */
export function changedSettlementDocuments(
  before: ReadonlyArray<{ documentId: number; amount: DecimalValue }>,
  after: ReadonlyArray<{ documentId: number; amount: DecimalValue }>,
): number[] {
  const sum = (parts: ReadonlyArray<{ documentId: number; amount: DecimalValue }>) => {
    const out = new Map<number, FinancialDecimal>();
    for (const p of parts) out.set(p.documentId, (out.get(p.documentId) ?? fin(0)).add(p.amount));
    return out;
  };
  const a = sum(before);
  const b = sum(after);
  return [...new Set([...a.keys(), ...b.keys()])].filter(id => !(a.get(id) ?? fin(0)).equals(b.get(id) ?? fin(0)));
}
