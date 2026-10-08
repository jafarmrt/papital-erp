import { isoToJalaliDate } from '../../utils/calendarDate.js';
import type { InvariantScope, InvariantViolation } from './businessInvariants.js';
import { rows } from './ledgerRows.js';

/**
 * v10.0.1 (TD-982, I-01) — I12 of the V8 catalogue (V8_MASTER_ROADMAP.md §4), read-only SQL: sequential numbers are unique
 * and never collide across fiscal years. For the rows above the watermarks:
 * - a live document's number is not held by another live document of its type and numbering year, and that numbering
 *   year is the Jalali year of the document's own date (TD-313);
 * - a voucher number is held by no other voucher (TD-195);
 * - a live treasury row number and a live payslip number are held by no other live row of the same table.
 * The database indexes behind the first two are built only on clean data (migrations 0017 and 0031), so the check reads
 * the rows, not the indexes.
 */
export async function checkNumberUniqueness(scope: InvariantScope): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  const docs = await rows<{ id: number; type: string; ref_number: string; ref_fiscal_year: number | null; date: string; holders: string }>(
    `SELECT d.id, d.type, d.ref_number, d.ref_fiscal_year, d.date::text AS date,
            (SELECT COUNT(*) FROM documents o
              WHERE o.is_deleted = 0 AND o.type = d.type AND o.ref_number = d.ref_number
                AND o.ref_fiscal_year IS NOT DISTINCT FROM d.ref_fiscal_year)::text AS holders
       FROM documents d
      WHERE d.id > $1 AND d.is_deleted = 0 AND length(d.ref_number) > 0
      ORDER BY d.id`,
    [scope.documentIdAfter]
  );
  for (const d of docs) {
    if (Number(d.holders) > 1) {
      violations.push({
        invariant: 'I12_unique_numbers',
        key: `doc-number:${d.type}:${d.ref_fiscal_year ?? '-'}:${d.ref_number}`,
        message: `${d.holders} live ${d.type} documents hold number ${d.ref_number} in numbering year ${d.ref_fiscal_year ?? '-'}`,
        expected: '1',
        actual: d.holders,
      });
    }
    const jalaliYear = Number(isoToJalaliDate(String(d.date).slice(0, 10)).slice(0, 4));
    if (d.ref_fiscal_year !== jalaliYear) {
      violations.push({
        invariant: 'I12_unique_numbers',
        key: `doc-year:${d.id}`,
        message: `${d.type} document ${d.ref_number} is numbered in year ${d.ref_fiscal_year ?? '-'} but dated in ${jalaliYear}`,
        expected: String(jalaliYear),
        actual: String(d.ref_fiscal_year ?? '-'),
      });
    }
  }

  const duplicates: Array<[string, string, number | undefined]> = [
    ['voucher-number', `SELECT v.voucher_number::text AS number, COUNT(*)::text AS holders FROM journal_vouchers v
       WHERE v.voucher_number IN (SELECT voucher_number FROM journal_vouchers WHERE id > $1)
       GROUP BY v.voucher_number HAVING COUNT(*) > 1`, scope.voucherIdAfter],
    ['treasury-number', `SELECT t.transaction_number AS number, COUNT(*)::text AS holders FROM treasury_transactions t
       WHERE t.is_deleted = 0 AND t.transaction_number IN (SELECT transaction_number FROM treasury_transactions WHERE id > $1 AND is_deleted = 0)
       GROUP BY t.transaction_number HAVING COUNT(*) > 1`, scope.treasuryIdAfter],
    ['payroll-number', `SELECT p.payroll_number AS number, COUNT(*)::text AS holders FROM piecework_payrolls p
       WHERE p.is_deleted = 0 AND p.payroll_number IN (SELECT payroll_number FROM piecework_payrolls WHERE id > $1 AND is_deleted = 0)
       GROUP BY p.payroll_number HAVING COUNT(*) > 1`, scope.payrollIdAfter],
  ];
  for (const [kind, sql, after] of duplicates) {
    if (after === undefined) continue;
    for (const r of await rows<{ number: string; holders: string }>(sql, [after])) {
      violations.push({
        invariant: 'I12_unique_numbers',
        key: `${kind}:${r.number}`,
        message: `${r.holders} live rows hold ${kind} ${r.number}`,
        expected: '1',
        actual: r.holders,
      });
    }
  }
  return violations;
}
