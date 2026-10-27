import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { bankAccounts, customers, journalVoucherItems, personnel, productionProjects } from '../../db/schema.js';
import { ForbiddenError, ValidationError } from '../../errors/customErrors.js';
import {
  CONTROL_REASON_MAX, CONTROL_REASON_REQUIRED_MESSAGE, controlAccountLine, controlAccountRefusalMessage, controlVoucherChangeRefusalMessage,
  type ControlAccountEntry,
} from '../../lib/accounting/controlAccounts.js';
import {
  VOUCHER_DETAILED_TYPE_LABELS, voucherDetailedTypeFromStored, voucherPersonnelName, voucherProjectLabel,
} from '../../lib/accounting/voucherDetailedTypes.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { AccountMappingService } from './accountMapping.service.js';

export interface ManualVoucherRowDetail {
  accountId: number;
  detailedType?: string | null;
  detailedId?: number | null;
  detailedName?: string | null;
}

/** who writes a manual voucher on a control account: the permission and the reason the form sent */
export interface ControlAdjustment {
  /** `accounting.control_adjustment` (the system admin always holds it), checked by the route */
  mayAdjust: boolean;
  reason?: string | null;
}

const rowLabel = (index: number) => `ردیف ${toPersianDigits(String(index + 1))}`;

/**
 * v11 phase 6.1b (M3, decision ت۵۲-۲): a manual voucher row (and a replacement row of a correction) on a control account
 * (`controlAccountsById`) needs `accounting.control_adjustment` (403 `VOUCHER_CONTROL_ACCOUNT`, naming each account and
 * the book its entries come from) and a reason (422 `VOUCHER_CONTROL_REASON_REQUIRED`). The result is the reason to store
 * on the voucher, empty when no row is on a control account. Before, a user who could draft vouchers posted on a bank,
 * inventory, wages or insurance account and on a party's receivable, and the book of that account no longer matched the
 * ledger.
 */
export async function assertManualControlRows(
  tx: DbExecutor,
  rows: readonly ManualVoucherRowDetail[],
  adjustment: ControlAdjustment,
  /**
   * an edit's stored rows that the sent rows replace: taking a row off a control account needs the permission too, without
   * a reason, as a delete or a reversal does (`assertMayChangeControlVoucher`)
   */
  replaced: readonly Pick<ManualVoucherRowDetail, 'accountId'>[] = [],
): Promise<string> {
  const control = await AccountMappingService.controlAccountsById(tx);
  const hitsOf = (list: readonly Pick<ManualVoucherRowDetail, 'accountId'>[]) => {
    const hits = new Map<number, ControlAccountEntry>();
    for (const row of list) {
      const entry = control.get(Number(row.accountId));
      if (entry) hits.set(entry.id, entry);
    }
    return hits;
  };
  const hit = hitsOf(rows);
  const all = hitsOf([...rows, ...replaced]);
  if (all.size === 0) return '';
  if (!adjustment.mayAdjust) {
    throw new ForbiddenError(controlAccountRefusalMessage([...all.values()], toPersianDigits), { accounts: [...all.values()] }, 'VOUCHER_CONTROL_ACCOUNT');
  }
  if (hit.size === 0) return '';
  const lines = [...hit.values()].map(entry => controlAccountLine(entry, toPersianDigits));
  const reason = String(adjustment.reason ?? '').trim();
  if (!reason) {
    throw new ValidationError(`${CONTROL_REASON_REQUIRED_MESSAGE} حساب‌های کنترلی این سند: ${lines.join('؛ ')}.`, { accounts: [...hit.values()] }, 'VOUCHER_CONTROL_REASON_REQUIRED');
  }
  if (reason.length > CONTROL_REASON_MAX) {
    throw new ValidationError(`دلیل ثبت روی حساب کنترلی حداکثر ${toPersianDigits(String(CONTROL_REASON_MAX))} نویسه است.`, undefined, 'VOUCHER_CONTROL_REASON_TOO_LONG');
  }
  return reason;
}

/**
 * v11 phase 6.1b (M3, review of #407): taking an entry off a control account is the same adjustment as writing one. An edit
 * (rows or header), a delete, a reversal or a correction of a stored voucher with a live row on a control account needs
 * `accounting.control_adjustment` (403 `VOUCHER_CONTROL_ACCOUNT`, naming each account and its book); a new row's reason
 * stays with `assertManualControlRows`. This covers the automatic vouchers that carry no source link (item opening, WAC
 * correction, void residue, a stock adjustment without a document), which the voucher page handles as manual: before, a
 * user who may only draft vouchers deleted, edited, reversed or corrected them, and the inventory ledger left the Kardex.
 */
export async function assertMayChangeControlVoucher(tx: DbExecutor, voucherId: number, mayAdjust: boolean): Promise<void> {
  if (mayAdjust) return;
  const rows = await tx.select({ accountId: journalVoucherItems.accountId }).from(journalVoucherItems)
    .where(and(eq(journalVoucherItems.voucherId, voucherId), eq(journalVoucherItems.isDeleted, 0)));
  if (rows.length === 0) return;
  const control = await AccountMappingService.controlAccountsById(tx);
  const hit = new Map<number, ControlAccountEntry>();
  for (const row of rows) {
    const entry = control.get(Number(row.accountId));
    if (entry) hit.set(entry.id, entry);
  }
  if (hit.size === 0) return;
  throw new ForbiddenError(controlVoucherChangeRefusalMessage([...hit.values()], toPersianDigits), { accounts: [...hit.values()] }, 'VOUCHER_CONTROL_ACCOUNT');
}

