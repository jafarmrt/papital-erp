import { and, eq, isNotNull } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { customers, documents, personnel, settlementAllocations } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { isRunningAccountKind, RUNNING_ACCOUNT_CURRENCY, RUNNING_ACCOUNT_LABELS, type RunningAccountKind } from '../../lib/accounting/runningAccount.js';
import { formatPersianCode, formatPersianNumber } from '../../utils/persianNumber.js';
import { writeRunningAccountSettlement } from '../accounting/treasury/runningAccountSettlement.js';
import { readDocumentPayableAndSettled } from './documentRemainingAmount.js';

/**
 * v12 colleague and partner sales (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md, owner's decisions of 6 Azar 1405).
 *
 * - **The stamp.** A sales invoice (or proforma) is stamped once, when it is first finalized, with the running account of
 *   its party at that moment (`documents.running_account`, `running_account_personnel_id`): every final invoice of a party
 *   linked to a colleague goes to «حساب جاری همکار» (3208), of a partner to «حساب جاری شرکا» (4101), on that person's
 *   personnel detail (decision 3.2). A later change of the party's link never moves an issued invoice; every final document
 *   of the books before migration 0038 is stamped '' (trade receivables).
 * - **The settlement.** A stamped invoice is settled from the running account at once (decision 3.1): one part with no
 *   treasury row or cheque, for what it owes after its final returns, written in the transaction of the finalize, the
 *   return or the void that changed it. A receipt or cheque already on the invoice refuses the finalize: the colleague's
 *   cash goes to their running account with the treasury use «حساب جاری همکار».
 * - Only rials: the running account is a rial account, so a stamped invoice in another currency is refused.
 */

export interface DocumentRunningAccount {
  kind: RunningAccountKind;
  personnelId: number;
  personnelName: string;
}

const SALES_TYPES = ['invoice', 'proforma'];

/** Stamps a sales document being finalized; a document already stamped keeps its stamp. Call it under the document lock. */
export async function stampDocumentRunningAccount(tx: DbExecutor, documentId: number): Promise<DocumentRunningAccount | null> {
  const [doc] = await tx.select({
    type: documents.type, partyId: documents.partyId, currency: documents.currency, refNumber: documents.refNumber,
    runningAccount: documents.runningAccount,
  }).from(documents).where(eq(documents.id, documentId));
  if (!doc || !SALES_TYPES.includes(String(doc.type))) return null;
  if (doc.runningAccount !== null) return documentRunningAccountOf(tx, documentId);
  const [party] = doc.partyId
    ? await tx.select({ personnelId: customers.personnelId, runningAccount: customers.runningAccount })
      .from(customers).where(and(eq(customers.id, doc.partyId), eq(customers.isDeleted, 0)))
    : [];
  const kind = party?.runningAccount;
  if (!party?.personnelId || !isRunningAccountKind(kind)) {
    await tx.update(documents).set({ runningAccount: '' }).where(eq(documents.id, documentId));
    return null;
  }
  // a colleague's running account is in rials; a partner's debt is fixed in euros (part B2, owner's decision of 7 Azar 1405)
  const required = RUNNING_ACCOUNT_CURRENCY[kind];
  if ((doc.currency || 'IRR').trim().toUpperCase() !== required) {
    throw new ValidationError(
      kind === 'partner'
        ? `طرف حساب فاکتور «${formatPersianCode(doc.refNumber ?? '')}» به یک شریک وصل است و بدهی شریک به یورو ثابت است؛ فاکتور را یورویی (با نرخ تسعیر روز) صادر کنید.`
        : `طرف حساب فاکتور «${formatPersianCode(doc.refNumber ?? '')}» به یک همکار وصل است و فاکتورش به ${RUNNING_ACCOUNT_LABELS[kind]} می‌رود که ریالی است؛ فاکتور را ریالی صادر کنید.`,
      { documentId, currency: required }, 'RUNNING_ACCOUNT_INVOICE_CURRENCY',
    );
  }
  await tx.update(documents).set({ runningAccount: kind, runningAccountPersonnelId: party.personnelId }).where(eq(documents.id, documentId));
  return documentRunningAccountOf(tx, documentId);
}

/** The running account a document was stamped with, or null (trade receivables, or not yet stamped) */
export async function documentRunningAccountOf(tx: DbExecutor, documentId: number): Promise<DocumentRunningAccount | null> {
  const [row] = await tx.select({ kind: documents.runningAccount, personnelId: documents.runningAccountPersonnelId, fullName: personnel.fullName })
    .from(documents)
    .leftJoin(personnel, eq(personnel.id, documents.runningAccountPersonnelId))
    .where(eq(documents.id, documentId));
  if (!row || !isRunningAccountKind(row.kind) || !row.personnelId) return null;
  return { kind: row.kind, personnelId: row.personnelId, personnelName: row.fullName ?? '' };
}

