import { inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { appSettings } from '../../db/schema.js';
import type { WcConnectionFields } from '../../lib/woocommerce/wcConnectionTest.js';

const CONNECTION_KEYS = ['wc_store_url', 'wc_consumer_key', 'wc_consumer_secret'] as const;

/**
 * نشانی فروشگاه و کلیدهای ذخیره‌شده ووکامرس (کلید نبود = رشته خالی). مسیرهای همگام‌سازی و «آزمایش اتصال» از همین
 * می‌خوانند (v9.0.322، TD-723).
 */
export async function readWcConnectionSettings(executor: DbExecutor = orm): Promise<WcConnectionFields> {
  const rows = await executor.select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, [...CONNECTION_KEYS]));
  const valueOf = (key: string) => rows.find(r => r.key === key)?.value ?? '';
  return {
    url: valueOf('wc_store_url'),
    consumerKey: valueOf('wc_consumer_key'),
    consumerSecret: valueOf('wc_consumer_secret'),
  };
}
