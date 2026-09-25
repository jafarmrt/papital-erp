# برنامه اصلاح: ثبت فاکتور، اختلاف موجودی و بدهی‌های فنی جانبی

> **وضعیت:** برنامه مصوب کاربر (2510-03 جلالی) — اجرا توسط عامل بعدی. علت‌ها با ممیزی کد و کوئری‌های فقط‌خواندنی روی دیتابیس محلی تأیید شده‌اند. این سند تغییر کدی ایجاد نمی‌کند؛ اجرای فازها طبق جدول «ترتیب انتشار» انجام می‌شود.

## بخش الف: قواعد الزامی برای عامل اجراکننده

1. قواعد `AGENTS.md` بخش ۲۳ ملاک است:
   - هر انتشار یک ورودی در `src/data/changelogs/5.ts` دارد و نسخه `package.json` بالا می‌رود.
   - بخش‌های ۷ و ۱۳ همان فایل هنوز به `4.ts` اشاره می‌کنند. این تناقض است (بدهی TD-127) و نباید از آن‌ها پیروی شود؛ ملاک بخش ۲۳ است.
2. تغییر ساختار دیتابیس فقط با یک فایل SQL تازه در `drizzle/` و یک ردیف در `drizzle/meta/_journal.json` انجام می‌شود:
   - مقدار `when` باید از `1789228800000` (مهاجرت 0008) بزرگ‌تر باشد، وگرنه مهاجرت اجرا نمی‌شود.
   - `db:push` ممنوع است؛ مهاجرت‌ها فقط از migrator اتمیک.
3. ای‌استودیو مدام `package-lock.json` را حذف می‌کند (TD-129). اگر حذف شده بود، با `npm install` دوباره ساخته و همراه کامیت شود.
4. تأیید بعد از هر فاز:
   ```powershell
   npm run lint; npm run check:version; npm run test:full
   $env:ERP_TEST_SCHEMA_ISOLATION='1'; npm run test:full; Remove-Item Env:ERP_TEST_SCHEMA_ISOLATION
   ```
   اجرای دوم روی یک schema تازه اجرا می‌شود که فقط از مهاجرت‌ها ساخته شده است. دیتابیس توسعه محلی نماینده نصب تازه **نیست**، چون کلیدهای فاز ۰ را دارد و پروداکشن ندارد — به همین دلیل این باگ در تست‌ها پنهان مانده بود (TD-134).
5. هر بدهی که ایجاد یا بسته می‌شود در `TECH_DEBT.md` ثبت شود. شماره‌های جدید از TD-113 شروع شده‌اند و همین حالا در دفتر ثبت شده‌اند.
6. هر تغییر وضعیت دیتابیس، پیش از اجرا با بکاپ `update.sh` محافظت می‌شود؛ مهاجرت‌های اصلاح داده باید پشتیبان (`_repair_*` جدول) بسازند.

---

## فاز ۰ (P0، مانع پروداکشن): جدول‌های شمارنده کلید یکتا ندارند (TD-113)

**علامت:** هر فاکتور در پروداکشن خطای ۵۰۰ می‌گیرد. لاگ سرور:
`Failed query: insert into "document_ref_counters" ... on conflict ("doc_type","fiscal_year") do update ...`

**علت فنی:**
- `drizzle/0000_v3_baseline.sql:154-163` جدول‌های `document_ref_counters` و `item_code_counters` را **بدون PRIMARY KEY** می‌سازد. هیچ‌کدام از مهاجرت‌های 0001 تا 0008 آن را اضافه نمی‌کنند.
- در کد Drizzle این کلیدها تعریف شده‌اند (`src/db/schema/documents.ts:43` و `src/db/schema/inventory.ts:79`)، ولی تعریف Drizzle ساختار واقعی دیتابیس را نمی‌سازد.
- PostgreSQL فرمان `ON CONFLICT (cols)` را فقط وقتی قبول می‌کند که روی همان ستون‌ها ایندکس یکتا وجود داشته باشد؛ در غیر این صورت خطای `there is no unique or exclusion constraint matching the ON CONFLICT specification` برمی‌گردد.
- صفحه فاکتور شماره را از قبل می‌گیرد (`peekNextRef`) و می‌فرستد. در نتیجه همیشه شاخه شماره دستی اجرا می‌شود (`document.service.ts:462-495`). اگر ردیف شمارنده آن سال وجود نداشته باشد، INSERT همراه ON CONFLICT اجرا می‌شود و کل تراکنش برمی‌گردد. ردیف هیچ‌وقت ساخته نمی‌شود، پس همه فاکتورهای بعدی هم خطا می‌گیرند.
- دیتابیس محلی قدیمی‌تر از فایل پایه است و کلید `document_ref_counters_pkey` را دارد؛ به همین دلیل تست‌ها خطا را نشان نداده‌اند.

