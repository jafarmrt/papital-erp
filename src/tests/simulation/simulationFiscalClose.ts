import { pool } from '../../db/drizzle.js';
import { FiscalYearService } from '../../services/accounting/fiscalYear.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { jalaliYearBounds } from '../../utils/calendarDate.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { checkBusinessInvariants, type InvariantScope, type InvariantViolation } from '../invariants/businessInvariants.js';

/** The Jalali year the simulator's dated operations run in (`YEAR_START` = 1 Farvardin 1404) */
export const SIMULATED_FISCAL_YEAR = 1404;

/**
 * v10.0.11 (TD-982, I-01) — the end of a simulated year: the accountant approves the year's draft vouchers (TD-252) and
 * closes the year with its opening voucher; the invariants are then checked with the closed year in scope (I11). A
 * refused closing is a finding of its own.
 */
export async function closeSimulatedYear(scope: InvariantScope): Promise<InvariantViolation[]> {
  const bounds = jalaliYearBounds(SIMULATED_FISCAL_YEAR);
  if (!bounds) return [];
  const drafts = await pool.query<{ id: number }>(
    `SELECT id FROM journal_vouchers WHERE is_deleted = 0 AND status = 'draft' AND date >= $1 AND date <= $2 ORDER BY id`,
    [bounds.firstDay, bounds.lastDay]
  );
  try {
    if (drafts.rows.length > 0) await VoucherService.approveJournalVouchers(drafts.rows.map(r => r.id), undefined, 'sim');
    await FiscalYearService.executeFiscalYearClosing({ year: SIMULATED_FISCAL_YEAR, createOpeningVoucher: true, username: 'sim' });
  } catch (err) {
    return [{
      invariant: 'I11_fiscal_year_closing',
      key: 'closing-refused',
      message: `Closing simulated fiscal year ${SIMULATED_FISCAL_YEAR} was refused: ${getErrorMessage(err).slice(0, 200)}`,
    }];
  }
  scope.fiscalYears = [SIMULATED_FISCAL_YEAR];
  return checkBusinessInvariants(scope);
}
