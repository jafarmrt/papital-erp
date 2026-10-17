import type { DbExecutor } from '../../db/drizzle.js';
import type { pieceworkLogs, pieceworkPayrolls, pieceworkTasks } from '../../db/schema.js';
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
export const PAYROLL_PAYMENT_AUDIT_ENTITY = 'پرداخت حقوق';
export const TASK_AUDIT_ENTITY = 'عنوان پرکیسی';
export const TASKS_AUDIT_ENTITY = 'عناوین پرکیسی';

export interface AuditActor {
  req?: unknown;
  userId?: number;
  username?: string;
}

type WorkLogRow = typeof pieceworkLogs.$inferSelect;
type PayrollRow = typeof pieceworkPayrolls.$inferSelect;
type TaskRow = typeof pieceworkTasks.$inferSelect;
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
    // v10.0.199 (TD-1085): فیش پیش‌پرداخت و دلیلش در ممیزی
    isPrepayment: row.isPrepayment ?? 0,
    prepaymentReason: row.prepaymentReason ?? '',
    // v10.0.210 (TD-1087): کسورات قانونی و شرح تغییر مبلغ پیشنهادی
    employeeInsurance: text(row.employeeInsurance),
    employerInsurance: text(row.employerInsurance),
    incomeTax: text(row.incomeTax),
    statutoryOverrideReason: row.statutoryOverrideReason ?? '',
    // v10.0.222 (TD-1089): سهم عیدی فیش، یا عیدی فیش عیدی و بخش انباشته آن
    eidiAmount: text(row.eidiAmount),
    eidiFromAccrual: text(row.eidiFromAccrual),
    eidiYear: row.eidiYear ?? null,
    isEidi: row.isEidi ?? 0,
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

export function actorFields(actor: AuditActor) {
  const reqUser = (actor.req as { user?: { id?: number; username?: string } } | undefined)?.user;
  return { req: actor.req, userId: actor.userId ?? reqUser?.id, username: actor.username || reqUser?.username || undefined };
}

const amount = (v: unknown) => toPersianDigits(String(v ?? 0));
const day = (iso: string) => toPersianDigits(isoToJalaliDate(iso) || iso);

function taskSnapshot(row: TaskRow): Snapshot {
  return {
    code: row.code,
    title: row.title,
    category: row.category ?? '',
    defaultRate: text(row.defaultRate),
    unit: row.unit ?? '',
    description: row.description ?? '',
    isActive: row.isActive ?? 1,
  };
}

/**
 * Closing sweep (#294 review): a task's create, delete and restore, the clear-all and the Excel import write their audit
 * row with their own `tx`, so a refused audit row refuses the change (the route wrote them after commit).
 */
export async function auditTaskCreated(tx: DbExecutor, row: TaskRow, actor: AuditActor): Promise<void> {
  await logActivity({
    tx, ...actorFields(actor), action: 'CREATE', entity: TASK_AUDIT_ENTITY, entityId: row.id,
    description: `تعریف عنوان کاری کارمزدی جدید «${row.title}» با کد «${row.code}»`,
    details: { after: taskSnapshot(row) },
  });
}

export async function auditTaskDeleted(tx: DbExecutor, row: TaskRow, actor: AuditActor): Promise<void> {
  await logActivity({
    tx, ...actorFields(actor), action: 'DELETE', entity: TASK_AUDIT_ENTITY, entityId: row.id,
    description: `حذف عنوان کاری کارمزدی «${row.title}»`,
    details: { before: taskSnapshot(row) },
  });
}

export async function auditTaskRestored(tx: DbExecutor, row: TaskRow, actor: AuditActor): Promise<void> {
  await logActivity({
    tx, ...actorFields(actor), action: 'UPDATE', entity: TASK_AUDIT_ENTITY, entityId: row.id,
    description: `بازیابی عنوان کاری کارمزدی «${row.title}» از بایگانی`,
    details: { after: taskSnapshot({ ...row, isDeleted: 0, isActive: 1 }) },
  });
}

export async function auditTasksCleared(tx: DbExecutor, taskIds: number[], actor: AuditActor): Promise<void> {
  await logActivity({
    tx, ...actorFields(actor), action: 'DELETE', entity: TASKS_AUDIT_ENTITY,
    description: `پاکسازی کلی عناوین کاری کارمزدی (${toPersianDigits(taskIds.length)} مورد حذف شدند)`,
    details: { taskIds },
  });
}

export async function auditTasksImported(tx: DbExecutor, counts: { createdCount: number; updatedCount: number; mode: string }, actor: AuditActor): Promise<void> {
  await logActivity({
    tx, ...actorFields(actor), action: 'IMPORT', entity: TASKS_AUDIT_ENTITY,
    description: `ورود اکسل عناوین کاری کارمزدی (${toPersianDigits(counts.createdCount)} عنوان جدید، ${toPersianDigits(counts.updatedCount)} عنوان ویرایش‌شده، شیوه: ${counts.mode})`,
    details: counts,
  });
}

