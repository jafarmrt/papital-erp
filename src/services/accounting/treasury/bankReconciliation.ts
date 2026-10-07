import { orm } from '../../../db/drizzle.js';
import { treasuryTransactions } from '../../../db/schema.js';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Request } from 'express';
import { BusinessLogicError, ValidationError } from '../../../errors/customErrors.js';
import { logActivity } from '../../../lib/auditLogger.js';

export interface ReconcileParams {
  bankAccountId: number;
  txIds: number[];
  batch: string;
  reconciled: boolean;
  req?: Request;
  userFullName?: string;
}

export interface ReconcileResult {
  success: boolean;
  updated: number;
  changedIds: number[];
}

/** چرا یک شناسه در تطبیق صورت‌حساب این حساب پذیرفته نیست؛ null یعنی پذیرفته است */
function refusalReason(row: { bankAccountId: number | null; isDeleted: number | null; status: string | null } | undefined, bankAccountId: number): string | null {
  if (!row || row.isDeleted === 1) return 'پیدا نشد';
  if (row.bankAccountId !== bankAccountId) return 'متعلق به حساب دیگری است';
  if (row.status === 'voided') return 'باطل شده است';
  return null;
}

/**
 * v9.0.103 (TD-511، B04-15): ثبت گروهی تطبیق صورت‌حساب بانک. شناسه‌ای که پیدا نشود، از حساب دیگری باشد یا باطل شده باشد
 * کل درخواست را با ۴۲۲ `TREASURY_RECONCILE_ROWS_INVALID` و فهرست شناسه‌ها رد می‌کند (پیش‌تر بی‌صدا کنار می‌رفت و ردیف
 * باطل‌شده تطبیق می‌خورد)؛ فقط ردیف‌هایی که وضعیتشان واقعاً عوض می‌شود نوشته و در ممیزی (با همین `tx`) ثبت می‌شوند؛
 * `reconciled_at` زمان UTC سرور است (نوع `isots`)، نه تاریخ کسب‌وکار.
 */
export async function reconcileTreasuryRows(params: ReconcileParams): Promise<ReconcileResult> {
  const ids = [...new Set(params.txIds)];
  if (ids.length === 0) return { success: true, updated: 0, changedIds: [] };

  return orm.transaction(async (tx) => {
    const rows = await tx.select({
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
    const byId = new Map(rows.map(r => [r.id, r]));

    const refused = ids
      .map(id => ({ id, row: byId.get(id) }))
      .map(({ id, row }) => ({ id, transactionNumber: row?.transactionNumber ?? null, reason: refusalReason(row, params.bankAccountId) }))
      .filter((r): r is { id: number; transactionNumber: string | null; reason: string } => r.reason !== null);
    if (refused.length > 0) {
      const list = refused.map(r => `«${r.transactionNumber ?? `شناسه ${r.id}`}» ${r.reason}`).join('، ');
      throw new ValidationError(`این تراکنش‌ها در تطبیق صورت‌حساب این حساب پذیرفته نیستند: ${list}.`, { refused }, 'TREASURY_RECONCILE_ROWS_INVALID');
    }

    // P2-05: گارد ممانعت از ثبت مجدد تراکنش‌های قبلاً تطبیق‌یافته در سرور
    if (params.reconciled) {
      const alreadyReconciledRow = rows.find(r => r.reconciled === 1);
      if (alreadyReconciledRow) {
        throw new BusinessLogicError(
          `تراکنش شماره «${alreadyReconciledRow.transactionNumber}» قبلاً در دسته «${alreadyReconciledRow.reconciledBatch || 'نامشخص'}» تطبیق داده شده است و امکان تطبیق مجدد ندارد.`
        );
      }
    }

    const changed = rows.filter(r => (r.reconciled === 1) !== params.reconciled);
    const reconciledAt = params.reconciled ? new Date().toISOString() : '';
    const batch = params.reconciled ? (params.batch || '') : '';
    for (const row of changed) {
      await tx.update(treasuryTransactions).set({
        reconciled: params.reconciled ? 1 : 0,
        reconciledAt,
        reconciledBatch: batch,
      }).where(eq(treasuryTransactions.id, row.id));
    }

    if (changed.length > 0) {
      await logActivity({
        tx,
        req: params.req,
        userFullName: params.userFullName,
        action: 'UPDATE',
        entity: 'treasury_reconciliation',
        entityId: String(params.bankAccountId),
        description: `${params.reconciled ? 'تطبیق' : 'لغو تطبیق'} ${changed.length} تراکنش حساب بانکی شناسه ${params.bankAccountId}`,
        details: {
          bankAccountId: params.bankAccountId,
          batch: params.batch,
          reconciled: params.reconciled,
          changedIds: changed.map(r => r.id),
          before: changed.map(r => ({ id: r.id, transactionNumber: r.transactionNumber, reconciled: r.reconciled ?? 0, reconciledAt: r.reconciledAt, reconciledBatch: r.reconciledBatch })),
          after: changed.map(r => ({ id: r.id, transactionNumber: r.transactionNumber, reconciled: params.reconciled ? 1 : 0, reconciledAt, reconciledBatch: batch })),
        },
      });
    }

    return { success: true, updated: changed.length, changedIds: changed.map(r => r.id) };
  });
}
