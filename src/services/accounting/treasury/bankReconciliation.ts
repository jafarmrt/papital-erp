import { orm } from '../../../db/drizzle.js';
import { cheques, treasuryTransactions } from '../../../db/schema.js';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { ReconcilableCheque } from '../../../lib/treasury/reconcilableCheque.js';
import type { Request } from 'express';
import { BusinessLogicError, ValidationError } from '../../../errors/customErrors.js';
import { logActivity } from '../../../lib/auditLogger.js';

export interface ReconcileParams {
  bankAccountId: number;
  txIds: number[];
  /** v10.0.252 (TD-971): چک‌های وصول‌شده همین حساب */
  chequeIds?: number[];
  batch: string;
  reconciled: boolean;
  req?: Request;
  userFullName?: string;
}

export interface ReconcileResult {
  success: boolean;
  updated: number;
  changedIds: number[];
  changedChequeIds: number[];
}

export type { ReconcilableCheque };

/** چرا یک شناسه در تطبیق صورت‌حساب این حساب پذیرفته نیست؛ null یعنی پذیرفته است */
function refusalReason(row: { bankAccountId: number | null; isDeleted: number | null; status: string | null } | undefined, bankAccountId: number): string | null {
  if (!row || row.isDeleted === 1) return 'پیدا نشد';
  if (row.bankAccountId !== bankAccountId) return 'متعلق به حساب دیگری است';
  if (row.status === 'voided') return 'باطل شده است';
  return null;
}

function chequeRefusalReason(row: { bankAccountId: number | null; isDeleted: number | null; status: string | null } | undefined, bankAccountId: number): string | null {
  if (!row || row.isDeleted === 1) return 'پیدا نشد';
  if (row.bankAccountId !== bankAccountId) return 'متعلق به حساب دیگری است';
  if (row.status !== 'passed') return 'وصول نشده است';
  return null;
}

/** تاریخ وصول چک: تاریخ آخرین گام «passed» تاریخچه، وگرنه سررسید */
function clearingDate(history: unknown, dueDate: string | null): string {
  const steps = Array.isArray(history) ? history as Array<{ status?: unknown; date?: unknown }> : [];
  const passed = [...steps].reverse().find(h => h?.status === 'passed' && typeof h.date === 'string' && h.date);
  return passed ? String(passed.date) : (dueDate || '');
}

/**
 * v10.0.252 (TD-971، OBS-R1-66): چک وصول‌شده در مانده خزانه حساب بانکی شمرده می‌شود (TD-276) و در صورت‌حساب بانک ردیف
 * دارد، پس در تطبیق صورت‌حساب نامزد است. پیش‌تر پنجره تطبیق فقط تراکنش خزانه را می‌خواند و ردیف چک همیشه مغایرت بود.
 */
export async function listReconcilableCheques(bankAccountId: number): Promise<ReconcilableCheque[]> {
  const rows = await orm.select({
    id: cheques.id,
    chequeNumber: cheques.chequeNumber,
    type: cheques.type,
    amount: cheques.amount,
    dueDate: cheques.dueDate,
    statusHistory: cheques.statusHistory,
    partyName: cheques.partyName,
    reconciled: cheques.reconciled,
  }).from(cheques)
    .where(and(eq(cheques.bankAccountId, bankAccountId), eq(cheques.status, 'passed'), eq(cheques.isDeleted, 0)))
    .orderBy(asc(cheques.id));
  return rows.map(r => ({
    id: r.id,
    chequeNumber: r.chequeNumber,
    type: r.type === 'paid' ? 'payment' : 'receipt',
    amount: r.amount.toNumber(),
    date: clearingDate(r.statusHistory, r.dueDate),
    partyName: r.partyName || '',
    reconciled: r.reconciled ?? 0,
  }));
}

/**
 * v9.0.103 (TD-511، B04-15): ثبت گروهی تطبیق صورت‌حساب بانک. شناسه‌ای که پیدا نشود، از حساب دیگری باشد یا باطل شده باشد
 * کل درخواست را با ۴۲۲ `TREASURY_RECONCILE_ROWS_INVALID` و فهرست شناسه‌ها رد می‌کند (پیش‌تر بی‌صدا کنار می‌رفت و ردیف
 * باطل‌شده تطبیق می‌خورد)؛ فقط ردیف‌هایی که وضعیتشان واقعاً عوض می‌شود نوشته و در ممیزی (با همین `tx`) ثبت می‌شوند؛
 * `reconciled_at` زمان UTC سرور است (نوع `isots`)، نه تاریخ کسب‌وکار.
 */
