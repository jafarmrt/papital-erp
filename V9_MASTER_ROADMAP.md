# نقشه راه نسخه ۹ پاپیتال ERP — ممیزی پایداری، معماری و کیفیت بسته‌به‌بسته (V9 Master Roadmap)

> **وضعیت سند:** 🚀 **سند فعال و رسمی حاکمیت نسخه ۹**
> **سند پیشین (بایگانی):** `V8_MASTER_ROADMAP.md` (نسخه ۸.۰.۰ تا ۸.۰.۱۲۸؛ گزارش بستن در بخش ۲۰ آن)
> **مبنای کد:** `v8.0.128` (کامیت `ecf6dba`)
> **تاریخ تصویب:** ۱۴ مهر ۱۴۰۵ / ۶ اکتبر ۲۰۲۶ (نسخه ۹.۰.۰) — به تصمیم مالک محصول: سری ۸ بسته شد و همه تغییرات تازه در سری ۹ پیگیری می‌شوند.

---

## ۱. چرا نسخه ۹

- نسخه ۸ صحت منطق کاری را در حوزه‌های A تا L با ناوردایی‌های قابل اجرا و شبیه‌سازی یک سال کاری اثبات کرد. ۱۲۹ ردیف بدهی (TD-250 تا TD-413) ثبت و همه رفع یا با تصمیم مالک محصول بسته شدند.
- آنچه نسخه ۸ نسنجید:
  - **معماری و لایه‌بندی:** نوشتن مستقیم در پایگاه‌داده از routeها (۶۲ مورد در `ecf6dba`)، مرز ماژول‌ها و وابستگی بین سرویس‌ها؛
  - **ماژول‌هایی که در V8 حوزه مستقل نداشتند:** CRM و مشتریان، گزارش روزانه و پیوست‌ها، کالا و قیمت‌گذاری، داشبورد و پوسته، و بخش پرسنل؛
  - **کیفیت و نگه‌داشت‌پذیری:** فایل‌های بزرگ، `any`، منطق تکراری؛
  - **کارایی و تجربه کاربری.**

**هدف نسخه ۹:** تکمیل کار V8، نه تکرار آن. هر بسته از نظر یکپارچگی داده، هم‌زمانی، امنیت، خطا و بازیابی، کارایی، معماری، آزمون و رابط کاربری ممیزی و پایدار می‌شود. **اولویت با پایداری است، نه بازنویسی.**

## ۲. اصول روش

1. **شواهد پیش از حکم.** هر یافته فایل:خط دارد و یکی از دو برچسب را می‌گیرد:
   - **اثبات‌شده:** با تست قرمز، اجرای دستور یا مثال عددی. ردیف `TD-###` می‌گیرد.
   - **مشاهده:** از خواندن کد. ردیف TD نمی‌گیرد و جدا گزارش می‌شود (مثل بخش ۵ `docs/audit/BUSINESS_LOGIC_AUDIT_V8.md`).
2. **ایراد محاسباتی** (مالی یا موجودی) مثال عددی گام‌به‌گام دارد.
3. **تست قرمز پیش از رفع.** هر ادعای رفع یک تست دارد که روی نسخه قبل قرمز و روی نسخه جدید سبز است (`AGENTS.md` §7). تغییر بی تست (refactor یا مستند) هرگز «رفع» نامیده نمی‌شود.
4. **ratchet برای یافته ساختاری.** یافته‌ای که تست رفتاری ندارد، با بررسی‌ای قفل می‌شود که فقط کم شدن را می‌پذیرد:
   - داده ratchetهای تازه در `scripts/ratchets/` و اجرایشان با یک آزمون Vitest در `src/tests/vitest/` (CI آن را در job lint می‌گیرد و workflow تغییر نمی‌کند)؛
   - ratchetهای موجود جابه‌جا نمی‌شوند: `eslint-baseline.json`، `eslint-any-baseline.json`، `src/tests/simulation/knownFindings.ts`، `src/tests/security/routeAccessPolicy.ts`.
5. **سیاست‌ها را خودمان عوض نمی‌کنیم.** هر جا رفتار درست به تصمیم مالک محصول بستگی دارد، گزینه‌ها و پیامدها گزارش می‌شوند و کار منتظر می‌ماند.
6. **یافته بسته** در `TECH_DEBT_ARCHIVE.md` فقط اگر دوباره بازتولید شد گزارش می‌شود. در منطق کاری بسته‌هایی که V8 پوشش داده دوباره ممیزی نمی‌شود؛ نشانه رگرسیون با سوئیت `business_invariants` سنجیده می‌شود.
7. **ابزار موجود اوراکل است:** `FinancialHealthService`، `WarehouseStockReconciliationService`، سوئیت ناوردایی‌ها، `npm run simulate:year`، جدول مجوز routeها (`npm run routes:permissions`) و تمرین ارتقا.

