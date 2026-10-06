import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.87 (TD-481، تصمیم ت۴ بسته ۶): ارزش سند افتتاحیه کالا جمع ردیف‌های افتتاحیه کاردکس همان کالاست (مقدار × بهای
 * ثبت‌شده هنگام ساخت)، نه «موجودی جاری × WAC جاری». پیش‌تر سندی که پس از تأیید گردش کار صادر می‌شد رسیدهای میانه را
 * دوباره به سرمایه اولیه می‌برد و ردیف افتتاحیه کاردکس را با WAC روز بازنویسی می‌کرد (I3 و I13). ردیف افتتاحیه یعنی ردیف
 * فعال ورود از نوع `audit` با مرجع «ثبت اولیه کالا» (فرم ساخت کالا)، «ثبت موجودی افتتاحیه» (فرم ویرایش کالای بی گردش) یا
 * «درون‌ریزی اکسل» با توضیح «موجودی اولیه از فایل اکسل» (کالای تازه از اکسل).
 */
export const OPENING_KARDEX_ROW = sql`(t.is_deleted = 0 AND t.type = 'in' AND t.document_type = 'audit' AND (
  t.document_ref IN ('ثبت اولیه کالا', 'ثبت موجودی افتتاحیه')
  OR (t.document_ref = 'درون‌ریزی اکسل' AND t.notes = 'موجودی اولیه از فایل اکسل')))`;

export interface OpeningKardexValue {
  quantity: FinancialDecimal;
  value: FinancialDecimal;
}

export async function openingKardexValue(executor: DbExecutor, itemId: number): Promise<OpeningKardexValue> {
  const res = await executor.execute(sql`
    SELECT COALESCE(SUM(t.quantity), 0)::text AS quantity, COALESCE(SUM(t.quantity * t.unit_price), 0)::text AS value
      FROM transactions t
     WHERE t.item_id = ${itemId} AND ${OPENING_KARDEX_ROW}`);
  const row = (res.rows?.[0] ?? {}) as { quantity?: string; value?: string };
  return { quantity: fin(row.quantity ?? 0), value: fin(row.value ?? 0).round(4) };
}

/** اختلاف مجاز سند افتتاحیه و ردیف‌های افتتاحیه (یک صدم ریال، مثل تراز سند) */
export const OPENING_VALUE_TOLERANCE = 0.01;

export interface OpeningVoucherMismatchRow {
  voucherId: number;
  voucherNumber: string | null;
  itemId: number;
  itemCode: string | null;
  itemName: string | null;
  voucherAmount: string;
  kardexValue: string;
}

/**
 * سندهای افتتاحیه فعالی که مبلغشان با ارزش ردیف‌های افتتاحیه کاردکس کالا نمی‌خواند. سندهای صادرشده دست نمی‌خورند و فقط
 * در بررسی سلامت مالی فهرست می‌شوند (تصمیم ت۴).
 */
export async function findOpeningVoucherMismatches(executor: DbExecutor = orm): Promise<OpeningVoucherMismatchRow[]> {
  const res = await executor.execute(sql`
    WITH v AS (
      SELECT jv.id, jv.voucher_number, jv.reference_id AS item_id,
             COALESCE((SELECT SUM(jvi.debit) FROM journal_voucher_items jvi WHERE jvi.voucher_id = jv.id AND jvi.is_deleted = 0), 0) AS amount
        FROM journal_vouchers jv
       WHERE jv.is_deleted = 0 AND jv.reference_module = 'item_opening'
    ), k AS (
      SELECT t.item_id, SUM(t.quantity * t.unit_price) AS value
        FROM transactions t
       WHERE ${OPENING_KARDEX_ROW}
       GROUP BY t.item_id
    )
    SELECT v.id AS "voucherId", v.voucher_number AS "voucherNumber", v.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
           v.amount::text AS "voucherAmount", COALESCE(k.value, 0)::text AS "kardexValue"
      FROM v
      LEFT JOIN k ON k.item_id = v.item_id
      LEFT JOIN items i ON i.id = v.item_id
     WHERE abs(v.amount - COALESCE(k.value, 0)) > ${OPENING_VALUE_TOLERANCE}
     ORDER BY v.id`);
  return (res.rows ?? []) as unknown as OpeningVoucherMismatchRow[];
}

export function buildOpeningVoucherHealthTest(rows: OpeningVoucherMismatchRow[]): HealthCheckTestResult {
  return {
    id: 'item_opening_voucher_value',
    category: 'inventory',
    title: 'سند افتتاحیه کالا و ردیف‌های افتتاحیه کاردکس',
    description: 'مبلغ سند افتتاحیه هر کالا باید برابر جمع مقدار × بهای ردیف‌های افتتاحیه کاردکس همان کالا باشد',
    status: rows.length > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(10, rows.length * 2),
    count: rows.length,
    message: rows.length > 0
      ? `${rows.length} سند افتتاحیه کالا با ارزش ردیف‌های افتتاحیه کاردکس نمی‌خواند. این سندها خودکار تغییر نمی‌کنند؛ آن‌ها را بررسی کنید.`
      : 'مبلغ همه سندهای افتتاحیه کالا با ردیف‌های افتتاحیه کاردکس می‌خواند.',
    items: rows.map(r => ({
      id: r.voucherId,
      code: r.voucherNumber ?? `سند #${r.voucherId}`,
      title: r.itemName ?? `کالا #${r.itemId}`,
      subtitle: `کالا: ${r.itemCode ?? r.itemId} | سند: ${fin(r.voucherAmount).toString()} | کاردکس: ${fin(r.kardexValue).toString()}`,
      discrepancy: fin(r.voucherAmount).subtract(fin(r.kardexValue)).toNumber(),
      details: `اختلاف ${fin(r.voucherAmount).subtract(fin(r.kardexValue)).toString()} ریال (TD-481).`,
      linkType: 'voucher' as const,
      linkId: r.voucherId,
    })),
    metrics: { mismatchedVouchers: rows.length },
  };
}
