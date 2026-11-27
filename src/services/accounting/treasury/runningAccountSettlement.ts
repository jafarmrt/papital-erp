import { and, eq, isNotNull } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { settlementAllocations } from '../../../db/schema.js';
import { logActivity } from '../../../lib/auditLogger.js';
import { fin, type DecimalValue } from '../../../lib/financialDecimal.js';
import { money } from '../../../lib/money.js';

/**
 * v12 colleague and partner sales (V12_COLLEAGUE_SALES_START_PLAN.md, decision 3.1): the «تسویه از حساب جاری» of a sales
 * invoice whose party stands for a colleague or partner. It is the one part of the invoice with no treasury row and no
 * cheque (`running_account_personnel_id`), and its amount is what the invoice still owes after its final returns, so the
 * invoice's remaining is zero and it never stands in the receivables list; the colleague's running account carries the
 * debt. The documents package works the amount out and calls this in the transaction of the finalize, return or void that
 * changed it; the invoice is locked by that caller. A target of zero or less removes the part (soft delete).
 */
export async function writeRunningAccountSettlement(
  tx: DbExecutor,
  params: { documentId: number; personnelId: number; amount: DecimalValue; userId?: number | null; username: string; refNumber: string },
): Promise<void> {
  const [current] = await tx.select({ id: settlementAllocations.id, amount: settlementAllocations.amount, personnelId: settlementAllocations.runningAccountPersonnelId })
    .from(settlementAllocations)
    .where(and(eq(settlementAllocations.documentId, params.documentId), isNotNull(settlementAllocations.runningAccountPersonnelId), eq(settlementAllocations.isDeleted, 0)))
    .for('update');
  const target = fin(params.amount);
  const before = current ? { amount: fin(current.amount).toString(), personnelId: current.personnelId } : null;
  if (current && target.isPositive() && fin(current.amount).equals(target) && current.personnelId === params.personnelId) return;
  if (current) {
    await tx.update(settlementAllocations).set({ isDeleted: 1 }).where(eq(settlementAllocations.id, current.id));
  }
  if (target.isPositive()) {
    await tx.insert(settlementAllocations).values({
      documentId: params.documentId,
      runningAccountPersonnelId: params.personnelId,
      amount: money(target),
      createdById: params.userId ?? null,
    });
  }
  if (!current && !target.isPositive()) return;
  await logActivity({
    username: params.username,
    action: 'UPDATE',
    entity: 'تسویه از حساب جاری',
    entityId: String(params.documentId),
    description: target.isPositive()
      ? `تسویهٔ فاکتور ${params.refNumber} از حساب جاری همکار`
      : `برداشتن تسویهٔ فاکتور ${params.refNumber} از حساب جاری همکار`,
    details: { before, after: target.isPositive() ? { amount: target.toString(), personnelId: params.personnelId } : null },
    userId: params.userId ?? undefined,
    tx,
  });
}