**مسیرهای دیگری که به همین مشکل وابسته‌اند:**
- `document.service.ts:381` (شماره خودکار سند)
- `procurement.service.ts:80-86` (شماره درخواست خرید)
- `itemCatalog.service.ts:236-242` (کد پیشنهادی کالا)

**اصلاح — فایل جدید `drizzle/0009_counter_primary_keys.sql`:**

```sql
-- V5.0.13 (TD-113): کلید اصلی جدول‌های شمارنده روی نصب‌های تازه (پایه آن را نداشت)
-- تکرار اجرا بی‌خطر است؛ داخل تراکنش اتمیک مهاجرت Drizzle اجرا می‌شود.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_ref_counters'::regclass AND contype = 'p'
  ) THEN
    -- ادغام ردیف‌های تکراری: بزرگ‌ترین شماره نگه داشته می‌شود
    CREATE TEMP TABLE _drc_dedup ON COMMIT DROP AS
      SELECT doc_type, fiscal_year, MAX(last_ref_number) AS last_ref_number
      FROM document_ref_counters GROUP BY doc_type, fiscal_year;
    DELETE FROM document_ref_counters;
    INSERT INTO document_ref_counters (doc_type, fiscal_year, last_ref_number)
      SELECT doc_type, fiscal_year, last_ref_number FROM _drc_dedup;
    ALTER TABLE document_ref_counters
      ADD CONSTRAINT document_ref_counters_pkey PRIMARY KEY (doc_type, fiscal_year);
    RAISE NOTICE 'TD-113: document_ref_counters_pkey created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'item_code_counters'::regclass AND contype = 'p'
  ) THEN
    CREATE TEMP TABLE _icc_dedup ON COMMIT DROP AS
      SELECT scope, prefix_key, MAX(last_number) AS last_number
      FROM item_code_counters GROUP BY scope, prefix_key;
    DELETE FROM item_code_counters;
    INSERT INTO item_code_counters (scope, prefix_key, last_number)
      SELECT scope, prefix_key, last_number FROM _icc_dedup;
    ALTER TABLE item_code_counters
      ADD CONSTRAINT item_code_counters_pkey PRIMARY KEY (scope, prefix_key);
    RAISE NOTICE 'TD-113: item_code_counters_pkey created';
  END IF;
END $$;
```

و این ردیف به `drizzle/meta/_journal.json` اضافه شود:

```json
{ "idx": 9, "version": "7", "when": 1789315200000, "tag": "0009_counter_primary_keys", "breakpoints": true }
```

**تست جلوگیری از تکرار** در `src/tests/suites/databaseSuite.ts`، با همان الگوی `makeTestCase` آن فایل:

```ts
// هر جدولی که در ON CONFLICT(target) به کار می‌رود باید ایندکس یکتای کامل روی همان ستون‌ها داشته باشد
const REQUIRED_CONFLICT_TARGETS: Array<{ table: string; columns: string[] }> = [
  { table: 'document_ref_counters', columns: ['doc_type', 'fiscal_year'] },
  { table: 'item_code_counters', columns: ['prefix_key', 'scope'] },
  { table: 'app_settings', columns: ['key'] },
  { table: 'idempotency_keys', columns: ['created_by_id', 'key', 'scope'] },
  { table: 'project_product_stage_progress', columns: ['item_id', 'project_id', 'stage_order'] },
];
const tStart = Date.now();
try {
  const missing: string[] = [];
  for (const t of REQUIRED_CONFLICT_TARGETS) {
    const r = await orm.execute(sql`
      SELECT array_agg(a.attname::text ORDER BY a.attname) AS cols
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
      WHERE c.relname = ${t.table}::text AND i.indisunique AND i.indpred IS NULL
      GROUP BY i.indexrelid`);
    const ok = (r.rows as Array<{ cols: string[] }>)
      .some(row => JSON.stringify(row.cols) === JSON.stringify([...t.columns].sort()));
    if (!ok) missing.push(`${t.table}(${t.columns.join(',')})`);
  }
  results.push(makeTestCase({
    id: 'db_on_conflict_targets_have_unique_index', scenarioId: 'db_readiness',
    name: 'ایندکس یکتای متناظر برای همه اهداف ON CONFLICT', layer: 'database',
    executionType: 'real_database', passed: missing.length === 0, durationMs: Date.now() - tStart,
    ...(missing.length ? { error: `بدون ایندکس یکتا: ${missing.join('، ')}` } : { details: 'همه اهداف پوشش دارند' })
  }));
} catch (err: any) {
  results.push(makeTestCase({
    id: 'db_on_conflict_targets_have_unique_index', scenarioId: 'db_readiness',
    name: 'ایندکس یکتای متناظر برای همه اهداف ON CONFLICT', layer: 'database',
    executionType: 'real_database', passed: false, durationMs: Date.now() - tStart, error: err.message
  }));
}
```

