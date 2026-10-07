import { asc, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { warehouses } from '../../db/schema.js';
import { ITEM_WAC_COLUMN, priceExportCells, priceListMatcher } from '../../lib/items/excelPriceColumns.js';
import { ITEM_REORDER_POINT_COLUMN } from '../../lib/items/itemExcelColumns.js';
import { ItemPricingService } from './itemPricing.service.js';

/** کد نمونه الگو: محصول نهایی دسته «گردنبند» (پیشوند N) با قالب `PRODUCT_CODE_PATTERN` */
export const ITEM_TEMPLATE_SAMPLE_CODE = '1404-N-101-01';
const SAMPLE_STOCK_PER_WAREHOUSE = 10;

/**
 * v9.0.201 (O8 بسته ۵): الگوی ورود اکسل کالا را سرور می‌سازد، با همان سرستون‌هایی که ورود می‌خواند: انبارهای فعال، فهرست‌های
 * قیمت تنظیم‌شده با ستون ارز هر کدام، و «موجودی کل» برابر جمع انبارها. پیش‌تر مرورگر الگو را از خروجی کامل
 * (`/items/unified-export`) می‌ساخت که همه کالاها را می‌خواند و یک ردیف ممیزی «EXPORT» می‌نوشت، و نمونه آن (۱۰۰ کل و ۵۰ در
 * هر انبار) با دو انبار یا بیشتر خطای «موجودی کل با جمع موجودی انبارها برابر نیست» می‌گرفت.
 */
export async function buildItemExcelTemplate(): Promise<{ rows: Array<Record<string, unknown>> }> {
  const activeWarehouses = await orm.select({ code: warehouses.code, name: warehouses.name }).from(warehouses)
    .where(eq(warehouses.isActive, 1)).orderBy(asc(warehouses.id));
  const titles = priceListMatcher(await ItemPricingService.getPricingStrategies()).titles;

  const row: Record<string, unknown> = {
    'کد کالا': ITEM_TEMPLATE_SAMPLE_CODE,
    'نام محصول': 'گردنبند طلایی طرح لوتوس',
    'نوع کالا': 'محصول نهایی',
    'دسته‌بندی': 'گردنبند',
    'واحد': 'عدد',
    'موجودی کل': SAMPLE_STOCK_PER_WAREHOUSE * activeWarehouses.length,
  };
  for (const w of activeWarehouses) row[`موجودی انبار ${w.name}`] = SAMPLE_STOCK_PER_WAREHOUSE;
  row[ITEM_REORDER_POINT_COLUMN] = 20;
  row[ITEM_WAC_COLUMN] = 1500000;
  row['تصویر'] = '';
  row['رنگ'] = 'طلایی';
  row['سایز'] = 'استاندارد';
  row['وزن'] = 15;
  row['جنس'] = 'استیل';
  Object.assign(row, priceExportCells(titles, () => ({ price: 2500000, currency: 'IRR' })));
  return { rows: [row] };
}
