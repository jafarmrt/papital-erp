import type { DbExecutor } from '../../db/drizzle.js';
import type { pieceworkLogs, pieceworkPayrolls } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { payrollStatusLabel, workLogStatusLabel } from '../../lib/payroll/payrollStatusLabels.js';
import { isoToJalaliDate } from '../../utils.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v9.0.285 (TD-810، B12P-07): هر نوشتن کارکرد و فیش حقوقی یک ردیف ممیزی در همان تراکنش دارد، با `req` (کاربر و IP) و
 * `details` (قبل و بعد؛ در ویرایش فقط فیلدهای تغییرکرده) و وضعیت با برچسب فارسی. پیش‌تر ویرایش کارکرد ۴ × ۱۰۰٬۰۰۰ به
 * ۴۰ × ۵۰۰٬۰۰۰ و حذف کارکرد هیچ ردی نمی‌گذاشت، ثبت کارکرد یک ردیف «ثبت N ردیف» بی شناسه داشت و ردیف‌های فیش پس از commit،
 * بی جزئیات و بی IP و با کد وضعیت انگلیسی نوشته می‌شدند.
 */
export const WORK_LOG_AUDIT_ENTITY = 'کارکرد پرکیسی';
export const PAYROLL_AUDIT_ENTITY = 'فیش حقوقی';

export interface AuditActor {
  req?: unknown;
  userId?: number;
  username?: string;
}

type WorkLogRow = typeof pieceworkLogs.$inferSelect;
type PayrollRow = typeof pieceworkPayrolls.$inferSelect;
type Snapshot = Record<string, string | number | null>;

const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function workLogSnapshot(row: WorkLogRow): Snapshot {
  return {
    personnelId: row.personnelId,
    taskId: row.taskId,
    projectId: row.projectId ?? null,
    date: row.date,
    quantity: text(row.quantity),
    unitRate: text(row.unitRate),
    totalAmount: text(row.totalAmount),
    notes: row.notes ?? '',
    status: workLogStatusLabel(row.status),
    payrollId: row.payrollId ?? null,
  };
}

export function payrollSnapshot(row: PayrollRow): Snapshot {
  return {
    payrollNumber: row.payrollNumber,
    personnelId: row.personnelId,
    startDate: row.startDate,
    endDate: row.endDate,
    title: row.title,
    status: payrollStatusLabel(row.status),
    totalPieceworkAmount: text(row.totalPieceworkAmount),
    totalFixedAmount: text(row.totalFixedAmount),
    totalBonuses: text(row.totalBonuses),
    totalDeductions: text(row.totalDeductions),
    deductionsDescription: row.deductionsDescription ?? '',
    advanceDeduction: text(row.advanceDeduction),
    netPayable: text(row.netPayable),
    paidAmount: text(row.paidAmount),
    notes: row.notes ?? '',
  };
}

/** فقط فیلدهایی که عوض شدند، با مقدار قبل و بعد */
export function changedFields(before: Snapshot, after: Snapshot): { before: Snapshot; after: Snapshot; changes: Record<string, { before: unknown; after: unknown }> } {
  const b: Snapshot = {};
  const a: Snapshot = {};
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (String(before[key] ?? '') === String(after[key] ?? '')) continue;
    b[key] = before[key] ?? null;
    a[key] = after[key];
    changes[key] = { before: before[key] ?? null, after: after[key] };
  }
  return { before: b, after: a, changes };
}

function actorFields(actor: AuditActor) {
  const reqUser = (actor.req as { user?: { id?: number; username?: string } } | undefined)?.user;
  return { req: actor.req, userId: actor.userId ?? reqUser?.id, username: actor.username || reqUser?.username || undefined };
}

const amount = (v: unknown) => toPersianDigits(String(v ?? 0));
const day = (iso: string) => toPersianDigits(isoToJalaliDate(iso) || iso);

