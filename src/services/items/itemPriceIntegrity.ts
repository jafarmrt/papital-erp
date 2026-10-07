import { and, asc, eq } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { itemPrices, items } from '../../db/schema.js';
import { getStrategyCanonicalKey } from '../../utils.js';
import type { HealthCheckTestResult } from '../../types.js';

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