**معیار پذیرش:**
- با `ERP_TEST_SCHEMA_ISOLATION=1`، این تست پیش از اعمال 0009 رد شود و پس از آن قبول شود.
- پس از `update.sh` روی سرور، `\d document_ref_counters` کلید `PRIMARY KEY` را نشان دهد و فاکتور ثبت شود.

**بهبود اختیاری:** خطاهای خام دیتابیس در error handler به `DatabaseError` با پیام فارسی و traceId ترجمه شوند، نه ۵۰۰ بی‌توضیح.

---

## فاز ۱ (P1): اختلاف موجودی کل با موجودی انبار از کلیدهای شبح (TD-114/115/116/117)

**علامت:** موجودی کل با جمع انبارهای قابل‌مشاهده برابر نیست، و فروش بیش از موجودی واقعی انبار رد می‌شود.

**علت فنی:** `items.current_stock` برابر جمع همه کلیدهای `items.stocks` است (`document.service.ts:1157`). ولی صفحه فقط کلیدی را نشان می‌دهد که با کد یک انبار فعال یکی باشد، و بررسی سرور هم فقط `stocks[code]` را می‌سنجد (`document.service.ts:1100`). هر کلید دیگر «موجودی شبح» است: در جمع کل هست، ولی دیده نمی‌شود و قابل فروش نیست.

**شاهد از دیتابیس محلی:**
- کالای `T-001` (id 1152): `stocks = {"main":150,"انبار اصلی":60}` و `current_stock = 210`.
- این ۶۰ عدد از دو رسید تدارکات (سندهای 829 و 830، شماره ۱۸ و ۱۹) آمده که `location` را برابر «انبار اصلی» (نام انبار) ثبت کرده‌اند، نه `main` (کد انبار) — هم در `document_items` و هم در `transactions`.

### ۱-الف) تشخیص و تبدیل کد انبار در یک نقطه (TD-114)

فایل جدید `src/services/inventory/warehouseResolver.ts`:

```ts
import { eq } from 'drizzle-orm';
import { warehouses } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logger } from '../../middleware/logger.js';
import type { DbClient } from '../document.service.js';

/** هر ورودی (کد، نام یا خالی) را به کد یک انبار فعال تبدیل می‌کند، یا خطای 422 می‌دهد. */
export async function resolveWarehouseCode(tx: DbClient, raw: unknown): Promise<string> {
  const input = String(raw ?? '').trim();
  const active = await tx.select({ code: warehouses.code, name: warehouses.name })
    .from(warehouses).where(eq(warehouses.isActive, 1));
  if (active.length === 0) {
    throw new ValidationError('هیچ انبار فعالی تعریف نشده است. از تنظیمات ← مدیریت انبارها یک انبار بسازید.');
  }
  if (!input) return active[0].code;
  const byCode = active.find(w => w.code === input);
  if (byCode) return byCode.code;
  const byName = active.find(w => (w.name || '').trim() === input);
  if (byName) {
    logger.warn({ message: `[WarehouseResolver] name used instead of code: "${input}" -> "${byName.code}"` });
    return byName.code;
  }
  throw new ValidationError(`انبار «${input}» تعریف نشده یا غیرفعال است.`);
}
```

جاهای مصرف:
- **`DocumentService.applyStockMovement`** (`document.service.ts:1058-1065`): به‌جای منطق فعلی `finalTargetLoc` از `await resolveWarehouseCode(tx, targetLoc)`.
- **`createDocument`** (حلقه خط 579 و شاخه audit خط 521) و **`updateDocument`** (خط 244): کد انبار **پیش از** درج `document_items` حل شود تا ستون `location` همیشه کد باشد.
- **`finalizeDocument`** (خط 1319): همان تبدیل.
- **`applyStockReversal`** نباید برای کلیدهای قدیمی خطا بدهد؛ برگشت با همان `location` ذخیره‌شده خودش انجام شود. پس آنجا resolver فراخوانی نشود.

### ۱-ب) حذف نام‌های ثابت انبار از کد (TD-115)

پیش‌فرض‌های ثابت حذف شوند؛ مقدار خالی به سرور برود و سرور با `resolveWarehouseCode` تعیین کند:
- `src/components/procurement/SplitOrderModal.tsx:61,125`
- `src/services/procurement.service.ts:662,983,998`
- `src/components/project/CreatePurchaseOrderModal.tsx:189,197`
- `src/components/reorder/ReorderPurchaseModal.tsx:159`

