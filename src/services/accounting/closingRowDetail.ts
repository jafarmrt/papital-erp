import type { TrialBalanceRow } from '../../types/accounting.types.js';
import { GENERAL_DETAIL_NAME } from './trialBalanceDetail.js';

/**
 * v10.0.264 (OBS-R1-45, TD-985): the detail a closing or opening voucher row carries for one level-4 balance.
 * A party, project or bank balance keeps its type and id, a legacy party row without an id keeps its type and name,
 * and every other balance (a cheque, an item opening row, a manual name) goes to «other» under its own name; the
 * account's general rest is named after the account. Before, every row was «other» with the account's name, so a
 * party's balance did not reach its account card in the new year.
 */
const ENTITY_TYPES = new Set(['customer', 'supplier', 'personnel', 'project', 'bank_account']);
const NAMED_PARTY_TYPES = new Set(['customer', 'supplier', 'personnel']);

export interface ClosingRowDetail {
  detailedType: string;
  detailedId: number | null;
  detailedName: string;
}

export function closingRowDetail(row: Pick<TrialBalanceRow, 'detailedType' | 'detailedId' | 'detailedName'>, accountName: string): ClosingRowDetail {
  const type = row.detailedType || 'other';
  const id = row.detailedId && row.detailedId > 0 ? Number(row.detailedId) : null;
  const name = (row.detailedName ?? '').trim();
  if (id !== null && ENTITY_TYPES.has(type)) return { detailedType: type, detailedId: id, detailedName: name || accountName };
  if (name && NAMED_PARTY_TYPES.has(type)) return { detailedType: type, detailedId: null, detailedName: name };
  return { detailedType: 'other', detailedId: null, detailedName: name && name !== GENERAL_DETAIL_NAME ? name : accountName };
}
