import { eq, and, desc, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { pieceworkLogs, pieceworkPayrolls, pieceworkTasks, personnel, journalVouchers, treasuryTransactions, bankAccounts } from '../../db/schema.js';

/**
 * خواندن فیش‌های حقوقی پرکیسی (فهرست، فیش‌های کاربر جاری، جزئیات فیش و سابقه پرداخت‌ها).
 * ترتیب کلیدها در هر select همان ترتیب کلیدهای پاسخ JSON است؛ ستون‌ها به همین ترتیب کنار هم چیده شده‌اند.
 */

const payrollHeadColumns = {
  id: pieceworkPayrolls.id,
  payrollNumber: pieceworkPayrolls.payrollNumber,
  personnelId: pieceworkPayrolls.personnelId,
};

const payrollPersonnelColumns = {
  personnelName: personnel.fullName,
  personnelCode: personnel.personnelCode,
  jobTitle: personnel.jobTitle,
  cardNumber: personnel.cardNumber,
  shebaNumber: personnel.shebaNumber,
  bankName: personnel.bankName,
};

const payrollAmountColumns = {
  startDate: pieceworkPayrolls.startDate,
  endDate: pieceworkPayrolls.endDate,
  title: pieceworkPayrolls.title,
  totalPieceworkAmount: pieceworkPayrolls.totalPieceworkAmount,
  // V1.3.5: بدون این فیلد، ردیف حقوق ثابت در فیش چاپی نمایش داده نمی‌شد
  totalFixedAmount: pieceworkPayrolls.totalFixedAmount,
  advanceDeduction: pieceworkPayrolls.advanceDeduction,
  totalBonuses: pieceworkPayrolls.totalBonuses,
  totalDeductions: pieceworkPayrolls.totalDeductions,
  netPayable: pieceworkPayrolls.netPayable,
};

const payrollPaymentColumns = {
  status: pieceworkPayrolls.status,
  paymentDate: pieceworkPayrolls.paymentDate,
  paymentMethod: pieceworkPayrolls.paymentMethod,
  paymentReference: pieceworkPayrolls.paymentReference,
  notes: pieceworkPayrolls.notes,
  createdAt: pieceworkPayrolls.createdAt,
};

/** ستون‌های ریز کارکرد فیش (پس از id و payrollId). */
const payrollLogItemColumns = {
  date: pieceworkLogs.date,
  dateIso: pieceworkLogs.dateIso,
  taskId: pieceworkLogs.taskId,
  taskTitle: pieceworkTasks.title,
  taskCode: pieceworkTasks.code,
  taskCategory: pieceworkTasks.category,
  unit: pieceworkTasks.unit,
  quantity: pieceworkLogs.quantity,
  unitRate: pieceworkLogs.unitRate,
  totalAmount: pieceworkLogs.totalAmount,
  notes: pieceworkLogs.notes,
};

/** ریز کارکرد هر فیش در پاسخ /piecework/payrolls/mine (همان ستون‌های select زیر). */
export type PayrollLogItem = Pick<typeof pieceworkLogs.$inferSelect,
  'id' | 'payrollId' | 'date' | 'dateIso' | 'taskId' | 'quantity' | 'unitRate' | 'totalAmount' | 'notes'> & {
  taskTitle: typeof pieceworkTasks.$inferSelect['title'];
  taskCode: typeof pieceworkTasks.$inferSelect['code'];
  taskCategory: typeof pieceworkTasks.$inferSelect['category'];
  unit: typeof pieceworkTasks.$inferSelect['unit'];
};

export interface PayrollListFilters {
  personnelId?: unknown;
  status?: unknown;
}

export class PayrollReadService {
  /** فهرست فیش‌ها همراه با اطلاعات سند حسابداری متصل (بدون پنهان‌سازی اطلاعات حساس؛ آن در روت انجام می‌شود). */
  static async listPayrolls(filters: PayrollListFilters) {
    const { personnelId, status } = filters;

    let rows = await orm.select({
      ...payrollHeadColumns,
      ...payrollPersonnelColumns,
      ...payrollAmountColumns,
      paidAmount: pieceworkPayrolls.paidAmount,
      ...payrollPaymentColumns,
    })
    .from(pieceworkPayrolls)
    .innerJoin(personnel, eq(pieceworkPayrolls.personnelId, personnel.id))
    .where(eq(pieceworkPayrolls.isDeleted, 0))
    .orderBy(desc(pieceworkPayrolls.id));

    if (personnelId && String(personnelId) !== 'ALL') {
      const pId = Number(personnelId);
      rows = rows.filter(r => r.personnelId === pId);
    }

    if (status && String(status) !== 'ALL') {
      rows = rows.filter(r => r.status === String(status));
    }

    // Attach linked journal voucher info
    const payrollIds = rows.map(r => r.id);
    let linkedVouchers: Array<{
      id: number;
      voucherNumber: number;
      referenceId: number | null;
      status: string | null;
      date: string;
    }> = [];
    if (payrollIds.length > 0) {
      linkedVouchers = await orm.select({
        id: journalVouchers.id,
        voucherNumber: journalVouchers.voucherNumber,
        referenceId: journalVouchers.referenceId,
        status: journalVouchers.status,
        date: journalVouchers.date
      })
      .from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceModule, 'payroll'),
        eq(journalVouchers.isDeleted, 0)
      ));
    }

    const voucherMap = new Map<number, (typeof linkedVouchers)[number]>();
    for (const v of linkedVouchers) {
      if (v.referenceId) {
        voucherMap.set(Number(v.referenceId), v);
      }
    }

    return rows.map(r => ({ ...r, ...PayrollReadService.voucherLinkFields(voucherMap.get(r.id)) }));
  }

  /** فیش‌های پرسنلِ متصل به کاربر (personnel.userId → users.id) همراه با ریز کارکرد هر فیش. */
  static async listPayrollsForUser(uid: number) {
    const linkedPersonnel = await orm.select({ id: personnel.id })
      .from(personnel)
      .where(and(eq(personnel.userId, uid), eq(personnel.isDeleted, 0)));

    if (!linkedPersonnel.length) return [];

    const pIds = linkedPersonnel.map(p => p.id);
    const rows = await orm.select({
      ...payrollHeadColumns,
      ...payrollPersonnelColumns,
      ...payrollAmountColumns,
      ...payrollPaymentColumns,
    })
    .from(pieceworkPayrolls)
    .innerJoin(personnel, eq(pieceworkPayrolls.personnelId, personnel.id))
    .where(and(eq(pieceworkPayrolls.isDeleted, 0), inArray(pieceworkPayrolls.personnelId, pIds)))
    .orderBy(desc(pieceworkPayrolls.id));

    // ریز کارکردهای هر فیش — تا فیشی که پرسنل می‌بیند کاملاً با فیش صدورکننده یکسان باشد
    const payrollIds = rows.map(r => r.id);
    const itemsByPayroll = new Map<number, PayrollLogItem[]>();
    if (payrollIds.length > 0) {
      const logs = await orm.select({
        id: pieceworkLogs.id,
        payrollId: pieceworkLogs.payrollId,
        ...payrollLogItemColumns,
      })
      .from(pieceworkLogs)
      .innerJoin(pieceworkTasks, eq(pieceworkLogs.taskId, pieceworkTasks.id))
      .where(and(inArray(pieceworkLogs.payrollId, payrollIds), eq(pieceworkLogs.isDeleted, 0)))
      .orderBy(pieceworkLogs.date);
      for (const lg of logs) {
        const pid = Number(lg.payrollId);
        if (pid) {
          const arr = itemsByPayroll.get(pid) || [];
          arr.push(lg);
          itemsByPayroll.set(pid, arr);
        }
      }
    }

    return rows.map(r => ({ ...r, items: itemsByPayroll.get(r.id) || [] }));
  }

  /** یک فیش با ریز کارکرد و سند حسابداری متصل؛ null اگر فیش وجود نداشته باشد. */
  static async getPayrollDetail(id: number) {
    const [pay] = await orm.select({
      ...payrollHeadColumns,
      personnelUserId: personnel.userId,
      ...payrollPersonnelColumns,
      nobitexUsername: personnel.nobitexUsername,
      ...payrollAmountColumns,
      paidAmount: pieceworkPayrolls.paidAmount,
      ...payrollPaymentColumns,
    })
    .from(pieceworkPayrolls)
    .innerJoin(personnel, eq(pieceworkPayrolls.personnelId, personnel.id))
    .where(and(eq(pieceworkPayrolls.id, id), eq(pieceworkPayrolls.isDeleted, 0)));

    if (!pay) return null;

    // Get work log items attached to this payroll
    const items = await orm.select({
      id: pieceworkLogs.id,
      ...payrollLogItemColumns,
    })
    .from(pieceworkLogs)
    .innerJoin(pieceworkTasks, eq(pieceworkLogs.taskId, pieceworkTasks.id))
    .where(and(eq(pieceworkLogs.payrollId, id), eq(pieceworkLogs.isDeleted, 0)))
    .orderBy(pieceworkLogs.date);

    // Get linked journal voucher if available
    const [linkedVoucher] = await orm.select({
      id: journalVouchers.id,
      voucherNumber: journalVouchers.voucherNumber,
      status: journalVouchers.status,
      date: journalVouchers.date,
      totalDebit: journalVouchers.totalDebit
    })
    .from(journalVouchers)
    .where(and(
      eq(journalVouchers.referenceModule, 'payroll'),
      eq(journalVouchers.referenceId, id),
      eq(journalVouchers.isDeleted, 0)
    ))
    .limit(1);

    return { payroll: pay, items, voucherLink: PayrollReadService.voucherLinkFields(linkedVoucher) };
  }

  /** V4.0.33: سابقه اقساط و پرداخت‌های خزانه‌ای متصل به یک فیش. */
  static async listPayrollPayments(id: number) {
    return orm.select({
      id: treasuryTransactions.id,
      transactionNumber: treasuryTransactions.transactionNumber,
      date: treasuryTransactions.date,
      method: treasuryTransactions.method,
      amount: treasuryTransactions.amount,
      currency: treasuryTransactions.currency,
      bankAccountId: treasuryTransactions.bankAccountId,
      bankAccountTitle: bankAccounts.title,
      trackingNumber: treasuryTransactions.trackingNumber,
      voucherId: treasuryTransactions.voucherId,
      description: treasuryTransactions.description,
      status: treasuryTransactions.status,
      createdAt: treasuryTransactions.createdAt
    })
    .from(treasuryTransactions)
    .leftJoin(bankAccounts, eq(treasuryTransactions.bankAccountId, bankAccounts.id))
    .where(and(
      eq(treasuryTransactions.payrollId, id),
      eq(treasuryTransactions.type, 'payment'),
      eq(treasuryTransactions.isDeleted, 0)
    ))
    .orderBy(desc(treasuryTransactions.id));
  }

  /** فیلدهای سند متصل در پاسخ فهرست و جزئیات فیش. */
  private static voucherLinkFields(v: { id: number; voucherNumber: number; status: string | null } | undefined) {
    return {
      voucherId: v ? v.id : null,
      voucherNumber: v ? v.voucherNumber : null,
      voucherStatus: v ? v.status : null,
      isVoucherSynced: !!v
    };
  }
}
