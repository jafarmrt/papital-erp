import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../../db/drizzle.js';
import { cheques, documents, settlementAllocations, treasuryTransactions } from '../../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../errors/customErrors.js';
import { logActivity } from '../../../lib/auditLogger.js';
import { fin, type DecimalValue } from '../../../lib/financialDecimal.js';
import { LockHierarchyLevel, validateLockOrder } from '../../../lib/lockOrder.js';
import { money } from '../../../lib/money.js';
import {
  LAPSED_CHEQUE_STATUSES, MAX_SETTLEMENT_PARTS, SETTLEABLE_DOCUMENT_STATUSES,
  type SettlementAllocationInput, type SettlementAllocationView, type SourceAllocations,
} from '../../../lib/treasury/settlementAllocation.js';
import { idempotentTransaction } from '../../../middleware/idempotency.js';
import { formatPersianCode, formatPersianNumber } from '../../../utils/persianNumber.js';
import type { TreasuryAuditActor } from './treasuryAudit.js';
import { assertWithinDocumentRemaining, lockSettlementDocument } from './documentRemaining.js';
import { assertTreasuryDocumentLink, resolveTreasuryPartyName } from './treasuryLinks.js';
import { exactTreasuryAmount } from './treasuryAmount.js';

/**
 * v11 phase 6.1t (M11 / U2, decision ت۵۲-۵): a receipt or payment of the treasury form, or a cheque, settles one or more
 * documents of its party in parts (`settlement_allocations`). The voucher of the receipt or cheque does not change: the
 * party's account takes the whole amount either way; only what each document counts as paid changes.
 *
 * - The source: a live receipt from a customer or payment to a supplier (completed, not a reversal, not a payslip), or a
 *   cheque received from a customer or paid to a supplier that has not bounced or come back. A receipt settles sales
 *   invoices and proformas, a payment purchase documents, with the party and currency rule of a direct link
 *   (`assertTreasuryDocumentLink`).
 * - Each part is above zero, one per document, at most the document's remaining amount (`assertWithinDocumentRemaining`,
 *   the document locked `FOR NO KEY UPDATE` first, in id order), and all parts together at most the source's amount; the
 *   rest stays on account.
 * - Writing a new set replaces the old one (old rows keep `is_deleted = 1`); a treasury row linked to one document
 *   directly leaves that link in the same transaction. An empty set puts the whole amount on account.
 * - Lock order: a treasury source locks its documents (60) and then its row (80); a cheque source its cheque (20) and
 *   then its documents (60). The create of a receipt or cheque locks its bank account (10) first.
 */

export type AllocationDirection = 'receipt' | 'payment';

/** What a part needs from its source to check its documents */
export interface AllocationSourceParty {
  direction: AllocationDirection;
  partyType: string;
  partyId: number | null;
  partyName: string;
  currency: string;
}

function notAllocatable(message: string): ConflictError {
  return new ConflictError(message, undefined, 'SETTLEMENT_SOURCE_NOT_ALLOCATABLE');
}

/**
 * The parts as sent: an array of `{ documentId, amount }` with exact amounts above zero, one per document, at most
 * `MAX_SETTLEMENT_PARTS`, together at most the source's amount. Sorted by document id, the lock order.
 */
export function normalizeAllocations(input: readonly SettlementAllocationInput[] | null | undefined, sourceAmount: number | string): SettlementAllocationInput[] {
  const parts = Array.isArray(input) ? input : [];
  if (parts.length > MAX_SETTLEMENT_PARTS) {
    throw new ValidationError(`یک دریافت یا چک حداکثر روی ${formatPersianNumber(MAX_SETTLEMENT_PARTS)} سند می‌نشیند.`, undefined, 'SETTLEMENT_ALLOCATION_INVALID');
  }
  const seen = new Set<number>();
  const normalized = parts.map(part => {
    const documentId = Number(part?.documentId);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      throw new ValidationError('سند هر سهم را از فهرست انتخاب کنید.', undefined, 'SETTLEMENT_ALLOCATION_INVALID');
    }
    if (seen.has(documentId)) {
      throw new ValidationError('هر سند فقط یک سهم از این دریافت یا چک می‌گیرد.', undefined, 'SETTLEMENT_ALLOCATION_INVALID');
    }
    seen.add(documentId);
    const amount = exactTreasuryAmount(part.amount, 'مبلغ سهم');
    if (!(amount > 0)) {
      throw new ValidationError('مبلغ هر سهم باید بزرگتر از صفر باشد.', undefined, 'SETTLEMENT_ALLOCATION_INVALID');
    }
    return { documentId, amount };
  });
  const total = normalized.reduce((sum, p) => sum.add(p.amount), fin(0));
  if (total.greaterThan(fin(sourceAmount))) {
    throw new ValidationError(
      `جمع سهم‌ها (${formatPersianNumber(total.toNumber(), 4)}) از مبلغ دریافت یا چک (${formatPersianNumber(fin(sourceAmount).toNumber(), 4)}) بیشتر است.`,
      { total: total.toNumber(), amount: fin(sourceAmount).toNumber() },
      'SETTLEMENT_ALLOCATION_EXCEEDS_SOURCE',
    );
  }
  return normalized.sort((a, b) => a.documentId - b.documentId);
}

