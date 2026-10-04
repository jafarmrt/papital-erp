import { pool } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import { DocumentService } from '../../services/document.service.js';
import { checkBusinessInvariants, type InvariantScope } from './businessInvariants.js';

/** ابزارهای مشترک سناریوهای سخت‌گیرانه سوئیت business_invariants (v8.0.3، در v8.0.4 جدا شد) */

export interface Watermarks { documentIdAfter: number; voucherIdAfter: number }

export async function watermarks(): Promise<Watermarks> {
  const res = await pool.query<{ d: string; v: string }>(
    `SELECT (SELECT COALESCE(MAX(id), 0) FROM documents)::text AS d, (SELECT COALESCE(MAX(id), 0) FROM journal_vouchers)::text AS v`);
  return { documentIdAfter: Number(res.rows[0].d), voucherIdAfter: Number(res.rows[0].v) };
}

export async function itemState(itemId: number): Promise<{ stock: number; wac: string }> {
  const res = await pool.query<{ stock: string; wac: string }>(
    `SELECT COALESCE(current_stock, 0)::text AS stock, COALESCE(weighted_average_cost, 0)::text AS wac FROM items WHERE id = $1`, [itemId]);
  return { stock: Number(res.rows[0]?.stock ?? 0), wac: fin(res.rows[0]?.wac ?? 0).toString() };
}

/** گردش خالص (بدهکار − بستانکار) هر حساب در اسناد حسابداری داده‌شده */
export async function netByAccount(voucherIds: number[]): Promise<Map<number, string>> {
  const res = await pool.query<{ account_id: number; net: string }>(
    `SELECT account_id, SUM(debit - credit)::text AS net FROM journal_voucher_items
      WHERE voucher_id = ANY($1::int[]) AND is_deleted = 0 GROUP BY account_id`, [voucherIds]);
  return new Map(res.rows.map(r => [r.account_id, fin(r.net).toString()]));
}

export async function invariantProblems(scope: InvariantScope, when: string): Promise<string[]> {
  const violations = await checkBusinessInvariants(scope);
  return violations.map(v => `${when}: ${v.invariant} ${v.key} — ${v.message} (انتظار ${v.expected ?? '-'}، واقعی ${v.actual ?? '-'})`);
}

/** رسید نهایی؛ allowBackdate همان مجوز «ثبت سند انبار با تاریخ گذشته» است (v8.0.4) */
export async function receive(itemId: number, quantity: number, unitPrice: number, wh: string, date: string, allowBackdate = false): Promise<number> {
  const { docId } = await DocumentService.createDocumentWithDetails({
    docType: 'receipt', inOut: 'in', status: 'final', date, user: 'inv', buyerName: 'تامین‌کننده آزمون انبار',
    items: [{ itemId, quantity, unitPrice, location: wh }],
  }, { allowBackdate });
  return docId;
}
