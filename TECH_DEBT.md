# Technical Debt Registry — رجیستری بدهی فنی

> **قاعده الزامی:** هر بدهی/میان‌بر شناسایی‌شده در توسعه باید به این فایل اضافه شود
> (ردیف جدید با ID یکتا). این فایل مرجع برنامه‌ریزی دورهای نگهداری است و بخشی از
> قرارداد مستندسازی پروژه محسوب می‌شود (بخش ۳۱ `AGENTS.md`).
>
> وضعیت‌ها: `open` | `scheduled:<phase>` | `in_progress` | `resolved`

---

## 🔴 بحرانی (سلامت داده / صحت مالی)

| ID | حوزه | شرح | منبع (فایل) | وضعیت |
|----|------|-----|--------------|-------|
| TD-001 | Docs | تجمیع AGENTS/GEMINI در یک سند مرجع معماری و حذف اسناد منسوخ | AGENTS.md, GEMINI.md | resolved (v3.0.0) |
| TD-002 | Data Safety | اسکریپت `clean-install.sh` هنوز `DROP DATABASE/DROP USER` اختیاری دارد؛ تولید خودکار backup پیشنهادی قبل از migrationها بررسی شود | clean-install.sh:36+ | open |
| TD-003 | Tests | دو سوییت e2e/integration همچنان cleanup را در finally صدا می‌زنند — اکنون gated داخل خود تابع است ولی برای شفافیت، گیت صریح هم داشته باشند | e2eSuite.ts:529, integrationSuite.ts:1234 | resolved (Phase 2) |
| TD-004 | Deploy | جریان deployment فعلاً به PM2 متکی است؛ Dockerfile در CI کامنت است (قبولی عملیاتی در V8 مانده) | .github/workflows/ci.yml | open |

## 🟠 مهم

| ID | حوزه | شرح | منبع | وضعیت |
|----|------|-----|------|-------|
| TD-010 | Items Coding | فرانت فرم کالا endpoint ناموجود `/items/next-code` را صدا می‌زند (fallback ساکت)؛ backend واقعی `/items/next-product-code` الگوی MAX()+1 دارد و یتیم مانده. فاز V10-2.1 endpoint اتمیک next-code + UI segment-wise تحویل می‌دهد | itemFormHelpers.ts:32,42; items.crud.routes.ts:473 | resolved (V10-2.1) |
| TD-011 | Items Coding | prefixهای تکراری seed (۵ دسته = N) و دوخط‌تیره مواد اولیه (`B-H--101`) نیاز بازطراحی seed دارند | src/db/seed.ts:46-72; useItemForm.ts:157,180 | resolved (V10-2.1 + تصمیم کاربر در v1.0.4): گوشواره آویز بزرگ/دو تکه → E، میخی → S، گردنبندها همه N؛ دوخط‌تیره با prefix بدون-dash رفع شد |
| TD-012 | UI Copy | متن «حداکثر ۱۰۰ کیلوبایت» در ItemSpecificationsForm با گیت واقعی 1MB ناسازگار؛ استاندارد نهایی 300KB فاز ۲ اعمال می‌شود | ItemSpecificationsForm.tsx:201, itemFormHelpers.ts:54 | resolved (V10-2.3) |
| TD-013 | Uploads | لوگوی GeneralSettingsTab بدون هیچ size/type validation (پنج مگابایت خام base64) | GeneralSettingsTab.tsx:118-130 | resolved (V10-2.3) |
 | TD-014 | Dialogs | ۳۴ دیالوگ native باقی‌مانده (بجز قطعی‌سازی سند که حل شد) → ConfirmModal/toast؛ توجه: چند مورد داخل hooks هستند و نیاز state-lifted دارند | audit list فاز 3.1 | resolved (V10-3.1) |