**نقاط `'main'`** (در پروداکشن فعلاً بی‌خطر چون راه‌اندازی اولیه انبار را با کد `main` می‌سازد — `auth.routes.ts:249`، ولی با کد انبار متفاوت همان کلید شبح را می‌سازند):
- `woocommerce.routes.ts:267`، `documents.routes.ts:413`
- `projectBomAllocation.service.ts:100,219,279,399,502,600,663`
- `kardexWacRecalculator.service.ts:55`، `itemCatalog.service.ts:419`، `document.service.ts:911`
- پیش‌فرض ستون‌ها: `schema/inventory.ts:61`، `schema/documents.ts:53`، `schema/projects.ts:89`

نمایش‌های صرفاً متنی (`ProcurementOrderList.tsx:180`، `ConfirmWarehouseDeliveryModal.tsx:114`) بی‌خطرند ولی بهتر است کد را به نام ترجمه کنند.

### ۱-ج) مهاجرت اصلاح داده (TD-116) — `drizzle/0010_repair_phantom_stock_keys.sql`

```sql
-- V5.0.13 (TD-116): ادغام کلیدهای شبح موجودی در کد انبار صحیح + پشتیبان برای بازگشت
DO $$
DECLARE r record; default_code text; unknown_keys text;
BEGIN
  SELECT code INTO default_code FROM warehouses WHERE is_active = 1 ORDER BY id LIMIT 1;
  IF default_code IS NULL THEN RAISE NOTICE 'TD-116: no active warehouse, skipped'; RETURN; END IF;

  CREATE TABLE IF NOT EXISTS _repair_0010_items_stocks_backup AS
    SELECT id, stocks, current_stock, now() AS backed_up_at FROM items WHERE false;
  INSERT INTO _repair_0010_items_stocks_backup (id, stocks, current_stock, backed_up_at)
    SELECT id, stocks, current_stock, now() FROM items
    WHERE EXISTS (SELECT 1 FROM jsonb_object_keys(stocks) k
                  WHERE k NOT IN (SELECT code FROM warehouses));

  -- نگاشت: نام هر انبار به کد همان انبار؛ برچسب‌های ثابت قدیمی به انبار پیش‌فرض
  FOR r IN
    SELECT name AS src, code AS dst FROM warehouses WHERE name IS NOT NULL AND name <> code
    UNION ALL SELECT 'انبار اصلی', default_code
    UNION ALL SELECT 'انبار مرکزی', default_code
  LOOP
    UPDATE items
      SET stocks = (stocks - r.src) || jsonb_build_object(
            r.dst, COALESCE((stocks->>r.dst)::numeric, 0) + COALESCE((stocks->>r.src)::numeric, 0))
      WHERE stocks ? r.src AND r.src <> r.dst;
    UPDATE transactions   SET location = r.dst WHERE location = r.src AND r.src <> r.dst;
    UPDATE document_items SET location = r.dst WHERE location = r.src AND r.src <> r.dst;
  END LOOP;

  -- هم‌ترازی موجودی کل با جمع انبارها (Single Source of Truth)
  UPDATE items i SET current_stock = s.total
  FROM (SELECT id, COALESCE((SELECT SUM(v::numeric) FROM jsonb_each_text(stocks) e(k, v)), 0) AS total FROM items) s
  WHERE s.id = i.id AND i.current_stock IS DISTINCT FROM s.total;

  -- کلیدهای ناشناخته (مثلاً انبار غیرفعال) خودکار جابه‌جا نمی‌شوند؛ فقط گزارش می‌شوند
  SELECT string_agg(DISTINCT k, '، ') INTO unknown_keys
  FROM items, jsonb_object_keys(stocks) k
  WHERE k NOT IN (SELECT code FROM warehouses WHERE is_active = 1) AND is_deleted = 0;
  IF unknown_keys IS NOT NULL THEN
    RAISE WARNING 'TD-116: stock keys not mapped to an active warehouse: %', unknown_keys;
  END IF;
END $$;
```

پس از مهاجرت، `stockReconciliation.service.ts` اجرا و گزارشش ضمیمه شود.

### ۱-د) غیرفعال‌کردن انباری که هنوز موجودی دارد (TD-117)

در `warehouses.routes.ts:65-70`:

```ts
const [wh] = await orm.select().from(warehouses).where(eq(warehouses.id, Number(req.params.id)));
if (!wh) throw new NotFoundError('انبار یافت نشد');
const res = await orm.execute(sql`
  SELECT COUNT(*)::int AS n FROM items
  WHERE is_deleted = 0 AND COALESCE((stocks->>${wh.code}::text)::numeric, 0) <> 0`);
if (Number((res.rows[0] as any)?.n) > 0) {
  throw new ConflictError(`انبار «${wh.name}» هنوز موجودی دارد؛ ابتدا موجودی را با سند انتقال خالی کنید.`);
}
```

همچنین POST/PUT/DELETE انبار با `logActivity` لاگ شوند (قاعده بخش ۵ AGENTS.md — الان هیچ‌کدام لاگ نمی‌شوند).

