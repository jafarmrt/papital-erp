import { fin, type DecimalValue } from '../financialDecimal.js';

/**
 * v9.0.11 (TD-422، تصمیم مالک محصول ت۷): ارزش پرونده‌های فروش همیشه به تفکیک ارز جمع می‌شود (قاعده TD-260: مبلغ ارزی
 * خام با ریال جمع نمی‌شود). مشترک سرور (آمار ارتباط با مشتری) و مرورگر (پرونده مشتری).
 */
export interface CurrencyTotal {
  currency: string;
  count: number;
  value: number;
}

/** پاسخ `GET /crm/stats` */
export interface CrmStats {
  activeLeadsCount: number;
  pipelineByCurrency: CurrencyTotal[];
  wonLeadsCount: number;
  wonByCurrency: CurrencyTotal[];
  pendingFollowupsCount: number;
  stageCounts: Record<string, { count: number; byCurrency: CurrencyTotal[] }>;
}

/** ارز پرونده: کد ارز با حروف بزرگ؛ خالی یعنی ریال */
export function leadCurrency(currency: string | null | undefined): string {
  const code = String(currency ?? '').trim().toUpperCase();
  return code || 'IRR';
}

/** ریال اول، سپس ارزهای دیگر به ترتیب الفبا */
export function sortCurrencyTotals<T extends { currency: string }>(totals: T[]): T[] {
  return [...totals].sort((a, b) => (a.currency === 'IRR' ? -1 : b.currency === 'IRR' ? 1 : a.currency.localeCompare(b.currency)));
}

export function sumByCurrency(leads: ReadonlyArray<{ currency?: string | null; estimatedValue?: DecimalValue }>): CurrencyTotal[] {
  const totals = new Map<string, { count: number; value: ReturnType<typeof fin> }>();
  for (const lead of leads) {
    const currency = leadCurrency(lead.currency);
    const current = totals.get(currency) ?? { count: 0, value: fin(0) };
    totals.set(currency, { count: current.count + 1, value: current.value.add(lead.estimatedValue ?? 0) });
  }
  return sortCurrencyTotals([...totals].map(([currency, t]) => ({ currency, count: t.count, value: t.value.toNumber() })));
}
