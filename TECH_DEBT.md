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
| TD-113 | DB Integrity / Counters (P0) | 🆕 ممیزی v5.0.11: مهاجرت پایه جدول‌های `document_ref_counters` و `item_code_counters` را بدون PRIMARY KEY می‌سازد؛ در نصب تازه (پروداکشن) هر `ON CONFLICT (doc_type, fiscal_year)` خطای خام ۵۰۰ می‌دهد و ثبت فاکتور همیشه شکست می‌خورد. تست‌ها به‌دلیل DB مشترک با کلید قدیمی، باگ را پنهان کرده بودند — برنامه اصلاح: `docs/FIX_PLAN_V5_INVOICE_STOCK.md` فاز ۰ | drizzle/0000_v3_baseline.sql:154-163, document.service.ts:484-491, procurement.service.ts:82, itemCatalog.service.ts:239 | open — فاز ۰، انتشار v5.0.13 |
| TD-114 | Inventory / Warehouse Resolution | 🆕 `applyStockMovement` هر رشته‌ای را به‌عنوان انبار می‌پذیرد؛ `location` نامعتبر کلید شبح در `items.stocks` می‌سازد. نیاز به `resolveWarehouseCode` واحد (کد ← نام ← خطا) | document.service.ts:1058-1065 | open — فاز ۱ |
| TD-115 | Inventory / Hardcoded Warehouse | 🆕 پیش‌فرض‌های ثابت «انبار اصلی»/«انبار مرکزی» و 'main' در تدارکات/سفارش خرید/reorder و ۱۰+ سرویس — با کد انبار متفاوت کلید شبح می‌سازند | SplitOrderModal.tsx:61,125، procurement.service.ts:662,983,998، projectBomAllocation.service.ts و... | open — فاز ۱ |
| TD-116 | DB Data Repair | 🆕 داده آلوده: کلید شبح «انبار اصلی» در stocks کالا T-001 ({"main":150,"انبار اصلی":60}) + location نام در transactions/document_items سندهای 829-832 — مهاجرت 0010 با پشتیبان و هم‌ترازی current_stock=Σ stocks | items.stocks, transactions.location, document_items.location | open — فاز ۱، مهاجرت 0010 |
| TD-117 | Warehouses Route Guard | 🆕 غیرفعال‌سازی انبار با موجودی مجاز است (کلید شبح می‌سازد) + مسیرهای warehouse هیچ logActivity ندارند | warehouses.routes.ts:57-70 | open — فاز ۱ |
| TD-118 | Sales Reservation Gate | 🆕 گیت رزرو فقط در POST /documents هست (maxAllowed = stock − رزرو پیش‌فاکتور/پروژه) ولی finalizeDocument ندارد؛ خود-رزروی در تبدیل پیش‌فاکتور؛ ترکیب رزرو کل با انبار مقصد نادرست؛ UI فقط موجودی خام نشان می‌دهد → «موجودی ۳ ولی اجازه ۲» | documents.routes.ts:238-273، document.service.ts:1275، CreateInvoicePage.tsx:303-684 | open — فاز ۲ |
| TD-119 | Jalali-as-Gregorian Dates | 🆕 ۴ سند receipt و ۲ گردش با تاریخ `1405-06-20` میلادی ذخیره شده (سپردن تاریخ شمسی خام به createDocument)؛ شاخه audit هنوز date خام درج می‌کند؛ ردیف‌های fiscal_year=2026 باقی‌مانده از resolve قدیمی | document.service.ts:549، procurement.service.ts:677 | open — فاز ۳ + مهاجرت اصلاح داده |
| TD-120 | COGS Voucher Missing | 🆕 سند خودکار فاکتور فروش ردیف بهای تمام‌شده/موجودی کالا ندارد (financialHealth خودش علت انحراف موجودی را همین می‌داند)؛ getter costOfGoodsSoldCode هم تعریف نشده. سند نامتوازن در نبود حساب تخفیف/ارزش افزوده | voucherSync.service.ts:124-167 | open — فاز ۴ |
| TD-121 | Warehouse Voucher Hardcodes | 🆕 syncWarehouseDocumentVoucher کدهای ثابت دارد؛ fallback WIP به 6001 (=COGS!) تداخل حسابی می‌سازد؛ strict بدون حساب WIP ساکت null برمی‌گرداند (نقض TD-093)؛ پروژه از regex روی notes به‌جای documents.projectId؛ doc.date.split('T') با mode:'string' سالم نیست | voucherSync.service.ts:477-534 | open — فاز ۴ |
| TD-122 | Test Cleanup Broken Cast | 🆕 `id = ANY($1::text[])` روی ستون integer خطای `integer = text` می‌دهد؛ پاکسازی تست همیشه ساکت شکست می‌خورد و داده آزمایشی در DB می‌ماند | src/tests/fixtures/dbTestHelper.ts:94 | open |
| TD-123 | GET-یی که می‌نویسد | 🆕 `syncMissingWarehouseStocks` در هر GET /items روی همه کالاها SELECT و بی‌لاگ UPDATE می‌کند | items.crud.routes.ts:137 | open — فاز ۱ |
| TD-124 | Stock Gate Bypass | 🆕 شاخه audit در createDocument و افتتاحیه کالا در POST/PUT مستقیم transactions/stocks می‌نویسند (بدون applyStockMovement → بدون WAC/Outbox/گارد انبار) | document.service.ts:517-577، items.crud.routes.ts:305-325,495-510 | open |
| TD-125 | Stock Event Location | 🆕 رویداد outbox موجودی `warehouseLocation: targetLoc` خام را ثبت می‌کند نه کد نهایی (ممکن است خالی باشد) | document.service.ts:1191 | open — یک‌خطی |
| TD-126 | Proforma Reservation Deleted Items | 🆕 محاسبه رزرو پیش‌فاکتور اقلام نرم‌حذف‌شده را هم حساب می‌کند (بدون فیلتر isDeleted) | itemStockReservation.service.ts:469-482 | open — فاز ۲ |
| TD-127 | AGENTS.md Contradiction | 🆕 بخش‌های ۷ و ۱۳ هنوز changelog 4.ts را الزامی می‌کنند؛ بخش ۲۳ ملاک 5.ts است | AGENTS.md:56,89 | open — مستندسازی |
| TD-128 | Repo Hygiene | 🆕 `scripts_temp_audit.py` (۹ خط ناقص) ای‌استودیو کامیت کرده | ریشه پروژه | open — حذف |
| TD-129 | Lockfile Flux | 🆕 ای‌استودیو تاکنون ۵ بار package-lock.json را حذف کرده؛ update.sh مقاوم شده ولی ریپو ناپایدار — نیاز به گیت چک در CI و هشدار در GEMINI.md | فرایند/CI | open |
| TD-130 | Hard Delete in updateDocument | 🆕 ویرایش سند ردیف‌های document_items را سخت حذف می‌کند (tx.delete) | document.service.ts:235 | open — مستندسازی یا حذف نرم |
| TD-131 | JWT Dev Fallback | 🆕 در محیط غیر-production اگر JWT_SECRET نباشد secret پیش‌فرض استفاده می‌شود؛ NODE_ENV خالی = fallback. فقط development/test مجاز شوند | src/middleware/auth.ts:34 | open — امنیتی |
| TD-132 | npm Audit Vulns | 🆕 ۱۰ آسیب‌پذیری (۹ متوسط، ۱ بالا)؛ firebase/firebase-admin/@google/genai بدون مصرف کد فقط برای سازگاری ای‌استودیو | npm audit | open — بررسی مسیر runtime |
| TD-133 | import.meta CJS Warning | 🆕 هشدار esbuild در باندل سرور (شاخه fallback کار می‌کند) | src/db/migrator.ts:21 | open — minor |
| TD-134 | Test DB Isolation Off by Default | 🆕 تست‌ها روی DB مشترک اجرا می‌شوند (`ERP_TEST_SCHEMA_ISOLATION` اختیاری) — همین باعث پنهان‌ماندن TD-113 شد؛ ایزوله‌سازی در CI الزامی شود | scripts/run-tests.ts:33 | open |

---

## 📊 آمار رجیستری

- **فعال:** ۳۱ ردیف (TD-032, TD-080, TD-085, TD-106, TD-108..112، TD-113..134)
- **آرشیو شده (resolved):** ۱۱۱ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`
- مبنای آمار و IDs یکتا: هر دو فایل مجموعاً فضای ID مشترک دارند؛ IDs جدید باید
  از بزرگ‌ترین ID موجود در **هر دو** فایل + ۱ انتخاب شود.

---

*آخرین بازبینی: v5.0.11 — ممیزی خطای ثبت فاکتور پروداکشن (TD-113: نبود PRIMARY KEY جدول‌های شمارنده در مهاجرت پایه) و ۲۱ بدهی جانبی (TD-114..134) ثبت شد؛ برنامه اصلاحی مصوب: `docs/FIX_PLAN_V5_INVOICE_STOCK.md`. مسئولیت به‌روزرسانی: هر AI Agent / دولوپر قبل از پایان هر زیرفاز.*
