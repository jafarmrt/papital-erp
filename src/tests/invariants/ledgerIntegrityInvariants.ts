import { fin } from '../../lib/financialDecimal.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import type { InvariantScope, InvariantViolation } from './businessInvariants.js';
import { FOREIGN_ROW_WITHOUT_RATE_SQL, irrAmountSql, rows } from './ledgerRows.js';

/**
 * v10.0.10 (TD-982, I-01) — ledger invariants added in series 10 (read-only SQL over the vouchers above the watermark):
 *
 * I17: every live voucher balances in rials by the TD-260 rule (a foreign row at its own rate), and no foreign row lacks a
 *      rate of its own (TD-551). I1 compares raw amounts, so a voucher of 100 USD against 100 IRR passed it.
 * I18: no live row sits on a deleted account, a group or general account, or an account with an active sub-account (TD-549).
 * I20: the net credit of «VAT payable» (mapped 3203) equals the VAT of the final sales invoices minus the VAT of their final
 *      returns (TD-774), in rials at each document's own rate.
 */

/** I17 */
export async function checkVoucherRialBalance(scope: InvariantScope): Promise<InvariantViolation[]> {
  const vouchers = await rows<{ id: number; voucher_number: number; debit: string; credit: string; row_count: string; rateless: string }>(
    `SELECT v.id, v.voucher_number,
            COALESCE(SUM(${irrAmountSql('i.debit')}), 0)::text AS debit,
            COALESCE(SUM(${irrAmountSql('i.credit')}), 0)::text AS credit,
            COUNT(i.id)::text AS row_count,
            COUNT(i.id) FILTER (WHERE ${FOREIGN_ROW_WITHOUT_RATE_SQL})::text AS rateless
       FROM journal_vouchers v
       JOIN journal_voucher_items i ON i.voucher_id = v.id AND i.is_deleted = 0
      WHERE v.is_deleted = 0 AND v.id > $1
      GROUP BY v.id, v.voucher_number`,
    [scope.voucherIdAfter]
  );
  const violations: InvariantViolation[] = [];
  for (const v of vouchers) {
    if (Number(v.rateless) > 0) {
      violations.push({
        invariant: 'I17_voucher_rial_balance',
        key: `voucher-rate:${v.id}`,
        message: `Voucher ${v.voucher_number} has ${v.rateless} foreign rows without a rate of their own`,
        expected: '0',
        actual: v.rateless,
      });
      continue;
    }
    // each foreign row is rounded to the rial on its own: at most half a rial per row, plus the double-entry tolerance
    const tolerance = fin(v.row_count).multiply(0.5).add(VOUCHER_BALANCE_TOLERANCE);
    if (fin(v.debit).subtract(fin(v.credit)).abs().greaterThan(tolerance)) {
      violations.push({
        invariant: 'I17_voucher_rial_balance',
        key: `voucher:${v.id}`,
        message: `Voucher ${v.voucher_number} does not balance in rials`,
        expected: v.debit,
        actual: v.credit,
      });
    }
  }
  return violations;
}

/** I18 */
export async function checkRowsOnPostingAccounts(scope: InvariantScope): Promise<InvariantViolation[]> {
  const offending = await rows<{ account_id: number; code: string | null; reason: string; row_count: string }>(
    `SELECT i.account_id, a.code,
            CASE WHEN a.id IS NULL OR a.is_deleted = 1 THEN 'deleted'
                 WHEN a.level NOT IN ('subsidiary', 'detailed') THEN 'summary_level'
                 ELSE 'has_children' END AS reason,
            COUNT(*)::text AS row_count
       FROM journal_voucher_items i
       JOIN journal_vouchers v ON v.id = i.voucher_id
       LEFT JOIN accounts a ON a.id = i.account_id
      WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND v.id > $1
        AND (a.id IS NULL OR a.is_deleted = 1 OR a.level NOT IN ('subsidiary', 'detailed')
             OR EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id AND c.is_deleted = 0 AND COALESCE(c.is_active, 1) = 1))
      GROUP BY i.account_id, a.code, reason
      ORDER BY i.account_id`,
    [scope.voucherIdAfter]
  );
  return offending.map(r => ({
    invariant: 'I18_rows_on_posting_accounts',
    key: `account:${r.account_id}`,
    message: `${r.row_count} live voucher rows sit on account ${r.code ?? r.account_id}, which is not a posting account (${r.reason})`,
    expected: '0',
    actual: r.row_count,
  }));
}

/** I20 */
export async function checkVatPayable(scope: InvariantScope): Promise<InvariantViolation[]> {
  const vat = await AccountMappingService.getSalesVatPayableAccount();
  if (!vat) return [];
  const [ledger] = await rows<{ net: string; row_count: string }>(
    `SELECT COALESCE(SUM(${irrAmountSql('i.credit')} - ${irrAmountSql('i.debit')}), 0)::text AS net, COUNT(i.id)::text AS row_count
       FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND v.id > $1 AND i.account_id = $2`,
    [scope.voucherIdAfter, vat.id]
  );
  const [documents] = await rows<{ net: string; doc_count: string }>(
    `SELECT COALESCE(SUM(
              (CASE WHEN d.type = 'return' THEN -1 ELSE 1 END)
              * CASE WHEN UPPER(COALESCE(NULLIF(d.currency, ''), 'IRR')) = 'IRR' THEN d.vat_amount
                     ELSE ROUND(d.vat_amount * COALESCE(NULLIF(d.exchange_rate, 0), 1), 0) END
            ), 0)::text AS net,
            COUNT(*)::text AS doc_count
       FROM documents d
      WHERE d.id > $1 AND d.is_deleted = 0 AND d.status = 'final' AND d.type IN ('invoice', 'proforma', 'return')
        AND d.vat_amount <> 0`,
    [scope.documentIdAfter]
  );
  const expected = fin(documents?.net);
  const actual = fin(ledger?.net);
  const tolerance = fin(Number(ledger?.row_count ?? 0) + Number(documents?.doc_count ?? 0)).add(VOUCHER_BALANCE_TOLERANCE);
  if (expected.subtract(actual).abs().greaterThan(tolerance)) {
    return [{
      invariant: 'I20_vat_payable_matches_documents',
      key: 'vat-payable',
      message: 'VAT payable in the ledger differs from the VAT of final sales invoices minus their returns',
      expected: expected.toString(),
      actual: actual.toString(),
    }];
  }
  return [];
}
