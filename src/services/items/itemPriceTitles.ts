import { and, eq, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { itemPrices, items } from '../../db/schema.js';
import { priceListMatcher } from '../../lib/items/excelPriceColumns.js';
import type { HealthCheckTestResult } from '../../types.js';
import { ItemPricingService } from './itemPricing.service.js';

/**
 * v9.0.114 (TD-647، تصمیم ت۱ الف): قیمت فعال با عنوانی که فهرست قیمت تنظیم‌شده نیست. مهاجرت 0063 فقط ردیف‌های
 * «میانگین خرید (WAC)»، «موجودی کل» و «میانگین بهای خرید» را نرم حذف کرد؛ عنوان ناشناخته دیگر (مثلاً فهرستی که از تنظیمات
 * حذف شده یا ستون دیگری از ورود اکسل پیشین) دست نمی‌خورد و فقط این‌جا فهرست می‌شود. کشوی قیمت فاکتور آن را نشان نمی‌دهد.
 */
export interface UnknownPriceTitleRow {
  title: string;
  priceCount: number;
  itemCount: number;
}

export async function findUnknownPriceTitles(executor: DbExecutor = orm, strategies?: string[]): Promise<UnknownPriceTitleRow[]> {
  const matcher = priceListMatcher(strategies ?? await ItemPricingService.getPricingStrategies());
  const rows = await executor
    .select({
      title: sql<string>`btrim(${itemPrices.title})`,
      priceCount: sql<number>`count(*)::int`,
      itemCount: sql<number>`count(DISTINCT ${itemPrices.itemId})::int`,
    })
    .from(itemPrices)
    .innerJoin(items, eq(items.id, itemPrices.itemId))
    .where(and(eq(itemPrices.isDeleted, 0), eq(items.isDeleted, 0)))
    .groupBy(sql`btrim(${itemPrices.title})`)
    .orderBy(sql`btrim(${itemPrices.title})`);
  return rows.filter(r => !matcher.match(r.title)).map(r => ({ title: r.title, priceCount: Number(r.priceCount), itemCount: Number(r.itemCount) }));
}

export function buildUnknownPriceTitleHealthTest(rows: UnknownPriceTitleRow[]): HealthCheckTestResult {
  const prices = rows.reduce((n, r) => n + r.priceCount, 0);
  return {
    id: 'item_price_unknown_title',
    category: 'inventory',
    title: 'قیمت کالا با عنوانی بیرون از فهرست‌های قیمت',
    description: 'هر قیمت فعال کالا باید به یکی از فهرست‌های قیمت تنظیم‌شده تعلق داشته باشد',
    status: rows.length > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, rows.length),
    count: prices,
    message: rows.length > 0
      ? `${prices} قیمت فعال با ${rows.length} عنوان بیرون از فهرست‌های قیمت تنظیم‌شده هست. این قیمت‌ها در فاکتور پیشنهاد نمی‌شوند و خودکار پاک نمی‌شوند؛ آن‌ها را بررسی کنید.`
      : 'همه قیمت‌های فعال کالا به فهرست‌های قیمت تنظیم‌شده تعلق دارند.',
    items: rows.map((r, i) => ({
      id: i + 1,
      code: r.title,
      title: `«${r.title}»`,
      subtitle: `${r.priceCount} قیمت برای ${r.itemCount} کالا`,
      details: 'عنوان در فهرست‌های قیمت تنظیمات نیست (TD-647).',
    })),
    metrics: { unknownTitles: rows.length, unknownTitlePrices: prices },
  };
}