### ۲.۱. شدت یافته‌ها

| شدت | تعریف |
|:---:|---|
| P0 | از دست رفتن یا خرابی داده مالی یا موجودی، یا دور زدن امنیت و دسترسی |
| P1 | نتیجه نادرست در مسیر اصلی، یا ریسک داده با شرایط مشخص و قابل بازتولید |
| P2 | نقص در مسیر فرعی، یا مشکل کارایی و نگه‌داشت‌پذیری با اثر قابل اندازه‌گیری |
| P3 | کیفیت، یکنواختی و رابط کاربری |

### ۲.۲. شناسه، امتیاز و محل خروجی‌ها

- **شناسه موقت یافته در گزارش بررسی:** `B<بسته>-<شماره>`، مثلاً `B09-03` (B = بسته؛ با برچسب شدت P0 تا P3 اشتباه نمی‌شود). یافته اثبات‌شده در «نسخه مستند» شناسه `TD-###` می‌گیرد.
- **امتیاز مکانیکی بسته:** max(۱، ۱۰ − ۴×P0 − ۲×P1 − ۱×P2 − ۰٫۵×P3)، فقط از یافته‌های اثبات‌شده.
- **خروجی‌های بیرون از مخزن** (نقشه مخزن، گزارش‌های بررسی، `PACKAGE_MAP`): پوشه مشترک پروژه `v9/`. **درون مخزن:** `docs/audit/STABILITY_AUDIT_V9.md` (یک بخش برای هر بسته)، `TECH_DEBT.md` و این سند.

## ۳. فازها، وضعیت و هدف خروج

| ترتیب | فاز | هدف خروج | وضعیت |
|---|---|---|---|
| ۰ | گذار سری: بستن سری ۸ با گزارش، انجماد `8.ts`، فعال کردن `9.ts`، این سند، حاکمیت در `AGENTS.md` و ابزار عمومی انتشار | `check:version` سبز؛ `npm test` و Vitest صددرصد قبول؛ build سبز؛ صفر ردیف باز سری ۸ | ✅ v9.0.0 |
| ۱ | خط مبنا و نقشه مخزن (بررسی): REPO_MAP از `git ls-files`، `PACKAGE_MAP` نهایی، اجرای همه گیت‌ها، سنجش شاخص‌های بخش ۴ | همه گیت‌ها اجرا و ثبت شده باشند (Docker «فقط CI»)؛ فایل تولیدی «بدون بسته» **۰**؛ هر شاخص بخش ۴ عدد مبنا داشته باشد | ✅ مبنا `5a56c4c` (v9.0.1)؛ بخش ۹ |
| ۲ | بازبینی معماری (بررسی): ۱۰ قاعده `ARCHITECTURE_RULES.md`، لایه‌بندی route ← service ← db، مرز ماژول‌ها، عملیات چنددامنه‌ای و outbox، فرانت و مشاهده‌پذیری | هر ۱۰ قاعده با فهرست فایل‌های ناقض؛ ۳ تا ۵ تصمیم معماری با گزینه و پیامد؛ ترتیب پیشنهادی بسته‌ها | ✅ گزارش معماری فاز ۲؛ A02-01 در v9.0.2 رفع شد |
| ۳ | بازبینی بسته‌ها (یک thread بررسی برای هر بسته؛ ابعاد بخش ۵) | ۱۶ از ۱۶ بسته بازبینی شده و هر کدام امتیاز مکانیکی دارد | 🔄 بسته‌های ۹، ۱۳، ۵ و ۱۶ و بخش پرسنل ۱۲ |
| ۴ | ثبت و رفع (یک thread تغییر برای هر بسته، فقط موارد تأییدشده): نسخه مستند و سپس هر TD در نسخه `v9.0.x` خودش | **۰** ردیف باز P0 و P1 در پایان فاز؛ هر ratchet تازه فقط کاهش را بپذیرد | 🔄 بسته ۹ (v9.0.3 تا v9.0.21)، بخش پرسنل ۱۲ (v9.0.22 تا v9.0.31)، بسته ۱۴ از v9.0.32، بسته ۶ از v9.0.54، بسته ۴ از v9.0.66، بسته ۲ از v9.0.72، بسته ۳ از v9.0.113، بسته ۱ از v9.0.120، بسته ۵ از v9.0.151، بسته ۱۳ از v9.0.248، بسته ۸ از v9.0.237، بسته ۱۶ از v9.0.243 و بسته ۱۰ از v9.0.265 |
| ۵ | بازبینی نهایی و بستن سری ۹: جریان‌های سرتاسری فروش، خرید، تولید پروژه و حقوق تا سند حسابداری | اهداف پایان سری در بخش ۴ | ⏳ |