/**
 * Brings the «تسویه از حساب جاری» of a stamped invoice to what it owes now (payable less its final returns), or removes it
 * when the invoice is voided or is not stamped. The caller holds the invoice locked; a return locks its invoice first.
 */
export async function syncRunningAccountSettlement(
  tx: DbExecutor,
  invoiceId: number,
  actor: { userId?: number | null; username: string },
): Promise<void> {
  const [doc] = await tx.select({ status: documents.status, isDeleted: documents.isDeleted, type: documents.type, refNumber: documents.refNumber })
    .from(documents).where(eq(documents.id, invoiceId));
  if (!doc) return;
  const account = await documentRunningAccountOf(tx, invoiceId);
  const refNumber = String(doc.refNumber ?? invoiceId);
  const live = doc.isDeleted === 0 && doc.status === 'final' && SALES_TYPES.includes(String(doc.type));
  if (!account || !live) {
    const [part] = await tx.select({ personnelId: settlementAllocations.runningAccountPersonnelId }).from(settlementAllocations)
      .where(and(eq(settlementAllocations.documentId, invoiceId), isNotNull(settlementAllocations.runningAccountPersonnelId), eq(settlementAllocations.isDeleted, 0)));
    if (part?.personnelId) await writeRunningAccountSettlement(tx, { documentId: invoiceId, personnelId: part.personnelId, amount: 0, ...actor, refNumber });
    return;
  }
  const amounts = await readDocumentPayableAndSettled(tx, invoiceId);
  if (!amounts) return;
  const [part] = await tx.select({ amount: settlementAllocations.amount }).from(settlementAllocations)
    .where(and(eq(settlementAllocations.documentId, invoiceId), isNotNull(settlementAllocations.runningAccountPersonnelId), eq(settlementAllocations.isDeleted, 0)));
  const others = amounts.settled.subtract(part ? fin(part.amount) : 0);
  if (others.greaterThan(0.01)) {
    throw new ConflictError(
      `فاکتور «${formatPersianCode(refNumber)}» به ${RUNNING_ACCOUNT_LABELS[account.kind]} ${account.personnelName} می‌رود و از همان حساب تسویه می‌شود، ولی ${formatPersianNumber(others.toNumber())} ریال دریافت یا چک روی آن نشسته است. نخست آن سهم را از «نشاندن روی فاکتورها» بردارید و پول را با کاربرد «حساب جاری همکار» در خزانه ثبت کنید.`,
      { documentId: invoiceId, settledByOthers: others.toNumber() },
      'RUNNING_ACCOUNT_INVOICE_HAS_RECEIPTS',
    );
  }
  await writeRunningAccountSettlement(tx, {
    documentId: invoiceId, personnelId: account.personnelId, amount: amounts.payable.subtract(amounts.returned), ...actor, refNumber,
  });
}

/**
 * After a sales invoice, proforma or sales return became final (its voucher is written): the invoice's «تسویه از حساب جاری»
 * follows. A return locks its invoice (`FOR NO KEY UPDATE`, as a settlement does) before it reads it.
 */
export async function syncRunningAccountAfterFinalize(tx: DbExecutor, documentId: number, actor: { userId?: number | null; username: string }): Promise<void> {
  const [doc] = await tx.select({
    type: documents.type, returnOfDocumentId: documents.returnOfDocumentId, partyId: documents.partyId,
    status: documents.status, isDeleted: documents.isDeleted, refNumber: documents.refNumber,
  }).from(documents).where(eq(documents.id, documentId));
  if (!doc) return;
  if (SALES_TYPES.includes(String(doc.type))) {
    await syncRunningAccountSettlement(tx, documentId, actor);
    return;
  }
  if (doc.type === 'return' && !doc.returnOfDocumentId && doc.isDeleted === 0 && doc.status === 'final' && doc.partyId) {
    // a return with no invoice would credit trade receivables while the party's sales sit on the running account
    const [party] = await tx.select({ personnelId: customers.personnelId, runningAccount: customers.runningAccount })
      .from(customers).where(and(eq(customers.id, doc.partyId), eq(customers.isDeleted, 0)));
    if (party?.personnelId && isRunningAccountKind(party.runningAccount)) {
      throw new ValidationError(
        `طرف حساب برگشت از فروش «${formatPersianCode(doc.refNumber ?? '')}» به یک همکار یا شریک وصل است و فروشش در ${RUNNING_ACCOUNT_LABELS[party.runningAccount]} است؛ برگشت را از روی فاکتور فروش همان کالا ثبت کنید.`,
        { documentId }, 'RUNNING_ACCOUNT_RETURN_NEEDS_INVOICE',
      );
    }
    return;
  }
  if (doc.type === 'return' && doc.returnOfDocumentId) {
    await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, doc.returnOfDocumentId)).for('no key update');
    await syncRunningAccountSettlement(tx, doc.returnOfDocumentId, actor);
  }
}
