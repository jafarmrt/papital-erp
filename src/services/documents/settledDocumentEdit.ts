import type { DbExecutor } from '../../db/drizzle.js';
import { ConflictError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { formatPersianCode, formatPersianNumber } from '../../utils/persianNumber.js';
import { readDocumentPayableAndSettled } from './documentRemainingAmount.js';

/**
 * v11 phase 6.1t (review of M11): a draft or proforma that a receipt, payment or cheque already settles (a direct link or a
 * part) keeps its party and currency, and its payable never drops below what settles it. Before, the edit moved customer
 * A's receipt onto customer B's document, or counted a rial part as dollars after a change of currency. The edit holds the
 * document `FOR UPDATE`, so no new settlement lands on it meanwhile (a settlement locks the document first).
 */

export interface SettledDocumentIdentity {
  refNumber: string | null;
  partyId: number | null;
  buyerName: string | null;
  currency: string | null;
}

const currencyOf = (c: string | null | undefined) => (c || 'IRR').trim().toUpperCase();

/** Whether a receipt, payment or cheque settles the document now */
export async function documentIsSettled(tx: DbExecutor, documentId: number): Promise<boolean> {
  const doc = await readDocumentPayableAndSettled(tx, documentId);
  return Boolean(doc && doc.settled.greaterThan(0));
}

/** The party or currency of a settled document does not change (409 `SETTLED_DOCUMENT_IDENTITY_LOCKED`) */
export function assertSettledDocumentIdentity(before: SettledDocumentIdentity, after: Omit<SettledDocumentIdentity, 'refNumber'>): void {
  const partyChanged = (before.partyId ?? null) !== (after.partyId ?? null)
    || ((before.partyId ?? null) === null && (before.buyerName ?? '').trim() !== (after.buyerName ?? '').trim());
  const currencyChanged = currencyOf(before.currency) !== currencyOf(after.currency);
  if (!partyChanged && !currencyChanged) return;
  throw new ConflictError(
    `سند «${formatPersianCode(before.refNumber ?? '')}» با دریافت، پرداخت یا چک تسویه شده است؛ طرف حساب و ارز آن عوض نمی‌شود. نخست سهم آن را از «نشاندن روی فاکتورها» در خزانه یا دفتر چک بردارید.`,
    { partyChanged, currencyChanged },
    'SETTLED_DOCUMENT_IDENTITY_LOCKED',
  );
}

/** After the edit the document still covers what settles it and its final returns (409 `SETTLED_DOCUMENT_BELOW_SETTLED`) */
export async function assertPayableCoversSettlement(tx: DbExecutor, documentId: number): Promise<void> {
  const doc = await readDocumentPayableAndSettled(tx, documentId);
  if (!doc) return;
  const covered = (doc.settled.isNegative() ? fin(0) : doc.settled).add(doc.returned);
  if (doc.payable.add(0.01).greaterThanOrEqual(covered)) return;
  throw new ConflictError(
    `مبلغ سند «${formatPersianCode(doc.refNumber ?? '')}» پس از این ویرایش (${formatPersianNumber(doc.payable.toNumber())}) از جمع تسویه آن (${formatPersianNumber(covered.toNumber())}) کمتر می‌شود؛ نخست سهم دریافت‌ها و چک‌های روی آن را کم کنید.`,
    { payable: doc.payable.toNumber(), settled: covered.toNumber() },
    'SETTLED_DOCUMENT_BELOW_SETTLED',
  );
}