ترتیب پیش‌فرض فاز ۳: اول بسته‌هایی که در V8 حوزه مستقل نداشتند (۹، ۱۳، ۵، ۱۶ و بخش پرسنل از ۱۲)، سپس بقیه به ترتیبی که فاز ۲ پیشنهاد می‌دهد.

## ۴. شاخص‌های سری ۹

> **مبنای فاز ۱ (۱۴ مهر ۱۴۰۵):** مقدارها روی `5a56c4c` (v9.0.1) اندازه‌گیری شد و مالک محصول هدف‌ها را با سه اصلاح تأیید کرد: `any` فقط کد تولیدی، پوشش هر بسته مالی جداگانه، و شاخص نوشتن از route فقط `insert` / `update` / `delete`.

| شاخص | تعریف | مبنا در `5a56c4c` | هدف پایان سری |
|---|---|---|---|
| نوشتن مستقیم DB از route | شمار `insert` / `update` / `delete` روی جدول Drizzle در `src/routes/**` (`execute(` و `select` جدا و بی هدف؛ مبنا ۷ و ۱۳۸) | ۶۲ (بسته‌های مالی ۱۱) | **۰** در بسته‌های مالی (۳، ۴، ۶، ۸، ۱۲) و **≤ ۲۰** در کل |
| `max-lines` | تخلف در خط پایه ESLint (`eslint-baseline.json`)؛ شمار فایل‌های بالای ۷۰۰ خط فقط برای اطلاع، طبق تصمیم P3-1 («خرد کردن بر پایه معماری نه اندازه») | ۱۴۲ | **≤ ۱۲۰** |
| `any` | جمع `eslint-any-baseline.json` در کد تولیدی، بی فایل‌های آزمون (در `MONEY_STOCK_PATHS` صفر می‌ماند، TD-106) | ۸۱۶ (با آزمون‌ها ۱۲۵۳ در ۲۱۲ فایل) | **≤ ۶۵۰** |
| پوشش خطوط سرور هر بسته | `npm run test:coverage` (c8) نگاشته به بسته‌ها با `PACKAGE_MAP`؛ پوشش فرانت فقط اگر فاز ۳ لازم بداند (وابستگی تازه با اجازه مالک) | ۷۶٫۶۱٪ کل؛ مالی روی هم ۸۲٫۵٪ و بسته ۱۲ ۷۱٫۴٪ | **≥ ۸۰٪** هر بسته مالی و **≥ ۶۰٪** بقیه |
| FK بی قید | `.references(` اسکیمای Drizzle در برابر `pg_constraint` پایگاه‌داده تازه پس از همه مهاجرت‌ها | ۷۳ (۱۰۳ FK در برابر ۳۰ قید منطبق) | **۱۰۰٪** تعیین‌تکلیف‌شده (قید، یا استثنای مستند)؛ TD-060 عمداً «FK انتخابی» بوده و FK تازه فقط با یافته orphan اثبات‌شده و تصمیم مالک افزوده می‌شود |
| ناوردایی‌ها | سوئیت `business_invariants` و `knownFindings.ts` | ۰ نقض، ۰ کلاس باز | **۰** |

## ۵. ابعاد بررسی هر بسته

1. **منطق کسب‌وکار** (فقط در بسته‌هایی که V8 پوشش نداده): دوبل و تراز اسناد، دوره مالی، میانگین موزون، کاردکس، ارزش افزوده، حقوق و کسورات
2. **یکپارچگی داده:** تراکنش اتمیک در عملیات چندجدولی، قید FK واقعی، رفتار حذف، برگشت و ویرایش
3. **هم‌زمانی:** race condition، قفل ردیف و OCC، idempotency
4. **امنیت:** RBAC هر route، IDOR، CSRF، اعتبارسنجی Zod، آپلود فایل، نشت اطلاعات در خطا و لاگ
5. **خطا و بازیابی:** خطاهای بلعیده‌شده، توابع «خودترمیم» که باگ مسیر نوشتن را پنهان می‌کنند
6. **کارایی:** N+1، ایندکس، صفحه‌بندی، کوئری‌های سنگین
7. **معماری و کیفیت کد:** انطباق با `ARCHITECTURE_RULES.md`، لایه سرویس، منطق تکراری، فایل‌های بزرگ، `any`
8. **تست:** مسیرهای بحرانی بی تست
9. **رابط کاربری:** RTL، تاریخ شمسی، ارقام فارسی، پیام خطای قابل فهم، حالت خالی و بارگذاری، اصطلاحات طبیعی فارسی

