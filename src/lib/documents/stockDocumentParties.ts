import type { Item } from '../../types';
import type { Personnel } from '../../types/personnel.types';
import { invoiceReturnTerms, type ReturnSourceLine } from './returnUnitPrice';

/**
 * v10.0.29 (OBS-R1-101): ردیف‌های برگشت از فاکتور مرجع کالای کامل فهرست کالاها را می‌گیرند (موجودی، دسته، واحد)؛
 * پیش‌تر فقط شناسه، نام، کد و واحد فاکتور را داشتند و جدول جزئیات سند برای آن‌ها موجودی نشان نمی‌داد.
 * کالایی که در فهرست نیست همان شکل کوتاه فاکتور را نگه می‌دارد.
 */
export interface ReturnInvoiceItemLine extends ReturnSourceLine {
  name?: string;
  code?: string;
  unit?: string;
}

export interface ReturnRow {
  item: Item;
  quantity: number;
  unitPrice: number;
}

export function returnRowsFromInvoice(lines: readonly ReturnInvoiceItemLine[], itemsList: readonly Item[]): ReturnRow[] {
  const terms = invoiceReturnTerms(lines);
  const rows: ReturnRow[] = [];
  for (const [itemId, t] of terms) {
    const line = lines.find(l => Number(l.itemId) === itemId);
    const listed = itemsList.find(it => Number(it.id) === itemId);
    rows.push({
      item: listed ?? ({ id: itemId, name: line?.name ?? '', code: line?.code ?? '', unit: line?.unit ?? '' } as Item),
      quantity: t.quantity.toNumber(),
      unitPrice: t.netUnitPrice.toNumber(),
    });
  }
  return rows;
}

/**
 * v10.0.30 (OBS-R1-99): تحویل‌گیرنده حواله با شناسه پرسنل انتخاب و پیدا می‌شود، نه با نام کامل؛ دو کارمند هم‌نام
 * دیگر یکی دیده نمی‌شوند. نام نمایشی همان نامی است که در سند (`buyer_name`) ثبت می‌شود.
 */
export function personnelDisplayName(p: Pick<Personnel, 'fullName' | 'firstName' | 'lastName'>): string {
  return p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'پرسنل';
}

export function personnelById<T extends Pick<Personnel, 'id'>>(list: readonly T[], id: number | null): T | null {
  if (id === null) return null;
  return list.find(p => Number(p.id) === id) ?? null;
}
