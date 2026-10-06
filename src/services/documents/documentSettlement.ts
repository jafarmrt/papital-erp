import { and, eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { treasuryTransactions } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import type { FinancialDecimal } from '../../lib/financialDecimal.js';
import type { Money } from '../../lib/money.js';

/** ردیف خزانه‌ای که در جمع تسویه یک سند خوانده می‌شود */
export interface SettlementRow {
  id: number;
  documentId: number | null;
  amount: Money;
  type: string;
  status: string | null;
  reversalOfId: number | null;
}

/**
 * v9.0.68 (TD-500، B04-04): ردیف‌های خزانه سندها برای جمع تسویه: کامل‌ها و باطل‌شده‌ها (حذف‌نشده).
 * ابطال، ردیف اصل را «باطل» می‌کند و ردیف معکوسش را با همان `documentId` کامل ثبت می‌کند؛ هر دو باید در جمع باشند.
 */
export async function fetchSettlementRows(docIds: number[]): Promise<SettlementRow[]> {
  if (docIds.length === 0) return [];
  return orm.select({
    id: treasuryTransactions.id,
    documentId: treasuryTransactions.documentId,
    amount: treasuryTransactions.amount,
    type: treasuryTransactions.type,
    status: treasuryTransactions.status,
    reversalOfId: treasuryTransactions.reversalOfId,
  })
  .from(treasuryTransactions)
  .where(and(
    inArray(treasuryTransactions.documentId, docIds),
    eq(treasuryTransactions.isDeleted, 0),
    inArray(treasuryTransactions.status, ['completed', 'voided'])
  ));
}

/**
 * v7.0.67 (P2-6): جمع خالص تسویه‌های خزانه یک سند با Decimal؛ خرید با پرداخت و فروش با دریافت تسویه می‌شود.
 * v9.0.68 (TD-500، B04-04): ردیف کامل شمرده می‌شود و ردیف باطلی هم که ردیف معکوسش در همین ردیف‌هاست؛ اصلِ باطل و
 * معکوسش با هم صفر می‌شوند. پیش‌تر اصل کنار می‌رفت و معکوس کم می‌شد، پس اثر دریافت دو بار حذف می‌شد و دریافت درست بعدی
 * فقط آن منفی پنهان را جبران می‌کرد. ردیف باطلی که معکوس ندارد (داده قدیمی) شمرده نمی‌شود، مانند پیش.
 */
export function settledAmount(rows: SettlementRow[], isPurchase: boolean): FinancialDecimal {
  const settling = isPurchase ? 'payment' : 'receipt';
  const reversed = new Set(rows.map(t => t.reversalOfId).filter((id): id is number => id !== null));
  return rows
    .filter(t => t.status === 'completed' || (t.status === 'voided' && reversed.has(t.id)))
    .reduce((sum, t) => (t.type === settling ? sum.add(t.amount) : sum.subtract(t.amount)), fin(0));
}