export async function reconcileTreasuryRows(params: ReconcileParams): Promise<ReconcileResult> {
  const ids = [...new Set(params.txIds)];
  const chequeIds = [...new Set(params.chequeIds ?? [])];
  if (ids.length === 0 && chequeIds.length === 0) return { success: true, updated: 0, changedIds: [], changedChequeIds: [] };

  return orm.transaction(async (tx) => {
    const rows = ids.length === 0 ? [] : await tx.select({
      id: treasuryTransactions.id,
      transactionNumber: treasuryTransactions.transactionNumber,
      bankAccountId: treasuryTransactions.bankAccountId,
      isDeleted: treasuryTransactions.isDeleted,
      status: treasuryTransactions.status,
      reconciled: treasuryTransactions.reconciled,
      reconciledAt: treasuryTransactions.reconciledAt,
      reconciledBatch: treasuryTransactions.reconciledBatch,
    }).from(treasuryTransactions)
      .where(inArray(treasuryTransactions.id, ids))
      .orderBy(asc(treasuryTransactions.id))
      .for('update');
    const chequeRows = chequeIds.length === 0 ? [] : await tx.select({
      id: cheques.id,
      transactionNumber: cheques.chequeNumber,
      bankAccountId: cheques.bankAccountId,
      isDeleted: cheques.isDeleted,
      status: cheques.status,
      reconciled: cheques.reconciled,
      reconciledAt: cheques.reconciledAt,
      reconciledBatch: cheques.reconciledBatch,
    }).from(cheques)
      .where(inArray(cheques.id, chequeIds))
      .orderBy(asc(cheques.id))
      .for('update');
    const byId = new Map(rows.map(r => [r.id, r]));
    const chequeById = new Map(chequeRows.map(r => [r.id, r]));

    const refused = [
      ...ids.map(id => ({ id, kind: 'treasury' as const, transactionNumber: byId.get(id)?.transactionNumber ?? null, reason: refusalReason(byId.get(id), params.bankAccountId) })),
      ...chequeIds.map(id => ({ id, kind: 'cheque' as const, transactionNumber: chequeById.get(id)?.transactionNumber ?? null, reason: chequeRefusalReason(chequeById.get(id), params.bankAccountId) })),
    ].filter((r): r is { id: number; kind: 'treasury' | 'cheque'; transactionNumber: string | null; reason: string } => r.reason !== null);
    if (refused.length > 0) {
      const list = refused.map(r => r.kind === 'cheque'
        ? `چک «${r.transactionNumber ?? `شناسه ${r.id}`}» ${r.reason}`
        : `«${r.transactionNumber ?? `شناسه ${r.id}`}» ${r.reason}`).join('، ');
      throw new ValidationError(`این تراکنش‌ها در تطبیق صورت‌حساب این حساب پذیرفته نیستند: ${list}.`, { refused }, 'TREASURY_RECONCILE_ROWS_INVALID');
    }

    // P2-05: گارد ممانعت از ثبت مجدد تراکنش‌های قبلاً تطبیق‌یافته در سرور
    if (params.reconciled) {
      const alreadyReconciledRow = [...rows, ...chequeRows].find(r => r.reconciled === 1);
      if (alreadyReconciledRow) {
        throw new BusinessLogicError(
          `تراکنش شماره «${alreadyReconciledRow.transactionNumber}» قبلاً در دسته «${alreadyReconciledRow.reconciledBatch || 'نامشخص'}» تطبیق داده شده است و امکان تطبیق مجدد ندارد.`
        );
      }
    }

    const changed = rows.filter(r => (r.reconciled === 1) !== params.reconciled);
    const changedCheques = chequeRows.filter(r => (r.reconciled === 1) !== params.reconciled);
    const reconciledAt = params.reconciled ? new Date().toISOString() : '';
    const batch = params.reconciled ? (params.batch || '') : '';
    const state = { reconciled: params.reconciled ? 1 : 0, reconciledAt, reconciledBatch: batch };
    for (const row of changed) {
      await tx.update(treasuryTransactions).set(state).where(eq(treasuryTransactions.id, row.id));
    }
    for (const row of changedCheques) {
      await tx.update(cheques).set(state).where(eq(cheques.id, row.id));
    }

    const changedCount = changed.length + changedCheques.length;
    if (changedCount > 0) {
      const snapshot = (list: typeof rows, after: boolean) => list.map(r => after
        ? { id: r.id, transactionNumber: r.transactionNumber, ...state }
        : { id: r.id, transactionNumber: r.transactionNumber, reconciled: r.reconciled ?? 0, reconciledAt: r.reconciledAt, reconciledBatch: r.reconciledBatch });
      await logActivity({
        tx,
        req: params.req,
        userFullName: params.userFullName,
        action: 'UPDATE',
        entity: 'treasury_reconciliation',
        entityId: String(params.bankAccountId),
        description: `${params.reconciled ? 'تطبیق' : 'لغو تطبیق'} ${changedCount} ردیف حساب بانکی شناسه ${params.bankAccountId}`,
        details: {
          bankAccountId: params.bankAccountId,
          batch: params.batch,
          reconciled: params.reconciled,
          changedIds: changed.map(r => r.id),
          changedChequeIds: changedCheques.map(r => r.id),
          before: snapshot(changed, false),
          after: snapshot(changed, true),
          chequesBefore: snapshot(changedCheques, false),
          chequesAfter: snapshot(changedCheques, true),
        },
      });
    }

    return { success: true, updated: changedCount, changedIds: changed.map(r => r.id), changedChequeIds: changedCheques.map(r => r.id) };
  });
}
