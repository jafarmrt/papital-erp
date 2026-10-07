import { and, asc, eq } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { itemPrices, items } from '../../db/schema.js';
import { getStrategyCanonicalKey } from '../../utils.js';
import type { HealthCheckTestResult } from '../../types.js';
import { priceCurrencyOf } from '../../lib/items/priceInput.js';

/**
 * v9.0.165 (TD-660، B05-14): چند قیمت فعال برای یک فهرست قیمت یک کالا. نوشتن قیمت اکنون زیر قفل ردیف کالاست و تکرار
 * تازه نمی‌سازد؛ تکرارهای پیشین (ذخیره‌های هم‌زمان پیش از این نسخه) دست نمی‌خورند و فقط این‌جا فهرست می‌شوند.
 * خواندن قیمت همچنان آخرین ردیف را نشان می‌دهد و نخستین ذخیره بعدی آن فهرست همه ردیف‌های فعالش را کنار می‌گذارد.
 */
export interface DuplicateActivePriceGroup {
  itemId: number;
  itemCode: string;
  itemName: string;
  title: string;
  priceIds: number[];
}

async function activePriceRows(executor: DbExecutor) {
  return executor
    .select({ id: itemPrices.id, itemId: itemPrices.itemId, title: itemPrices.title, code: items.code, name: items.name })
    .from(itemPrices)
    .innerJoin(items, eq(items.id, itemPrices.itemId))
    .where(and(eq(itemPrices.isDeleted, 0), eq(items.isDeleted, 0)))
    .orderBy(asc(itemPrices.itemId), asc(itemPrices.id));
}

export async function findDuplicateActivePrices(executor: DbExecutor = orm): Promise<DuplicateActivePriceGroup[]> {
  const groups = new Map<string, DuplicateActivePriceGroup>();
  for (const row of await activePriceRows(executor)) {
    const key = getStrategyCanonicalKey(row.title);
    if (!key) continue;
    const mapKey = `${row.itemId}|${key}`;
    const group = groups.get(mapKey) ?? { itemId: row.itemId, itemCode: row.code, itemName: row.name, title: row.title.trim(), priceIds: [] };
    group.priceIds.push(row.id);
    groups.set(mapKey, group);
  }
  return [...groups.values()].filter(g => g.priceIds.length > 1);
}

export function buildDuplicateActivePriceHealthTest(groups: DuplicateActivePriceGroup[]): HealthCheckTestResult {
  return {
    id: 'item_price_duplicate_active',
    category: 'inventory',
    title: 'چند قیمت فعال برای یک فهرست قیمت کالا',
    description: 'هر فهرست قیمت هر کالا باید یک قیمت فعال داشته باشد',
    status: groups.length > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, groups.length),
    count: groups.length,
    message: groups.length > 0
      ? `${groups.length} فهرست قیمت کالا بیش از یک قیمت فعال دارد. فاکتور آخرین قیمت را پیشنهاد می‌کند و ذخیره بعدی آن فهرست ردیف‌های اضافی را کنار می‌گذارد؛ خودکار پاک نمی‌شوند.`
      : 'هر فهرست قیمت کالا یک قیمت فعال دارد.',
    items: groups.map(g => ({
      id: g.itemId,
      code: g.itemCode,
      title: `${g.itemName} — «${g.title}»`,
      subtitle: `${g.priceIds.length} قیمت فعال`,
      details: `شناسه ردیف‌ها: ${g.priceIds.join('، ')} (TD-660)`,
    })),
    metrics: { duplicateGroups: groups.length },
  };
}

/**
 * v9.0.166 (TD-657 بخش قیمت، تصمیم ت۹ الف): قیمت فعال با مبلغ صفر یا منفی، یا ارزی بیرون از فهرست AGENTS §6. نوشتن تازه
 * چنین قیمتی را نمی‌پذیرد؛ ردیف‌های پیشین دست نمی‌خورند و فقط این‌جا فهرست می‌شوند (کشوی قیمت فاکتور قیمتی با ارز
 * ناشناخته را با ارز سند جور نمی‌کند و نشان نمی‌دهد).
 */
export interface InvalidActivePriceRow {
  priceId: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  title: string;
  price: string;
  currency: string;
  reason: 'amount' | 'currency';
}

export async function findInvalidActivePrices(executor: DbExecutor = orm): Promise<InvalidActivePriceRow[]> {
  const rows = await executor
    .select({ id: itemPrices.id, itemId: itemPrices.itemId, title: itemPrices.title, price: itemPrices.price, currency: itemPrices.currency, code: items.code, name: items.name })
    .from(itemPrices)
    .innerJoin(items, eq(items.id, itemPrices.itemId))
    .where(and(eq(itemPrices.isDeleted, 0), eq(items.isDeleted, 0)))
    .orderBy(asc(itemPrices.itemId), asc(itemPrices.id));
  const invalid: InvalidActivePriceRow[] = [];
  for (const r of rows) {
    const reason = !r.price.isPositive() ? 'amount' : (priceCurrencyOf(r.currency) === null ? 'currency' : null);
    if (!reason) continue;
    invalid.push({ priceId: r.id, itemId: r.itemId, itemCode: r.code, itemName: r.name, title: r.title.trim(), price: r.price.toString(), currency: String(r.currency ?? ''), reason });
  }
  return invalid;
}

export function buildInvalidActivePriceHealthTest(rows: InvalidActivePriceRow[]): HealthCheckTestResult {
  const amounts = rows.filter(r => r.reason === 'amount').length;
  return {
    id: 'item_price_invalid_amount_currency',
    category: 'inventory',
    title: 'قیمت کالا با مبلغ نامعتبر یا ارز ناشناخته',
    description: 'هر قیمت فعال کالا باید بزرگ‌تر از صفر و به یکی از ارزهای ریال، دلار، یورو، درهم یا پوند باشد',
    status: rows.length > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, rows.length),
    count: rows.length,
    message: rows.length > 0
      ? `${rows.length} قیمت فعال (${amounts} با مبلغ صفر یا منفی، ${rows.length - amounts} با ارز ناشناخته) هست. این قیمت‌ها خودکار تغییر نمی‌کنند؛ در صفحه قیمت‌گذاری اصلاح یا حذفشان کنید.`
      : 'همه قیمت‌های فعال کالا مبلغ مثبت و ارز پشتیبانی‌شده دارند.',
    items: rows.map(r => ({
      id: r.priceId,
      code: r.itemCode,
      title: `${r.itemName} — «${r.title}»`,
      subtitle: `${r.price} ${r.currency}`,
      details: r.reason === 'amount' ? 'مبلغ صفر یا منفی (TD-657)' : `ارز «${r.currency}» پشتیبانی نمی‌شود (TD-657)`,
    })),
    metrics: { invalidAmount: amounts, invalidCurrency: rows.length - amounts },
  };
}