/**
 * v11 phase 6.1b (M3, DEBT_LESSONS #8 «a party is its id and its type»): the detail of a manual voucher row names a live
 * record of its type, and the row stores that record's current name. A customer or supplier is a party of that kind (or
 * «both»), personnel a personnel record, a project a production project and a bank account a treasury account, none
 * deleted; each needs its id (picked from the list). «متفرقه» and «بدون تفصیلی» carry no id. Anything else is 422
 * `VOUCHER_DETAIL_INVALID` listing every bad row. Before, a row posted on customer 99999, a customer id typed as
 * personnel, or a name with no record, and party statements gained parties that do not exist.
 */
export async function resolveManualRowDetails<T extends ManualVoucherRowDetail>(tx: DbExecutor, rows: readonly T[]): Promise<T[]> {
  const idsOf = (types: readonly string[]) => [...new Set(rows
    .filter(r => types.includes(voucherDetailedTypeFromStored(r.detailedType)) && Number(r.detailedId) > 0)
    .map(r => Number(r.detailedId)))];
  const partyIds = idsOf(['customer', 'supplier']);
  const personIds = idsOf(['personnel']);
  const projectIds = idsOf(['project']);
  const bankIds = idsOf(['bank_account']);
  const parties = partyIds.length === 0 ? [] : await tx.select({ id: customers.id, name: customers.name, partyType: customers.partyType })
    .from(customers).where(and(inArray(customers.id, partyIds), eq(customers.isDeleted, 0))).for('key share');
  const people = personIds.length === 0 ? [] : await tx.select({
    id: personnel.id, fullName: personnel.fullName, firstName: personnel.firstName, lastName: personnel.lastName,
  }).from(personnel).where(and(inArray(personnel.id, personIds), eq(personnel.isDeleted, 0))).for('key share');
  const projects = projectIds.length === 0 ? [] : await tx.select({ id: productionProjects.id, title: productionProjects.title, projectCode: productionProjects.projectCode })
    .from(productionProjects).where(and(inArray(productionProjects.id, projectIds), eq(productionProjects.isDeleted, 0))).for('key share');
  const banks = bankIds.length === 0 ? [] : await tx.select({ id: bankAccounts.id, title: bankAccounts.title })
    .from(bankAccounts).where(and(inArray(bankAccounts.id, bankIds), eq(bankAccounts.isDeleted, 0))).for('key share');
  const partyById = new Map(parties.map(p => [p.id, p]));
  const personById = new Map(people.map(p => [p.id, p]));
  const projectById = new Map(projects.map(p => [p.id, p]));
  const bankById = new Map(banks.map(b => [b.id, b]));

  const problems: string[] = [];
  const resolved = rows.map((row, index) => {
    const type = voucherDetailedTypeFromStored(row.detailedType);
    const id = Number(row.detailedId) > 0 ? Number(row.detailedId) : null;
    const label = VOUCHER_DETAILED_TYPE_LABELS[type];
    // «بدون تفصیلی» keeps no name either; «متفرقه» keeps the name typed for it
    if (type === 'none') return { ...row, detailedType: type, detailedId: null, detailedName: '' };
    if (type === 'other') return { ...row, detailedType: type, detailedId: null };
    if (!id) {
      problems.push(`${rowLabel(index)}: ${label} از فهرست انتخاب نشده است`);
      return row;
    }
    const missing = () => problems.push(`${rowLabel(index)}: ${label} شماره ${toPersianDigits(String(id))} یافت نشد یا حذف شده است`);
    if (type === 'customer' || type === 'supplier') {
      const party = partyById.get(id);
      if (!party) { missing(); return row; }
      const kind = party.partyType || 'customer';
      if (kind !== type && kind !== 'both') {
        problems.push(`${rowLabel(index)}: «${party.name}» ${label} نیست`);
        return row;
      }
      return { ...row, detailedType: type, detailedId: id, detailedName: party.name };
    }
    if (type === 'personnel') {
      const person = personById.get(id);
      if (!person) { missing(); return row; }
      return { ...row, detailedType: type, detailedId: id, detailedName: voucherPersonnelName(person) };
    }
    if (type === 'project') {
      const project = projectById.get(id);
      if (!project) { missing(); return row; }
      return { ...row, detailedType: type, detailedId: id, detailedName: voucherProjectLabel(project) };
    }
    const bank = bankById.get(id);
    if (!bank) { missing(); return row; }
    return { ...row, detailedType: type, detailedId: id, detailedName: bank.title };
  });
  if (problems.length > 0) {
    throw new ValidationError(`تفصیلی این ردیف‌های سند درست نیست: ${problems.join('؛ ')}.`, { rows: problems }, 'VOUCHER_DETAIL_INVALID');
  }
  return resolved;
}
