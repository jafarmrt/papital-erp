import type { DbExecutor } from '../../../db/drizzle.js';
import { logActivity } from '../../../lib/auditLogger.js';
import type { ChequeAuditActor } from './chequeAudit.js';

/** کاربر درخواست برای ممیزی خزانه (درون همان تراکنش)؛ همان شکل ممیزی چک */
export type TreasuryAuditActor = ChequeAuditActor;

const faAmount = (amount: unknown): string => Number(amount ?? 0).toLocaleString('fa-IR');

/**
 * v10.0.260 (TD-934، OBS-R1-63): ممیزی ثبت‌های خزانه با `tx` همان ثبت نوشته می‌شود؛ پیش‌تر هشت روت خزانه پس از commit و
 * بیرون از تراکنش ممیزی می‌نوشتند، پس خطای درج ممیزی ثبت را بی ردپا می‌گذاشت (TD-324). شرح‌ها و نام موجودیت‌ها همان پیشین‌اند.
 */
export async function auditTreasuryTransactionCreated(
  tx: DbExecutor,
  actor: TreasuryAuditActor | undefined,
  row: { id: number; type: string; transactionNumber: string; amount: number },
  after: Record<string, unknown>,
): Promise<void> {
  await logActivity({
    tx,
    req: actor?.req,
    userFullName: actor?.userFullName,
    action: 'CREATE',
    entity: 'treasury_transaction',
    entityId: String(row.id),
    description: `ثبت ${row.type === 'receipt' ? 'دریافت' : 'پرداخت'} شماره ${row.transactionNumber} به مبلغ ${faAmount(row.amount)}`,
    details: { before: null, after },
  });
}

export async function auditTreasuryTransactionVoided(
  tx: DbExecutor,
  actor: TreasuryAuditActor | undefined,
  voided: { id: number; transactionNumber: string; status: string | null },
  reversal: { id: number; transactionNumber: string; voucherId: number | null },
  reason: string,
): Promise<void> {
  await logActivity({
    tx,
    req: actor?.req,
    userFullName: actor?.userFullName,
    action: 'UPDATE',
    entity: 'treasury_transaction',
    entityId: String(voided.id),
    description: `ابطال تراکنش شناسه ${voided.id} با سند معکوس ${reversal.transactionNumber} — دلیل: ${reason}`,
    details: {
      voidedTxId: voided.id,
      reversalTxId: reversal.id,
      reversalVoucherId: reversal.voucherId,
      reason,
      before: { status: voided.status },
      after: { status: 'voided' },
    },
  });
}

export async function auditTreasuryTransfer(
  tx: DbExecutor,
  actor: TreasuryAuditActor | undefined,
  transfer: { paymentId: number; receiptId: number; voucherId: number | null; amount: number; fromBankAccountId: number; toBankAccountId: number },
): Promise<void> {
  await logActivity({
    tx,
    req: actor?.req,
    userFullName: actor?.userFullName,
    action: 'CREATE',
    entity: 'treasury_transfer',
    entityId: `${transfer.paymentId}/${transfer.receiptId}`,
    description: `انتقال وجه ${faAmount(transfer.amount)} بین حساب‌ها (سند ${transfer.voucherId || 'بدون سند'})`,
    details: transfer,
  });
}

export async function auditChequeCreated(
  tx: DbExecutor,
  actor: TreasuryAuditActor | undefined,
  cheque: { id: number; type: string; chequeNumber: string; amount: number },
  after: Record<string, unknown>,
): Promise<void> {
  await logActivity({
    tx,
    req: actor?.req,
    userFullName: actor?.userFullName,
    action: 'CREATE',
    entity: 'cheque',
    entityId: String(cheque.id),
    description: `ثبت چک ${cheque.type === 'received' ? 'دریافتی' : 'پرداختی'} شماره ${cheque.chequeNumber} (مبلغ: ${faAmount(cheque.amount)})`,
    details: { before: null, after },
  });
}

export async function auditBankAccountChange(
  tx: DbExecutor,
  actor: TreasuryAuditActor | undefined,
  action: 'CREATE' | 'UPDATE' | 'DELETE',
  id: number,
  title: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  const verb = action === 'CREATE' ? 'تعریف حساب بانکی/صندوق جدید' : action === 'UPDATE' ? 'ویرایش حساب بانکی/صندوق' : 'حذف حساب بانکی/صندوق';
  await logActivity({
    tx,
    req: actor?.req,
    userFullName: actor?.userFullName,
    action,
    entity: 'bank_account',
    entityId: String(id),
    description: `${verb}: ${title}`,
    details: { before, after },
  });
}

export async function auditBankBalanceSync(
  tx: DbExecutor,
  actor: TreasuryAuditActor | undefined,
  report: { syncedCount: number; discrepantCount: number },
): Promise<void> {
  await logActivity({
    tx,
    req: actor?.req,
    userFullName: actor?.userFullName,
    action: 'UPDATE',
    entity: 'bank_reconciliation',
    entityId: 'sync',
    description: `همگام‌سازی مانده حساب‌های بانکی از تراکنش‌ها (${report.syncedCount} حساب هم‌خوان با دفتر کل، ${report.discrepantCount} اختلاف)`,
    details: { report },
  });
}