/** OBS-R2-50: the task edit's audit row, written with the edit's `tx` and only the fields that changed */
export async function auditTaskUpdated(tx: DbExecutor, before: TaskRow, after: TaskRow, actor: AuditActor): Promise<void> {
  const codeChange = after.code !== before.code ? ` (کد «${before.code}» به «${after.code}»)` : '';
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'UPDATE',
    entity: TASK_AUDIT_ENTITY,
    entityId: after.id,
    description: `ویرایش عنوان کاری کارمزدی «${before.title}»${codeChange}`,
    details: changedFields(taskSnapshot(before), taskSnapshot(after)),
  });
}

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
  tx: DbExecutor, row: PayrollRow,
  info: { personnelName: string; logIds: number[]; voucher: { id: number; voucherNumber: number } | null; statutory?: Record<string, unknown>; eidi?: Record<string, unknown> },
  actor: AuditActor,
): Promise<void> {
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'CREATE',
    entity: PAYROLL_AUDIT_ENTITY,
    entityId: row.id,
    description: `صدور ${row.isEidi === 1 ? `فیش عیدی ${row.payrollNumber} (سال ${toPersianDigits(row.eidiYear ?? '')})` : row.isPrepayment === 1 ? `فیش پیش‌پرداخت ${row.payrollNumber} (دلیل: ${row.prepaymentReason})` : `فیش حقوقی ${row.payrollNumber}`} برای ${info.personnelName} با خالص ${amount(row.netPayable)} (سند حسابداری: ${info.voucher ? toPersianDigits(info.voucher.voucherNumber) : 'بدون سند'})`,
    details: {
      after: payrollSnapshot(row), workLogIds: info.logIds, voucherId: info.voucher?.id ?? null, voucherNumber: info.voucher?.voucherNumber ?? null,
      ...(info.statutory ? { statutory: info.statutory } : {}),
      ...(info.eidi ? { eidi: info.eidi } : {}),
    },
  });
}

export async function auditPayrollUpdated(
  tx: DbExecutor, before: PayrollRow, after: PayrollRow, voucher: { id: number; voucherNumber: number } | null, actor: AuditActor,
  statutory?: Record<string, unknown>,
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
      : Object.keys(diff.changes).every(key => key === 'notes')
        ? `ویرایش یادداشت فیش حقوقی ${after.payrollNumber}`
        // v10.0.200 (TD-1242): ویرایش مبلغ‌های فیش پیش‌نویس و سند دوباره‌ساخته
        : `ویرایش فیش پیش‌نویس ${after.payrollNumber} با خالص ${amount(after.netPayable)}`,
    details: { ...diff, voucherId: voucher?.id ?? null, voucherNumber: voucher?.voucherNumber ?? null, ...(statutory ? { statutory } : {}) },
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

/**
 * v10.0.259 (TD-950، P5-W06): پرداخت فیش و ابطال آن ممیزی خود را در تراکنش پرداخت می‌نویسند، با کاربر و IP (`req`)، مبلغ
 * و پرداخت‌شده فیش پیش و پس از آن. پیش‌تر مسیر پس از commit، بی `tx` و `req` و مبلغ می‌نوشت.
 */
export async function auditPayrollPaymentRegistered(
  tx: DbExecutor, row: PayrollRow,
  info: { transactionId: number; transactionNumber: string; amount: string; paidBefore: string; voucherId: number | null; voucherNumber: number | string | null },
  actor: AuditActor,
): Promise<void> {
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'CREATE',
    entity: PAYROLL_PAYMENT_AUDIT_ENTITY,
    entityId: row.id,
    description: `ثبت پرداخت ${amount(info.amount)} برای فیش ${row.payrollNumber} با تراکنش ${info.transactionNumber} (سند تسویه: ${info.voucherNumber !== null ? toPersianDigits(info.voucherNumber) : '—'})`,
    details: {
      payrollId: row.id, transactionId: info.transactionId, transactionNumber: info.transactionNumber, amount: info.amount,
      voucherId: info.voucherId, voucherNumber: info.voucherNumber,
      before: { paidAmount: info.paidBefore }, after: { paidAmount: text(row.paidAmount), status: payrollStatusLabel(row.status) },
    },
  });
}

export async function auditPayrollPaymentVoided(
  tx: DbExecutor, row: PayrollRow,
  info: { transactionId: number; transactionNumber: string; reversalTransactionNumber: string; amount: string; reason: string; reversalVoucherId: number | null; paidBefore: string },
  actor: AuditActor,
): Promise<void> {
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'DELETE',
    entity: PAYROLL_PAYMENT_AUDIT_ENTITY,
    entityId: row.id,
    description: `ابطال پرداخت ${amount(info.amount)} (${info.transactionNumber}) فیش ${row.payrollNumber} با تراکنش معکوس ${info.reversalTransactionNumber}`,
    details: {
      payrollId: row.id, transactionId: info.transactionId, transactionNumber: info.transactionNumber, amount: info.amount, reason: info.reason,
      reversalTransactionNumber: info.reversalTransactionNumber, reversalVoucherId: info.reversalVoucherId,
      before: { paidAmount: info.paidBefore }, after: { paidAmount: text(row.paidAmount), status: payrollStatusLabel(row.status) },
    },
  });
}
