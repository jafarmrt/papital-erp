import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { AccountMappingService } from './accountMapping.service.js';

/**
 * v10.0.3 (TD-964): the ledger side of the stock vs ledger health check. Stock is valued from the items (quantity ×
 * weighted average cost), so the ledger side is the general account 14 without the work in progress account (mapping
 * `workInProgressCode`, default 1402): a remittance to production and a material allocation move value from stock into
 * work in progress, which no warehouse holds (the same rule as invariant I3). Approved and permanent vouchers make the
 * ledger value; the draft share and the work in progress balance are returned apart, so the report can say how much
 * of the gap approving the drafts closes. Rows in a foreign currency count at their own rate (TD-260).
 */
export interface InventoryLedgerValues {
  /** approved and permanent rows on account 14 without work in progress */
  posted: string;
  /** draft rows on the same accounts */
  draft: string;
  /** approved and permanent rows on the work in progress account */
  workInProgress: string;
}

export async function readInventoryLedgerValues(): Promise<InventoryLedgerValues> {
  const wip = await AccountMappingService.getWorkInProgressAccount();
  const wipId = wip?.id ?? 0;
  const res = await orm.execute(sql`
    WITH rows AS (
      SELECT vi.account_id, v.status,
             CASE WHEN UPPER(COALESCE(NULLIF(vi.currency, ''), NULLIF(v.currency, ''), 'IRR')) = 'IRR' THEN vi.debit - vi.credit
                  ELSE ROUND((vi.debit - vi.credit) * COALESCE(NULLIF(vi.exchange_rate, 0), 1), 0) END AS net_irr
        FROM journal_voucher_items vi
        JOIN journal_vouchers v ON v.id = vi.voucher_id AND v.is_deleted = 0
        JOIN accounts a ON a.id = vi.account_id AND a.is_deleted = 0
       WHERE vi.is_deleted = 0 AND a.code LIKE '14%'
    )
    SELECT COALESCE(SUM(net_irr) FILTER (WHERE status IN ('approved', 'permanent') AND account_id <> ${wipId}), 0)::text AS posted,
           COALESCE(SUM(net_irr) FILTER (WHERE status = 'draft' AND account_id <> ${wipId}), 0)::text AS draft,
           COALESCE(SUM(net_irr) FILTER (WHERE status IN ('approved', 'permanent') AND account_id = ${wipId}), 0)::text AS wip
      FROM rows
  `);
  const row = (res.rows?.[0] ?? {}) as { posted?: string; draft?: string; wip?: string };
  return { posted: row.posted ?? '0', draft: row.draft ?? '0', workInProgress: row.wip ?? '0' };
}
