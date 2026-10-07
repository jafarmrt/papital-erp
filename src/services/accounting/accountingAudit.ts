import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';
import type { JournalVoucher } from '../../types/accounting.types.js';

/**
 * v9.0.290 (TD-555، B03-13، AGENTS §5): ممیزی ویرایش و حذف سند حسابداری و سرفصل حساب مقدار پیش و پس دارد. پیش‌تر
 * ویرایش سند فقط بدنه درخواست (`changes`) و حذف سند و سرفصل فقط شناسه را ثبت می‌کرد و مقدار پیشین بازسازی‌پذیر نبود.
 * ویرایش فقط بخش‌های تغییرکرده را ثبت می‌کند، حذف کل سند یا حساب را.
 */

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export interface VoucherAuditSnapshot {
  voucherNumber: string;
  manualVoucherNumber: string;
  date: string;
  voucherType: string;
  status: string;
  description: string;
  currency: string;
  totalDebit: string;
  totalCredit: string;
  version: string;
  rows: Array<{
    account: string;
    detailedType: string;
    detailedId: string;
    detailedName: string;
    debit: string;
    credit: string;
    currency: string;
    exchangeRate: string;
    description: string;
  }>;
}

export function voucherAuditSnapshot(v: JournalVoucher): VoucherAuditSnapshot {
  return {
    voucherNumber: text(v.voucherNumber),
    manualVoucherNumber: text(v.manualVoucherNumber),
    date: text(v.date),
    voucherType: text(v.voucherType),
    status: text(v.status),
    description: text(v.description),
    currency: text(v.currency),
    totalDebit: text(v.totalDebit),
    totalCredit: text(v.totalCredit),
    version: text(v.version),
    rows: (Array.isArray(v.items) ? v.items : []).map(item => ({
      account: text(item.accountCode ?? item.accountId),
      detailedType: text(item.detailedType),
      detailedId: text(item.detailedId),
      detailedName: text(item.detailedName),
      debit: text(item.debit),
      credit: text(item.credit),
      currency: text(item.currency),
      exchangeRate: text(item.exchangeRate),
      description: text(item.description),
    })),
  };
}

/** فقط بخش‌های تغییرکرده سند؛ ردیف‌ها یک بخش‌اند و با تغییر هر ردیف همه ردیف‌های پیش و پس ثبت می‌شوند */
export function voucherAuditChanges(before: JournalVoucher, after: JournalVoucher) {
  const b = voucherAuditSnapshot(before);
  const a = voucherAuditSnapshot(after);
  const changedBefore: Partial<VoucherAuditSnapshot> = {};
  const changedAfter: Partial<VoucherAuditSnapshot> = {};
  for (const key of Object.keys(b) as Array<keyof VoucherAuditSnapshot>) {
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      Object.assign(changedBefore, { [key]: b[key] });
      Object.assign(changedAfter, { [key]: a[key] });
    }
  }
  return { before: changedBefore, after: changedAfter };
}

const ACCOUNT_AUDITED_KEYS = ['code', 'name', 'level', 'parentId', 'accountType', 'nature', 'description', 'isSystem', 'isActive', 'isDeleted'] as const;
type AccountRow = typeof accounts.$inferSelect;
export type AccountAuditSnapshot = Partial<Record<typeof ACCOUNT_AUDITED_KEYS[number], string>>;

export function accountAuditSnapshot(row: Partial<AccountRow>): AccountAuditSnapshot {
  const out: AccountAuditSnapshot = {};
  for (const key of ACCOUNT_AUDITED_KEYS) out[key] = text(row[key]);
  return out;
}

export function accountAuditChanges(before: Partial<AccountRow>, after: Partial<AccountRow>) {
  const b = accountAuditSnapshot(before);
  const a = accountAuditSnapshot(after);
  const changedBefore: AccountAuditSnapshot = {};
  const changedAfter: AccountAuditSnapshot = {};
  for (const key of ACCOUNT_AUDITED_KEYS) {
    if (b[key] !== a[key]) {
      changedBefore[key] = b[key];
      changedAfter[key] = a[key];
    }
  }
  return { before: changedBefore, after: changedAfter };
}

/** ردیف حساب برای ممیزی (حذف‌شده هم خوانده می‌شود) */
export async function accountAuditRow(executor: DbExecutor, id: number): Promise<AccountRow | null> {
  const [row] = await executor.select().from(accounts).where(eq(accounts.id, id));
  return row ?? null;
}