| TD-015 | Print | کلاس `.no-print` تعریف نشده (~۱۷ استفاده در حسابداری) + chrome چاپ PrintDocModal کارتابل فاقد print:hidden | index.css, approval/PrintDocModal.tsx | resolved (V10-3.2) |
| TD-016 | CRM | فروشنده مسئول از users؛ لینک پرسنل↔کاربر formal نیست؛ syncCustomerFromCRMLead بدون audit-log؛ documents.crm_lead_id جای regex یادداشت | useCRMData.ts:170-182; crm.routes.ts:328-411; documents.routes.ts:180 | resolved (V10-4.1/4.2/4.3): فروشنده از پرسنل + لینک userId تأیید؛ sync دارای audit قبل/بعد؛ documents.crm_lead_id رسمی شد و regex حذف گردید؛ گره gated leads در DELETE باز شد |
| TD-017 | Payroll | status=paid قابل تنظیم مستقیم از UI بدون عبور خزانه؛ حقوق ثابت/ترکیبی پشتیبانی نمی‌شود؛ عنوان صفحه به «حقوق و دستمزد» تغییر کند | piecework.routes.ts:1026-1086 | resolved (V10-4.4): paid فقط با register-payment خزانه‌ای (ConflictError بر مسیر مستقیم)؛ salaryType/monthlySalary + totalFixedAmount؛ عنوان صفحه اصلاح شد |
| TD-018 | RBAC | واژگان دوگانه items./products./warehouse.approve؛ ۱۴ permission بی‌استفاده؛ viewer دارای daily_logs.create؛ seed merge-only هرگز revoke نمی‌کند | seed.ts, pendingMaterials.routes.ts:197,282 | resolved (V10-5.1/5.2): واژگان unify شد (pending_materials.approve / piecework.payroll)؛ viewer fix؛ workflow.execute سید شد؛ documents.delete enforce؛ cleanup با env opt-in |
| TD-019 | RBAC | کنترل دید منو per-role وجود ندارد (فقط مشتق permission)؛ menu_visibility JSON لازم است | menuConfig.ts:51-164 | resolved (V10-5.3): deny-list JSON در app_settings + ماتریس نقش×مسیر در RolesTab + ادغام در getMenuGroups/Sidebar |
| TD-020 | Accounting | تکرار خارج از tx مسیر route-level `AccountingService.sync*Voucher` پس از ثبت سند (idempotent اما زائد) | documents.routes.ts:229-249,379-406 | resolved (Phase 2) |
| TD-021 | Accounting | الگوی دوردیفی در حذف ادمینی تراکنش تکی: insert reversal + applyStockMovement مجدد (کاردکس جفت حساب نمیشود unless scoped) | transactions.routes.ts:196-225 | resolved (Phase 2) |
| TD-022 | Woo | نگاشت currency سفارش به `'تومان'` خارج از واژگان ارزی استاندارد سیستم | woocommerce.routes.ts:282 | resolved (Phase 2) |

## 🟡 جزئی / نکات تمیزکاری