## ۶. بسته‌ها (موقت)

> **موقت:** نگاشت نهایی فایل به بسته در فاز ۱ از فایل قاعده glob مرتب `PACKAGE_MAP` (اولین قاعده منطبق برنده؛ «اول دامنه، بعد پوسته») ساخته می‌شود. REPO_MAP، پوشش هر بسته و ratchetها همه از همان فایل می‌خوانند. `src/tests` و `e2e` بخش جدای «زیرساخت آزمون» و اسناد ریشه بخش «حاکمیت» دارند.

| # | بسته | دامنه اصلی (موقت) | حوزه V8 |
|---|---|---|---|
| ۱ | زیرساخت داده | `src/db`، `drizzle/`، `system.routes`، `services/system`، bootstrap (`server.ts`، `src/app.ts`)، `SetupPage`، `install.sh`، `update.sh`، `scripts/`، استقرار (`Dockerfile`، `deploy/`)، لاگ و متریک | K |
| ۲ | احراز هویت و دسترسی | auth و users routes، `middleware/*` (به‌جز idempotency)، `services/auth`، `AuthContext`، LoginPage، UsersPage، ActivityLogsPage | H |
| ۳ | حسابداری | `accounting.routes` و `routes/accounting/*` (به‌جز treasury)، `services/accounting` (به‌جز treasury و پرداخت حقوق)، AccountingPage، `components/accounting`، `standardChartOfAccounts` | B |
| ۴ | خزانه و چک | `accounting/treasury.routes.ts`، `services/accounting/treasury/*`، `treasury.service.ts`، `ChequesTab`، `BankAndTreasuryTab`، `components/accounting/reconciliation` | C |
| ۵ | کالا و قیمت‌گذاری | `items.*.routes`، `categories.routes`، `services/items/*` (به‌جز رزرو)، ItemsPage، PricingPage، `components/items`، pricing، excel | بخشی در L |
| ۶ | انبار و کاردکس | inventory، transactions، warehouses و transfers routes، `services/inventory` (به‌جز تخصیص BOM)، `stockReconciliation` و `warehouseStockReconciliation` و `systemReconciliation`، `transfer.service`، `warehouse.service`، صفحات InventoryStatus، Transactions، Transfers، InventoryAudit | A |
| ۷ | برنامه‌ریزی موجودی | ReorderAlertsPage، ReservedItemsReportPage، PendingMaterialsPage، `itemStockReservation.service`، `components/reorder` | بخشی در E |
| ۸ | فروش و اسناد | documents و drafts routes، `services/documents`، `document.service.ts`، CreateInvoicePage، InvoicesListPage، DocumentsPage، `components/invoices`، documents، print | A و L |
| ۹ | مشتریان و CRM | crm و customers routes، `customer.service`، CRMPage، CustomersPage، `components/crm` و customers | ندارد |
| ۱۰ | خرید و تدارکات | `procurement.routes`، `procurement.service.ts` و `services/procurement`، ProcurementPage، `components/procurement` | E |
| ۱۱ | کنترل پروژه و تولید (BOM) | `projects.routes`، `projects.service.ts` و `services/projects`، `projectBomAllocation.service`، ProjectsPage، ProjectInventoryPage، `components/project` و project-modal | E |
| ۱۲ | پرسنل و حقوق کارمزدی | personnel و piecework routes، `piecework.service.ts` و `services/piecework`، `payrollPayment*.service`، `components/piecework` و personnel، PersonnelPage، PieceworkPayrollPage، MyPayslipsPage | D (پرسنل ندارد) |
| ۱۳ | گزارش روزانه و پیوست‌ها | dailyLogs و attachments routes، `services/attachments`، DailyLogsPage، GalleryPage | ندارد |
| ۱۴ | گردش کار و تأییدات | `workflow.routes`، `services/workflow`، `ruleEngine.service`، ApprovalInboxPage، WorkflowManagementPage، `components/workflow` و approval | G |
| ۱۵ | رویدادها و یکپارچگی‌ها | events، woocommerce و notifications routes، `services/events` و woocommerce، `middleware/idempotency`، DomainEventsPage، NotificationBell | F و J |
| ۱۶ | داشبورد، تنظیمات و پوسته فرانت | `dashboard.routes`، Dashboard، SettingsPage، `components/layout` و common، `hooks/` و `lib/` غیر دامنه‌ای، `src/api.ts`، drafts و settings services؛ تاریخ و ساعت (حوزه I، میان‌بخشی) | بخشی در L و I |