**معیار پذیرش فاز ۱:** سند با `location` نامعتبر خطای 422 می‌دهد؛ نام انبار به کد تبدیل می‌شود؛ کالای `T-001` مقدار `{"main":210}` می‌گیرد؛ برای همه کالاها `current_stock = Σ stocks`؛ تست رگرسیون در `regressionSuite.ts`.

---

## فاز ۲ (P1): محدودیت «فقط ۲ از ۳» به‌خاطر رزرو پنهان (TD-118)

**علت فنی:**
- `POST /documents` (`documents.routes.ts:238-273`) برای هر سند خروجی: `maxAllowed = currentStock − (رزرو پیش‌فاکتورهای باز + رزرو پروژه‌های فعال)`.
- صفحه فاکتور (`CreateInvoicePage.tsx:303-323`، `:359-381`، `:663-684`) فقط موجودی خام نشان می‌دهد و از رزروها خبر ندارد.
- **ناسازگاری:** مسیر `PUT /documents/:id/finalize` → `finalizeDocument` (`document.service.ts:1275`) این بررسی را ندارد.
- **خطر خود-رزروی:** در تبدیل پیش‌فاکتور به فاکتور، رزرو خودِ همان پیش‌فاکتور نباید از سقف کم شود.
- **ترکیب نادرست مبناها:** رزرو از موجودی کل کم می‌شود ولی خروج از یک انبار مشخص است.

**اصلاح:** یک تابع واحد در سرور، در `itemStockReservation.service.ts`:

```ts
export interface SellableStockContext {
  location: string;            // کد انبار (پس از resolveWarehouseCode)
  excludeDocumentId?: number;  // سندی که در حال نهایی‌شدن است (رزرو خودش حساب نشود)
  projectId?: number | null;   // رزرو همین پروژه آزاد است
}

/** قابل‌فروش = min(موجودی انبار مقصد، موجودی کل − رزرو دیگران) */
static computeSellable(
  summary: ItemReservedReportSummary | undefined,
  stocks: Record<string, number>,
  ctx: SellableStockContext
): { locationStock: number; reservedForOthers: number; sellable: number } {
  const locationStock = Number(stocks?.[ctx.location] || 0);
  const total = Object.values(stocks || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const reservedForOthers = (summary?.reservations || [])
    .filter(r => !(r.sourceType === 'proforma' && ctx.excludeDocumentId && Number(r.sourceId) === ctx.excludeDocumentId))
    .filter(r => !(r.sourceType === 'project' && ctx.projectId && Number(r.sourceId) === ctx.projectId))
    .reduce((s, r) => s + Number(r.reservedQty || 0), 0);
  const sellable = Math.max(0, Math.min(locationStock, total - reservedForOthers));
  return { locationStock, reservedForOthers, sellable };
}
```

- **سرور:** استفاده در `documents.routes.ts:238-273` و `finalizeDocument` (پیش از Step 2، با `excludeDocumentId: id`). محاسبه با `fin()` و پیام خطا شامل موجودی انبار، رزرو و قابل‌فروش.
- **پاسخ `/items`:** فیلدهای `reserved_stock` (موجود) و `available_stock` بر اساس انبار در `items.crud.routes.ts:204-234`.
- **سمت صفحه:** منطق سه‌بار تکرارشده در `CreateInvoicePage` در یک helper مشترک (`src/lib/stockAvailability.ts`) جمع شود. متن گزینه کالا: `«انبار مرکزی: ۳ | رزرو: ۱ | قابل فروش: ۲»`.

```ts
export function getSellableStock(item: any, location: string) {
  const loc = Number(item?.[`stock_${location}`] ?? item?.stocks?.[location] ?? 0) || 0;
  const total = Number(item?.current_stock ?? item?.currentStock ?? 0) || 0;
  const reserved = Number(item?.reserved_stock ?? 0) || 0;
  return { loc, total, reserved, sellable: Math.max(0, Math.min(loc, total - reserved)) };
}
```

- **نکته:** fallback خطوط 310-312/370-374/666-671 (fallback به `current_stock` وقتی `stock_<location>` نیست) حذف و صفر در نظر گرفته شود — الان انبار نامعتبر، موجودی کل را قابل‌فروش نشان می‌دهد.

**معیار پذیرش:** پیش‌فاکتور باز ۱ عدد رزرو کرده → صفحه «قابل فروش: ۲» و ثبت ۳ عدد رد با پیام روشن؛ تبدیل همان پیش‌فاکتور با ۳ عدد قبول؛ POST و finalize نتیجه یکسان.

---

## فاز ۳ (P2): تاریخ شمسی ذخیره‌شده به‌صورت سال میلادی ۱۴۰۵ (TD-119)

**شاهد:** ۴ سند `receipt` و ۲ ردیف `transactions` با تاریخ `1405-06-20 00:00:00` (میلادی) در دیتابیس محلی.

