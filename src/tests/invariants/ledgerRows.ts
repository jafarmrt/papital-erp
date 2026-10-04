import { pool } from '../../db/drizzle.js';

/** v8.0.1 — پرس‌وجوهای مشترک ناوردایی‌ها روی دفتر کاردکس (فقط SELECT). در v8.0.4 از businessInvariants.ts جدا شد. */

export const QTY_TOLERANCE = 0.0001;

export async function rows<T extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export interface KardexRow extends Record<string, unknown> {
  id: number;
  item_id: number;
  type: string;
  quantity: string;
  unit_price: string;
  location: string | null;
  reversal_of_id: number | null;
  document_ref: string | null;
}

/** ردیف‌های فعال کاردکس، بدون ردیف‌های معکوسِ ردیف‌های حذف‌شده (همان قاعده AGENTS.md §12) */
export async function activeLedgerRows(itemIds: number[], order: 'id' | 'date'): Promise<KardexRow[]> {
  if (itemIds.length === 0) return [];
  // v8.0.4 (TD-257): «ترتیب تاریخ» یعنی روز سند، سپس ترتیب ثبت (همان ترتیب کنترل موجودی تا تاریخ)
  const orderBy = order === 'id' ? 't.id' : 't.date::date, t.id';
  return rows<KardexRow>(
    `SELECT t.id, t.item_id, t.type, t.quantity::text AS quantity, COALESCE(t.unit_price, 0)::text AS unit_price,
            t.location, t.reversal_of_id, t.document_ref
       FROM transactions t
      WHERE t.item_id = ANY($1::int[]) AND t.is_deleted = 0
        AND NOT EXISTS (SELECT 1 FROM transactions o WHERE o.id = t.reversal_of_id AND o.is_deleted = 1)
      ORDER BY ${orderBy}`,
    [itemIds]
  );
}

export const isInRow = (t: KardexRow) => t.type === 'in' || t.type === 'transfer_in';
export const isOutRow = (t: KardexRow) => t.type === 'out' || t.type === 'transfer_out';

