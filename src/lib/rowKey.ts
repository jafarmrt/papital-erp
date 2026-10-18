/**
 * v10.2.4 (TD-1291): کلید پایدار ردیف‌های فرم‌های چندردیفی (ردیف سند حسابداری، ردیف کارکرد).
 * کلید فقط در مرورگر است و هرگز فرستاده نمی‌شود؛ با حذف یک ردیف، کادرهای ردیف بعدی جای آن را نمی‌گیرند
 * و متن نادرست یا خطای کادرِ ردیف حذف‌شده به ردیف دیگر نمی‌رسد.
 */
export interface KeyedRow {
  rowKey?: string;
}

let lastRowKey = 0;

export function withRowKey<T extends object>(row: T): T & KeyedRow {
  if ((row as KeyedRow).rowKey) return row;
  lastRowKey += 1;
  return { ...row, rowKey: `row-${lastRowKey}` };
}

export function withRowKeys<T extends object>(rows: T[]): Array<T & KeyedRow> {
  return rows.map(row => withRowKey(row));
}

export function rowKeyOf(row: KeyedRow, index: number): string {
  return row.rowKey ?? `index-${index}`;
}
