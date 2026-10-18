/**
 * v10.2.4 (TD-1291): کلید پایدار ردیف‌های فرم‌های چندردیفی (ردیف سند حسابداری، ردیف کارکرد).
 * کلید فقط در مرورگر است و هرگز فرستاده یا در پیش‌نویس ذخیره نمی‌شود؛ با حذف یک ردیف، کادرهای ردیف بعدی جای آن را نمی‌گیرند
 * و متن نادرست یا خطای کادرِ ردیف حذف‌شده به ردیف دیگر نمی‌رسد. ردیف‌هایی که از پیش‌نویس یا سند ذخیره‌شده بازمی‌گردند
 * همیشه کلید تازه می‌گیرند، چون کلید کهنه ممکن است با کلید ردیف تازه یکی شود.
 */
export interface KeyedRow {
  rowKey?: string;
}

let lastRowKey = 0;

function newRowKey(): string {
  lastRowKey += 1;
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `row-${uuid}` : `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${lastRowKey}`;
}

export function withRowKey<T extends object>(row: T): T & KeyedRow {
  if ((row as KeyedRow).rowKey) return row;
  return { ...row, rowKey: newRowKey() };
}

export function withRowKeys<T extends object>(rows: T[]): Array<T & KeyedRow> {
  return rows.map(row => withRowKey(row));
}

/** ردیف‌های بازگشته از پیش‌نویس یا سند ذخیره‌شده: هر کلید مانده کنار گذاشته و کلید تازه داده می‌شود */
export function withFreshRowKeys<T extends object>(rows: T[]): Array<T & KeyedRow> {
  return rows.map(row => ({ ...row, rowKey: newRowKey() }));
}

/** رونوشت ردیف بی کلید مرورگر، برای پیش‌نویس یا هر داده‌ای که ذخیره می‌شود */
export function withoutRowKey<T extends object>(row: T): Omit<T, 'rowKey'> {
  const copy = { ...row } as T & KeyedRow;
  delete copy.rowKey;
  return copy;
}

export function rowKeyOf(row: KeyedRow, index: number): string {
  return row.rowKey ?? `index-${index}`;
}
