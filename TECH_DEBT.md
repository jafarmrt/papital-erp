# Technical Debt Registry — رجیستری بدهی‌های فنی

> **قاعده الزامی:** هر بدهی/میان‌بر شناسایی‌شده در توسعه باید به این فایل اضافه شود
> (ردیف جدید با ID یکتا). این فایل مرجع برنامه‌ریزی دورهای نگهداری است و بخشی از
> قرارداد مستندسازی پروژه محسوب می‌شود (بخش ۲۳ `AGENTS.md`).
>
> وضعیت‌ها: `open` | `scheduled:<phase>` | `in_progress` | `resolved`
>
> 📦 **آرشیو:** ردیف‌های `resolved` به‌محض حل، به `TECH_DEBT_ARCHIVE.md` منتقل
> می‌شوند تا این فایل فقط اقلام فعال (open / scheduled / in_progress) را نگه دارد.
> تاریخچه کامل با متن و شواهد عیناً در آرشیو حفظ می‌شود.

---

## 🔵 اقلام فعال نسخه ۷ (open / scheduled / in_progress)

| ID | حوزه | شرح | منبع (فایل) | وضعیت |
|----|------|-----|--------------|-------|
| TD-080 | Refactoring Budget | خردسازی گادفایل‌ها و توابع با پیچیدگی بالا: (۱) تجزیه کامل src/utils.ts به ۴ ماژول در utils/ [انجام شد: v7.0.16]؛ (۲) تفکیک کامل document.service.ts به ۵ ماژول در services/documents/ [انجام شد: v7.0.17]؛ (۳) تفکیک صفحات DocumentsPage و InvoicesListPage | src/utils.ts، src/services، src/pages | in_progress — فاز ۴.۴ نسخه ۷ |
| TD-085 | Workflow/Events UX | (۱) پیش‌نمایش شرایط لازم به فارسی از `evaluateRuleBreakdown` قبل از اقدام؛ (۲) نمایش پیشرفت امضا «n از m» در Stepper از `approvalProgressJson`؛ (۳) انتخاب‌گر فیلد payload به‌جای تایپ دستی `{{payload.x}}` در RuleEditorModal؛ (۴) قوانین پیش‌فرض یادآوری SLA | workflow/task/rule UI | scheduled:فاز ۳ نسخه ۷ |
| TD-106 | Frontend / Type Safety (FE-007) | ۹۱۸ مورد `: any` و ۲۷۹ مورد `as any` در سورس‌کد | سراسر src | scheduled:فاز ۳ نسخه ۷ |
| TD-108 | FE Helpers (Badges) | ۱۲ کپی `getStatusBadge`/`getPriorityBadge` با الگو یکسان ولی واژگان/رنگ متفاوت — تجمیع در PillBadge | components/pages | scheduled:فاز ۳ نسخه ۷ |
| TD-109 | Runtime Flags Cleanup | پاکسازی کامل سرویس/کلیدهای موقت test_endpoints پس از حذف روت‌های تست | src/lib/runtimeFlags.ts | scheduled:فاز ۲ نسخه ۷ |
| TD-110 | financialMath Shim | مهاجرت ۵ ایمپورت باقی‌مانده از utils/financialMath به lib/financialDecimal و حذف فایل واسط | src/utils/financialMath.ts | resolved:v7.0.10 (فاز ۲ نسخه ۷) |
| TD-112 | Workflow Keep-List | روت‌های بدون مصرف‌کننده فرانت‌اند در انتظار رابط کاربری فاز ۳ | workflow.routes.ts | scheduled:فاز ۳ نسخه ۷ |
| TD-129 | Lockfile Flux | محافظت از وجود package-lock.json در گیت CI و فعال‌سازی کش | فرایند/CI | resolved:v7.0.19 — گیت در v7.0.3 اضافه شد ولی خود package-lock.json هرگز commit نشده بود و CI همیشه در گام اول شکست می‌خورد؛ در v7.0.19 فایل قفل (lockfileVersion 3، Node 22) ثبت شد (جزئیات: TD-172) |
| TD-173 | Security / xlsx CVEs | `xlsx@0.18.5` دارای دو آسیب‌پذیری High بدون اصلاحیه در رجیستری npm (GHSA-4r6h-8v6p-xvw6 Prototype Pollution، GHSA-5pgg-2g8v-p4x9 ReDoS)؛ در ۱۰+ کامپوننت فرانت برای پارس فایل اکسل ورودی کاربر استفاده می‌شود. موقتاً در فهرست استثنای `scripts/audit-gate.ts` ثبت شده است | package.json، src/components/**/*Excel*، scripts/audit-gate.ts | open — مهاجرت به exceljs یا نسخه رسمی SheetJS (CDN) و حذف استثنا از گیت |
| TD-176 | Startup Ordering / pg Client | در بوت روی دیتابیس تازه، یک کوئری روی جدول personnel پیش از اتمام مایگریشن‌ها اجرا شده و خطا لاگ می‌شود؛ همچنین `SET statement_timeout` در رویداد connect استخر (drizzle.ts:63) به‌صورت fire-and-forget اجرا شده و هشدار منسوخ‌شدن pg («client.query when the client is already executing») می‌دهد. پیشنهاد: انتقال تنظیمات session به `options: '-c statement_timeout=...'` در کانفیگ Pool و یافتن فراخوان پیش از مایگریشن | src/db/drizzle.ts:63، server.ts | open |
| TD-177 | Docker Image Size | کتابخانه‌های صرفاً فرانت‌اند (react، lucide-react، xlsx، فونت‌ها، react-multi-date-picker و ...) در `dependencies` هستند و با `npm ci --omit=dev` وارد ایمیج رانتایم می‌شوند در حالی که سرور فقط ۲۴ ماژول require می‌کند | package.json، Dockerfile | open — انتقال وابستگی‌های فقط-کلاینت به devDependencies پس از بررسی |
| TD-179 | Business Clock / Nowruz Approximation | شاخه میلادی `resolveJalaliFiscalYear` (businessClock.ts:132-141) نوروز را همیشه ۲۱ مارس فرض می‌کند؛ در سال‌هایی که نوروز ۲۰ مارس است، اسناد آن روز به سال مالی قبل نسبت داده می‌شوند (هم در پارتیشن شمارنده عطف و هم در `checkFiscalPeriodOpen`). تابع SQL `erp_ref_fiscal_year` در مهاجرت 0015 عمداً همین رفتار را آینه کرده تا دامنه یکتایی با شمارنده یکسان بماند | src/lib/businessClock.ts:116، drizzle/0015 | open — جایگزینی با تبدیل دقیق جلالی در هر دو سمت و بازمحاسبه ref_fiscal_year فقط برای ردیف‌های مرزی |
| TD-182 | Spoofable Client IP in Audit Logs / General Limiter | `extractClientIp` (auditLogger.ts:62) و کلید محدودکننده عمومی (app.ts:214) و چند مسیر حسابداری (accounting.routes.ts:52,167) نخستین مقدار X-Forwarded-For را که در کنترل کلاینت است می‌خوانند؛ IP ثبت‌شده در لاگ ممیزی قابل جعل است. پس از v7.0.23 مقدار `req.ip` (بر پایه TRUST_PROXY) منبع معتبر است | src/lib/auditLogger.ts:62، src/app.ts:214، src/routes/accounting.routes.ts | open — جایگزینی با req.ip |
| TD-187 | Targeted Account Lockout (residual) | با قفل تدریجی (TD-186) قفل حساب حداکثر ۳۰ دقیقه است، اما مهاجم بدون احراز هویت همچنان می‌تواند با یک تلاش ناموفق پس از پایان هر قفل، حساب هدف (مثلاً admin) را در قفل نگه دارد؛ قفل در سطح نام کاربری است نه (نام کاربری + IP). وضعیت قفل نام‌های کاربری ناموجود درون‌حافظه‌ای و مخصوص هر Pod است | src/services/auth/loginSecurity.service.ts | open — قفل در سطح (نام کاربری + IP) یا CAPTCHA پس از آستانه، و ذخیره مشترک (Redis) در استقرار چند Pod |
| TD-189 | Plaintext Third-Party Credential | ستون `personnel.nobitex_password` رمز حساب صرافی پرسنل را به‌صورت متن ساده در پایگاه‌داده نگه می‌دارد (از v7.0.29 در خروجی داده‌ها حذف می‌شود، اما در دیتابیس و احتمالاً پاسخ‌های API پرسنل باقی است) | src/db/schema/personnel.ts:34 | open — حذف نگهداری رمز شخص ثالث یا رمزنگاری در سطح برنامه با کلید جدا، و حذف از پاسخ‌های API |
| TD-191 | WooCommerce Order Totals (shipping / fees / tax) | فاکتور سفارش ووکامرس فقط از `line_items` ساخته می‌شود؛ هزینه ارسال (`shipping_lines`)، کارمزدها (`fee_lines`) و مالیات سفارش (`total_tax`) در فاکتور و سند حسابداری ثبت نمی‌شوند، پس جمع فاکتور می‌تواند از مبلغ پرداختی مشتری کمتر باشد | src/services/woocommerce/wooOrderSync.service.ts | open — نیازمند تصمیم مالک محصول درباره سرفصل درآمد حمل و نگاشت مالیات ووکامرس به فیلدهای ساختاریافته ارزش افزوده |
| TD-192 | Test Isolation Shares Migration Journal | `setupTestSchema` (src/tests/setup/testDb.ts) مهاجرت‌ها را داخل اسکیمای موقت اجرا می‌کند اما جدول ردیابی `drizzle.__drizzle_migrations` بین همه اجراها مشترک است؛ اجرای دوم تست‌ها روی همان پایگاه‌داده هیچ مهاجرتی را اعمال نمی‌کند و همه سوئیت‌ها روی اسکیمای خالی شکست می‌خورند. CI چون هر بار پایگاه‌داده تازه می‌سازد تحت تأثیر نیست | src/tests/setup/testDb.ts:66، src/db/migrator.ts | open — اجرای مهاجرت تست با `migrationsSchema` مخصوص اسکیمای موقت |
| TD-194 | Seed Advisory Lock on Pooled Connections | `runSeedWithLock` (src/db/seed.ts:17-27) قفل مشورتی 89345 را با یک کوئری `orm.execute` می‌گیرد و با کوئری دیگری آزاد می‌کند؛ روی استخر اتصال این دو ممکن است روی دو اتصال متفاوت اجرا شوند، پس آزادسازی بی‌اثر می‌ماند و قفل روی اتصال اول تا بسته‌شدن آن باقی می‌ماند | src/db/seed.ts:17 | open — استفاده از `withAdvisoryLock` (src/lib/advisoryLock.ts) |
| TD-195 | Voucher Number Uniqueness Not Enforced in DB | گزارش ممیزی (P1-8) ایندکس یکتای `journal_vouchers(voucher_number)` را هم پیشنهاد کرده بود؛ اضافه نشد چون داده‌های قدیمی ممکن است شماره تکراری داشته باشند و شکست ساخت ایندکس، راه‌اندازی پروداکشن را متوقف می‌کند. شماره‌های جدید از sequence می‌آیند و تکراری نمی‌شوند | src/db/schema/accounting.ts، drizzle/ | open — گزارش شماره‌های تکراری در بازرس سلامت مالی، اصلاح با تصمیم حسابدار و سپس مهاجرت ایندکس یکتا |
| TD-198 | Exchange Rate Parsed From Notes | `syncSalesInvoiceVoucher` (voucherSync.service.ts) نرخ تسعیر فاکتورهای ارزی را در نبود گزینه صریح با الگوی متنی «نرخ تسعیر» / exchange_rate از متن یادداشت سند استخراج می‌کند — همان کلاس مشکل P1-7؛ یادداشت آزاد می‌تواند نرخ تسعیر سند حسابداری را تغییر دهد | src/services/accounting/voucherSync.service.ts | open — ستون ساختاریافته نرخ تسعیر روی سند |
| TD-199 | Pre-v7.0.32 Proformas Keep VAT Only in Notes | با تصمیم مالک محصول داده قدیمی منتقل نشد؛ پیش‌فاکتورهایی که پیش از v7.0.32 با مالیات ثبت شده‌اند مالیات را فقط در متن یادداشت دارند و اگر بدون ویرایش نهایی شوند، فاکتور و سند حسابداری بدون مالیات صادر می‌شوند | documents (vat_percent / vat_amount) | open — پیش از نهایی‌سازی، پیش‌فاکتور قدیمی را در فرم ویرایش باز و مالیات را دوباره فعال کنید؛ یا گزارش پیش‌فاکتورهای باز دارای برچسب مالیات در یادداشت |
| TD-130 | Hard Delete in updateDocument | بررسی ردیف‌های document_items در ویرایش سند جهت هم‌ترازی با soft-delete | document.service.ts:235 | scheduled:فاز ۱ نسخه ۷ |
| TD-132 | Dead Dependencies / CVEs | پکیج‌های بی‌استفاده firebase، firebase-admin و @google/genai و کاهش حجم ایمیج | package.json | resolved:v7.0.10 (فاز ۲ نسخه ۷) |
| TD-134 | Test DB Isolation Off by Default | پیش‌فرض کردن ERP_TEST_SCHEMA_ISOLATION=1 در رانر تست‌ها و حذف sleepها | scripts/run-tests.ts:121 | resolved:v7.0.3 (فاز ۲ نسخه ۷) |
| TD-160 | TypeScript Strict Mode Disabled | خاموش بودن فلگ‌های strict, strictNullChecks, noImplicitAny در tsconfig.json | tsconfig.json | resolved:v7.0.4 (فاز ۳ نسخه ۷) |
| TD-161 | Zod Coverage Gap | فقدان اعتبارسنجی Zod روی ۱۱ روت تدارکات (Procurement) و روت‌های داشبورد | src/routes/procurement.routes.ts | resolved:v7.0.1 (فاز ۱ نسخه ۷) |
| TD-162 | Ad-Hoc DDL in Migrator | ۵ بلوک DDL خام خارج از ترنزکشن رسمی دریزل که خطاها را قورت می‌دهند | src/db/migrator.ts:77-108 | resolved:v7.0.1 (فاز ۱ نسخه ۷) |
| TD-163 | Startup Race Condition | پذیرش ترافیک قبل از اتمام مایگریشن‌ها و سید در هنگام بوت سرور | server.ts:47-108 | resolved:v7.0.1 (فاز ۱ نسخه ۷) |
| TD-164 | N+1 Queries in Hot Loops | کوری‌های تکی انبار و قیمت در حلقه سطرهای سند انبارگردانی تحت قفل سطری | src/services/document.service.ts:615 | resolved:v7.0.2 (فاز ۲ نسخه ۷) |
| TD-165 | JSONB Stocks Normalization | ذخیره‌سازی موجودی تفکیکی انبار در ستون JSONB فاقد قید دیتابیسی | src/db/schema/inventory.ts:33 | resolved:v7.0.8 (فاز ۴.۱ نسخه ۷) |
| TD-166 | Missing FK Index | فقدان نمایه B-Tree روی documents(project_id) | src/db/schema/documents.ts:85 | resolved:v7.0.1 (فاز ۱ نسخه ۷) |
| TD-167 | fetchJson Typing & Protocol Fallback | تایپ ضعیف T=any و قورت دادن خطای بدنه نامعتبر در .catch(() => ({})) | src/api.ts:77,190 | resolved:v7.0.5 (فاز ۳ نسخه ۷) |
| TD-168 | Native parseFloat in Forms | استفاده مستقیم از parseFloat در ۲۴ فیلد فرم‌های مالی و کارمزدی | VoucherItemsTable.tsx, PieceworkLogModal.tsx | resolved:v7.0.6 (فاز ۳ نسخه ۷) |
| TD-169 | Schema Import Cycle | چرخه ۵ ماژولی در اسکیماهای Drizzle (Tarjan SCC) | src/db/schema/ | resolved:v7.0.12 (فاز ۴.۲ نسخه ۷) |
| TD-170 | Dual Serialization Debt | بازگرداندن همزمان کلیدهای camelCase و snake_case در روت پروژه‌ها | src/routes/projects.routes.ts:202 | resolved:v7.0.15 (فاز ۴.۳ نسخه ۷) |

---

## 📊 آمار رجیستری

- **فعال:** ۱۶ ردیف
- **آرشیو شده (resolved):** ۱۶۱ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`
- مبنای آمار و IDs یکتا: هر دو فایل مجموعاً فضای ID مشترک دارند؛ IDs جدید باید
  از بزرگ‌ترین ID موجود در **هر دو** فایل + ۱ انتخاب شود.

---

> **فاز ۰ ممیزی مستقل (v7.0.18 به بعد):** ردیف‌های TD-171 به بعد که در همان change-set حل شده‌اند مستقیماً در بخش «فاز ۰» فایل `TECH_DEBT_ARCHIVE.md` ثبت شده‌اند.
> ⚠️ ناسازگاری شناخته‌شده: چند ردیف `resolved` (TD-110، TD-129، TD-132، TD-134، TD-160 تا TD-170) هنوز در جدول فعال بالا مانده‌اند و آمار «۱۶ ردیف فعال» با جدول منطبق نیست؛ جابه‌جایی آن‌ها خارج از دامنه فاز ۰ است.

*آخرین بازبینی: v7.0.37 — پایان زیرفاز ۲.۱ ممیزی: حل TD-196، TD-201، TD-202 / P2-2 و TD-203 / P2-3 (آرشیو).*