| ID | حوزه | شرح | منبع | وضعیت |
|----|------|-----|------|-------|
| TD-030 | FE Minor | ItemsTable colSpan=11 برای viewers (ستون عملیات مخفی) | ItemsTable.tsx:254 | resolved (Phase 2) |
| TD-031 | FE Minor | دو نسخه واگرای parseMultiValue/formatMultiValue (Persian comma فقط در یکی) | ItemsTable.tsx:8-15 vs itemFormHelpers.ts:21-28 | resolved (Phase 2) |
| TD-032 | UX | password visibility toggle + lockout countdown پیاده شد — فقط تست دستی E2E روی دیوایس موبایل باقی است | LoginPage.tsx | open |
| TD-033 | Backend Types | ~۳۸۰ نقطه `: any` در سرویس‌های رویداد، ورکفلو، ریکاوری، اکشن‌ها، تست‌ها و روت‌های اکسپرس پاکسازی و با تایپ‌های مستحکم جایگزین شد؛ بیلد و تایپ‌اسکریپت کاملاً سبز | services, routes, events, workflow | resolved (v2.8.4) |
| TD-034 | Dates | استانداردسازی کامل تاریخ‌های میلادی ISO و نگارش همزمان (Dual-Write) در daily_work_logs, piecework_logs و crm_activities به همراه ایندکس‌ها و مایگریشن بک‌فیل | schema.ts multiple, migrator.ts | resolved (v2.8.5) |
| TD-035 | Migrator | fallback سال مالی '2026' در backfill قدیمی migrator طی remap فاز ۱.۲ عملاً مهار شد؛ برای نصب‌های تازه مقدار اولیه seed review شود | migrator.ts(legacy backfill) | resolved-by-V10-1.2 |
| TD-036 | DB Hygiene | پاکسازی کامل داده‌های آزمایشی و تسویه‌نشده با اسکریپت `scripts/cleanup-test-data.ts`، حذف تمام اسناد، کاربران، آیتم‌ها، فیش‌ها و لاگ‌های تستی و همگام‌سازی سکوئنس‌ها و شمارنده‌های پایگاه‌داده به همراه اسکن سلامت ۱۲ گانه | scripts/cleanup-test-data.ts, dbTestHelper.ts | resolved (v2.8.6) |
| TD-037 | Test Runner UI | حذف کامل کامپوننت بلااستفاده و کد مرده SystemTestRunner.tsx از فرانت‌اند، کاهش حجم باندل کلاینت و شفاف‌سازی مسیر رسمی اجرای آزمون‌ها (فقط CLI استاندارد `npm run test`) | SystemTestRunner.tsx (deleted) | resolved (v2.8.7) |
| TD-038 | DB Migration | یکپارچه‌سازی نهایی پایپ‌لاین مایگریشن‌ها و حذف تعریف دستی DDLهای تکراری در migrator.ts به نفع اجرای مستقیم فایل‌های SQL دریزل | src/db/migrator.ts, drizzle/*.sql | resolved (v3.0.2) |
| TD-039 | FE Performance | بهینه‌سازی حجم لود اولیه باندل با تبدیل ایمپورت ماژول‌های سنگین نظیر xlsx به Dynamic Import / Lazy Loading در مودال‌های اکسل | src/components/excel/*, src/components/UnifiedExcelModal.tsx | resolved (v3.0.3) |
| TD-040 | DB Scalability | تدوین استراتژی بایگانی دوره‌ای (Archival) لاگ‌های ممیزی، سوابق گردش انبار و پاکسازی رکوردهای نهایی‌شده در Outbox | src/services/events/outboxService.ts, src/lib/auditLogger.ts | resolved (v3.0.3) |
| TD-041 | Testing DevX | تفکیک اسکریپت‌های اجرای آزمون در package.json (تفکیک `test:unit` برای فیدبک سریع و `test:full` برای پایپ‌لاین CI) | package.json, scripts/run-tests.ts | resolved (v3.0.3) |
| TD-042 | Caching | پیاده‌سازی لایه کش درون‌حافظه‌ای سبک (TTL-based Memory Cache) برای تنظیمات عمومی سامانه و ماتریس مجوزهای نقش‌ها | src/routes/system.routes.ts, src/middleware/auth.ts, src/lib/memoryCache.ts | resolved (v3.0.3) |
| TD-043 | Architecture / DevOps | حل پدیده Version Drift، ایجاد ماژول منبع واحد نسخه (SSOT) در src/lib/version.ts، حذف مقادیر هاردکدشده در اندپوینت سلامت، بک‌آپ، ReleaseGate و مانیفست K8s | src/lib/version.ts, src/app.ts, src/routes/system.routes.ts, src/services/releaseGate.service.ts, deploy/k8s/erp-deployment.yaml | resolved (v3.0.4) |

---

*آخرین بازبینی: v3.0.4 — حل بدهی‌های فنی TD-039 تا TD-043 (بهینه‌سازی باندل اکسل، بایگانی داده‌ها، تفکیک اسکریپت تست، کش درون‌حافظه‌ای، و حل ریشه‌ای Version Drift با ماژول متمرکز SSOT). مسئولیت به‌روزرسانی: هر AI Agent / دولوپر قبل از پایان هر زیرفاز.*
