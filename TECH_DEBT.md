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
| TD-081 | Project Control (Write-Path) | مسیر نوشتن `inventory_control.reservedItems` jsonb (حواله خروج) هنوز کتابداری موازی است — باید release رسمی رزروها از طریق سرویس تخصیص/رزرو انجام و jsonb به read-model تنزل یابد | documents.routes.ts:248-309 | scheduled:فاز بعدی کنترل پروژه |
| TD-085 | Workflow/Events UX | (۱) پیش‌نمایش شرایط لازم به فارسی از `evaluateRuleBreakdown` قبل از اقدام؛ (۲) نمایش پیشرفت امضا «n از m» در Stepper از `approvalProgressJson`؛ (۳) انتخاب‌گر فیلد payload به‌جای تایپ دستی `{{payload.x}}` در RuleEditorModal؛ (۴) قوانین پیش‌فرض یادآوری SLA | workflow/task/rule UI | scheduled:فاز UX |
| TD-104 | Business Clock (دامنه‌های ثانویه) | 🆕 ارزیابی مستقل v4.0.28: TD-062 فقط «۲ نقطه» را بست ولی کلاس نقض در دامنه‌های ثانویه زنده است — `dailyLogs.routes.ts:250,468`، `crm.routes.ts:628,755,821`، `transfers.routes.ts:228`، `woocommerce.routes.ts:331`، `notifications.routes.ts:31`، `payrollPayment.service.ts:49` (تاریخ پرداخت مالی) و `inventoryStockRepair.service.ts:36`؛ هیچ‌کدام businessClock را import نمی‌کنند؛ با TZ تهران رکوردهای نیمه‌شب تا ۰۳:۳۰ با تاریخ روز قبل ثبت می‌شوند | dailyLogs.routes.ts, crm.routes.ts, transfers.routes.ts, woocommerce.routes.ts, notifications.routes.ts, payrollPayment.service.ts, inventoryStockRepair.service.ts | open — مسیریابی به `businessTodayIsoDate()` / `systemNowUtcIso()` |
| TD-105 | Financial / Treasury (ساعت مرورگر) | 🆕 ارزیابی مستقل v4.0.28: مودال‌های خزانه v4.0.16 تاریخ تراکنش را با `new Date().toISOString()` از ساعت مرورگر کلاینت می‌سازند (`TreasuryTransactionModal.tsx:35,59`، `TreasuryTransferModal.tsx:27,39`) و سرور `data.date` را بدون enforce ساعت توافقی یا اعتبارسنجی بازه می‌پذیرد (`treasuryTransaction.service.ts:295,332`) — تاریخ اسناد خزانه‌داری واک مشارکتی از UTC مرورگر مشمول شیفت می‌شود | TreasuryTransactionModal.tsx, TreasuryTransferModal.tsx, treasuryTransaction.service.ts | open — تاریخ پیش‌فرض از API سرور + اعتبارسنجی بازه در سرویس |
| TD-106 | Frontend / Type Safety (FE-007) | 🆕 ارزیابی مستقل v4.0.28: ادعای TD-033 (پاکسازی ~۳۸۰ نقطه any) کهنه است — اکنون ~۸۵۷ نقطه `: any` در src (شامل کد تازه v4: TreasuryTransactionModal.tsx:20,50,79 و...)؛ typecheck سبز است ولی FE-007 در حال فرسایش، به‌ویژه در کامپوننت‌های حمل‌کننده محاسبات مالی | سراسر src (services, pages, components, hooks) | open — اولویت: خزانه/حسابداری مالی، سپس تدریجی |
| TD-107 | Test Data Safety (باقی‌مانده TD-064) | 🆕 ارزیابی مستقل v4.0.28: `dbTestHelper.ts:177-178` هنوز `DELETE/UPDATE ... ILIKE '%آزمایشی%' OR '%TEST%'` روی purchase_requisitions دارد (کلاس TD-064 که با تنگش‌سازی هندل شد)؛ بازطراحی marker محور وعده‌داده‌شده فاز ۴ انجام نشده | src/tests/fixtures/dbTestHelper.ts:177-178 | open — بازطراحی marker محور |
| TD-108 | FE Helpers (Badges) | 🆕 ممیزی کد مرده v4.0.29: ۱۲ کپی `getStatusBadge`/`getPriorityBadge` با الگو یکسان ولی واژگان/رنگ/آیکون/اندازه متفاوت (پروژه‌ها، procurement، رویدادها، نسبت‌های مالی و...) — تلفیق کور ریسک رگرسیون بصری دارد؛ نیاز به `PillBadge` مشترک + جداول نگاشت دامنه‌ای | 7× getStatusBadge + 5× getPriorityBadge در components/pages | scheduled:فاز UX — همراه TD-085 |
| TD-109 | Runtime Flags Cleanup | 🆕 پس از حذف روت‌های tests/run و clean-test-data (v4.0.29)، سرویس `runtimeFlags.ts`، کلید `runtime_enable_test_endpoints` و payload `/system/env` بدون کارکرد گیت‌کننده مانده‌اند (فقط اطلاعاتی) — حذف کامل سرویس/کلید/استیت useSettings | src/lib/runtimeFlags.ts, system.routes.ts, useSettings.ts, seed.ts | open — پاکسازی نهایی در فاز بعدی |
| TD-110 | financialMath Shim | 🆕 ۵ سرویس انبار/تطبیق از re-export shim (`utils/financialMath.ts`) به‌جای import مستقیم `lib/financialDecimal` استفاده می‌کنند؛ مهاجرت ۵ ایمپورت و حذف shim + آپدیت unitSuite | src/utils/financialMath.ts, 5 services | open — minor |
| TD-111 | Version Sync Enforcement | 🆕 دو منبع نسخه (`package.json` و `SYSTEM_UPDATES[0]`) فقط به‌صورت دستی دوبامپ همگام می‌شوند (AGENTS §23)؛ هیچ گیت خودکاری واگرایی را کشف نمی‌کند — افزودن چک نسخه در CI/ReleaseGate | package.json, src/data/changelogs/4.ts, src/lib/version.ts | open — گیت CI |
| TD-112 | Workflow Keep-List (نقشه TD-085) | 🆕 پس از پاکسازی v4.0.29: ۶ روت workflow عمداً بدون مصرف‌کننده frontend نگه‌داری شدند (versions/publish/rollback/bottlenecks/compliance + docs CRUD) — اینها «مرده» نیستند، هدف فاز UX فلات (TD-085) هستند؛ فاز بعدی یا UI تولید کند یا حذف شود | workflow.routes.ts:268-445 | open — منوط به TD-085 |

---

## 📊 آمار رجیستری

- **فعال:** ۱۴ ردیف (TD-032, TD-080, TD-081, TD-085, TD-104..112)
- **آرشیو شده (resolved):** ۱۰۶ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`
- مبنای آمار و IDs یکتا: هر دو فایل مجموعاً فضای ID مشترک دارند؛ IDs جدید باید
  از بزرگ‌ترین ID موجود در **هر دو** فایل + ۱ انتخاب شود.

---

*آخرین بازبینی: v4.0.29 — ممیزی جامع کد مرده (unused imports/exports، dead routes، duplicate services/helpers، legacy code، منطق چنج‌لاگ)؛ TD-083 به آرشیو منتقل شد؛ ثبت TD-108 تا TD-112. مسئولیت به‌روزرسانی: هر AI Agent / دولوپر قبل از پایان هر زیرفاز.*
