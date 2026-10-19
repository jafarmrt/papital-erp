import type { projectBomAllocations, transactions } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';

/**
 * OBS-R2-45 (TD-1322): the API shape of an allocation row, read by the paged list (`bomAllocationList.ts`) and the allocation
 * service. It sits in the inventory core so the list does not import the allocation service, which sits above it.
 */

export interface ProjectBomAllocationRecord {
  id: number;
  projectId: number;
  projectCode: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  quantity: number;
  unit: string;
  sourceTransactionId: number | null;
  sourceLocation: string;
  status: 'allocated' | 'consumed' | 'released';
  userId: number | null;
  username: string;
  notes: string;
  allocatedAt: string | null;
  consumedAt: string | null;
  releasedAt: string | null;
  /** v10.1.37 (N-01, TD-1283): the personnel who receives the materials and confirms them in the workshop cartable */
  recipientPersonnelId: number | null;
  /** v10.0.130 (TD-1210): بهای کاردکس خروج تخصیص به ریال (همان مبلغ سند ۱۴۰۲)؛ null وقتی حرکت منبع خروج نیست */
  cost?: number | null;
  transactionDetails?: {
    date: string;
    documentType: string;
    documentRef: string;
    quantity: number;
  } | null;
}

type AllocationRow = typeof projectBomAllocations.$inferSelect;
type TransactionRow = typeof transactions.$inferSelect;

/** ردیف تخصیص به شکل خروجی API؛ با ردیف کاردکس منبع اگر خوانده شده باشد */
export function toAllocationRecord(alloc: AllocationRow, tx?: TransactionRow | null): ProjectBomAllocationRecord {
  const record: ProjectBomAllocationRecord = {
    id: alloc.id,
    projectId: alloc.projectId,
    projectCode: alloc.projectCode,
    itemId: alloc.itemId,
    itemCode: alloc.itemCode,
    itemName: alloc.itemName,
    quantity: fin(alloc.quantity).toNumber(),
    unit: alloc.unit || 'عدد',
    sourceTransactionId: alloc.sourceTransactionId,
    sourceLocation: alloc.sourceLocation || 'main',
    status: (alloc.status || 'allocated') as ProjectBomAllocationRecord['status'],
    userId: alloc.userId,
    username: alloc.username || '',
    notes: alloc.notes || '',
    allocatedAt: alloc.allocatedAt,
    consumedAt: alloc.consumedAt,
    releasedAt: alloc.releasedAt,
    recipientPersonnelId: alloc.recipientPersonnelId ?? null,
  };
  if (tx === undefined) return record;
  return {
    ...record,
    cost: tx && tx.type === 'out' ? fin(tx.unitPrice ?? 0).multiply(tx.quantity ?? 0).toNumber() : null,
    transactionDetails: tx
      ? {
          date: tx.date || '',
          documentType: tx.documentType || '',
          documentRef: tx.documentRef || '',
          quantity: fin(tx.quantity).toNumber(),
        }
      : null,
  };
}
