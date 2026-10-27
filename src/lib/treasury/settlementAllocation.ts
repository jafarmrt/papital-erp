import { fin } from '../financialDecimal.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { canRelinkTreasuryRow } from './treasuryRelink.js';

/**
 * v11 phase 6.1t (M11 / U2, decision ت۵۲-۵): a receipt or payment of the treasury form, or a cheque, settles one or
 * more documents of its party in parts (`settlement_allocations`). One contract for the server and the forms.
 */

/** A cheque in one of these statuses came back to its drawer: its parts no longer settle anything */
export const LAPSED_CHEQUE_STATUSES = ['bounced', 'returned'] as const;

/** Most parts one receipt or cheque is split into */
export const MAX_SETTLEMENT_PARTS = 50;

/** One part as the forms send it */
export interface SettlementAllocationInput {
  documentId: number;
  amount: number;
}

/** One live part, as the document page and the allocation window read it */
export interface SettlementAllocationView {
  id: number;
  documentId: number;
  refNumber: string;
  amount: number;
  source: 'treasury' | 'cheque';
  sourceId: number;
  /** the treasury row's number, or the cheque's number */
  sourceNumber: string;
  /** ISO day of the treasury row, or the cheque's issue day */
  date: string;
  /** the treasury row's method, or the cheque's status */
  status: string;
}

/** A document of the party that still has something left to settle (`GET /accounting/settlement/open-documents`) */
export interface OpenSettlementDocument {
  id: number;
  refNumber: string;
  type: string;
  status: string;
  /** ISO day */
  date: string;
  currency: string;
  payable: number;
  settled: number;
  /** what is left after settlements and final returns, never below zero */
  remaining: number;
  /** what this receipt or cheque already puts on the document (the allocation window lists it again) */
  allocatedHere: number;
}

/** The parts of one receipt or cheque and what is left of it on account */
export interface SourceAllocations {
  source: 'treasury' | 'cheque';
  sourceId: number;
  amount: number;
  allocations: SettlementAllocationView[];
  unallocated: number;
}

/**
 * The default split: the oldest documents first (the list comes sorted by day, then id), each up to what is left on it,
 * until the amount runs out. What is left of the amount stays on account.
 */
export function fillOldestFirst(
  docs: ReadonlyArray<Pick<OpenSettlementDocument, 'id' | 'remaining' | 'allocatedHere'>>,
  amount: number,
): SettlementAllocationInput[] {
  let left = fin(amount);
  const parts: SettlementAllocationInput[] = [];
  for (const doc of docs) {
    if (!left.isPositive()) break;
    const room = fin(doc.remaining).add(doc.allocatedHere ?? 0);
    if (!room.isPositive()) continue;
    const part = left.greaterThan(room) ? room : left;
    parts.push({ documentId: doc.id, amount: part.toNumber() });
    left = left.subtract(part);
  }
  return parts;
}

/** How the forms split a receipt or cheque: the default, the user's own choice, or nothing (all on account) */
export type SettlementMode = 'oldest' | 'manual' | 'none';

/** The kinds of documents a receipt or payment settles, by the rule of a direct link */
export const SETTLEMENT_DOCUMENT_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  invoice: 'فاکتور فروش',
  proforma: 'پیش‌فاکتور',
  purchase: 'فاکتور خرید',
  receipt: 'رسید ورود',
});

/** What a document can still take from this receipt or cheque: its remaining plus what this one already puts on it */
export function settlementRoom(doc: Pick<OpenSettlementDocument, 'remaining' | 'allocatedHere'>): number {
  return fin(doc.remaining).add(doc.allocatedHere ?? 0).toNumber();
}

/** The parts the form sends in each mode; a manual part of a document no longer listed, or of zero, is dropped */
export function settlementPartsFor(
  mode: SettlementMode,
  docs: ReadonlyArray<Pick<OpenSettlementDocument, 'id' | 'remaining' | 'allocatedHere'>>,
  amount: number,
  manual: ReadonlyArray<SettlementAllocationInput>,
): SettlementAllocationInput[] {
  if (mode === 'none') return [];
  if (mode === 'oldest') return fillOldestFirst(docs, amount);
  const listed = new Set(docs.map(d => d.id));
  return manual.filter(p => listed.has(p.documentId) && fin(p.amount || 0).isPositive()).map(p => ({ ...p }));
}

/**
 * Why the form refuses these parts, or null: more than the amount in all, or more than a document can take. The server
 * checks the same, and each document's remaining again under its locks.
 */
export function settlementPartsProblem(
  parts: ReadonlyArray<SettlementAllocationInput>,
  amount: number,
  docs: ReadonlyArray<Pick<OpenSettlementDocument, 'id' | 'refNumber' | 'remaining' | 'allocatedHere'>>,
): string | null {
  if (parts.length > MAX_SETTLEMENT_PARTS) return `یک دریافت یا چک روی بیش از ${toPersianDigits(MAX_SETTLEMENT_PARTS)} سند نمی‌نشیند.`;
  if (fin(allocationTotal(parts)).greaterThan(amount || 0)) return 'جمع سهم سندها از مبلغ بیشتر است.';
  for (const part of parts) {
    const doc = docs.find(d => d.id === part.documentId);
    if (doc && fin(part.amount).greaterThan(settlementRoom(doc))) return `سهم سند «${toPersianDigits(doc.refNumber)}» از مانده آن بیشتر است.`;
  }
  return null;
}

/** The sum of the parts, exact */
export function allocationTotal(parts: ReadonlyArray<Pick<SettlementAllocationInput, 'amount'>>): number {
  return parts.reduce((sum, p) => sum.add(p.amount || 0), fin(0)).toNumber();
}

/**
 * Which receipt or cheque can be put on documents: a live receipt from a customer or payment to a supplier of the
 * treasury form (not a payslip or reversal; the rule of the move to another document), and a cheque received from a
 * customer or paid to a supplier that has not come back. The server checks the same rule under its locks.
 */
export const canAllocateTreasuryRow = canRelinkTreasuryRow;

export function canAllocateCheque(cheque: { type?: string | null; partyType?: string | null; status?: string | null }): boolean {
  if ((LAPSED_CHEQUE_STATUSES as readonly string[]).includes(String(cheque.status ?? ''))) return false;
  const partyType = cheque.partyType || (cheque.type === 'paid' ? 'supplier' : 'customer');
  return (cheque.type === 'received' && partyType === 'customer') || (cheque.type === 'paid' && partyType === 'supplier');
}
