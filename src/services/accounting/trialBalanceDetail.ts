import { inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { bankAccounts, customers, personnel, productionProjects } from '../../db/schema.js';
import { voucherProjectLabel } from '../../lib/accounting/voucherDetailedTypes.js';

/**
 * v10.0.85 (TD-1128): the detail of a level-4 trial balance row. A detail with an id (customer, supplier, personnel,
 * project, bank account) is one row per account, type and id, whatever name each voucher stored; a legacy party row
 * without an id keeps its exact name (TD-416), and so does a row without an id that a person typed on a manual voucher;
 * a row without an id of an automatic voucher (cheque labels, item opening, revenue labels) is the account's general
 * row, because its stored name is a description of that voucher and not a detail account.
 */
export const GENERAL_DETAIL_NAME = 'سایر / عمومی';

const ENTITY_DETAIL_TYPES = new Set(['customer', 'supplier', 'personnel', 'project', 'bank_account']);
const NAMED_LEGACY_TYPES = new Set(['customer', 'supplier', 'personnel']);

export interface DetailRef {
  detailedType: string;
  detailedId: number | null;
  /** the stored name of this row, the fallback when the entity has no current name */
  storedName: string;
}

/** A voucher a person entered (manual, its correction or reversal, and the year-closing run), not one a source issued */
export function isManualReferenceModule(referenceModule: string | null | undefined): boolean {
  return !referenceModule || referenceModule === 'manual';
}

export function trialBalanceDetailKey(
  accountId: number,
  row: { detailedType?: string | null; detailedId?: number | null; detailedName?: string | null },
  manualEntry: boolean,
): { key: string; ref: DetailRef } {
  const type = row.detailedType || 'other';
  const id = row.detailedId && row.detailedId > 0 ? Number(row.detailedId) : null;
  const storedName = (row.detailedName ?? '').trim();
  if (id !== null && ENTITY_DETAIL_TYPES.has(type)) {
    return { key: `${accountId}__${type}__${id}`, ref: { detailedType: type, detailedId: id, storedName } };
  }
  if (storedName && (NAMED_LEGACY_TYPES.has(type) || manualEntry)) {
    return { key: `${accountId}__${type}__name__${storedName}`, ref: { detailedType: type, detailedId: null, storedName } };
  }
  return { key: `${accountId}__general`, ref: { detailedType: 'other', detailedId: null, storedName: GENERAL_DETAIL_NAME } };
}

/** The current name of each detail entity, keyed `${type}__${id}`; a missing entity keeps the stored name */
export async function currentDetailNames(executor: DbExecutor, refs: DetailRef[]): Promise<Map<string, string>> {
  const idsOf = (types: string[]) => [...new Set(refs.filter(r => r.detailedId !== null && types.includes(r.detailedType)).map(r => r.detailedId as number))];
  const names = new Map<string, string>();
  const partyIds = idsOf(['customer', 'supplier']);
  if (partyIds.length) {
    for (const p of await executor.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, partyIds))) {
      names.set(`customer__${p.id}`, p.name);
      names.set(`supplier__${p.id}`, p.name);
    }
  }
  const personnelIds = idsOf(['personnel']);
  if (personnelIds.length) {
    for (const p of await executor.select({ id: personnel.id, fullName: personnel.fullName }).from(personnel).where(inArray(personnel.id, personnelIds))) {
      names.set(`personnel__${p.id}`, p.fullName);
    }
  }
  const projectIds = idsOf(['project']);
  if (projectIds.length) {
    for (const p of await executor.select({ id: productionProjects.id, title: productionProjects.title, projectCode: productionProjects.projectCode })
      .from(productionProjects).where(inArray(productionProjects.id, projectIds))) {
      names.set(`project__${p.id}`, voucherProjectLabel(p));
    }
  }
  const bankIds = idsOf(['bank_account']);
  if (bankIds.length) {
    for (const b of await executor.select({ id: bankAccounts.id, title: bankAccounts.title }).from(bankAccounts).where(inArray(bankAccounts.id, bankIds))) {
      names.set(`bank_account__${b.id}`, b.title);
    }
  }
  return names;
}

export function detailDisplayName(ref: DetailRef, names: Map<string, string>): string {
  const current = ref.detailedId !== null ? names.get(`${ref.detailedType}__${ref.detailedId}`)?.trim() : '';
  return current || ref.storedName || GENERAL_DETAIL_NAME;
}