export async function auditWorkLogCreated(tx: DbExecutor, row: WorkLogRow, names: { personnel?: string; task?: string }, actor: AuditActor): Promise<void> {
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'CREATE',
    entity: WORK_LOG_AUDIT_ENTITY,
    entityId: row.id,
    description: `ثبت کارکرد «${names.task ?? `#${row.taskId}`}» برای ${names.personnel ?? `پرسنل #${row.personnelId}`} در ${day(row.date)}: ${amount(row.quantity)} × ${amount(row.unitRate)} = ${amount(row.totalAmount)}`,
    details: { after: workLogSnapshot(row) },
  });
}

export async function auditWorkLogUpdated(tx: DbExecutor, before: WorkLogRow, after: WorkLogRow, actor: AuditActor): Promise<void> {
  const diff = changedFields(workLogSnapshot(before), workLogSnapshot(after));
  if (Object.keys(diff.changes).length === 0) return;
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'UPDATE',
    entity: WORK_LOG_AUDIT_ENTITY,
    entityId: after.id,
    description: `ویرایش کارکرد شماره ${toPersianDigits(after.id)}: مبلغ ${amount(before.totalAmount)} → ${amount(after.totalAmount)}`,
    details: { personnelId: after.personnelId, ...diff },
  });
}

export async function auditWorkLogDeleted(tx: DbExecutor, row: WorkLogRow, actor: AuditActor): Promise<void> {
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'DELETE',
    entity: WORK_LOG_AUDIT_ENTITY,
    entityId: row.id,
    description: `حذف کارکرد شماره ${toPersianDigits(row.id)} (${amount(row.quantity)} × ${amount(row.unitRate)} = ${amount(row.totalAmount)}) در ${day(row.date)}`,
    details: { before: workLogSnapshot(row) },
  });
}

export async function auditPayrollIssued(
  tx: DbExecutor, row: PayrollRow, info: { personnelName: string; logIds: number[]; voucher: { id: number; voucherNumber: number } | null }, actor: AuditActor,
): Promise<void> {
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'CREATE',
    entity: PAYROLL_AUDIT_ENTITY,
    entityId: row.id,
    description: `صدور فیش حقوقی ${row.payrollNumber} برای ${info.personnelName} با خالص ${amount(row.netPayable)} (سند حسابداری: ${info.voucher ? toPersianDigits(info.voucher.voucherNumber) : 'بدون سند'})`,
    details: { after: payrollSnapshot(row), workLogIds: info.logIds, voucherId: info.voucher?.id ?? null, voucherNumber: info.voucher?.voucherNumber ?? null },
  });
}

export async function auditPayrollUpdated(
  tx: DbExecutor, before: PayrollRow, after: PayrollRow, voucher: { id: number; voucherNumber: number } | null, actor: AuditActor,
): Promise<void> {
  const diff = changedFields(payrollSnapshot(before), payrollSnapshot(after));
  if (Object.keys(diff.changes).length === 0) return;
  const statusChanged = before.status !== after.status;
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'UPDATE',
    entity: PAYROLL_AUDIT_ENTITY,
    entityId: after.id,
    description: statusChanged
      ? `تغییر وضعیت فیش حقوقی ${after.payrollNumber} از «${payrollStatusLabel(before.status)}» به «${payrollStatusLabel(after.status)}»`
      : `ویرایش یادداشت فیش حقوقی ${after.payrollNumber}`,
    details: { ...diff, voucherId: voucher?.id ?? null, voucherNumber: voucher?.voucherNumber ?? null },
  });
}

export async function auditPayrollDeleted(
  tx: DbExecutor, row: PayrollRow, info: { reason: string; voidedVoucherIds: number[]; freedLogIds: number[] }, actor: AuditActor,
): Promise<void> {
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'DELETE',
    entity: PAYROLL_AUDIT_ENTITY,
    entityId: row.id,
    description: `ابطال و حذف فیش حقوقی ${row.payrollNumber} با خالص ${amount(row.netPayable)}؛ ${toPersianDigits(info.freedLogIds.length)} کارکرد آزاد شد`,
    details: { before: payrollSnapshot(row), reason: info.reason, voidedVoucherIds: info.voidedVoucherIds, freedWorkLogIds: info.freedLogIds },
  });
}