**علت احتمالی:**
- `procurement.service.ts:677` مقدار `date: getTodayJalaliDate()` (رشته شمسی سمت سرور — نقض قاعده ساعت کسب‌وکار).
- نسخه قدیمی‌تر `normalizeDateToDbTimestamp` تبدیل نمی‌کرد (utils.ts در کامیت `2cfe76b` ~۶۰۰ خط تغییر کرده).
- شاخه audit در `createDocument` (`document.service.ts:549`) هنوز `date` خام درج می‌کند نه `normalizedDocDate`.

**اصلاح:**
1. `procurement.service.ts:677`: `date: await businessTodayIsoDate()`.
2. `document.service.ts:549`: `date: normalizedDocDate`.
3. تست واحد: `normalizeDateToDbTimestamp('1405/06/20')` و `'1405-06-20'` باید معادل میلادی 2026-09-11 برگردانند (عامل با `jalaliToIsoDate` تأیید کند).
4. **اصلاح داده** در `migrator.ts` با الگوی Read-Calculate-Update (تبدیل تاریخ شمسی در SQL خالص پیچیده است):

```ts
// V5.0.14 (TD-119): تبدیل تاریخ‌های شمسی که به‌صورت سال میلادی ۱۳۰۰-۱۵۰۰ ذخیره شده‌اند
await orm.transaction(async (tx) => {
  for (const table of [documents, transactions, journalVouchers] as const) {
    const rows = await tx.select({ id: table.id, date: table.date }).from(table)
      .where(sql`EXTRACT(YEAR FROM ${table.date}) BETWEEN 1300 AND 1500`).for('update');
    for (const r of rows) {
      const [datePart, timePart = '00:00:00'] = String(r.date).split(' ');
      const iso = jalaliToIsoDate(datePart);
      if (!iso) { logger.warn(`[TD-119] cannot convert ${String(r.date)} (id ${r.id})`); continue; }
      await tx.update(table).set({ date: `${iso} ${timePart}` }).where(eq(table.id, r.id));
    }
  }
});
```

   عامل بررسی کند کدام ستون‌های timestamp دیگر (`treasury_transactions`، `cheques` و...) در این وضعیت‌اند. تعداد اصلاح‌ها در `logger.info` ثبت شود.
5. **گارد پایانی:** `ALTER TABLE documents ADD CONSTRAINT chk_documents_date_gregorian CHECK (date >= '1900-01-01') NOT VALID;` و همین برای `transactions`؛ سپس `VALIDATE CONSTRAINT`.
6. **داده جانبی:** ردیف‌های `document_ref_counters` با `fiscal_year = 2026` (باقی‌مانده از نسخه قدیمی `resolveJalaliFiscalYear`) با تأیید کاربر در ردیف سال ۱۴۰۵ ادغام شوند (بزرگ‌ترین شماره).

---

## فاز ۴ (P2): سند حسابداری فروش و انبار (TD-120، TD-121)

1. **سند فروش ردیف بهای تمام‌شده ندارد (TD-120).**
   - `syncSalesInvoiceVoucher` (`voucherSync.service.ts:124-167`) فقط دریافتنی/تخفیف/درآمد/ارزش افزوده ثبت می‌کند؛ حساب موجودی کالا هرگز بستانکار نمی‌شود. `financialHealth.service.ts:415` همین کمبود را گزارش می‌کند.
   - کلید `costOfGoodsSoldCode` (6001) در `accountMapping.service.ts:18,46` تعریف شده ولی getter ندارد:

   ```ts
   static async getCostOfGoodsSoldAccount(tx?: DbExecutor): Promise<Account | null> {
     return this.resolveAccount('costOfGoodsSoldCode', tx);
   }
   ```

   ```ts
   // voucherSync.service.ts — داخل syncSalesInvoiceVoucher، پس از ردیف‌های درآمد
   const cogsAcc = await AccountMappingService.getCostOfGoodsSoldAccount(tx);
   const fgAcc = await AccountMappingService.getInventoryFinishedGoodsAccount(tx);
   const rmAcc = await AccountMappingService.getInventoryRawMaterialsAccount(tx);
   let fgCost = fin(0), rmCost = fin(0);
   for (const line of linesWithItemTypeAndWac) {
     const c = fin(line.quantity).multiply(Number(line.weightedAverageCost) || 0);
     if (line.itemType === 'product') fgCost = fgCost.add(c); else rmCost = rmCost.add(c);
   }
   const total = fgCost.add(rmCost).round(4).toNumber();
   if (total > 0) {
     if (!cogsAcc || (fgCost.toNumber() > 0 && !fgAcc) || (rmCost.toNumber() > 0 && !rmAcc)) {
       if (isStrict) throw new ValidationError('حساب بهای تمام‌شده یا موجودی کالا در تنظیمات حسابداری تعریف نشده است.');
     } else {
       voucherItems.push({ accountId: cogsAcc.id, debit: total, credit: 0, detailedType: 'other', description: `بهای تمام‌شده فاکتور ${doc.refNumber}` });
       if (fgCost.toNumber() > 0) voucherItems.push({ accountId: fgAcc!.id, debit: 0, credit: fgCost.round(4).toNumber(), detailedType: 'other', description: `کاهش موجودی کالای ساخته‌شده بابت فاکتور ${doc.refNumber}` });
       if (rmCost.toNumber() > 0) voucherItems.push({ accountId: rmAcc!.id, debit: 0, credit: rmCost.round(4).toNumber(), detailedType: 'other', description: `کاهش موجودی مواد بابت فاکتور ${doc.refNumber}` });
     }
   }
   ```

   **نکته مهم:** بهای هر قلم باید از `transactions.unitPrice/totalPrice` حرکت خروج خوانده شود نه WAC لحظه sync، چون WAC بعد از فروش تغییر می‌کند و re-sync سند را خراب می‌کند. عامل بررسی کند مقدار `price` در `applyStockMovement` برای خروج فروش قیمت فروش است یا WAC (فعلاً قیمت فروش است → برای بهای تمام‌شده باید WAC در فیلد جدا ذخیره شود).
