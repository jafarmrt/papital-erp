import { pool } from '../../db/drizzle.js';
import { FiscalYearService } from '../../services/accounting/fiscalYear.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { DocumentService } from '../../services/document.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestCustomer, createTestItem } from '../fixtures/factories.js';
import { checkFiscalYearClosings } from './fiscalCloseInvariant.js';
import { irrAmountSql } from './ledgerRows.js';

/** A Jalali year no other check uses; closed without an opening voucher, so 1379 stays empty for the TD-544 order rule */
const ROUNDING_CLOSING_YEAR = 1378;

async function stocked(wh: string, type: 'product' | 'raw_material', quantity: number, unitPrice: string): Promise<number> {
  const item = await createTestItem({ type, stocks: {}, weightedAverageCost: 0 });
  await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date: '1999-06-01', user: 'inv', buyerName: 'ERP-TEST-MARKER TD-1030 supplier',
    items: [{ itemId: item.id, quantity, unitPrice, location: wh }],
  });
  return item.id;
}

/**
 * v10.0.3 (TD-1030): a USD sales invoice whose Kardex costs carry rial fractions (3 x 100,010 of finished goods and
 * 2 x 150,000.25 of raw materials, cost of sales 600,030.5) posts a voucher that balances in rials under the report rule
 * (TD-260: each foreign row at its own rate, rounded to the rial), so the year that holds it closes. Before, each cost row's
 * 4-decimal amount and rate made the cost of sales one rial short and the closing was refused.
 */
export async function checkForeignSaleBalancesInRials(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const voucherMark = Number((await pool.query<{ m: string }>(`SELECT COALESCE(MAX(id), 0)::text AS m FROM journal_vouchers`)).rows[0].m);
  const product = await stocked(wh, 'product', 3, '100010');
  const raw = await stocked(wh, 'raw_material', 2, '150000.25');
  const customer = await createTestCustomer({ name: `ERP-TEST-MARKER TD-1030 customer ${Date.now()}`, partyType: 'customer' });
  const invoiceId = await DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status: 'final', date: '1999-07-01', user: 'inv', partyId: customer.id, currency: 'USD', exchangeRate: 600000,
    items: [{ itemId: product, quantity: 3, unitPrice: 0.65, location: wh }, { itemId: raw, quantity: 2, unitPrice: 0.5, location: wh }],
  });
  const gap = (await pool.query<{ gap: string | null }>(
    `SELECT SUM(${irrAmountSql('i.debit')} - ${irrAmountSql('i.credit')})::text AS gap
       FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0`, [invoiceId])).rows[0]?.gap;
  if (gap === null || gap === undefined) problems.push('the USD invoice has no voucher');
  else if (Number(gap) !== 0) problems.push(`the USD sales voucher is off by ${gap} rials under the report rule (expected 0)`);

  const drafts = await pool.query<{ id: number }>(`SELECT id FROM journal_vouchers WHERE id > $1 AND is_deleted = 0 AND status = 'draft'`, [voucherMark]);
  await VoucherService.approveJournalVouchers(drafts.rows.map(r => r.id), undefined, 'inv');
  try {
    await FiscalYearService.executeFiscalYearClosing({ year: ROUNDING_CLOSING_YEAR, createOpeningVoucher: false, username: 'inv' });
    for (const v of await checkFiscalYearClosings([ROUNDING_CLOSING_YEAR])) {
      if (!v.key.includes(':opening:')) problems.push(`after closing ${ROUNDING_CLOSING_YEAR}: ${v.key}: ${v.message}`);
    }
  } catch (err) {
    problems.push(`closing ${ROUNDING_CLOSING_YEAR} with the USD sale was refused: ${getErrorMessage(err).slice(0, 160)}`);
  }
  return problems;
}

export const FOREIGN_ROUNDING_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_1030_foreign_sale_rial_balance', 'v10.0.3: a USD sale with fractional rial costs posts a voucher balanced in rials and its year closes (TD-1030)',
    checkForeignSaleBalancesInRials, 'USD sales voucher balanced to the rial and its year closed'],
];
