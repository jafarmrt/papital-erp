# Technical Debt Registry — رجیستری بدهی‌های فنی

> **قاعده الزامی:** هر بدهی/میان‌بر شناسایی‌شده در توسعه باید به این فایل اضافه شود
> (ردیف جدید با ID یکتا). این فایل مرجع برنامه‌ریزی دورهای نگهداری است و بخشی از
> قرارداد مستندسازی پروژه محسوب می‌شود (بخش ۳۱ `AGENTS.md`).
>
> وضعیت‌ها: `open` | `scheduled:<phase>` | `in_progress` | `resolved`
>
> 📦 **آرشیو:** ردیف‌های `resolved` به‌محض حل، به `TECH_DEBT_ARCHIVE.md` منتقل
> می‌شوند تا این فایل فقط اقلام فعال (open / scheduled / in_progress) را نگه دارد.
> تاریخچه کامل با متن و شواهد عیناً در آرشیو حفظ می‌شود.

---

## 🔵 اقلام فعال (open / scheduled / in_progress)

| ID | حوزه | شرح | منبع (فایل) | وضعیت |
|----|------|-----|--------------|-------|
| TD-032 | UX | password visibility toggle + lockout countdown پیاده شد — فقط تست دستی E2E روی دیوایس موبایل باقی است | LoginPage.tsx | open |
| TD-080 | Refactoring Budget | چند تابع با cognitive >۱۰۰ پیش‌موجودند: parseCliArgs (۲۵۳)، useCRMData (۱۷۷)، useAccounting (۱۴۹)، سوییت‌های تست (۱۳۰-۱۵۸)، processUnifiedImport (۱۱۷)، CreateInvoicePage/InventoryRebuildModal (۱۰۴-۱۱۱) | scripts/initial-setup.ts، src/hooks، src/pages | in_progress — runSeed/ProjectScheduleTab (v3.2.0)، useAccountingReports (v3.2.1)، useCRMFilters + useMemo صفحات (v3.2.3)؛ باقی: parseCliArgs و سوییت‌های تست |
| TD-085 | Workflow/Events UX | (۱) پیش‌نمایش شرایط لازم به فارسی از `evaluateRuleBreakdown` قبل از اقدام؛ (۲) نمایش پیشرفت امضا «n از m» در Stepper از `approvalProgressJson`؛ (۳) انتخاب‌گر فیلد payload به‌جای تایپ دستی `{{payload.x}}` در RuleEditorModal؛ (۴) قوانین پیش‌فرض یادآوری SLA | workflow/task/rule UI | scheduled:فاز UX |
| TD-106 | Frontend / Type Safety (FE-007) | 🆕 ارزیابی مستقل v4.0.28: ادعای TD-033 (پاکسازی ~۳۸۰ نقطه any) کهنه است — اکنون ~۸۵۷ نقطه `: any` در src (شامل کد تازه v4: TreasuryTransactionModal.tsx:20,50,79 و...)؛ typecheck سبز است ولی FE-007 در حال فرسایش، به‌ویژه در کامپوننت‌های حمل‌کننده محاسبات مالی | سراسر src (services, pages, components, hooks) | open — اولویت: خزانه/حسابداری مالی، سپس تدریجی |
| TD-108 | FE Helpers (Badges) | 🆕 ممیزی کد مرده v4.0.29: ۱۲ کپی `getStatusBadge`/`getPriorityBadge` با الگو یکسان ولی واژگان/رنگ/آیکون/اندازه متفاوت (پروژه‌ها، procurement، رویدادها، نسبت‌های مالی و...) — تلفیق کور ریسک رگرسیون بصری دارد؛ نیاز به `PillBadge` مشترک + جداول نگاشت دامنه‌ای | 7× getStatusBadge + 5× getPriorityBadge در components/pages | scheduled:فاز UX — همراه TD-085 |
| TD-109 | Runtime Flags Cleanup | 🆕 پس از حذف روت‌های tests/run و clean-test-data (v4.0.29)، سرویس `runtimeFlags.ts`، کلید `runtime_enable_test_endpoints` و payload `/system/env` بدون کارکرد گیت‌کننده مانده‌اند (فقط اطلاعاتی) — حذف کامل سرویس/کلید/استیت useSettings | src/lib/runtimeFlags.ts, system.routes.ts, useSettings.ts, seed.ts | open — پاکسازی نهایی در فاز بعدی |
| TD-110 | financialMath Shim | 🆕 ۵ سرویس انبار/تطبیق از re-export shim (`utils/financialMath.ts`) به‌جای import مستقیم `lib/financialDecimal` استفاده می‌کنند؛ مهاجرت ۵ ایمپورت و حذف shim + آپدیت unitSuite | src/utils/financialMath.ts, 5 services | open — minor |
| TD-112 | Workflow Keep-List (نقشه TD-085) | 🆕 پس از پاکسازی v4.0.29: ۶ روت workflow عمداً بدون مصرف‌کننده frontend نگه‌داری شدند (versions/publish/rollback/bottlenecks/compliance + docs CRUD) — اینها «مرده» نیستند، هدف فاز UX فلات (TD-085) هستند؛ فاز بعدی یا UI تولید کند یا حذف شود | workflow.routes.ts:268-445 | open — منوط به TD-085 |
| TD-129 | Lockfile Flux | 🆕 ای‌استودیو تاکنون ۵ بار package-lock.json را حذف کرده؛ update.sh مقاوم شده ولی ریپو ناپایدار — نیاز به گیت چک در CI و هشدار در GEMINI.md | فرایند/CI | open |
| TD-130 | Hard Delete in updateDocument | 🆕 ویرایش سند ردیف‌های document_items را سخت حذف می‌کند (tx.delete) | document.service.ts:235 | open — مستندسازی یا حذف نرم |
| TD-132 | npm Audit Vulns | 🆕 ۱۰ آسیب‌پذیری (۹ متوسط، ۱ بالا)؛ firebase/firebase-admin/@google/genai بدون مصرف کد فقط برای سازگاری ای‌استودیو | npm audit | open — بررسی مسیر runtime |
| TD-134 | Test DB Isolation Off by Default | 🆕 تست‌ها روی DB مشترک اجرا می‌شوند (`ERP_TEST_SCHEMA_ISOLATION` اختیاری) — همین باعث پنهان‌ماندن TD-113 شد؛ ایزوله‌سازی در CI الزامی شود | scripts/run-tests.ts:33 | open |
| TD-135 | Inventory WAC Dilution | 🆕 رقیق‌سازی و صفر شدن بهای تمام‌شده میانگین موزون (WAC) بر اثر ثبت قیمت صفر در اضافه انبارگردانی دوره‌ای | src/services/document.service.ts:548 | resolved:v6.0.1 (Sub-phase 1.1) |
| TD-136 | Kardex Rebuild WAC Reset | 🆕 صفر شدن اجباری نرخ میانگین موزون کالا هنگام رسیدن موجودی به صفر در الگوریتم بازسازی کاردکس | src/services/inventory/kardexWacRecalculator.service.ts:109 | resolved:v6.0.5 (Sub-phase 2.1) |
| TD-137 | Excel Import Stock Bypass | 🆕 درون‌ریزی اکسل متد متمرکز applyStockMovement را دور زده و WAC و رویدادهای Outbox را ثبت نمی‌کند | src/services/items/itemCatalog.service.ts:515 | resolved:v6.0.7 (Sub-phase 2.3) |
| TD-138 | Warehouse Transfer OCC | 🆕 حواله انتقال بین انبارها ستون‌های currentStock و version را آپدیت نکرده و توالی زمانی کاردکس را مخدوش می‌کند | src/services/inventory/inventoryStockRepair.service.ts:80 | resolved:v6.0.6 (Sub-phase 2.2) |
| TD-139 | Reservation Gate in Service | 🆕 فقدان گیت کنترل سقف رزرو کالا در متد مرکزی createDocument و ریسک فروش کالاهای رزروشده پیش‌فاکتور/پروژه | src/services/document.service.ts:563 | resolved:v6.0.8 (Sub-phase 2.4) |
| TD-140 | Kardex Backfill Hardcoded WH | 🆕 ارجاع به کد هاردکد انبار main در سرویس ایجاد تراکنش افتتاحیه کاردکس به جای استفاده از resolveWarehouseCode | src/services/inventory/kardexBackfill.service.ts:98 | resolved:v6.0.6 (Sub-phase 2.2) |
| TD-141 | Fiscal Year Isolation Bug | 🆕 شکست قطعی و رول‌بک بستن سال مالی به دلیل عدم مشاهده اسناد موقت ثبت‌شده در getTrialBalance (ایزولاسیون tx) | src/services/accounting/fiscalYear.service.ts:409 | resolved:v6.0.3 (Sub-phase 1.3) |
| TD-142 | Calendar Mismatch in Closing | 🆕 رد شدن کلیه اسناد در تراز آزمایشی بستن سال مالی به دلیل مقایسه لغوی تاریخ شمسی و میلادی | src/services/accounting/fiscalYear.service.ts:32 | resolved:v6.0.3 (Sub-phase 1.3) |
| TD-143 | Multi-Currency COGS Fiasco | 🆕 فاجعه ارزی در ثبت بهای تمام‌شده فاکتورهای ارزی (ثبت رقم ریالی به جای رقم ارزی ناشی از نرخ تسعیر) | src/services/accounting/voucherSync.service.ts:241 | resolved:v6.0.4 (Sub-phase 1.4) |
| TD-144 | Purchase Voucher Soft-Delete | 🆕 عدم اعمال فیلتر isDeleted = 0 در استخراج اقلام فاکتور خرید برای صدور سند حسابداری | src/services/accounting/voucherSync.service.ts:339 | resolved:v6.0.9 (Sub-phase 3.1) |
| TD-145 | Sales Return COGS Voucher | 🆕 عدم صدور آرتیکل‌های موجودی کالا و بهای تمام‌شده در سند حسابداری ناشی از نهایی‌سازی مرجوعی فروش | src/services/accounting/voucherSync.service.ts:745 | resolved:v6.0.10 (Sub-phase 3.2) |
| TD-146 | Double Reversal Vulnerability | 🆕 امکان صدور چندباره سند معکوس در reverseVoucher به دلیل فقدان قفل سطری و عدم بررسی سند معکوس پیشین | src/services/accounting/voucher.service.ts:470 | resolved:v6.0.11 (Sub-phase 3.3) |
| TD-147 | Deleted Account Code Reuse | 🆕 عدم امکان تعریف مجدد یا احیای کدهای سرفصل چارت حساب‌های حذف‌شده نرم | src/services/accounting/chartOfAccounts.service.ts:238 | resolved:v6.0.9 (Sub-phase 3.1) |
| TD-148 | Cheque Instant Bank Drain | 🆕 کسر/افزایش مستقیم مانده حساب بانکی در تراکنش‌های خزانه‌داری با روش چک و ایجاد ریسک برداشت مضاعف | src/services/accounting/treasury/treasuryTransaction.service.ts:310 | resolved:v6.0.2 (Sub-phase 1.2) |
| TD-149 | Jalali String in Voucher Date | 🆕 بازتولید ذخیره رشته تاریخ شمسی در ستون تاریخ سند حسابداری در چرخه چک و بازثبت سند | src/services/accounting/treasury/chequeLifecycle.service.ts:348 | resolved:v6.0.12 (Sub-phase 3.4) |
| TD-150 | Cheque Spent Status Blocked | 🆕 مسدود بودن انتقال وضعیت به خرج چک (spent) در ماشین وضعیت چک‌های صیادی | src/services/accounting/treasury/chequeLifecycle.service.ts:30 | resolved:v6.0.13 (Sub-phase 4.1) |
| TD-151 | Bank Reconciliation Calendar | 🆕 خطای محاسبه تفاضل روز در مغایرت‌گیری بانکی بر اثر تقویم شمسی/میلادی و افتادن به تطبیق غلط amount_only | src/components/accounting/reconciliation/bankStatementMatcher.ts:65 | resolved:v6.0.14 (Sub-phase 4.2) |
| TD-152 | Document Ref Full Scan | 🆕 اسکن کامل جدول اسناد بدون تفکیک سال مالی در مقداردهی اولیه شمارنده عطف | src/services/document.service.ts:298 | resolved:v6.0.15 (Sub-phase 4.3) |
| TD-153 | Duplicate Ref False Positive | 🆕 اعلام ناهماهنگی تکرار شماره عطف بدون در نظر گرفتن نوع سند در گزارش سلامت دیتابیس | src/services/reconciliation/dataReconciliation.service.ts:70 | resolved:v6.0.15 (Sub-phase 4.3) |
| TD-154 | Update Document Lost Update | 🆕 خواندن بدون قفل سطری قبل از ویرایش سند و ریسک بازنویسی اسناد نهایی‌شده همزمان | src/services/document.service.ts:197 | resolved:v6.0.17 (Sub-phase 5.2) |
| TD-155 | WooCommerce Order Webhook Race | 🆕 مسابقه همزمانی در وب‌هوک ووکامرس برای سفارش‌های بار اول به دلیل عدم وجود سطر لاگ اولیه | src/routes/woocommerce.routes.ts:178 | resolved:v6.0.18 (Sub-phase 5.3) |
| TD-156 | Direct DB Mutations in Routes | 🆕 جهش مستقیم دیتابیس در ۸ فایل روت به جای سرویس‌های تخصصی دامنه (نقض صریح RULE 01) | src/routes/{customers,items,users,transfers,...}.routes.ts | resolved:v6.0.20 (Sub-phase 6.2) |
| TD-157 | Hard Delete in Auditable Entities | 🆕 حذف فیزیکی (Hard Delete) در ردیف‌های اقلام سند، آرتیکل‌ها، انتقالات و نقش‌ها (نقض صریح RULE 09) | src/services/document.service.ts, voucher.service.ts | resolved:v6.0.21 (Sub-phase 6.3) |
| TD-158 | Raw SQL Mutation in Procurement | 🆕 استفاده از قطعه کد Raw SQL در بند onConflictDoUpdate شمارنده درخواست خرید (نقض RULE 04) | src/services/procurement.service.ts:84 | resolved:v6.0.22 (Sub-phase 6.4) |
| TD-159 | Lock Order Inversion (Deadlock) | 🆕 معکوس شدن اولویت قفل‌گذاری اسناد و کالاها در finalizeDocument و ریسک خطای deadlock detected | src/services/document.service.ts:1350 | resolved:v6.0.16 (Sub-phase 5.1) |

---

## 📊 آمار رجیستری

- **فعال:** ۳۷ ردیف (۱۲ ردیف فعال پیشین + ۲۵ ردیف ناشی از ممیزی مستقل نسخه ۶: TD-135 تا TD-159)
- **آرشیو شده (resolved):** ۱۲۹ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`
- مبنای آمار و IDs یکتا: هر دو فایل مجموعاً فضای ID مشترک دارند؛ IDs جدید باید
  از بزرگ‌ترین ID موجود در **هر دو** فایل + ۱ انتخاب شود.

---

*آخرین بازبینی: v6.0.0 — ابلاغ رسمی نقشه راه نسخه ۶ (ثبت کامل ۲۵ بدهی فنی TD-135 تا TD-159 بر مبنای یافته‌های ممیزی مستقل داده‌ها و معماری).*