2. **سند نامتوازن در نبود حساب تخفیف/ارزش افزوده:** اگر `totalDiscount > 0` بدون `discountAcc` یا `vatAmount > 0` بدون `vatAcc`، ردیف حذف و سند نامتوازن رد می‌شود. در strict باید پیام روشن «حساب تخفیف/ارزش افزوده را در تنظیمات تعریف کنید» داده شود.
3. **کدهای ثابت و تداخل 6001 در سند انبار (TD-121).**
   - `syncWarehouseDocumentVoucher` (`voucherSync.service.ts:477-483`) به‌جای `AccountMappingService` کد ثابت دارد.
   - fallback «کالای در جریان ساخت» به **6001** است که در نگاشت، «بهای تمام‌شده کالای فروش‌رفته» است → مصرف تولید به حساب بهای تمام‌شده می‌رود.
   - اگر `wipAcc` پیدا نشود حتی در strict فقط `null` برمی‌گردد (خط 534) — نقض TD-093.
   - پروژه از regex روی `notes` پیدا می‌شود (خط 490) در حالی که ستون رسمی `documents.projectId` (TD-070) هست.
   - **اصلاح:** کلید نگاشت `workInProgressCode` اضافه شود، از `doc.projectId` استفاده شود، و در strict خطا داده شود.
4. **فرمت تاریخ سند:** `documents.date` با `mode:'string'` مقدار `"2026-09-25 00:00:00"` می‌دهد؛ `doc.date.split('T')[0]` (خطوط 111 و 486) ساعت را نگه می‌دارد. از `String(doc.date).slice(0, 10)` استفاده شود + تست.

---

## فاز ۵ (P3): بدهی‌های جانبی بی‌ارتباط با اصل ماجرا

