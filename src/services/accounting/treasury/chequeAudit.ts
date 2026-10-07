import { journalVouchers, type cheques } from '../../../db/schema.js';
import { and, asc, eq } from 'drizzle-orm';
import type { Request } from 'express';
import type { DbExecutor } from '../../../db/drizzle.js';
import { logActivity } from '../../../lib/auditLogger.js';
import { chequeStatusLabel } from '../../../lib/treasury/chequeTransitions.js';

type ChequeRow = typeof cheques.$inferSelect;

/** کاربر درخواست برای ممیزی چک (درون همان تراکنش) */
export interface ChequeAuditActor {
  req?: Request;
  userFullName?: string;
}

/** شناسه سندهای فعال (حذف‌نشده) چک، با پیوند `source_cheque_id` */
export async function activeChequeVoucherIds(tx: DbExecutor, chequeId: number): Promise<number[]> {
  const rows = await tx.select({ id: journalVouchers.id }).from(journalVouchers)
    .where(and(eq(journalVouchers.sourceChequeId, chequeId), eq(journalVouchers.isDeleted, 0)))
    .orderBy(asc(journalVouchers.id));
  return rows.map(r => r.id);
}

function chequeState(row: Pick<ChequeRow, 'status' | 'bankAccountId'>) {
  return { status: row.status, statusLabel: chequeStatusLabel(row.status), bankAccountId: row.bankAccountId ?? null };
}

/**
 * v9.0.104 (TD-512، B04-16): ممیزی تغییر وضعیت چک با قبل و بعد (وضعیت و برچسب فارسی آن، حساب بانکی) و سندهایی که همین
 * تغییر صادر کرد. پیش‌تر فقط `{"status":"in_collection"}` با شرح «… به in_collection» ثبت می‌شد.
 */
export async function auditChequeStatusChange(tx: DbExecutor, actor: ChequeAuditActor | undefined, before: ChequeRow, after: ChequeRow, issuedVoucherIds: number[]): Promise<void> {
  await logActivity({
    tx,
    req: actor?.req,
    userFullName: actor?.userFullName,
    action: 'UPDATE',
    entity: 'cheque',
    entityId: String(before.id),
    description: `تغییر وضعیت چک شماره ${before.chequeNumber} از «${chequeStatusLabel(before.status)}» به «${chequeStatusLabel(after.status)}»`,
    details: {
      chequeNumber: before.chequeNumber,
      amount: before.amount.toNumber(),
      before: chequeState(before),
      after: chequeState(after),
      issuedVoucherIds,
    },
  });
}

/**
 * v9.0.104 (TD-512، B04-16): ممیزی حذف چک با وضعیت، حساب بانکی و مبلغ پیش از حذف و سندهایی که حذف کرد (پیش‌نویس) یا با
 * سند معکوس باطل کرد. پیش‌تر فقط `{"chequeId":6}` ثبت می‌شد.
 */
export async function auditChequeDelete(
  tx: DbExecutor,
  actor: ChequeAuditActor | undefined,
  before: ChequeRow,
  voided: { deletedVoucherIds: number[]; reversedVoucherIds: number[]; reversalVoucherIds: number[] },
): Promise<void> {
  await logActivity({
    tx,
    req: actor?.req,
    userFullName: actor?.userFullName,
    action: 'DELETE',
    entity: 'cheque',
    entityId: String(before.id),
    description: `حذف چک شماره ${before.chequeNumber} در وضعیت «${chequeStatusLabel(before.status)}»`,
    details: {
      chequeNumber: before.chequeNumber,
      amount: before.amount.toNumber(),
      before: { ...chequeState(before), isDeleted: 0 },
      after: { ...chequeState(before), isDeleted: 1 },
      ...voided,
    },
  });
}
