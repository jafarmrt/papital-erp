import { fin } from '../../lib/financialDecimal.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import type { InvariantViolation } from './businessInvariants.js';
import { irrAmountSql, rows } from './ledgerRows.js';

/**
 * v10.0.1 (TD-982, I-01) — I8 of the V8 catalogue (V8_MASTER_ROADMAP.md §4), read-only SQL for the given customers:
 *
 * the balance of «trade receivables» (mapped 1201) under the customer's own id (TD-416), over live vouchers of any status,
 * in rials (TD-260) equals what the business records say the customer owes:
 *   final sales invoices (payable = net of lines + VAT + service charge, at the document's rate)
 *   − their final sales returns
 *   − completed treasury receipts from the customer + treasury payments to the customer (original rows with a voucher;
 *     a voided row and its reversal cancel out)
 *   − received cheques of the customer + those returned to the customer after a bounce (TD-273)
 *   + paid cheques to the customer − those that bounced (TD-272).
 * Entries recorded without a voucher (TD-409) are left out on both sides.
 */
export async function checkPartyBalances(partyIds: number[] | undefined): Promise<InvariantViolation[]> {
  if (!partyIds || partyIds.length === 0) return [];
  const receivable = await AccountMappingService.getTradeReceivablesAccount();
  if (!receivable) return [];
  const balances = await rows<{ id: number; name: string; ledger: string; ledger_rows: string; documents: string; treasury: string; cheques: string }>(
    `SELECT c.id, c.name,
            COALESCE((SELECT SUM(${irrAmountSql('i.debit')} - ${irrAmountSql('i.credit')})
                        FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
                       WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND i.account_id = $2
                         AND i.detailed_type IN ('customer', 'supplier') AND i.detailed_id = c.id), 0)::text AS ledger,
            (SELECT COUNT(*) FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
              WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND i.account_id = $2
                AND i.detailed_type IN ('customer', 'supplier') AND i.detailed_id = c.id)::text AS ledger_rows,
            COALESCE((SELECT SUM(
                        (CASE WHEN d.type = 'return' THEN -1 ELSE 1 END)
                        * ROUND((COALESCE((SELECT SUM(GREATEST(di.quantity * di.unit_price - di.discount, 0)) FROM document_items di
                                            WHERE di.document_id = d.id AND di.is_deleted = 0), 0)
                                 + d.vat_amount + d.service_charge_amount)
                                * CASE WHEN UPPER(COALESCE(NULLIF(d.currency, ''), 'IRR')) = 'IRR' THEN 1
                                       ELSE COALESCE(NULLIF(d.exchange_rate, 0), 1) END, 0))
                        FROM documents d
                       WHERE d.party_id = c.id AND d.is_deleted = 0 AND d.status = 'final'
                         AND d.type IN ('invoice', 'proforma', 'return')), 0)::text AS documents,
            COALESCE((SELECT SUM(
                        (CASE WHEN t.type = 'receipt' THEN -1 ELSE 1 END)
                        * ROUND(t.amount * CASE WHEN UPPER(COALESCE(NULLIF(t.currency, ''), 'IRR')) = 'IRR' THEN 1
                                                ELSE COALESCE(NULLIF(t.exchange_rate, 0), 1) END, 0))
                        FROM treasury_transactions t
                       WHERE t.party_type = 'customer' AND t.party_id = c.id AND t.is_deleted = 0
                         AND t.reversal_of_id IS NULL AND COALESCE(t.status, 'completed') = 'completed'
                         AND t.voucher_id IS NOT NULL), 0)::text AS treasury,
            COALESCE((SELECT SUM(
                        CASE WHEN q.type = 'received' THEN (CASE WHEN q.status = 'returned' THEN 0 ELSE -q.amount END)
                             ELSE (CASE WHEN q.status IN ('bounced', 'returned') THEN 0 ELSE q.amount END) END)
                        FROM cheques q
                       WHERE q.party_type = 'customer' AND q.party_id = c.id AND q.is_deleted = 0
                         AND q.voucher_id IS NOT NULL), 0)::text AS cheques
       FROM customers c
      WHERE c.id = ANY($1::int[])
      ORDER BY c.id`,
    [partyIds, receivable.id]
  );
  const violations: InvariantViolation[] = [];
  for (const b of balances) {
    const expected = fin(b.documents).add(fin(b.treasury)).add(fin(b.cheques));
    const actual = fin(b.ledger);
    // each foreign row and each foreign document is rounded to the rial on its own
    const tolerance = fin(b.ledger_rows).add(1);
    if (expected.subtract(actual).abs().greaterThan(tolerance)) {
      violations.push({
        invariant: 'I8_customer_balance',
        key: `party:${b.id}`,
        message: `Receivable balance of customer ${b.id} differs from invoices - returns - receipts - cheques`,
        expected: expected.toString(),
        actual: actual.toString(),
      });
    }
  }
  return violations;
}