/** A receipt settles sales documents of a customer, a payment purchase documents of a supplier */
export function assertAllocatableParty(direction: AllocationDirection, partyType: string): void {
  const expected = direction === 'receipt' ? 'customer' : 'supplier';
  if (partyType !== expected) {
    throw new ValidationError(
      direction === 'receipt'
        ? 'فقط دریافت از مشتری روی فاکتورهای فروش می‌نشیند.'
        : 'فقط پرداخت به تأمین‌کننده روی سندهای خرید می‌نشیند.',
      undefined,
      'SETTLEMENT_ALLOCATION_PARTY_INVALID',
    );
  }
}

/**
 * Under the caller's earlier locks: each document is locked in id order and checked against the source (live, the right
 * side, the same party and currency) and its remaining amount. The caller has already released any old parts of this
 * source, so they do not count against the new ones; `kept` is what the source put on each document before (its parts,
 * or its direct link), so a draft it already settles may keep that part or a smaller one.
 */
export async function lockAndCheckAllocationTargets(
  tx: DbExecutor,
  source: AllocationSourceParty,
  parts: readonly SettlementAllocationInput[],
  kept: ReadonlyMap<number, DecimalValue> = new Map(),
): Promise<void> {
  for (const part of parts) {
    await lockSettlementDocument(tx, part.documentId);
    await assertTreasuryDocumentLink(tx, {
      type: source.direction,
      documentId: part.documentId,
      partyType: source.partyType,
      partyId: source.partyId,
      partyName: source.partyName,
      currency: source.currency,
    });
    await assertSettleableDocumentStatus(tx, part, kept.get(part.documentId));
    await assertWithinDocumentRemaining(tx, { documentId: part.documentId, amount: part.amount }, { exact: true });
  }
}

/**
 * A draft is still changed freely, so no new part sits on it (422 `SETTLEMENT_DOCUMENT_NOT_ISSUED`). A draft this source
 * already settles (a proforma sent back to draft, or an old direct link) keeps its part or a smaller one, so the window
 * still saves the set it opened on (review of M11).
 */
async function assertSettleableDocumentStatus(tx: DbExecutor, part: SettlementAllocationInput, keptAmount: DecimalValue | undefined): Promise<void> {
  const [doc] = await tx.select({ refNumber: documents.refNumber, status: documents.status }).from(documents).where(eq(documents.id, part.documentId));
  if (!doc || SETTLEABLE_DOCUMENT_STATUSES.includes(doc.status ?? '')) return;
  if (keptAmount !== undefined && fin(part.amount).lessThanOrEqual(keptAmount)) return;
  throw new ValidationError(
    keptAmount !== undefined
      ? `سند «${formatPersianCode(doc.refNumber ?? part.documentId)}» پیش‌نویس است؛ سهم کنونی آن می‌ماند یا کم می‌شود اما بیشتر نمی‌شود.`
      : `سند «${formatPersianCode(doc.refNumber ?? part.documentId)}» پیش‌نویس است؛ دریافت و چک فقط روی فاکتور نهایی یا پیش‌فاکتور می‌نشیند.`,
    { documentId: part.documentId, status: doc.status, kept: keptAmount === undefined ? null : fin(keptAmount).toNumber() },
    'SETTLEMENT_DOCUMENT_NOT_ISSUED',
  );
}

/** What a source put on each document before a new set replaces it: its live parts, or its direct link */
function keptAmounts(before: readonly SettlementAllocationView[], direct: { documentId: number | null; amount: DecimalValue } | null): Map<number, DecimalValue> {
  const kept = new Map<number, DecimalValue>(before.map(p => [p.documentId, p.amount]));
  if (direct?.documentId) kept.set(direct.documentId, direct.amount);
  return kept;
}

