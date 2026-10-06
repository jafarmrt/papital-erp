import { fin } from '../../lib/financialDecimal.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import type { InvariantViolation } from './businessInvariants.js';
import { rows } from './ledgerRows.js';

/**
 * v9.0.67 (TD-499، B04-03) — ناوردایی‌های بانک (فقط SELECT) برای حساب‌های خزانه داده‌شده.
 *
 * I15: مانده جاری هر حساب = گردش دفتری ردیف‌های همان حساب (تفصیلی `bank_account`، اسناد فعال با هر وضعیت: پیش‌نویس،
 * تأییدشده، قطعی) + مانده اول دوره اگر سند افتتاحیه فعال ندارد. سند خودکار تا تأیید حسابدار پیش‌نویس است (TD-252)، پس
 * پیش‌نویس هم شمرده می‌شود. تراکنش «بی سند» (TD-409) این قاعده را آگاهانه می‌شکند و در بررسی سلامت فهرست می‌شود.
 * I16: هیچ ردیف خزانه کامل و بی سندی که زنجیره ابطالش اثر اصل را برمی‌گرداند (عمق زوج ≥ ۲، «احیا») وجود ندارد.
 */
export async function checkBankInvariants(bankIds: number[]): Promise<InvariantViolation[]> {
  if (bankIds.length === 0) return [];
  const violations: InvariantViolation[] = [];
  const balances = await rows<{ id: number; title: string; current: string; initial: string; ledger: string; has_opening: boolean }>(
    `SELECT b.id, b.title, b.current_balance::text AS current, b.initial_balance::text AS initial,
            COALESCE((SELECT SUM(i.debit - i.credit) FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
                       WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND i.detailed_type = 'bank_account' AND i.detailed_id = b.id), 0)::text AS ledger,
            EXISTS (SELECT 1 FROM journal_vouchers v WHERE v.is_deleted = 0 AND v.reference_module = 'treasury_opening'
                       AND v.voucher_type = 'opening' AND v.reference_id = b.id) AS has_opening
       FROM bank_accounts b WHERE b.id = ANY($1::int[]) AND b.is_deleted = 0`,
    [bankIds]
  );
  for (const b of balances) {
    const expected = fin(b.ledger).add(b.has_opening ? 0 : fin(b.initial));
    if (expected.subtract(fin(b.current)).abs().greaterThan(VOUCHER_BALANCE_TOLERANCE)) {
      violations.push({
        invariant: 'I15_bank_balance_matches_ledger',
        key: `bank:${b.id}`,
        message: `Bank account ${b.id} balance differs from its ledger rows (all voucher statuses) plus an opening balance without an opening voucher`,
        expected: expected.toString(),
        actual: fin(b.current).toString(),
      });
    }
  }
  const revived = await rows<{ id: number; bank_account_id: number; transaction_number: string; depth: number }>(
    `WITH RECURSIVE chain AS (
       SELECT id, reversal_of_id, 0 AS depth FROM treasury_transactions WHERE reversal_of_id IS NULL
       UNION ALL
       SELECT t.id, t.reversal_of_id, c.depth + 1 FROM treasury_transactions t JOIN chain c ON t.reversal_of_id = c.id
     )
     SELECT t.id, t.bank_account_id, t.transaction_number, c.depth
       FROM treasury_transactions t JOIN chain c ON c.id = t.id
      WHERE t.bank_account_id = ANY($1::int[]) AND t.is_deleted = 0 AND t.voucher_id IS NULL
        AND COALESCE(t.status, 'completed') <> 'voided' AND c.depth >= 2 AND c.depth % 2 = 0`,
    [bankIds]
  );
  for (const r of revived) {
    violations.push({
      invariant: 'I16_no_revived_treasury_without_voucher',
      key: `treasury:${r.id}`,
      message: `Treasury row ${r.transaction_number} of bank ${r.bank_account_id} re-applies a voided transaction (reversal depth ${r.depth}) without a voucher`,
    });
  }
  return violations;
}
