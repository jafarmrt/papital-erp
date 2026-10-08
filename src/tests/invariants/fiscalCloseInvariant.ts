import { fin } from '../../lib/financialDecimal.js';
import { jalaliYearBounds } from '../../utils/calendarDate.js';
import type { InvariantViolation } from './businessInvariants.js';
import { irrAmountSql, rows } from './ledgerRows.js';

/**
 * v10.0.7 (TD-982, I-01) — I11 of the V8 catalogue (V8_MASTER_ROADMAP.md §4), read-only SQL for the given (Jalali) fiscal
 * years that `fiscal_periods` marks closed:
 * - every account balances to zero in rials over the live vouchers dated up to the year's last day, closing vouchers
 *   included (temporary accounts are closed to profit and loss, the rest by the closing voucher; TD-310);
 * - the opening voucher of the next year (`source_fiscal_year` = the year, TD-545) is the closing voucher of the
 *   permanent accounts with debit and credit swapped, account by account;
 * - no live voucher dated in the closed year was registered after its closing run (fiscal period lock, P2-5).
 */
export async function checkFiscalYearClosings(years: number[] | undefined): Promise<InvariantViolation[]> {
  if (!years || years.length === 0) return [];
  const violations: InvariantViolation[] = [];
  for (const year of years) {
    const bounds = jalaliYearBounds(year);
    if (!bounds) continue;
    const [period] = await rows<{ status: string; closing_voucher_id: number | null }>(
      `SELECT status, closing_voucher_id FROM fiscal_periods WHERE fiscal_year = $1`, [year]);
    if (period?.status !== 'closed') continue;

    const open = await rows<{ account_id: number; code: string | null; balance: string }>(
      `SELECT i.account_id, a.code, SUM(${irrAmountSql('i.debit')} - ${irrAmountSql('i.credit')})::text AS balance
         FROM journal_voucher_items i
         JOIN journal_vouchers v ON v.id = i.voucher_id
         LEFT JOIN accounts a ON a.id = i.account_id
        WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND v.date <= $1
        GROUP BY i.account_id, a.code
       HAVING ABS(SUM(${irrAmountSql('i.debit')} - ${irrAmountSql('i.credit')})) > 1`,
      [bounds.lastDay]
    );
    for (const a of open) {
      violations.push({
        invariant: 'I11_fiscal_year_closing',
        key: `fy:${year}:account:${a.account_id}`,
        message: `Account ${a.code ?? a.account_id} is not zero at the end of closed fiscal year ${year}`,
        expected: '0',
        actual: a.balance,
      });
    }

    const mirror = await rows<{ account_id: number; closing: string; opening: string }>(
      `WITH run AS (
         SELECT v.id, v.voucher_type, v.reference_number FROM journal_vouchers v
          WHERE v.is_deleted = 0 AND v.source_fiscal_year = $1
            AND (v.voucher_type = 'opening' OR v.reference_number = 'CLOSING-' || $1::text)
       )
       SELECT i.account_id,
              COALESCE(SUM(i.debit - i.credit) FILTER (WHERE r.voucher_type = 'closing'), 0)::text AS closing,
              COALESCE(SUM(i.debit - i.credit) FILTER (WHERE r.voucher_type = 'opening'), 0)::text AS opening
         FROM run r JOIN journal_voucher_items i ON i.voucher_id = r.id AND i.is_deleted = 0
        WHERE EXISTS (SELECT 1 FROM run o WHERE o.voucher_type = 'opening')
        GROUP BY i.account_id`,
      [year]
    );
    for (const m of mirror) {
      if (fin(m.closing).add(fin(m.opening)).abs().greaterThan(0.01)) {
        violations.push({
          invariant: 'I11_fiscal_year_closing',
          key: `fy:${year}:opening:${m.account_id}`,
          message: `Opening voucher of fiscal year ${year + 1} does not mirror the closing voucher of ${year} on account ${m.account_id}`,
          expected: fin(m.closing).negate().toString(),
          actual: m.opening,
        });
      }
    }

    if (period.closing_voucher_id !== null) {
      const late = await rows<{ id: number; voucher_number: number }>(
        `SELECT v.id, v.voucher_number FROM journal_vouchers v
          WHERE v.is_deleted = 0 AND v.date >= $1 AND v.date <= $2 AND v.id > $3
          ORDER BY v.id`,
        [bounds.firstDay, bounds.lastDay, period.closing_voucher_id]
      );
      for (const v of late) {
        violations.push({
          invariant: 'I11_fiscal_year_closing',
          key: `fy:${year}:late:${v.id}`,
          message: `Voucher ${v.voucher_number} is dated in closed fiscal year ${year} but was registered after its closing`,
        });
      }
    }
  }
  return violations;
}
