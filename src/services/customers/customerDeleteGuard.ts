import { and, asc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { cheques, crmLeads, customers, documents, journalVoucherItems, journalVouchers, productionProjects } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import { formatPersianPrice, toPersianDigits } from '../../utils/persianNumber.js';
import { PARTY_DETAILED_TYPES, partyDetailedRowsCondition } from '../accounting/partyDetailedRows.js';
import { voucherItemCurrencySql } from '../accounting/voucherItemAmount.js';

/**
 * v9.0.10 (TD-431، تصمیم مالک محصول ت۴ الف): طرف حسابی که مانده یا کار باز دارد حذف نمی‌شود. پیش‌تر حذف نرم بی هیچ
 * بررسی انجام می‌شد: مانده او از انتخابگر گزارش‌ها می‌افتاد و سند بعدی به همان نام ردیف بی تفصیلی می‌ساخت (سند فروش
 * طرف حساب را با نام و `is_deleted = 0` پیدا می‌کند).
 */

/** وضعیت‌هایی از چک که هنوز گام بعدی دارند (`CHEQUE_TRANSITIONS`)؛ passed، returned و spent پایانی‌اند */
export const OPEN_CHEQUE_STATUSES = ['received', 'in_treasury', 'in_safe', 'in_collection', 'bounced'];
export const OPEN_DOCUMENT_STATUSES = ['draft', 'proforma'];
const CLOSED_PROJECT_STATUSES = ['completed', 'cancelled'];
const LISTED = 5;

type Party = typeof customers.$inferSelect;

export interface CustomerDeleteBlockers {
  /** مانده اسناد تأییدشده و دائم هر ارز (بدهکار − بستانکار، ارز خود ردیف) */
  balances: Array<{ currency: string; balance: string }>;
  draftVoucherNumbers: number[];
  openDocumentRefs: string[];
  activeLeadTitles: string[];
  openProjectCodes: string[];
  openChequeNumbers: string[];
}

export async function findCustomerDeleteBlockers(party: Party, db: DbExecutor): Promise<CustomerDeleteBlockers> {
  const name = (party.name ?? '').trim();
  const partyRows = partyDetailedRowsCondition({ id: party.id, legacyName: name });

  const balanceRows = await db.select({
    currency: voucherItemCurrencySql,
    balance: sql<string>`COALESCE(SUM(COALESCE(${journalVoucherItems.debit}, 0) - COALESCE(${journalVoucherItems.credit}, 0)), 0)::text`,
  })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .where(and(eq(journalVouchers.isDeleted, 0), eq(journalVoucherItems.isDeleted, 0), inArray(journalVouchers.status, ['approved', 'permanent']), partyRows))
    .groupBy(voucherItemCurrencySql);
  const balances = balanceRows
    .filter(r => fin(r.balance).abs().greaterThanOrEqual(VOUCHER_BALANCE_TOLERANCE))
    .map(r => ({ currency: String(r.currency), balance: fin(r.balance).toString() }));

  const draftVouchers = await db.selectDistinct({ voucherNumber: journalVouchers.voucherNumber })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .where(and(eq(journalVouchers.isDeleted, 0), eq(journalVoucherItems.isDeleted, 0), eq(journalVouchers.status, 'draft'), partyRows))
    .orderBy(asc(journalVouchers.voucherNumber));

  const openDocuments = name ? await db.select({ refNumber: documents.refNumber })
    .from(documents)
    .where(and(eq(documents.isDeleted, 0), inArray(documents.status, OPEN_DOCUMENT_STATUSES), sql`btrim(${documents.buyerName}) = ${name}::text`))
    .orderBy(asc(documents.id)) : [];

  const activeLeads = await db.select({ title: crmLeads.title })
    .from(crmLeads)
    .where(and(eq(crmLeads.customerId, party.id), eq(crmLeads.status, 'active'), eq(crmLeads.isDeleted, 0)))
    .orderBy(asc(crmLeads.id));

  const openProjects = await db.select({ projectCode: productionProjects.projectCode })
    .from(productionProjects)
    .where(and(
      eq(productionProjects.customerId, party.id), eq(productionProjects.isDeleted, 0),
      or(isNull(productionProjects.status), notInArray(productionProjects.status, CLOSED_PROJECT_STATUSES)),
    ))
    .orderBy(asc(productionProjects.id));

  const chequeOwner = name
    ? or(eq(cheques.partyId, party.id), and(isNull(cheques.partyId), sql`btrim(${cheques.partyName}) = ${name}::text`))
    : eq(cheques.partyId, party.id);
  const openCheques = await db.select({ chequeNumber: cheques.chequeNumber })
    .from(cheques)
    .where(and(eq(cheques.isDeleted, 0), inArray(cheques.status, OPEN_CHEQUE_STATUSES), inArray(cheques.partyType, PARTY_DETAILED_TYPES), chequeOwner))
    .orderBy(asc(cheques.id));

  return {
    balances,
    draftVoucherNumbers: draftVouchers.map(v => Number(v.voucherNumber)),
    openDocumentRefs: openDocuments.map(d => String(d.refNumber ?? '')),
    activeLeadTitles: activeLeads.map(l => l.title),
    openProjectCodes: openProjects.map(p => p.projectCode),
    openChequeNumbers: openCheques.map(c => c.chequeNumber),
  };
}

/** شماره‌ها و کدها همان‌گونه که ثبت شده‌اند می‌آیند؛ فقط شمار بقیه فارسی است */
function listed(values: Array<string | number>): string {
  const shown = values.slice(0, LISTED).map(String).join('، ');
  return values.length > LISTED ? `${shown} و ${toPersianDigits(values.length - LISTED)} مورد دیگر` : shown;
}

/** دلیل‌های فارسی رد حذف؛ آرایه خالی یعنی حذف آزاد است */
export function describeCustomerDeleteBlockers(b: CustomerDeleteBlockers): string[] {
  const reasons: string[] = [];
  if (b.balances.length > 0) {
    const amounts = b.balances.map(x => `${formatPersianPrice(fin(x.balance).abs().toString(), x.currency, 2)} ${fin(x.balance).isNegative() ? 'بستانکار' : 'بدهکار'}`);
    reasons.push(`مانده حساب ${amounts.join(' و ')}`);
  }
  if (b.draftVoucherNumbers.length > 0) reasons.push(`سند حسابداری پیش‌نویس شماره ${listed(b.draftVoucherNumbers)}`);
  if (b.openDocumentRefs.length > 0) reasons.push(`سند پیش‌نویس یا پیش‌فاکتور ${listed(b.openDocumentRefs)}`);
  if (b.activeLeadTitles.length > 0) reasons.push(`پرونده فروش فعال «${b.activeLeadTitles.slice(0, LISTED).join('»، «')}»`);
  if (b.openProjectCodes.length > 0) reasons.push(`پروژه باز ${listed(b.openProjectCodes)}`);
  if (b.openChequeNumbers.length > 0) reasons.push(`چک باز شماره ${listed(b.openChequeNumbers)}`);
  return reasons;
}

/** پیش از حذف نرم، زیر قفل ردیف طرف حساب صدا زده می‌شود */
export async function assertCustomerDeletable(party: Party, db: DbExecutor): Promise<void> {
  const blockers = await findCustomerDeleteBlockers(party, db);
  const reasons = describeCustomerDeleteBlockers(blockers);
  if (reasons.length === 0) return;
  throw new ConflictError(`طرف حساب «${party.name}» حذف نمی‌شود: ${reasons.join('؛ ')}. نخست این موارد را تسویه، نهایی یا بسته کنید.`, {
    code: 'CUSTOMER_HAS_OPEN_ITEMS',
    ...blockers,
  });
}
