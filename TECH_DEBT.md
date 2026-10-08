# Technical Debt Registry — رجیستری بدهی‌های فنی

> **قاعده الزامی:** هر بدهی/میان‌بر شناسایی‌شده در توسعه باید به این فایل اضافه شود
> (ردیف جدید با ID یکتا). این فایل مرجع برنامه‌ریزی دورهای نگهداری است و بخشی از
> قرارداد مستندسازی پروژه محسوب می‌شود (بخش ۲۳ `AGENTS.md`).
>
> وضعیت‌ها: `open` | `scheduled:فاز ۳ ممیزی` | `in_progress` | `resolved` — فازهای گذشته برچسب زمان‌بندی ندارند (بررسی خودکار در تست واحد unit_governance_docs_consistency_p3_12)
>
> 📦 **آرشیو:** ردیف‌های `resolved` به‌محض حل، به `TECH_DEBT_ARCHIVE.md` منتقل
> می‌شوند تا این فایل فقط اقلام فعال (open / scheduled / in_progress) را نگه دارد.
> تاریخچه کامل با متن و شواهد عیناً در آرشیو حفظ می‌شود.

---

## 🔵 اقلام فعال نسخه ۹ (open / scheduled / in_progress)

| ID | حوزه | شرح | منبع (فایل) | وضعیت |
|----|------|-----|--------------|-------|
| TD-589 | زیرساخت (بسته ۱) | P2 (B01-09) — قید FK و ایندکس یکتای شرطی مهاجرت‌ها روی داده ناپاک فقط notice `SKIPPED` می‌دهند که کسی نمی‌شنود: پایگاه‌داده دوره v3 پس از ارتقا `success:true, warnings:[]` و بی `fk_transactions_item_id`، `fk_document_items_*` و `uq_cheques_sayad_number_active`، حتی پس از پاک شدن داده | db/migrator.ts، drizzle/0001، 0012، 0015 | open (P2، تصمیم ت۵ الف) |
| TD-590 | زیرساخت (بسته ۱) | P2 (B01-10) — `0007` ایندکس را بی نام اسکیما حذف می‌کند و اسکیمای ایزوله آزمون با مسیر جست‌وجوی `"<schema>", public` ساخته می‌شود: `public.idx_idemp_user_scope_key` حذف شد و هر POST با کلید idempotency با خطای `ON CONFLICT` شکست | drizzle/0007_idempotency_triple_key.sql، src/tests/setup/testDb.ts | open (P2) |
| TD-610 | زیرساخت (بسته ۱) | P3 (B01-30) — ۱۰۹ بررسی وجود بی نام اسکیما در ۱۹ مهاجرت: وقتی `public` مهاجرت‌شده است اسکیمای ایزوله آزمون ۳۰ قید و ایندکس را ندارد، از جمله `chk_iws_current_stock_non_negative`، `uq_jv_voucher_number` و ۱۰ قید `fk_*`؛ اسکیمای آزمونی که اجرای قطع‌شده جا گذاشته همین اثر را دارد (۶ آزمون پایگاه‌داده و ناوردایی قرمز شدند) | drizzle/*.sql، src/tests/setup/testDb.ts | open (P3) |
| TD-611 | زیرساخت (بسته ۱)؛ اثر روی ۱۵ | P3 (B01-31) — ۷ `onDelete` اعلام‌شده در Drizzle قید ندارند و سرویس‌ها والد را فیزیکی حذف می‌کنند: پس از حذف اشتراک وب‌هوک و قاعده رویداد، یک تحویل و یک لاگ به شناسه حذف‌شده اشاره ماندند | webhookSubscriptionService.ts، eventActionEngineService.ts، db/schema | open (P3، تصمیم ت۶ الف) |
| TD-612 | زیرساخت (بسته ۱)؛ اثر روی ۱۴ و ۳ | P3 (B01-32) — ذخیره دوباره بی تغییر طرح گردش کار شناسه گام‌ها را از ۶ تا ۹ به ۱۴ تا ۱۷ برد و ۵ ستون مرجع نمونه‌های در جریان یتیم شدند؛ امضای چاپ سند قدیمی عنوان گام را از جدول زنده می‌خواند؛ استثنای FK مستند نیست | workflowDefinitionService.ts، reports.routes.ts | open (P3، تصمیم ت۶ الف) |
| TD-613 | زیرساخت (بسته ۱) | P3 (B01-33) — اسکیمای Drizzle با پایگاه‌داده نمی‌خواند: ۵ FK `SET NULL` در پایگاه‌داده و `no action` در Drizzle، ۴ ستون nullable در برابر NOT NULL، ۲ ایندکس فقط در Drizzle و ۸ ایندکس یکتای جزئی فقط در پایگاه‌داده؛ `drizzle-kit generate` یا `push` آن‌ها را جابه‌جا می‌کند | src/db/schema/** | open (P3) |
| TD-614 | زیرساخت (بسته ۱) | P3 (B01-34) — ۵۶ از ۱۰۴ ستون FK بی ایندکس، ۳۳ روی جدول پرکاربرد (`workflow_instances (entity_type, entity_id)`، `workflow_history_logs.instance_id`، ستون‌های سند و فیش `treasury_transactions`): با حجم ساختگی ۵ ساله جزئیات فاکتور ۲۲٫۳ ms، با ایندکس ۰٫۰۷ ms | drizzle/*.sql | open (P3) |
| TD-616 | زیرساخت (بسته ۱) | P3 (B01-36) — شاخه `SQL_HOST` هرگز اجرا نمی‌شود و بی `NODE_ENV` و `DATABASE_URL` یک ERP ساختگی در حافظه با `admin`/`admin` بالا می‌آید (`isMockDatabase: true`)؛ `/health/ready` حالت mock را نمی‌گوید | db/drizzle.ts، db/mockPool.ts، server.ts | open (P3، تصمیم ت۴ الف) |
| TD-617 | زیرساخت (بسته ۱) | P3 (B01-37) — `migratePlainPasswords` هر بوت، حتی در تولید، هر رشته غیر bcrypt (کاربر حذف‌شده، `!locked`، hash `$argon2id$`) را رمز کارا می‌کند و `mustResetPassword` و ردیف ممیزی نمی‌نویسد | db/migratePlainPasswords.ts، server.ts | open (P3، تصمیم ت۴ الف) |
| TD-625 | زیرساخت (بسته ۱)؛ اثر روی همه بسته‌ها | P3 (B01-45) — خروجی ترمینال فارسی است: ۵ پیام hook آغاز جلسه، ۱۱۷ خط در ۱۲ اسکریپت CLI و ۱۳ پیام `check:version`، لاگ پیام فارسی هر خطای کسب‌وکار در `errorHandler`، حدود ۸۰۱ خط نام آزمون در ۶۸ فایل و ۱۲ نام آزمون Vitest | .claude/hooks/session-start.sh، scripts/*.ts، middleware/logger.ts، src/tests/** | open (P3، قاعده ت۹؛ قاعده در AGENTS.md §6 و ratchet فقط کاهشی `ratchet:terminal-english` از v9.0.211؛ ترجمه باز) |
| TD-743 | کنترل پروژه و تولید (بسته ۱۱) | P2 (B11-09) — `GET /projects` صفحه‌بندی ندارد، فیلتر و جست‌وجو را در JS می‌کند و همه JSONهای همه پروژه‌ها را دو بار (camelCase و snake_case) برمی‌گرداند: ۳۱۲ پروژه ← ۹٬۱۰۹٬۷۴۷ بایت در ۳۰۸ میلی‌ثانیه، `?page=1&limit=10` همان ۳۱۲ ردیف؛ خوانندگان فهرست انتخاب از v9.0.139 (TD-889) `/projects/options` را می‌خوانند | projects.routes.ts | open (P2) |
| TD-745 | کنترل پروژه و تولید (بسته ۱۱)؛ اثر روی ۸ و ۱۰ | P2 (B11-11) — «سند مستقیم» زبانه پروژه شماره را در مرورگر می‌سازد (`PO-<کد>-<۴ رقم تصادفی>`)، رسید قطعی را بی گذر از تدارکات ثبت می‌کند و انبار متن آزاد است؛ جلو رفتن شمارنده رسید تا ۵۵۰۰ و «پیش‌فاکتور خرید» `in` را TD-783 و TD-770 بستند | CreatePurchaseOrderModal.tsx | open (P2، تصمیم ت۸ ب) |
| TD-748 | کنترل پروژه و تولید (بسته ۱۱) | P2 (B11-14) — الگوهای «کنترل موجودی» مواد را گم می‌کنند: الگو مواد را در `items` دارد و زبانه فقط `itemsSchema`/`globalItems` را می‌خواند؛ الگوی پیش‌فرض ۱۰ ماده بی موجودی ← فهرست خرید خالی، پیشرفت مواد ۱۰۰٪ و ثبت نهایی بی رزرو | inventoryControlPresets.ts، useProjectInventory.ts | open (P2) |
| TD-750 | کنترل پروژه و تولید (بسته ۱۱) | P2 (B11-16) — وضعیت تدارکات ردیف فهرست خرید ذخیره نمی‌شود: شناسه ردیف `code_<کد>` با جست‌وجوی `itemId` جور نمی‌شود و state درجا تغییر می‌کند | useProjectInventory.ts، ManualPurchaseList.tsx | open (P2) |
| TD-751 | کنترل پروژه و تولید (بسته ۱۱)؛ اثر روی ۶ | P2 (B11-17) — تخصیص مواد همیشه از انبار `main` برداشت می‌خواهد (`setSelectedLocation('main')`) در حالی که select اولین انبار را نشان می‌دهد؛ خلاف TD-203 | ProjectBomAllocationsTab.tsx | open (P2) |
| TD-752 | کنترل پروژه و تولید (بسته ۱۱) | P2 (B11-18) — هیچ کنترل مجوزی در رابط بسته نیست: نقش‌های فقط `projects.view` فرم‌ها را پر می‌کنند و ۴۰۳ می‌گیرند | components/project/**، ProjectDetailModal.tsx، ProjectsPage.tsx | open (P2) |
| TD-759 | کنترل پروژه و تولید (بسته ۱۱)؛ اثر روی ۶ | P3 (B11-25) — تخصیص مواد به پروژه لغوشده پذیرفته می‌شود: ۴ واحد ← ۲۰۰ و سند ۱۴۰۲ پیش‌نویس ۲۰۰٬۰۰۰ ریال | projectBomAllocation.service.ts | open (P3، تصمیم ت۹ الف) |
| TD-760 | کنترل پروژه و تولید (بسته ۱۱) | P3 (B11-26) — خطای بارگذاری تخصیص‌ها (۴۰۳) مثل فهرست خالی نشان داده می‌شود؛ زبانه زیر `/audit` با `audit.view` باز است ولی API `warehouse.view`/`projects.view` می‌خواهد | ProjectBomAllocationsTab.tsx | open (P3) |
| TD-761 | کنترل پروژه و تولید (بسته ۱۱) | P3 (B11-27) — کانبان پروژه‌های متوقف و لغوشده را پنهان می‌کند و فیلتر «لغوشده» ندارد | ProjectsPage.tsx | open (P3) |
| TD-762 | کنترل پروژه و تولید (بسته ۱۱) | P3 (B11-28) — مودال جزئیات `/items/prices/all` و کارکردهای پروژه را می‌خواند و دور می‌ریزد | ProjectDetailModal.tsx | open (P3) |
| TD-763 | کنترل پروژه و تولید (بسته ۱۱) | P3 (B11-29) — تاریخ مراحل ورودی متنی با نمونه ۱۴۰۳ است؛ نشان «قلم کسری» فیلدی را می‌خواند که کسی نمی‌نویسد | ProjectDetailModal.tsx | open (P3) |
| TD-764 | کنترل پروژه و تولید (بسته ۱۱) | P3 (B11-30) — `JalaliDateInput` در بسته به کار نرفته؛ `toLocaleDateString` و `toISOString` در نام فایل | components/project/**، ProjectsPage.tsx | open (P3) |
| TD-765 | کنترل پروژه و تولید (بسته ۱۱) | P3 (B11-31) — جایگزین محور نمودار زمان‌بندی (`1404*365+31`) با واحد روز از ۱۹۷۰ ناهمگون است | ProjectGanttTab.tsx | open (P3) |
| TD-766 | کنترل پروژه و تولید (بسته ۱۱) | P3 (B11-32) — ۱۴ `catch` فقط لاگ می‌کند و شکست مثل داده خالی دیده می‌شود؛ `err.message` در `ProjectDetailModal.tsx` | components/project/**، ProjectDetailModal.tsx | open (P3) |
| TD-767 | کنترل پروژه و تولید (بسته ۱۱) | P3 (B11-33) — ۶ `<select>` بومی روی فهرست موجودیت (کالا، پرسنل، پروژه) | components/project/**، ProjectBomAllocationsTab.tsx | open (P3) |
| TD-769 | کنترل پروژه و تولید (بسته ۱۱) | P3 (B11-35) — ۵۷ اصطلاح انگلیسی یا آوانویسی در رابط بسته («فریز» ۱۵، BOM ۸، «گانت»/Gantt ۷، «سرور» ۶، …)؛ سرور «SKU×مرحله» را در شرح ممیزی می‌نویسد | components/project/**، projects.routes.ts | open (P3، تصمیم ت۱۰ الف) |

---

## 📊 آمار رجیستری

- **فعال:** ۲۶ ردیف
- **آرشیو شده (resolved):** ۷۷۴ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`
- مبنای آمار و IDs یکتا: هر دو فایل مجموعاً فضای ID مشترک دارند؛ IDs جدید باید
  از بزرگ‌ترین ID موجود در **هر دو** فایل + ۱ انتخاب شود.

---

> **فاز ۰ ممیزی مستقل (v7.0.18 به بعد):** ردیف‌های TD-171 به بعد که در همان change-set حل شده‌اند مستقیماً در بخش «فاز ۰» فایل `TECH_DEBT_ARCHIVE.md` ثبت شده‌اند.
> ✅ v7.0.44: ردیف‌های `resolved` که در جدول فعال مانده بودند (TD-110، TD-129، TD-132، TD-134، TD-160 تا TD-170) عیناً به بخش «نسخه ۷ — نقشه راه V7» آرشیو منتقل شدند.

*آخرین بازبینی: v9.0.423 — TD-734 (واژه‌های انگلیسی و آوانویسی رابط رویدادها، P3) رفع و بایگانی شد. شناسه‌های رزروشده: `v9/PHASE4_LANES.md` §۷.۲.*
*v9.0.313 — نسخه مستند بسته ۱۰ (خرید و تدارکات): TD-688 تا TD-702 و TD-901 (تصمیم ت۵) باز شد. شناسه‌های رزروشده: `v9/PHASE4_LANES.md` §۷.۲.*