export async function insertAllocations(
  tx: DbExecutor,
  source: { treasuryTransactionId: number } | { chequeId: number },
  parts: readonly SettlementAllocationInput[],
  userId: number | null | undefined,
): Promise<void> {
  if (parts.length === 0) return;
  await tx.insert(settlementAllocations).values(parts.map(part => ({
    documentId: part.documentId,
    treasuryTransactionId: 'treasuryTransactionId' in source ? source.treasuryTransactionId : null,
    chequeId: 'chequeId' in source ? source.chequeId : null,
    amount: money(part.amount),
    createdById: userId ?? null,
  })));
}

/** The current parts of one source with their document numbers (a source that is live has only live parts) */
export async function sourceAllocationViews(
  tx: DbExecutor,
  source: { kind: 'treasury' | 'cheque'; id: number; number: string; date: string; status: string },
): Promise<SettlementAllocationView[]> {
  const rows = await tx.select({
    id: settlementAllocations.id, documentId: settlementAllocations.documentId, amount: settlementAllocations.amount, refNumber: documents.refNumber,
  })
    .from(settlementAllocations)
    .innerJoin(documents, eq(documents.id, settlementAllocations.documentId))
    .where(and(
      source.kind === 'treasury' ? eq(settlementAllocations.treasuryTransactionId, source.id) : eq(settlementAllocations.chequeId, source.id),
      eq(settlementAllocations.isDeleted, 0),
    ))
    .orderBy(asc(settlementAllocations.documentId));
  return rows.map(r => ({
    id: r.id, documentId: r.documentId, refNumber: String(r.refNumber ?? r.documentId), amount: fin(r.amount).toNumber(),
    source: source.kind, sourceId: source.id, sourceNumber: source.number, date: source.date, status: source.status,
  }));
}

function sourceSummary(kind: 'treasury' | 'cheque', id: number, amount: DecimalValue, allocations: SettlementAllocationView[], directDocumentId: number | null): SourceAllocations {
  const placed = allocations.reduce((sum, a) => sum.add(a.amount), fin(0)).add(directDocumentId ? fin(amount) : 0);
  const left = fin(amount).subtract(placed);
  return { source: kind, sourceId: id, amount: fin(amount).toNumber(), allocations, unallocated: left.isNegative() ? 0 : left.toNumber() };
}

/** The parts of a recorded receipt or cheque, read now (the window of «نشاندن روی فاکتورها») */
export function readSourceAllocations(source: { treasuryId: number } | { chequeId: number }): Promise<SourceAllocations & { directDocumentId: number | null }> {
  return readSourceAllocationsIn(orm, source);
}

async function readSourceAllocationsIn(tx: DbExecutor, source: { treasuryId: number } | { chequeId: number }): Promise<SourceAllocations & { directDocumentId: number | null }> {
  if ('treasuryId' in source) {
    const [row] = await tx.select().from(treasuryTransactions)
      .where(and(eq(treasuryTransactions.id, source.treasuryId), eq(treasuryTransactions.isDeleted, 0)));
    if (!row) throw new NotFoundError('تراکنش خزانه یافت نشد');
    // a voided row or a reversal settles nothing, whatever parts it kept (review of M11)
    const live = row.status === 'completed' && row.reversalOfId === null;
    const views = live
      ? await sourceAllocationViews(tx, { kind: 'treasury', id: row.id, number: row.transactionNumber, date: String(row.date).slice(0, 10), status: row.method })
      : [];
    return { ...sourceSummary('treasury', row.id, row.amount, views, row.documentId ?? null), directDocumentId: row.documentId ?? null };
  }
  const [cheque] = await tx.select().from(cheques).where(and(eq(cheques.id, source.chequeId), eq(cheques.isDeleted, 0)));
  if (!cheque) throw new NotFoundError('چک یافت نشد');
  // a bounced or returned cheque settles nothing, whatever parts it kept (review of M11)
  const views = (LAPSED_CHEQUE_STATUSES as readonly string[]).includes(cheque.status ?? '')
    ? []
    : await sourceAllocationViews(tx, { kind: 'cheque', id: cheque.id, number: cheque.chequeNumber, date: String(cheque.issueDate).slice(0, 10), status: cheque.status ?? '' });
  return { ...sourceSummary('cheque', cheque.id, cheque.amount, views, null), directDocumentId: null };
}

async function releaseSourceAllocations(tx: DbExecutor, source: { treasuryTransactionId: number } | { chequeId: number }): Promise<void> {
  await tx.update(settlementAllocations)
    .set({ isDeleted: 1 })
    .where(and(
      'treasuryTransactionId' in source
        ? eq(settlementAllocations.treasuryTransactionId, source.treasuryTransactionId)
        : eq(settlementAllocations.chequeId, source.chequeId),
      eq(settlementAllocations.isDeleted, 0),
    ));
}

