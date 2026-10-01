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
| TD-032 | UX | password visibility toggle + lockout countdown پیاده شد — فقط تست دستی E2E روی دیوایس موبایل باقی است | LoginPage.tsx | open |
| TD-080 | Refactoring Budget | چند تابع با cognitive >۱۰۰ پیش‌موجودند: parseCliArgs (۲۵۳)، useCRMData (۱۷۷)، useAccounting (۱۴۹)، سوییت‌های تست (۱۳۰-۱۵۸)، processUnifiedImport (۱۱۷)، CreateInvoicePage/InventoryRebuildModal (۱۰۴-۱۱۱) | scripts/initial-setup.ts، src/hooks، src/pages | in_progress — تفکیک در فاز ۴ نسخه ۷ |
| TD-085 | Workflow/Events UX | (۱) پیش‌نمایش شرایط لازم به فارسی از `evaluateRuleBreakdown` قبل از اقدام؛ (۲) نمایش پیشرفت امضا «n از m» در Stepper از `approvalProgressJson`؛ (۳) انتخاب‌گر فیلد payload به‌جای تایپ دستی `{{payload.x}}` در RuleEditorModal؛ (۴) قوانین پیش‌فرض یادآوری SLA | workflow/task/rule UI | scheduled:فاز ۳ نسخه ۷ |
| TD-106 | Frontend / Type Safety (FE-007) | ۹۱۸ مورد `: any` و ۲۷۹ مورد `as any` در سورس‌کد | سراسر src | scheduled:فاز ۳ نسخه ۷ |
| TD-108 | FE Helpers (Badges) | ۱۲ کپی `getStatusBadge`/`getPriorityBadge` با الگو یکسان ولی واژگان/رنگ متفاوت — تجمیع در PillBadge | components/pages | scheduled:فاز ۳ نسخه ۷ |
| TD-109 | Runtime Flags Cleanup | پاکسازی کامل سرویس/کلیدهای موقت test_endpoints پس از حذف روت‌های تست | src/lib/runtimeFlags.ts | scheduled:فاز ۲ نسخه ۷ |
| TD-110 | financialMath Shim | مهاجرت ۵ ایمپورت باقی‌مانده از utils/financialMath به lib/financialDecimal و حذف فایل واسط | src/utils/financialMath.ts | resolved:v7.0.10 (فاز ۲ نسخه ۷) |
| TD-112 | Workflow Keep-List | روت‌های بدون مصرف‌کننده فرانت‌اند در انتظار رابط کاربری فاز ۳ | workflow.routes.ts | scheduled:فاز ۳ نسخه ۷ |
| TD-129 | Lockfile Flux | محافظت از وجود package-lock.json در گیت CI و فعال‌سازی کش | فرایند/CI | resolved:v7.0.3 (فاز ۲ نسخه ۷) |
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
| TD-170 | Dual Serialization Debt | بازگرداندن همزمان کلیدهای camelCase و snake_case در روت پروژه‌ها | src/routes/projects.routes.ts:202 | scheduled:فاز ۴ نسخه ۷ (P2) |

---

## 📊 آمار رجیستری

- **فعال:** ۱۷ ردیف
- **آرشیو شده (resolved):** ۱۶۰ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`
- مبنای آمار و IDs یکتا: هر دو فایل مجموعاً فضای ID مشترک دارند؛ IDs جدید باید
  از بزرگ‌ترین ID موجود در **هر دو** فایل + ۱ انتخاب شود.

---

*آخرین بازبینی: v7.0.10 — پیاده‌سازی کامل TD-110 و TD-132 در نقشه راه نسخه ۷ (V7_MASTER_ROADMAP.md).*
