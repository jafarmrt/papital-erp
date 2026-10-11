import { eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { bankAccounts, cheques, customers, itemOpeningVoucherItems, items, personnel, productionProjects } from '../../db/schema.js';
import { voucherProjectLabel } from '../../lib/accounting/voucherDetailedTypes.js';

/**
 * v10.0.139 (TD-1128): the detail of a level-4 trial balance row. A detail with an id (customer, supplier, personnel,
 * project, bank account) is one row per account, type and id, whatever name each voucher stored; a legacy party row
 * without an id keeps its exact name (TD-416), and so does a row without an id that a person typed on a manual voucher;
 * a row without an id of an automatic voucher is grouped by the voucher's stable reference when it has one (the cheque
 * of a cheque voucher, the item of an item opening row) and goes to the account's general row otherwise, because its
 * stored name (revenue, inventory and VAT labels) describes that voucher and is not a detail account.
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

/** The stable reference of an automatic voucher's row without an id: its cheque, or the item of an item opening row */
export interface StableRef {
  kind: 'cheque' | 'item';
  id: number;
}

export const ITEM_OPENING_ROW_PREFIX = 'موجودی اولیه ';

/** The item of an item opening row: the voucher's linked item whose opening row name it carries, else its only item */
export function itemOfOpeningRow(voucherItems: Array<{ itemId: number; name: string }> | undefined, storedName: string): number | null {
  const name = storedName.trim();
  if (!voucherItems?.length || !name.startsWith(ITEM_OPENING_ROW_PREFIX)) return null;
  const named = voucherItems.filter(i => `${ITEM_OPENING_ROW_PREFIX}${i.name}`.trim() === name);
  if (named.length === 1) return named[0].itemId;
  return voucherItems.length === 1 ? voucherItems[0].itemId : null;
}

/** The items linked to each item opening voucher (`item_opening_voucher_items`), with the name the rows were written with */
export async function openingVoucherItems(executor: DbExecutor, voucherIds: number[]): Promise<Map<number, Array<{ itemId: number; name: string }>>> {
  const byVoucher = new Map<number, Array<{ itemId: number; name: string }>>();
  const ids = [...new Set(voucherIds)];
  if (!ids.length) return byVoucher;
  const rows = await executor.select({ voucherId: itemOpeningVoucherItems.voucherId, itemId: items.id, name: items.name })
    .from(itemOpeningVoucherItems).innerJoin(items, eq(items.id, itemOpeningVoucherItems.itemId))
    .where(inArray(itemOpeningVoucherItems.voucherId, ids));
  for (const r of rows) {
    const list = byVoucher.get(r.voucherId) ?? [];
    list.push({ itemId: r.itemId, name: r.name });
    byVoucher.set(r.voucherId, list);
  }
  return byVoucher;
}

export function trialBalanceDetailKey(
  accountId: number,
  row: { detailedType?: string | null; detailedId?: number | null; detailedName?: string | null },
  manualEntry: boolean,
  stable: StableRef | null = null,
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
  if (stable) {
    return { key: `${accountId}__${stable.kind}__${stable.id}`, ref: { detailedType: stable.kind, detailedId: stable.id, storedName: storedName || GENERAL_DETAIL_NAME } };
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
  const chequeIds = idsOf(['cheque']);
  if (chequeIds.length) {
    for (const c of await executor.select({ id: cheques.id, chequeNumber: cheques.chequeNumber }).from(cheques).where(inArray(cheques.id, chequeIds))) {
      names.set(`cheque__${c.id}`, `چک ${c.chequeNumber}`);
    }
  }
  const itemIds = idsOf(['item']);
  if (itemIds.length) {
    for (const i of await executor.select({ id: items.id, name: items.name, code: items.code }).from(items).where(inArray(items.id, itemIds))) {
      names.set(`item__${i.id}`, `${ITEM_OPENING_ROW_PREFIX}${i.name} (${i.code})`);
    }
  }
  return names;
}

export function detailDisplayName(ref: DetailRef, names: Map<string, string>): string {
  const current = ref.detailedId !== null ? names.get(`${ref.detailedType}__${ref.detailedId}`)?.trim() : '';
  return current || ref.storedName || GENERAL_DETAIL_NAME;
}