/** Live parts a treasury row has (the move to another document refuses such a row) */
export async function hasLiveSourceAllocations(tx: DbExecutor, treasuryTransactionId: number): Promise<boolean> {
  const [row] = await tx.select({ id: settlementAllocations.id }).from(settlementAllocations)
    .where(and(eq(settlementAllocations.treasuryTransactionId, treasuryTransactionId), eq(settlementAllocations.isDeleted, 0)))
    .limit(1);
  return Boolean(row);
}

function partsText(parts: readonly SettlementAllocationView[], refs: Map<number, string>): string {
  if (parts.length === 0) return 'علی‌الحساب';
  return parts.map(p => `«${refs.get(p.documentId) ?? p.refNumber}» ${formatPersianNumber(p.amount, 4)}`).join('، ');
}

/**
 * `PUT /accounting/settlement/treasury/:id` and `/cheques/:id`: the new set of parts of one receipt or cheque, in place
 * of the old one (an empty set puts it all on account). Each change writes one activity row with the parts before and
 * after.
 */
export async function replaceSourceAllocations(params: {
  source: { treasuryId: number } | { chequeId: number };
  allocations: readonly SettlementAllocationInput[];
  userId?: number;
  username?: string;
  audit?: TreasuryAuditActor;
}): Promise<SourceAllocations> {
  return idempotentTransaction(async (tx) => {
    if ('treasuryId' in params.source) return replaceTreasuryAllocations(tx, params.source.treasuryId, params);
    return replaceChequeAllocations(tx, params.source.chequeId, params);
  });
}

async function replaceTreasuryAllocations(
  tx: DbExecutor,
  id: number,
  params: { allocations: readonly SettlementAllocationInput[]; userId?: number; audit?: TreasuryAuditActor },
): Promise<SourceAllocations> {
  validateLockOrder([
    { name: 'document', hierarchyLevel: LockHierarchyLevel.DOCUMENTS },
    { name: 'treasuryTransaction', hierarchyLevel: LockHierarchyLevel.TREASURY_TRANSACTIONS },
  ]);
  const [peek] = await tx.select().from(treasuryTransactions)
    .where(and(eq(treasuryTransactions.id, id), eq(treasuryTransactions.isDeleted, 0)));
  if (!peek) throw new NotFoundError('تراکنش خزانه یافت نشد');
  const parts = normalizeAllocations(params.allocations, peek.amount.toString());
  // the documents first (level 60), then the row (level 80); a void of the row waits here or is seen below
  for (const part of parts) await lockSettlementDocument(tx, part.documentId);
  const [row] = await tx.select().from(treasuryTransactions)
    .where(and(eq(treasuryTransactions.id, id), eq(treasuryTransactions.isDeleted, 0)))
    .for('update');
  if (!row) throw new NotFoundError('تراکنش خزانه یافت نشد');
  if (row.status !== 'completed' || row.reversalOfId !== null || row.payrollId) {
    throw notAllocatable(`تراکنش «${row.transactionNumber}» باطل‌شده، ردیف ابطال یا پرداخت فیش حقوق است و روی سندی نمی‌نشیند.`);
  }
  const direction: AllocationDirection = row.type === 'payment' ? 'payment' : 'receipt';
  if (row.type !== 'receipt' && row.type !== 'payment') throw notAllocatable(`تراکنش «${row.transactionNumber}» دریافت یا پرداخت نیست.`);
  assertAllocatableParty(direction, row.partyType || 'other');

  const before = await sourceAllocationViews(tx, { kind: 'treasury', id: row.id, number: row.transactionNumber, date: String(row.date).slice(0, 10), status: row.method });
  const previousDocumentId = row.documentId ?? null;
  await releaseSourceAllocations(tx, { treasuryTransactionId: row.id });
  if (previousDocumentId !== null) {
    // the direct link to one document gives way to the parts, in the same transaction
    await tx.update(treasuryTransactions)
      .set({ documentId: null, version: (row.version ?? 1) + 1, updatedAt: sql`now()` })
      .where(eq(treasuryTransactions.id, row.id));
  }
  const partyName = (await resolveTreasuryPartyName(tx, row.partyType || 'other', row.partyId)) ?? row.partyName;
  await lockAndCheckAllocationTargets(tx, {
    direction, partyType: row.partyType || 'other', partyId: row.partyId ?? null, partyName, currency: row.currency || 'IRR',
  }, parts, keptAmounts(before, { documentId: previousDocumentId, amount: row.amount }));
  await insertAllocations(tx, { treasuryTransactionId: row.id }, parts, params.userId);

  const after = await sourceAllocationViews(tx, { kind: 'treasury', id: row.id, number: row.transactionNumber, date: String(row.date).slice(0, 10), status: row.method });
  const refs = await documentRefs(tx, [...after.map(a => a.documentId), ...(previousDocumentId ? [previousDocumentId] : [])]);
  const beforeText = previousDocumentId !== null
    ? `«${refs.get(previousDocumentId) ?? previousDocumentId}» ${formatPersianNumber(fin(row.amount).toNumber(), 4)}`
    : partsText(before, refs);
  await logActivity({
    tx,
    req: params.audit?.req,
    userFullName: params.audit?.userFullName,
    action: 'UPDATE',
    entity: 'treasury_transaction',
    entityId: String(row.id),
    description: `نشاندن تراکنش ${row.transactionNumber} روی سندها: از ${beforeText} به ${partsText(after, refs)}`,
    details: {
      before: { documentId: previousDocumentId, allocations: before.map(a => ({ documentId: a.documentId, amount: a.amount })) },
      after: { documentId: null, allocations: after.map(a => ({ documentId: a.documentId, amount: a.amount })) },
    },
  });
  return sourceSummary('treasury', row.id, row.amount, after, null);
}