## ۷. قواعد ثبت و انتشار در سری ۹

- هر تغییر یک مدخل کوتاه در `src/data/changelogs/9.ts` و چهار محل نسخه همگام دارد (`AGENTS.md` §7 و §23). `7.ts` و `8.ts` منجمدند و گیت `npm run check:version` (`src/data/changelogs/seriesGuard.ts`) هر تغییر در آن‌ها را رد می‌کند.
- هر یافته اثبات‌شده یک ردیف `TD-###` در `TECH_DEBT.md` دارد. شناسه تازه از بزرگ‌ترین شناسه در هر دو فایل + ۱ است؛ **نخستین شناسه سری ۹، TD-414 است** (در v9.0.1 برای هشدارهای امنیتی ابزار آزمون vitest به کار رفت). ردیف بسته در بخش «نسخه ۹» `TECH_DEBT_ARCHIVE.md` می‌نشیند.
- ابزار: `npm run release -- <spec.json>` (`scripts/release.ts`، سری را از `ACTIVE_CHANGELOG` می‌خواند؛ `closes[]` چند ردیف را در یک نسخه می‌بندد و `openRows[]` ردیف باز نسخه مستند را می‌افزاید)، سپس `npm run check:version`.
- **فاز ۴:** اول یک «نسخه مستند» (بخش آن بسته در `docs/audit/STABILITY_AUDIT_V9.md` و ردیف TD برای همه یافته‌های اثبات‌شده)، سپس هر TD انتخاب‌شده در نسخه `v9.0.x` خودش. **حداکثر حدود ۵ TD در هر PR**؛ بقیه در PR بعدی همان بسته.
- **`AGENTS.md`** در فاز ۴ فقط برای ثبت قاعده همان TD ویرایش می‌شود.
- **Git:** فقط شاخه جدا `v9/<فاز یا بسته>-<موضوع>` و PR پیش‌نویس؛ هرگز push مستقیم به master؛ merge با مالک محصول (`AGENTS.md` §24).
- آزمون محلی با `source scripts/ci-test-env.sh && npm test`. در جلسه‌های Claude Code روی وب، هوک شروع جلسه وابستگی‌ها و PostgreSQL 16 را آماده می‌کند.

## ۸. «V9 قدیم» در کد و CHANGELOG.md

برچسب «V9» پیش از این سند هم در مخزن بوده است و به این سری ربطی ندارد:
- ۸۴ کامنت در ۵۴ فایل مانند `V9 Phase 5.2` و `V9-1.3` (مثلاً `voucherSync.service.ts`، `NewVoucherModal.tsx`)؛
- سرخط `v9.0.0 — Stability & Production-Ready` در بخش «Pre-1.0 history summary» فایل `CHANGELOG.md`.

هر دو از دوره پیش از بازنشانی شماره نسخه‌ها مانده‌اند و دست نمی‌خورند. کامنت تازه فقط به شکل `v9.0.x (TD-###)` نوشته می‌شود، نه «V9 Phase».

## ۹. خط مبنا

commit مبنا `5a56c4c` (v9.0.1، ۱۴ مهر ۱۴۰۵). هر ۱۲ گیت سبز بود و Docker فقط در CI اجرا می‌شود. `npm test` ۳۷۹ از ۳۷۹، Vitest ۲۵۴ از ۲۵۴، پوشش خطوط سرور ۷۶٫۶۱٪، شبیه‌سازی سال کاری ۰ نقض در ۳ بذر، E2E ۱ از ۱. همه ۹۵۴ فایل در `PACKAGE_MAP` بسته دارند و ۱۳ اصلاح نگاشت موقت بخش ۶ پذیرفته شد. مقدار شاخص‌ها در بخش ۴ است؛ گزارش کامل و نقشه مخزن بیرون از مخزن، در پوشه مشترک پروژه (`v9/BASELINE.md`، `v9/REPO_MAP.md`).