| TD | مشکل | محل | اصلاح پیشنهادی |
|---|---|---|---|
| TD-122 | پاکسازی داده تست همیشه شکست می‌خورد: `id = ANY($1::text[])` روی ستون integer خطای `operator does not exist: integer = text` → داده تست در DB می‌ماند (هشدارهای `[TestDbHelper] Failed to clean` در `test:full`) | `src/tests/fixtures/dbTestHelper.ts:94` | ``sql`DELETE FROM ${sql.identifier(t)} WHERE ${sql.identifier(c)}::text = ANY(${sql.param(ids)}::text[])` `` + بررسی گیت `ERP_ALLOW_TEST_CLEANUP` |
| TD-123 | تغییر داده در GET: `syncMissingWarehouseStocks` در هر `GET /items` بی‌لاگ UPDATE می‌زند | `items.crud.routes.ts:137`، `itemStockReservation.service.ts:99-129` | به مهاجرت یک‌باره یا ابزار تطبیق منتقل و از GET حذف شود |
| TD-124 | دور زدن دروازه مرکزی موجودی: شاخه audit در `createDocument` و ثبت موجودی افتتاحیه در POST/PUT کالا مستقیم `transactions`/`stocks` می‌نویسند (بدون WAC/Outbox/گارد انبار) | `document.service.ts:517-577`، `items.crud.routes.ts:305-325,495-510` | از `applyStockMovement` استفاده شود؛ audit مقدار variance را به‌صورت حرکت in/out بفرستد |
| TD-125 | رویداد موجودی انبار اشتباه: `warehouseLocation: targetLoc` به‌جای کد نهایی انبار (ممکن است خالی باشد) | `document.service.ts:1191` | `finalTargetLoc` |
| TD-126 | رزرو پیش‌فاکتور اقلام حذف‌شده را هم حساب می‌کند: `documentItems.isDeleted = 0` فیلتر نشده | `itemStockReservation.service.ts:469-482` | `and(inArray(...), eq(documentItems.isDeleted, 0))` |
| TD-127 | تناقض `AGENTS.md`: بخش‌های ۷ و ۱۳ هنوز `4.ts`/`v4.x.y` را الزامی می‌دانند، بخش ۲۳ `5.ts` را | `AGENTS.md:56,89` | متن هر دو با بخش ۲۳ یک‌سان شود |
| TD-128 | فایل اضافی `scripts_temp_audit.py` (۹ خط ناقص از ای‌استودیو) | ریشه پروژه | حذف شود |
| TD-129 | ای‌استودیو `package-lock.json` را حذف می‌کند (تا الان ۵ بار). `update.sh` مقاوم شده ولی ریپو ناپایدار است | فرایند | گیت‌چک/CI که اگر لاک‌فایل نبود شکست بخورد + هشدار در `GEMINI.md` |
| TD-130 | حذف سخت در ویرایش سند: `updateDocument` ردیف‌های `document_items` را با `tx.delete` پاک می‌کند | `document.service.ts:235` | برای draft/proforma قابل قبول ولی مستند شود یا حذف نرم شود |
| TD-131 | امنیت: در محیط غیر production اگر `JWT_SECRET` نباشد از secret پیش‌فرض استفاده می‌شود (کامیت `cb57e08`) | `src/middleware/auth.ts:34` | `NODE_ENV` خالی به‌منزله production تفسیر شود یا فقط `development`/`test` مجاز باشند |
| TD-132 | آسیب‌پذیری‌های npm: ۱۰ مورد (۹ متوسط، ۱ بالا) | `npm audit` | بررسی مسیر runtime؛ پکیج‌های بدون مصرف (`firebase`, `firebase-admin`, `@google/genai`) فقط برای سازگاری ای‌استودیو مانده‌اند |
| TD-133 | هشدار build: `import.meta` در خروجی CJS خالی است | `src/db/migrator.ts:21` | شاخه fallback کار می‌کند؛ با `define` esbuild یا حذف شاخه ESM رفع شود |
| TD-134 | تست‌ها روی دیتابیس مشترک اجرا می‌شوند (ایزوله‌سازی اختیاری `ERP_TEST_SCHEMA_ISOLATION`) — علت پنهان‌ماندن TD-113 | `scripts/run-tests.ts:33` | اجرای ایزوله در CI الزامی شود |

---

## بخش ب: ترتیب انتشار و بررسی نهایی

| انتشار | محتوا | کار روی سرور |
|---|---|---|
| v5.0.13 | فاز ۰ (مهاجرت 0009 + تست ON CONFLICT) | `sudo bash update.sh`؛ سپس `psql ... -c "\d document_ref_counters"` و ثبت فاکتور آزمایشی |
| v5.0.14 | فاز ۱ (گارد انبار، حذف نام‌های ثابت، مهاجرت 0010، گارد غیرفعال‌سازی) | پیش از آن بکاپ بررسی شود؛ بعد از آن خروجی `RAISE WARNING` در `journalctl` |
| v5.0.15 | فاز ۲ (رزرو یکپارچه) و فاز ۳ (تاریخ‌ها) | آزمون دستی: پیش‌فاکتور باز ۱ عدد و فروش ۳ عدد |
| v5.0.16 | فاز ۴ (سند بهای تمام‌شده + اصلاحات سند انبار) | تراز آزمایشی: حساب موجودی کالا با ارزش انبار مقایسه شود |
| v5.0.17 | فاز ۵ | — |

برای هر انتشار: یک ورودی در `src/data/changelogs/5.ts`، افزایش نسخه، ثبت/بستن TD در `TECH_DEBT.md`، و اجرای `lint`، `check:version`، `test:full` معمولی و `test:full` ایزوله (`ERP_TEST_SCHEMA_ISOLATION=1`).

## بخش ج: تصمیم‌های مصوب کاربر (پیش‌فرض‌ها تأیید شد)

1. **رزرو پیش‌فاکتور:** مانع فروش باشد و در صفحه شفاف نمایش داده شود. (گزینه دوم در صورت نیاز بعدی: تنظیم `proforma_reservation_policy` با `block`/`warn`.)
2. **موجودی کلیدهای ناشناخته/انبار غیرفعال:** فقط گزارش شود (`RAISE WARNING`).
3. **برچسب‌های ثابت «انبار اصلی»/«انبار مرکزی» در مهاجرت 0010:** به انبار پیش‌فرض (کمترین id فعال) نگاشت شوند.
4. **بهای تمام‌شده در سند فروش:** در فاز ۴ پیاده شود؛ اصلاح سندهای فروش گذشته جداگانه و با تأیید حسابدار.