async function replaceChequeAllocations(
  tx: DbExecutor,
  id: number,
  params: { allocations: readonly SettlementAllocationInput[]; userId?: number; audit?: TreasuryAuditActor },
): Promise<SourceAllocations> {
  validateLockOrder([
    { name: 'cheque', hierarchyLevel: LockHierarchyLevel.CHEQUES },
    { name: 'document', hierarchyLevel: LockHierarchyLevel.DOCUMENTS },
  ]);
  const [cheque] = await tx.select().from(cheques)
    .where(and(eq(cheques.id, id), eq(cheques.isDeleted, 0)))
    .for('update');
  if (!cheque) throw new NotFoundError('چک یافت نشد');
  if ((LAPSED_CHEQUE_STATUSES as readonly string[]).includes(cheque.status ?? '')) {
    throw notAllocatable(`چک «${cheque.chequeNumber}» برگشت خورده یا عودت شده است و روی سندی نمی‌نشیند.`);
  }
  const direction: AllocationDirection = cheque.type === 'paid' ? 'payment' : 'receipt';
  const partyType = cheque.partyType || (cheque.type === 'paid' ? 'supplier' : 'customer');
  assertAllocatableParty(direction, partyType);
  const parts = normalizeAllocations(params.allocations, cheque.amount.toString());

  const view = { kind: 'cheque' as const, id: cheque.id, number: cheque.chequeNumber, date: String(cheque.issueDate).slice(0, 10), status: cheque.status ?? '' };
  const before = await sourceAllocationViews(tx, view);
  await releaseSourceAllocations(tx, { chequeId: cheque.id });
  const partyName = (await resolveTreasuryPartyName(tx, partyType, cheque.partyId)) ?? cheque.partyName;
  await lockAndCheckAllocationTargets(tx, {
    direction, partyType, partyId: cheque.partyId ?? null, partyName, currency: cheque.currency || 'IRR',
  }, parts, keptAmounts(before, null));
  await insertAllocations(tx, { chequeId: cheque.id }, parts, params.userId);

  const after = await sourceAllocationViews(tx, view);
  const refs = await documentRefs(tx, after.map(a => a.documentId));
  await logActivity({
    tx,
    req: params.audit?.req,
    userFullName: params.audit?.userFullName,
    action: 'UPDATE',
    entity: 'cheque',
    entityId: String(cheque.id),
    description: `نشاندن چک ${cheque.chequeNumber} روی سندها: از ${partsText(before, refs)} به ${partsText(after, refs)}`,
    details: {
      before: { allocations: before.map(a => ({ documentId: a.documentId, amount: a.amount })) },
      after: { allocations: after.map(a => ({ documentId: a.documentId, amount: a.amount })) },
    },
  });
  return sourceSummary('cheque', cheque.id, cheque.amount, after, null);
}

async function documentRefs(tx: DbExecutor, ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx.select({ id: documents.id, refNumber: documents.refNumber }).from(documents).where(inArray(documents.id, unique));
  return new Map(rows.map(r => [r.id, String(r.refNumber ?? r.id)]));
}
