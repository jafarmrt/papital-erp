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

---

## 📊 آمار رجیستری

- **فعال:** ۹ ردیف (TD-032, TD-080, TD-085, TD-106, TD-108..112)
- **آرشیو شده (resolved):** ۱۱۱ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`
- مبنای آمار و IDs یکتا: هر دو فایل مجموعاً فضای ID مشترک دارند؛ IDs جدید باید
  از بزرگ‌ترین ID موجود در **هر دو** فایل + ۱ انتخاب شود.

---

*آخرین بازبینی: v4.0.31 — بسته‌شدن فاز ۵ ردیف: TD-104 (Business Clock در ۷ دامنه ثانویه)، TD-105 (تاریخ سرور-authoritative خزانه)، TD-081 (سرویس یگانه آزادسازی رزرو پروژه با OCC)، TD-107 (پاکسازی تستی مارک‌محور) و TD-111 (گیت CI همگام‌سازی نسخه + گیت coverage نرم). مسئولیت به‌روزرسانی: هر AI Agent / دولوپر قبل از پایان هر زیرفاز.*
