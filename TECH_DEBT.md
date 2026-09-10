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
| TD-044 | Data Integrity | 🎯 ممیزی Forensic BUG-01: raw SQL جهشی از تراکنش در حذف تراکنش‌های یتیم (بدون tx/Audit، نقض DB-009) | dataReconciliation.service.ts:250 | resolved (v3.0.6) |
| TD-045 | Data Integrity | 🎯 ممیزی Forensic BUG-02: کاهش موجودی درون‌ریزی اکسل بدون ردیف out در کاردکس → Rebuild رویداد-محور موجودی را برمی‌گرداند | itemCatalog.service.ts:520-560 | resolved (v3.0.6) |
| TD-046 | Financial Integrity | 🎯 ممیزی Forensic BUG-03: بستن سال مالی غیراتمیک (۴ تراکنش مستقل) بدون گارد بستن مجدد | fiscalYear.service.ts | resolved (v3.0.6) |
| TD-047 | Observability | 🎯 ممیزی Forensic BUG-04: purgeProcessedEvents وضعیت نادرست 'processed' را پاکسازی می‌کرد (worker می‌نویسد 'completed') → رشد بی‌پایان outbox | outboxService.ts:520 | resolved (v3.0.6) |
| TD-048 | Security | 🎯 ممیزی Forensic BUG-05: GET /settings کل app_settings شامل secretهای WooCommerce را به هر کاربر احراز هویت‌شده برمی‌گرداند | system.routes.ts:120 | resolved (v3.0.6) |
| TD-049 | CI/CD | 🎯 ممیزی Forensic BUG-06: تریگر CI روی main/staging درحالی‌که برنچ فعال master است → CI هرگز اجرا نمی‌شد | .github/workflows/ci.yml:10-13 | resolved (v3.0.6) |
| TD-050 | Security | 🎯 ممیزی Forensic BUG-08: JWT در بدنه پاسخ login/setup/me + logout بدون ابطال (tokenVersion) + تغییر رمز شخصی بدون bump نسخه | auth.routes.ts, users.routes.ts | resolved (v3.0.6) |
| TD-051 | Operational Risk | 🎯 ممیزی Forensic BUG-10: سقوط بی‌صدای Production به mockPool حافظه‌ای هنگام DATABASE_URL ناموجود/placeholder | drizzle.ts:110-118 | resolved (v3.0.6) |
| TD-052 | Testing Debt | 🎯 ممیزی Forensic FC-2: regressionSuite در هر دو شاخه passed:true ثبت می‌کرد | regressionSuite.ts:16-38 | resolved (v3.0.6) |
| TD-053 | Numbering | 🎯 ممیزی Forensic BUG-07: کلید شمارنده refNumber دستی با سال میلادی بود ولی شماره‌گذاری خودکار سال جلالی → دو ردیف شمارنده + ریسک شماره تکراری (UNIQUE روی ref_number در فاز ۲) | document.service.ts:440-448 | resolved (v3.0.6) |
| TD-054 | Data Integrity | 🎯 ممیزی Forensic BUG-12: ورود کالا به انبار از مسیر projects.routes بدون applyStockMovement → WAC هرگز محاسبه نمی‌شود و Business Clock نقض می‌شود | projects.routes.ts:710-726 | resolved (v3.0.7) |
| TD-055 | Testing Debt | 🎯 ممیزی Forensic FC-1: ~۱۸ تست tautological در concurrencySuite (t1-t3,t7-t9)، workflowSuite (snapshot/SLA/delegation) و apiSuite — شبیه‌سازی متغیر محلی به‌جای تست کد واقعی؛ mutation-resistant | concurrencySuite.ts:59-79, workflowSuite.ts:82-84,363-397, apiSuite.ts | resolved (v3.0.9) — ۱۰ تست اصلی با پیاده‌سازی واقعی جایگزین شدند و باگ واقعی تفویض را کشف کرد؛ تست‌های باقی‌مانده صادقانه simulation_logic برچسب خورده‌اند (تأیید منطق مجاز، پوشش واقعی در e2e/penetration) |
| TD-056 | Security | 🎯 ممیزی Forensic BUG-14: CSRF-via-GET — مسیرهای state-changing با GET (run-seed، tests/run) قابل trigger از سایت دیگر با کوکی SameSite=None | auth.ts:163, system.routes.ts:99,671 | resolved (v3.0.7) |
| TD-057 | Security | 🎯 ممیزی Forensic BUG-16/17: fallback هاردکد webhook secret + secret ضعیف Math.random در روتر رویدادها + SSRF TOCTOU/redirect-following در dispatch | eventActionEngineService.ts:471, events.routes.ts:751, ssrfGuard.ts, woocommerce.routes.ts:689 | resolved (v3.0.7) — redirect manual + secret masking + test-connection guard؛ IP-pinning کامل در فاز ۳ |
| TD-060 | Financial Integrity | ممیزی Forensic: عدم FOREIGN KEY در کل اسکیما (transactions.item_id، document_items، journal_voucher_items و...) → orphan rows ممکن؛ افزودن FK انتخابی با backfill اعتبارسنجی‌شده | drizzle/0000_v3_baseline.sql | resolved (v3.0.7) — مهاجرت مشروط 0001_integrity_constraints.sql |
| TD-061 | Data Integrity | 🎯 ممیزی Forensic BUG-13/15: reverseVoucher خواندن voucher اصلی خارج از تراکنش فراخواننده؛ deleteDocument revert با کلید location 'default' به‌جای انبار واقعی حرکت اصلی | voucher.service.ts:463, document.service.ts:1283 | resolved (v3.0.7) |
| TD-062 | Business Clock | 🎯 ممیزی Forensic BUG-09: باقیمانده ۲ نقطه new Date().toISOString() برای تاریخ اسناد (پس از رفع مورد itemCatalog در v3.0.6) | projects.routes.ts:720, voucherSync.service.ts:770 | resolved (v3.0.7) |
| TD-063 | False Confidence | 🎯 ممیزی Forensic FC-4/FC-5: ReleaseGate ستون‌های build/security با prose ثابت passed را گزارش می‌کند؛ mockPool fallback در تست‌ها بدون پیام fail-fast | releaseGate.service.ts:76-102, drizzle.ts, testRunner.ts:140-147 | resolved (v3.0.9) — tsc زنده، ستون‌ها مشتق از سوییت واقعی، metrics زنده، fail-fast mock |
| TD-064 | Test Data Safety | 🎯 ممیزی Forensic FC-6: cleanup تستی شامل ILIKE '%تست%'/'%آزمایشی%' روی notes/name واقعی است — ریسک حذف داده واقعی حاوی این واژه‌ها | dbTestHelper.ts:141-159,266 | resolved (v3.0.7) — تنگش‌سازی محافظه‌کارانه؛ بازطراحی کامل marker محور در فاز ۴ |
| TD-065 | Security (Low) | 🎯 ممیزی Forensic F6/F8/F9/F10: SVG upload با سرو عمومی فایل‌های logo؛ /system/health بدون authorize؛ public-settings با runSeed روی خطای DB؛ حداقل طول رمز ضعیف (6/4)؛ test-connection بدون SSRF guard | storage.ts:8,32; system.routes.ts:415; auth.routes.ts:112-119,165; users.routes.ts:23; woocommerce.routes.ts:689 | resolved (v3.0.7) |
| TD-066 | Frontend Stability | 🎯 ممیزی Forensic BUG-11: دسترسی بدون Array.isArray guard به res.data در CustomersPage (62,71)، useCRMData (426-427) و CustomerDossierDrawer (69) → crash صفحه CRM | CustomersPage.tsx, useCRMData.ts, CustomerDossierDrawer.tsx | resolved (v3.0.7) |
| TD-058 | Deployment | 🎯 ممیزی Forensic BUG-18: بدون Dockerfile (مانیفست K8s به تصویر ارجاع می‌دهد) + uploads روی دیسک بدون PVC و خارج از backup → داده تصاویر در هر reschedule pod از بین می‌رود | Dockerfile (غایب), storage.ts:43-52, deploy/k8s | resolved (v3.0.8) — Dockerfile + .dockerignore + CI docker gate + PVC RWX؛ اعتبارسنجی نهایی روی کلاستر واقعی نیازمند محیط production |
| TD-059 | Disaster Recovery | 🎯 ممیزی Forensic FC-3: «تست integrity بازیابی» فقط SELECT از ۴ جدول است؛ restore واقعی از dump هرگز تمرین نشده؛ backup.sh فقط gzip را validate می‌کند و S3 failure فقط WARN است | systemRecovery.service.ts:273-307, scripts/backup.sh | resolved (v3.0.8) — restore.sh با drill موفق روی DB محلی اجرا و ۱۰ جدول حیاتی اعتبارسنجی شد؛ pg_restore --list به backup.sh اضافه شد |
| TD-067 | Testing Debt | 🎯 دو تست لایه regression به‌صورت pre-existing (اثبات‌شده با stash-diff در v3.0.5) fail می‌شدند: (۱) Payroll-Treasury با سخت‌کد bankAccountId=1؛ (۲) ISO Date با سخت‌کد userId=1 نقض FK در DBهای schema-کامل | businessLogicAuditSuite.ts | resolved (v3.0.9) — فیکسچر پویا (حساب موجود/سینتتیک و کاربر واقعی)؛ سوییت کامل Failed: 0 |
| TD-068 | Workflow / Timezone | 🆕 کشف حین فاز ۴: وضعیت تفویض اختیار در getDelegations همیشه expired بود — ستون‌های timestamp WITHOUT timezone با UTC-literal ذخیره و با now() سشن تهران مقایسه می‌شدند (+۳:۳۰ انحراف)؛ مقایسه به SQL با AT TIME ZONE 'utc' منتقل شد | workflowDelegationService.ts (getDelegations) | resolved (v3.0.9) |
| TD-069 | Project Control | پیشرفت پروژه فقط سطح-پروژه بود (میانگین ساده مراحل) درحالی‌که مدل کسب‌وکار «۶۰ SKU × ۱۰۰ عدد» پیشرفت per-SKU می‌طلبد؛ فیکسچر جعلی prod_default عنوان پروژه را به‌جای کد کالا نشان می‌داد | projects.routes.ts:285, useProjectInventory.ts:63-75, ProjectDetailModal.tsx:123-132 | resolved (v3.1.0) — جدول project_product_stage_progress + ماتریس SKU×مرحله + رول‌آپ وزن‌دار + رفع fallback جعلی و باگ ریست تب |
| TD-070 | Project Control (باقی‌مانده عمدی) | لیست خرید ردیف‌های sections پل مستقیم به سند خرید ندارد (فقط ManualPurchaseList)؛ inventory_control jsonb و project_bom_allocations دو منبع حقیقت موازی‌اند؛ اتصال رسمی سند فروش ← پروژه (project_id در documents) در فاز بعدی نرم‌افزاری | InventorySectionsList.tsx, documents.routes.ts:208 | open (بخش بعدی بهبود کنترل پروژه) |
| TD-071 | Data Integrity (Accounting) | 🆕 کشف گراف (Playbook سناریو ۴): `getAccountsTree` هیچ تشخیص چرخه‌ای ندارد — parentId چرخه‌ای (A↔B یا A→A) باعث می‌شود حساب‌ها از `roots` غیرقابل‌دسترس و به‌صورت بی‌صدا از درخت حسابداری UI ناپدید شوند؛ سابقه چرخه FK در migration 0005 زمینه واقعی دارد | src/services/accounting/chartOfAccounts.service.ts:171-190 | resolved (v3.1.42) — سازنده خالص `buildAccountTree` با تشخیص reachability؛ یتیم‌های چرخه‌ای به‌عنوان root قابل‌مشاهده quarantine + logger.warn با کد حساب‌ها؛ self-cycle مستقیماً root می‌شود |
| TD-072 | Frontend Stability (Accounting) | 🆕 کشف گراف (Playbook سناریو ۴): `renderTreeNode` بازگشت بی‌محافظ است (بدون MAX_DEPTH و visited-set؛ depth فقط برای استایل است) — اگر درخت چرخه‌دار به roots برسد، stack-overflow و کرش کامل تب نمودار حساب‌ها | src/components/accounting/ChartOfAccountsTab.tsx:271 | resolved (v3.1.42) — گارد `MAX_TREE_DEPTH=50` + visited-set در هر مسیر رندر؛ هر بازدید تکراری/عمق مازاد null می‌شود (console.warn در buildهای production حذف می‌شود)؛ تأیید ۹ چک سبز با اسکریپت شبیه‌سازی |

---

*آخرین بازبینی: v3.1.42 — رفع TD-071 و TD-072 (سناریو ۴ Playbook گراف): درخت نمودار حساب‌ها اکنون چرخه‌ها را تشخیص می‌دهد، یتیم‌ها را به‌صورت قابل‌مشاهده quarantine و با warn لاگ می‌کند؛ رندر فرانت با MAX_TREE_DEPTH=50 و visited-set ضد stack-overflow محافظت شد (۹ چک شبیه‌سازی سبز + tsc). بدهی عمدی باقی‌مانده: TD-070 (پل خرید و اتصال سند←پروژه). مسئولیت به‌روزرسانی: هر AI Agent / دولوپر قبل از پایان هر زیرفاز.*
