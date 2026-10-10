# Changelog — Papital Workshop ERP

All notable development history is preserved in **Git history** (`git log`). This file
provides a concise, human-readable archive of the pre-1.0 era and the release policy
going forward.

## Release policy (V10 onward)

| Channel | File | Version series |
|---|---|---|
| Client-bundled update center | `src/data/changelogs/0.ts` | baseline `v1.0.0` entry |
| Client-bundled update center (archive) | `src/data/changelogs/archive_1_6.ts` | condensed `1.x.y` – `6.x.y` series (`v1.x` - `v6.0.28`), replaced `1.ts` … `6.ts` in v7.0.11 |
| Client-bundled update center (archive) | `src/data/changelogs/7.ts` | closed `7.x.y` series (`v7.0.0` – `v7.0.140`), frozen in v8.0.0 (fingerprint checked by `npm run check:version`) |
| Client-bundled update center (archive) | `src/data/changelogs/8.ts` | closed `8.x.y` series (`v8.0.0` – `v8.0.128`), frozen in v9.0.0 (fingerprint checked by `npm run check:version`) |
| Client-bundled update center (archive) | `src/data/changelogs/9.ts` | closed `9.x.y` series (`v9.0.0` – `v9.0.461`), frozen in v10.0.0 (fingerprint checked by `npm run check:version`) |
| Client-bundled update center (active) | `src/data/changelogs/10.ts` | current `10.x.y` release series (`v10.0.0` onward); short entries, important points only (v7.0.54) |
| Root archive (this file) | `CHANGELOG.md` | summary of the pre-reset history & milestones |

---

## Version 10.x Series (Active — see `src/data/changelogs/10.ts`)

### v10.0.51 — واژه‌های «سیستم»، «کاتالوگ»، «فیلتر» و «دوبل» دیگر به صفحه‌ها اضافه نمی‌شوند
- شمارنده واژه‌گزینی رابط هر افزایش این واژه‌ها را رد می‌کند و پنج صفحه راهنما اصلاح شد (TD-1168).

### v10.0.50 — خواندن سند فقط با شناسه
- v10.0.50 — `GET /documents/:id` فقط شناسه عددی مثبت را می‌خواند؛ شناسه سند باطل‌شده ۴۰۴ است حتی اگر سند دیگری همان شماره را داشته باشد و شماره عطف ۴۰۰ است و از `by-ref` با نوع و سال خوانده می‌شود (OBS-R1-93).

### v10.0.49 — ساخت، ویرایش و حذف نقش با ردیف رویدادنگارش یکجا ثبت می‌شود
- نقش و ردیف رویدادنگار آن در یک تراکنش نوشته می‌شوند و نقشی بی سابقه ساخته، ویرایش یا حذف نمی‌شود (بخشی از TD-960).

### v10.0.48 — دکمه‌های تأیید درخواست خرید با مجوز تأیید (TD-1126)
- تأیید، رد و لغو درخواست خرید در صفحه و در صدور سفارش فقط با `procurement.approve`؛ بازگشایی با `procurement.create` هم.

### v10.0.47 — ثبت یافته‌های راهنمای نقش‌ها برای اسناد و انبار
- v10.0.47 — ده ردیف بدهی تازه (TD-1130..1139) برای یافته‌های راهنمای نقش‌ها در اسناد، انبار، تدارکات و فروش؛ تغییر کد ندارد.

### v10.0.46 — راه‌اندازی اولیه همه یا هیچ ذخیره می‌شود
- راه‌اندازی اولیه مدیر سامانه، انبار پیش‌فرض و تنظیمات شرکت را در یک تراکنش می‌نویسد و شکست آن مدیر نیمه‌کاره بر جا نمی‌گذارد (بخشی از TD-960).

### v10.0.45 — آغاز گردش کار درخواست خرید در ثبت آن
- v10.0.45 — درخواست خریدی که گردش کارش آغاز نمی‌شود ثبت نمی‌شود، نه بی گردش کار (TD-940).

### v10.0.44 — طرف حساب هم‌نوع سند خرید و فروش
- v10.0.44 — رسید و خرید فقط تأمین‌کننده و سند فروش فقط مشتری (یا «هر دو») می‌گیرد و فهرست انتخاب همان را نشان می‌دهد (TD-939).

### v10.0.43 — هشدار رویدادی نقطه سفارش با موجودی آزاد
- v10.0.43 — هشدار نقطه سفارش پس از خروج کالا موجودی آزاد (منهای رزروها) را می‌سنجد، همان صفحه هشدار (TD-937).

### v10.0.42 — بهای کاردکس در رویداد گردش انبار
- v10.0.42 — بهای واحد رویدادهای ورود و خروج انبار بهای کاردکس همان ردیف است، نه قیمت فروش (TD-930).

### v10.0.41 — ممیزی قطعی‌شدن سند از گردش کار و فاکتور ووکامرس
- v10.0.41 — سندی که گردش کار قطعی می‌کند و فاکتور ووکامرس ردیف ممیزی سند پیش و پس را در همان تراکنش می‌گیرند (TD-929).

### v10.0.40 — سنجش رزرو در شبیه‌ساز هم‌زمان
- v10.0.40 — شبیه‌ساز هم‌زمان I19 را فقط برای اضافه رزروی گزارش می‌کند که همان دور ساخته است (TD-1146).

### v10.0.39 — ثبت ناپایداری شبیه‌ساز هم‌زمان
- v10.0.39 — ردیف بدهی تازه برای سنجش I19 در شبیه‌ساز هم‌زمان (TD-1146)؛ بی تغییر رفتار.

### v10.0.38 — تصویرهای CI از آینه عمومی گرفته می‌شوند
- CI و Dockerfile تصویر PostgreSQL و Node را از آینه ECR می‌گیرند، نه Docker Hub (TD-1169).

### v10.0.37 — v10.0.37 — مجوز اقدام‌های گردش کار درخواست خرید
- هر اقدام گردش کار پیش‌فرض درخواست خرید مجوز می‌خواهد و ثبت‌کننده درخواست آن را تأیید نمی‌کند (OBS-R2-36).

### v10.0.36 — آزمون هم‌زمانی: میان مسیرها و ۲۰ کاربر در شبیه‌ساز
- آزمون هم‌زمانی میان مسیرها و شبیه‌ساز سال کاری با ۱۰ تا ۲۰ کاربر هم‌زمان (I-03).

### v10.0.35 — اعتبارسنجی ورودی همه routeهای نویسنده
- v10.0.35 — routeهای رویدادها، وب‌هوک، ورود گروهی طرف حساب، پرسنل و عنوان کار، کد کالا و کارتابل بدنه را با Zod می‌خوانند؛ ورود گروهی سقف ۵٬۰۰۰ ردیف دارد و آزمونی route نویسنده بی اسکیما را رد می‌کند (TD-979).

### v10.0.34 — اشاره در اقدام ارتباط با مشتری فقط به کاربر درست
- اشاره در اقدام ارتباط با مشتری فقط کاربر موجود را می‌پذیرد، نام را با «شامل» تطبیق نمی‌دهد و اعلان را فقط به کسی می‌دهد که اقدام را می‌بیند (TD-976).

### v10.0.33 — ویرایش جزئی طرف حساب بقیه فیلدها را نگه می‌دارد
- ویرایش طرف حساب فقط فیلدهای فرستاده‌شده را تغییر می‌دهد و نشانی، یادداشت، نوع، اطلاعات بانکی و افراد رابط را خالی نمی‌کند (TD-975).

### v10.0.32 — صفر اول تلفن و شماره کارت در ورود اکسل طرف حساب
- ورود اکسل طرف حساب صفر اول تلفن عددی را برمی‌گرداند و شماره کارتی را که اکسل بریده خطای ردیف می‌کند (TD-974).

### v10.0.31 — اقدام بی‌پرونده طرف حسابش را نگه می‌دارد
- اقدامی که از پرونده مشتری و بی پرونده فروش ثبت می‌شود به همان مشتری وصل می‌ماند (TD-973).

### v10.0.30 — رویداد تخصیص مواد روی پروژه خودش
- رویداد تخصیص مواد روی پروژه خودش ثبت می‌شود (TD-944).

### v10.0.29 — رسید تولید پروژه رویداد خرید منتشر نمی‌کند
- رسید تولید پروژه رویداد خرید با تأمین‌کننده خالی منتشر نمی‌کند (TD-942).

### v10.0.28 — بهای ورود محصول پروژه به انبار از میانگین روز
- ورود محصول پروژه به انبار بی بهای واردشده با میانگین موزون روز ثبت می‌شود (TD-977).

### v10.0.27 — v10.0.27 — تأیید سند حسابداری با مجوز جدا
- تأیید و قطعی کردن سند حسابداری مجوز جدای «تأیید و قطعی کردن سند حسابداری» می‌خواهد و ثبت‌کننده سند دستی آن را تأیید نمی‌کند (TD-965).

### v10.0.26 — ratchet تصمیم‌های معماری فاز ۲
- `npm run ratchet:architecture` نوشتن از route، جایگزینی تراکنش با `orm`، پاسخ خطای دست‌ساز، `throw new Error` در سرویس و import خلاف جهت بسته‌ها را فایل‌به‌فایل می‌شمارد و فقط کاهش را می‌پذیرد (ت۲ تا ت۵).

### v10.0.25 — صفحه کتابخانه تصاویر محصولات
- صفحه کتابخانه با جست‌وجو بر پایه کالکشن، سال طراحی و کد ترنسفر، صفحه هر محصول با گالری و کارت محصول، و دریافت چند فایل در یک فایل فشرده (N-05، بخش دوم).

### v10.0.24 — بررسی نسخه اسکریپت npm افتاده در ادغام را می‌گیرد
- `check:version` هر `npm run` نام‌برده در AGENTS.md، مستندها، CI و اسکریپت‌های پوسته را در package.json می‌جوید (OT-A-03، TD-983).

### v10.0.23 — شماره‌گذاری ادغام نسخه نام آزمون‌ها را هم جابه‌جا می‌کند
- `release:renumber` نسخه شاخه را در نام آزمون، رشته، توضیح پایان خط و JSX و با رقم فارسی هم جابه‌جا می‌کند (OT-A-01، TD-999).

### v10.0.22 — شماره‌گذاری ادغام ردیف بایگانی‌شده را برنمی‌گرداند
- `release:renumber` ردیف بایگانی‌شده بدهی را به جدول فعال برنمی‌گرداند و `check:version` شناسه هم فعال و هم بایگانی را رد می‌کند (TD-981).

### v10.0.21 — زیرساخت کتابخانه تصاویر و فیلم‌ها
- بارگذاری تصویر و فیلم تا ۵۰ مگابایت با نسخه اصلی و نسخه سبک، هشدار حجم بالا و کیفیت پایین، و سه مجوز تازه کتابخانه (N-05، بخش اول).

### v10.0.20 — ثبت کارکرد کارمزدی روی گوشی
- پنجره ثبت کارکرد روی گوشی تمام‌صفحه است و بی اتصال ذخیره نمی‌کند (D-11).

### v10.0.19 — شمارش انبار روی گوشی
- برگه شمارش روی گوشی کارت به کارت است، رقم فارسی را می‌پذیرد و شمار نادرست را صفر نمی‌شمرد (D-11).

### v10.0.18 — کارتابل تأییدها روی گوشی
- پنجره بررسی کار روی گوشی تمام‌صفحه است و تصمیم بی اتصال فرستاده نمی‌شود (D-11).

### v10.0.17 — نوار پایین گوشی
- روی گوشی نوار پایین جای فهرست کناری را می‌گیرد و فهرست کامل روی صفحه باز می‌شود (D-11).

### v10.0.16 — برنامه نصب‌پذیر روی گوشی
- برنامه با vite-plugin-pwa روی گوشی نصب می‌شود؛ service worker فقط پوسته را نگه می‌دارد و هیچ پاسخ API را (D-11).

### v10.0.15 — هشدار پایش سرور به دو ربات
- پایش سرور هشدار را به ربات دوم هم می‌فرستد (مثلاً بله و تلگرام با هم) (TD-1001).

### v10.0.14 — v10.0.14 — خروجی انگلیسی تمرین ارتقا در ترمینال
- تمرین ارتقا بررسی سلامت را با شناسه انگلیسی نام می‌برد و به‌جای متن SQL علت خطا را چاپ می‌کند؛ اسکریپت‌های نگهداری سرور هم فارسی داده را در ترمینال چاپ نمی‌کنند (TD-1000).

### v10.0.13 — موجودی بی‌بها در ورود اکسل کالا
- ورود اکسل کالا به کالایی که میانگین موزون بها ندارد موجودی نمی‌دهد و ردیف را خطا می‌کند (TD-1012).

### v10.0.12 — Foreign sale and purchase vouchers balance in rials, so their year closes (TD-1030)
- Cost rows of a foreign-currency voucher take the 4-decimal rate that reaches their rial value exactly and the opposite row their sum, so the voucher balances in rials and the fiscal-year closing no longer refuses it by one rial.

### v10.0.11 — Simulator runs treasury, cheques, payroll, purchasing, allocation, approval and year closing (TD-982, I-01)
- The business-year simulator gains eleven operations through the application services and a `--close-year` option; TD-982 is resolved and the first year closing of a simulated year found TD-1030 (a foreign sale voucher off by one rial).

### v10.0.10 — Business invariants I7, I8, I9, I11, I12 and I17–I20 (TD-982, I-01)
- Nine new read-only business invariants (project reservation, party receivable, cheque transitions, closed fiscal year, unique numbers, rial balance, posting accounts, reservation within stock, VAT payable) with checks that break a row and expect it reported; TD-982 stays open for the simulator operations.

### v10.0.9 — End-to-End Tests for Four Business Flows
- **I-02:** Playwright tests drive purchase, project production and delivery, payslip and payment, and treasury and cheque from the browser down to stock, Kardex and voucher rows.

### v10.0.8 — Confirmation Dialog Above the Payslip Payment Window
- **TD-1040:** the confirmation opened under the payslip payment window, so no payslip could be paid from the UI; it now opens above every window.

### v10.0.7 — Stock vs Ledger Health Check Leaves Work in Progress Out
- **TD-964:** the financial health check compares the warehouse value with account 14 without the work in progress account (1402), shows the work in progress balance apart and reports the share of draft vouchers.

### v10.0.6 — هشدار خودکار از کار افتادن برنامه، دیسک، پشتیبان و صف رویدادها
- `scripts/monitor.sh` هر پنج دقیقه سلامت، دیسک، سن پشتیبان و صف رویدادها را می‌سنجد و با ربات بله یا تلگرام یا ایمیل هشدار می‌دهد (TD-1021).

### v10.0.5 — سنجه‌های صف رویداد و تحویل در /metrics
- `/metrics` صف خطای حل‌نشده، رویدادهای ناموفق و گیرکرده و تحویل‌های یکپارچه‌سازی را می‌دهد و خطای خواندن را پنهان نمی‌کند (OBS-R2-11).

### v10.0.4 — رونوشت رمزگذاری‌شده پشتیبان در گوگل‌درایو
- پشتیبان روزانه و `.env` با `ERP_SECRETS_KEY` با rclone crypt به گوگل‌درایو می‌روند؛ شکست رونوشت کد ۳ (TD-957).

### v10.0.3 — زمان‌بندی خودکار پشتیبان روزانه و پایش در نصب
- `install.sh` با `scripts/install-ops-cron.sh` پشتیبان روزانه و پایش پنج‌دقیقه‌ای را در cron می‌گذارد (TD-1020).

### v10.0.2 — عدد متنی در ورود اکسل کالا
- ورود اکسل کالا بها و موجودی نوشته‌شده با ارقام فارسی یا جداکننده هزارگان را می‌خواند و متنی را که عدد نیست خطای ردیف می‌کند (TD-1011).

### v10.0.1 — ستون نوع در ورود اکسل کالا
- ورود اکسل کالا «مواد اولیه» و «محصول» را می‌خواند و نوع ناشناخته را خطای ردیف می‌کند؛ پیش‌نمایش نوع را مثل سرور تعیین می‌کند (TD-1010).

### v10.0.0 — Closure of Version 9 & Launch of Version 10
- **Version 9 Closure:** Concluded and archived the v9.x series (`v9.0.0` through `v9.0.461`). `V9_MASTER_ROADMAP.md` is archived with a closing report (section 10: phase 5 review of the sales, purchase, project production and payroll flows); `src/data/changelogs/9.ts` is frozen.
- **Phase 5 Findings and Observations:** `docs/audit/STABILITY_AUDIT_V9.md` section 18 records the 53 phase 5 findings; TD-904 – TD-956 hold one row each, the 41 not fixed by other changes stay open, and the series 9 observations are kept in the new ledger `docs/audit/V9_OBSERVATIONS.md` with 43 open rows TD-957 – TD-999 (`AGENTS.md` §23 exception).
- **Version 10 Mission:** `V10_MASTER_ROADMAP.md` — fix the open debt and observations of series 9 and the 27 improvement and development items the product owner chose (roadmap section 3.3; no electronic tax invoicing); new debt rows start at TD-1000.
- **Governance:** `npm run check:version` now also rejects any change to the closed 9.x series; release paperwork and `npm run release:renumber` follow the active series 10.

---

## Version 9.x Series (Archived at v9.0.461)

### v9.0.461 — Payroll Payments Follow the Treasury Date Rule
- **Fix (TD-927, P5-W04):** a payroll payment dated after the business today is refused with 422 `TREASURY_DATE_IN_FUTURE` and nothing is written, like every other treasury write; the payment form sends an ISO date from the Jalali picker.

### v9.0.460 — Treasury Rows Link Only to Documents of Their Currency
- **Fix (TD-908, P5-P08 / P5-S-06):** a new receipt or payment is linked only to a document in its own currency (422 `TREASURY_DOCUMENT_CURRENCY_MISMATCH`, nothing written), the same rule the relink already had; a rial row no longer settles a foreign-currency document.

### v9.0.459 — Settlement Receipts and Payments Carry the Document's Party
- **Fix (TD-907, P5-S-01 / P5-P06):** a receipt or payment recorded against a document without a party id takes the document's party id and current name, so the party's account card and delete guard still see it after a rename; the invoice settlement form sends the party id too.

### v9.0.458 — Procurement Finalizes Write the Document Audit Row
- **Fix (TD-917, P5-P10):** order delivery and receive items write, in their transaction, one finalize audit row per order with the document id and the stored document before and after, like PUT /documents/:id/finalize, so the document timeline shows them.

### v9.0.457 — Receive Items Does Not Close a Requisition With Open Rows
- **Fix (TD-911, P5-P02):** receive items, like delivery, marks a requisition received only when every row is received or closed; otherwise it is 409 REQUISITION_ROWS_NOT_SETTLED naming the rows and the whole transition rolls back.

### v9.0.456 — Workflow Approval Reads the Signer's Backdate Permission
- **Fix (TD-928, P5-S-04):** a workflow transition that finalizes a document or receives goods takes warehouse.backdate from the signer's role (the delegator's for a deputy, always for the system admin), like PUT /documents/:id/finalize; it was never passed and a permitted backdated approval got 422.

### v9.0.455 — Purchase Goods Enter Stock Only With warehouse.in
- **Fix (TD-904, P5-P01):** a requisition transition into the received step (workflow route, inbox task, receive items) and order delivery ask the receipt's stock-in permission `warehouse.in`; workflow-only or procurement-only users get 403 and nothing moves, and the procurement page hides the buttons.

### v9.0.454 — Warehouse Keys for Project Stock Paths
- **Fix (TD-923, P5-M08):** allocating material to a project asks `warehouse.out`, and releasing an allocation or delivering a project to stock asks `warehouse.in` as well, like the stock documents; `projects.edit` alone no longer moves stock.

### v9.0.453 — No Zero-Cost Entry for an Item Without Cost
- **Fix (TD-906, TD-916, P5-M04 / P5-P09):** a final receipt, its finalize, a procurement delivery and a project delivery refuse a zero-cost line of an item that has no weighted average cost yet (422), so such an item never enters stock unsellable.

### v9.0.452 — Material Allocation Deducts the Project Reservation
- **Fix (TD-918, P5-M01):** allocating material to a project deducts the project's reservation like its remittance, and releasing the allocation restores exactly what was deducted (migration 0095).

### v9.0.451 — Material Allocation Passes the Sellable Gate
- **Fix (TD-905, P5-M02):** allocating material to a project checks sellable stock like a remittance, so it no longer takes the stock another project or a sales proforma has reserved.

### v9.0.450 — Terminal Output Is English
- **Fix (TD-625, B01-45):** scripts, the session hook, test names, test runner labels and failure messages print English; server error logs show the status, code and route, and the user's Persian message stays in the response and the JSON log file.

### v9.0.449 — Every Foreign Key Column Has an Index
- **Fix (TD-614, B01-34):** the 41 foreign key columns without an index leading with them get one (partial on IS NOT NULL when nullable), so a parent's rows and the delete check are read without a table scan; a test refuses a new unindexed key.

### v9.0.448 — The Drizzle Schema Matches the Database
- **Fix (TD-613, B01-33):** the Drizzle schema declares the ON DELETE actions, NOT NULL columns, indexes and unique indexes the migrations built, and a drift test refuses any new difference; four stage progress columns become NOT NULL on clean data.

### v9.0.447 — Business References Get Their Foreign Keys
- **Fix (TD-903, B01-31 / B01-32):** the thirty references between business tables get database foreign keys (NO ACTION as declared), validated on clean data and listed by the health check until validated.

### v9.0.446 — User Columns Get Their Foreign Keys
- **Fix (TD-902, B01-31 / B01-32):** the sixteen columns declared as references to users get database foreign keys with their declared ON DELETE, validated on clean data and listed by the health check until validated.

### v9.0.445 — Webhook Deliveries and Rule Logs Follow Their Declared ON DELETE
- **Fix (TD-611, B01-31):** webhook deliveries and rule action logs get the foreign keys the schema declares; deleting a subscription or a rule is one audited transaction that also closes its queued jobs.

### v9.0.444 — Print Signatures Keep Their Step Title; Foreign Key Exceptions Documented
- **Fix (TD-612, B01-32):** the document print signature reads the step title from the instance's own snapshot, so a workflow design save no longer drops it; columns kept without a foreign key on purpose are listed with their reason and a test checks the schema against the database.

### v9.0.443 — Persian Wording in the Events Screens
- **Events wording (TD-734):** the events, webhook, dead-letter, notification and WooCommerce screens use the words of decision t9 («اقدام», «آزمایش», «گزارش», «داده رویداد», «صف ارسال رویداد», «صف خطا», «سرآیند», «اشاره») instead of «اکشن», «تست», «لاگ», Outbox and Payload; «وب‌هوک» is the third allowed loanword, WordPress labels stay only in parentheses, and the WooCommerce secret is no longer called optional.

### v9.0.442 — Persian Digits in the Events Screens
- **Persian digits (TD-732):** counts, percentages and durations in the events, webhook, dead-letter, WooCommerce and notification screens were written with Latin digits («بازپخش 1 مورد», «%۸۶», «120ms», «تلاش 3/۵»); they now use `formatPersianNumber` / `toPersianDigits`, «٪» after the number and «میلی‌ثانیه».

### v9.0.441 — Events Page States Its Real Status
- **Events page status (TD-733):** a stopped outbox worker showed the green pulse, each outbox action was announced by a banner and a toast, the live list label said 8 seconds for a 10-second refresh and the WooCommerce order log header promised amounts; each now states what is true.

### v9.0.440 — Timeline Aggregate Search Settles
- **Timeline search (TD-731):** the event timeline's aggregate search sent a request per keystroke and a late answer overwrote the newer list; it now waits for the keyword to settle (`useDebounce`) and aborts the older request.

### v9.0.439 — Event Screens Show the Server Reason
- **Event error messages (TD-730):** the dead-letter, webhook, rule, outbox and timeline tabs showed fixed texts for refused requests (losing the server's 409 «in replay» or SSRF reason) and called any refusal of a dead-letter payload edit a JSON format error; every catch now shows the server's message and only a parse error is a JSON format error.

### v9.0.438 — Rule Switch Sends Its Target State
- **Rule switch (TD-729):** the automatic rule switch flipped the state on every call, so a double click put the rule back (with two success messages) and no change was audited; the switch now sends `{ active }` (`setRuleActive` under the rule row lock: a repeat changes nothing, each change one audit row in its transaction) and the switch and the test button wait for their answer.

### v9.0.437 — Webhook Form Saves Once
- **Webhook form double submit (TD-728):** the webhook form's submit button was never disabled, so a double click made two subscriptions and every event was delivered twice; the form now sends once (`isSaving` with a ref guard) and the button stays disabled until the answer.

### v9.0.436 — Event, Notification and WooCommerce Log Times in UTC
- **Server times of package 15 (TD-725):** the events routes, the notification list and the WooCommerce order log sent zone-less UTC timestamps, so a Tehran browser showed them 3.5 hours early (the previous day before 03:30) and a new notification said «3 ساعت پیش»; they now carry a Z (`utcTimestampResponses` / `withUtcTimestampKeys`), stored event payloads are sent as stored, and the bell prints its relative time from UTC with Persian digits.

### v9.0.435 — Events Page by Permission
- **Events page access (TD-722):** the events page was guarded by the role codes admin / manager while its menu entry and route asked `events.view`, so a holder of events.view with another role got «عدم دسترسی»; the page now opens with `events.view` and every change button of its sub-tabs (rules, outbox, dead letters, timeline replay, webhooks, event simulation) shows only for `events.manage`, the key each change route asks.

### v9.0.434 — Dismissed Notifications Stay Dismissed
- **Notification dismissal (TD-717):** deleting a notification removed its row and the due reminder was made by read-then-write on every bell and counter request, so a deleted reminder came back and concurrent requests made two; «حذف» now sets `dismissed_at` (migration 0089), the bell and its counter skip dismissed rows, and the reminder insert is ON CONFLICT DO NOTHING on the partial unique index `uq_notifications_due_reminder` (created only on clean data; older duplicates listed by the financial health check).

### v9.0.433 — Due Follow-up Reminder Reaches Only Its Assignee
- **Due reminder recipient (TD-709):** the notification bell matched a follow-up's assignee with «contains», so a user named «علی» got the reminder (title and customer) of «علی رضایی»'s follow-up; the reminder now goes to the user linked to the assigned personnel, or for a legacy row without a personnel id to the user whose full name or username equals the trimmed assignee (else logger) exactly.

### v9.0.432 — Dead Letter Payload Edit and Outbox Retry Are Consistent
- **Dead letter edit and outbox retry (TD-716):** editing the payload of a replayed dead-letter row rewrote it and its completed outbox row with no lock or audit, and retrying a failed outbox event left its dead-letter row quarantined; a replayed row is now never edited (409 DLQ_EVENT_REPLAYED), an open row's edit runs under its row lock with an audit row and spares a completed outbox row, and the retry resolves the event's idle dead-letter rows in the same transaction and refuses an event that is not failed.

### v9.0.431 — Event Timeline Shows the Entity Own Rows
- **Event timeline (TD-711):** the timeline compared «document» with the publisher's «Document», its picker gave the document number instead of the id, and audit rows of any entity whose id or description contained the id came back, also to a role without the audit-log permission; each entity type now maps to its event aggregate types and audit entity names (`TIMELINE_AGGREGATE_SCOPES`), outbox, dead-letter and audit rows match the exact id, and audit rows go only to holders of `audit_logs.view`.

### v9.0.430 — Rule Test, Event Simulation and Replay Have No Effect
- **No-effect test tools (TD-708):** the rule test and the event simulation ran real actions with sample data (notifications to recipients, audit rows, a validly signed webhook with a fake amount to an outside partner) and the timeline's live replay ran without confirmation; the rule test now evaluates the stored rule and only describes its action, the simulation publishes nothing and lists the matching rules and receiving webhooks, and live replay is refused (422 EVENT_REPLAY_LIVE_REMOVED).

### v9.0.429 — Non-bcrypt Passwords Are Locked, Never Turned Into Passwords
- **Fix (TD-617, B01-37):** the boot no longer hashes stored non-bcrypt values into working passwords; a one-off script locks them with a required reset, ended sessions and an audit row.

### v9.0.428 — No Silent Demo Database Without DATABASE_URL
- **Fix (TD-616, B01-36):** SQL_HOST alone reaches PostgreSQL, the in-memory demo database starts only with ERP_DEMO_MODE=1 outside production, and a server without a database refuses to start.

### v9.0.427 — Skipped Migration Constraints Are Reported and Built by Hand
- **Fix (TD-589, B01-09):** the migrator reports a constraint or index a migration left out, the financial health check lists each missing one with its cause, and the system admin builds it once the data is clean.

### v9.0.426 — Migrations Check Objects in Their Own Schema
- **Fix (TD-610, B01-30):** every existence check of the migrations looks only in the current schema, so a test schema built beside a migrated one gets every constraint, index and trigger, among them the non-negative stock guard.

### v9.0.425 — Migrations Drop Objects in Their Own Schema
- **Fix (TD-590, B01-10):** every DROP ... IF EXISTS of the migrations names the current schema, so building an isolated test schema no longer drops the public index `idx_idemp_user_scope_key` (and with it every idempotent request) on a development or staging database.

### v9.0.424 — Persian Wording on the Project Screens
- **Persian Wording on the Project Screens (TD-769):** the project screens and server messages used BOM, «فریز», «گانت», «سرور» and other loanwords and showed counts and percents in Latin digits; they now follow the approved glossary (owner decision t10) with Persian digits and «٪».

### v9.0.423 — Searchable Project, Item and Task Pickers
- **Searchable Project, Item and Task Pickers (TD-767):** six package-11 pickers were native selects over whole entity lists (projects, raw materials, warehouse items, piecework tasks); they are now `SearchableSelect`, and the project inventory picker labels each status from the closed status list.

### v9.0.422 — Project Read Failures Are Shown
- **Project Read Failures Are Shown (TD-766):** several project screen reads only logged their failure, so it looked like empty data, and a failed item code suggestion became `PREFIX001`; each failure now shows its message (`errorMessageOf`) and the code stays empty.

### v9.0.421 — Timeline Axis From Today
- **Timeline Axis From Today (TD-765):** with no start date anywhere the project timeline axis started at `1404*365+31`, a different unit from its day numbers since 1970, so stage bars collapsed to the minimum width; it now starts today in the same unit.

### v9.0.420 — Project Dates Through the Jalali Date Input
- **Project Dates Through the Jalali Date Input (TD-764):** the project form and the product schedule used `react-multi-date-picker` directly and the purchase required date was free text; all now use `JalaliDateInput` with ISO state, and the reservation date is shown with `formatPersianDate`.

### v9.0.419 — Stage Dates by the Jalali Picker and the Shortage Badge
- **Stage Dates by the Jalali Picker and the Shortage Badge (TD-763, TD-762):** stage dates in the project detail were free text with a 1403 sample and the shortage badge read a field nobody writes; the dates now use `JalaliDateInput` and the badge counts the reservation shortages written at finalize. TD-762 had been fixed by TD-891 / TD-892 and gets a guard test.

### v9.0.418 — Paused and Cancelled Projects on the Kanban
- **Paused and Cancelled Projects on the Kanban (TD-761):** the kanban had three columns, so paused and cancelled projects were hidden in the default view, and the status filter had no cancelled option; a fourth column and the full status list fix both.

### v9.0.417 — Project Buttons by Their API Keys
- **Project Buttons by Their API Keys (TD-752):** no project screen asked a permission, so a user holding only `projects.view` filled forms and got 403; the project list, detail, inventory control, delivery, progress matrix, workshop schedule and material allocation buttons now follow the keys their routes ask, defined once in `projectPermissions.ts`.

### v9.0.416 — Project Purchase Orders Through Procurement
- **Project Purchase Orders Through Procurement (TD-745, decision ت۸ ب):** the project purchase window built its own `PO-…` number, took free-text supplier and warehouse and could post a final receipt; its direct mode now records the project requisition and converts it into one draft procurement order with the server number, a listed supplier and warehouse, for holders of the create, order and approve keys only.

### v9.0.415 — Allocation Read Errors and Tab Access
- **Allocation Read Errors and Tab Access (TD-760):** a refused allocation read (403) showed as an empty list and the tab opened for `audit.view`, which the API refuses; the tab now shows the error with a retry and appears only for `READ_PERMISSIONS.bomAllocations`, the keys of `GET /inventory/allocations`.

### v9.0.414 — Purchase Row Status Kept
- **Purchase Row Status Kept (TD-750):** the purchase list row id (`code_…` / `name_…`) never matched a section row, so a chosen procurement status was lost and state was changed in place; `withProcurementStatus` now updates every section row of that code or name immutably with a functional update.

### v9.0.413 — Inventory Control Presets in the Project
- **Inventory Control Presets in the Project (TD-748):** preset sections keep their materials in `items`, which the project tab, purchase list, material progress and reservation never read (default preset: empty purchase list, 100% progress, no reservation); they now become project rows (`projectSectionsFromPreset`) in the tab and on the server before saving and reserving.

### v9.0.412 — Paged Project List
- **Paged Project List (TD-743):** `GET /projects` returned every project with every JSON field twice (312 projects, 9.1 MB) and ignored `page`; it is now one summary page `{ data, total, page, limit, statusCounts }` filtered in SQL, details only in `GET /projects/:id`, and the projects page pages, filters on the server and opens the edit form with the fresh record.

### v9.0.411 — Allocation From the Warehouse Shown
- **Allocation From the Warehouse Shown (TD-751):** the material allocation form showed the first warehouse but sent `main`; it now opens on the default warehouse (active, lowest id, TD-203) and sends it.

### v9.0.410 — No Material for a Closed Project
- **No Material for a Closed Project (TD-759, decision t9 A):** material was allocated to a cancelled project; allocating to a cancelled or completed project is now 422 `PROJECT_CLOSED_FOR_ALLOCATION` with no stock moved, releasing earlier allocations stays possible, a project with an open allocation is not cancelled (like delete, TD-412), and the allocation form offers only open projects.

### v9.0.409 — Rule Conditions Read Persian Digits
- **Rule condition digits (TD-727):** the rule engine compared with Number(value), so a condition value typed with Persian digits or thousands separators (`gt "۱٬۰۰۰٬۰۰۰"`) never matched; the engine now reads both sides with `normalizeDecimalString` for numeric comparisons and equality with a number, and the rule editor saves such a value as a number and refuses one that is not a number.

### v9.0.408 — Rule Execution Log and Stats Are Shown
- **Rule execution log (TD-721):** the «لاگ‌های اجرا» view of the automatic actions tab was always empty and its cards always 0, because the hook read `logs` / `totalLogs` / `avgDurationMs` while the server sends `data` / `logsTotal` / `avgLatencyMs`; both now share one contract (`actionLogContract.ts`) and each row shows the rule, event, status, duration and result.

### v9.0.407 — Invoice and Purchase Events Carry the Payable Amount
- **Document event amounts (TD-713):** the invoice event carried no amount, so a rule on payload.totalAmount never ran and the audit wrote «به مبلغ undefined»; invoice and purchase events now carry the payable amount (net of lines + VAT + service charge) in the document currency and in rials, on create and on finalize, and the rule editor offers these fields.

### v9.0.406 — Rules Trigger Only on Published Event Types
- **Rule trigger events (TD-726):** the rule editor offered InvoiceCancelled, ChequeStatusChanged, ProjectStageCompleted and CustomerCreated, which nothing publishes, so such a rule was saved active and never ran; the editor now offers the published types with Persian labels and «همه رویدادها», the server refuses another type on create, switch, activation and active save (422), and stored rules of such types are listed by the health check.

### v9.0.405 — Webhook Subscriptions Use the Published Event Types
- **Webhook event patterns (TD-707):** the webhook form offered dotted patterns (document.invoiced, inventory.*) that matched no event the server publishes, so such subscriptions received nothing; the form now offers only the published types with Persian labels and «همه رویدادها», the server refuses any other pattern (422), stored subscriptions were converted with a mapping table (old lists recorded, unmappable or example.com ones deactivated), and the two demo subscriptions are no longer seeded.

### v9.0.404 — Reorder Alert on Free Stock
- **Reorder alerts (TD-843, decision t7):** free stock (stock minus reservations) is compared with the reorder point; open purchases are shown as «در راه».

### v9.0.403 — Reorder Purchase Receipt at Price Zero
- **Reorder alerts (TD-830, B07-14):** a final receipt at price zero needs «کالای اهدایی» and is refused for an item without cost; the warehouse and the Jalali date can be chosen.

### v9.0.402 — Reserved Items Excel Export and Source Links
- **Reserved items report (TD-828, B07-12):** «خروجی اکسل» writes a real xlsx file with a Persian name and Jalali date; source links open the searched documents list or the project inventory control.

### v9.0.401 — Below Reorder Point Filter
- **Reorder alerts (TD-827, B07-11):** the «زیر نقطه سفارش» filter shows items with stock up to the reorder point instead of the out-of-stock ones.

### v9.0.400 — Reserved Items by Reader
- **Reserved items report (TD-829, B07-13):** cost and value go only to item cost readers and a proforma buyer only to documents.view holders; other readers see quantities and sources.

### v9.0.399 — Reserved Items at Cost
- **Reserved items report (TD-823, B07-07):** every reservation is valued at quantity × the item WAC in IRR, for proformas in any currency and projects alike; the proforma sale price is no longer reported.

### v9.0.398 — Project Material Requests Through the Queue
- **Raw material requests (TD-826, B07-10):** project control sends a request instead of creating an item; a request starts the pending-material workflow, whose approve and reject steps review it, and a direct review closes the open instance.

### v9.0.397 — Pending Material Review Once
- **Raw material requests (TD-825, B07-09):** sending needs `pending_materials.create`; approve, reject, edit and delete run under the request row lock and only from pending; the item is made by the item service and linked on the request (migration 0087).

### v9.0.396 — Pending Material Approval Body
- **Raw material requests (TD-824, B07-08):** the approval and the edit of a request send one camelCase form; the route bodies are strict, so the old snake_case keys are a 400 instead of being dropped.

### v9.0.395 — Scoped Reservation Reads
- **Reservations (TD-831, B07-15):** the reservation report reads sales proforma lines in one joined query, only finalized projects with stored rows and only the items those rows name; scoped reads (exit gate, item list, online shop) read only what may reach their items.

### v9.0.394 — Reservation Readers Fail Closed
- **Reservations (TD-821, B07-05):** a stored project reservation row is read as text and a row that reaches no live item is skipped and listed by the financial health check; the item list, the online shop sync and the reservation report fail closed instead of showing zero reservations.

### v9.0.393 — Setup Token Checked on Step 1
- **Fix (TD-621, B01-41):** step 1 of the setup wizard needs the setup token, and a wrong token takes the wizard back to step 1 with the message under the token field; the password half was fixed by TD-532.

### v9.0.392 — Setup Wizard and Health Page in Persian
- **Fix (TD-622, B01-42, decision ت۸):** the setup wizard, the health page, its integrity check and the reset dialog show no English word or Latin digit; the company name has no default and is required by `POST /setup`, and the factory reset is confirmed by typing «حذف همه».

### v9.0.391 — Event Queue Replay Asks First
- **Fix (TD-623, B01-43, decision ت۸):** replaying the failed events or the events stuck in the send queue asks «… دوباره اجرا شوند؟» first, and each button shows only when its queue has events; the health answer carries `outbox.stuckCount`, counted with the reset's own condition.

### v9.0.390 — Factory Reset Restores Event Rules and Subscriptions
- **Fix (TD-620, B01-40):** after a factory reset the default workflows, event rules and webhook subscriptions are seeded again with the boot's `seedDefaultEngines`, so the low-stock alert works without a restart; the reset card names what is erased, what comes back and that roles are kept.

### v9.0.389 — Storage Card Checks the Attachment Directory
- **Fix (TD-619, B01-39):** the health page's storage card checks the attachment root (`ATTACHMENTS_DIR`) and the image uploads directory, each with its path, by permission only; it no longer writes a test file into `public/uploads` on every call or reports «writable» while attachments cannot be saved.

### v9.0.388 — Health Page Reports a Failed Check as Unknown
- **Fix (TD-593, B01-13):** the system health page measures the event queue, voucher balance and workflow separately; a failed query is `unknown` with null counts and a Persian message instead of zeros and `ok`, the constant `observability` field is gone, and the page shows «نامعلوم» with its own color.

### v9.0.387 — Data Export Holds Every Promised Table
- **Fix (TD-624, B01-44, decision ت۷):** the export reads one table list shared with the settings card (`DATA_EXPORT_TABLES`): project allocations and stage progress, pending materials, piecework tasks and rates, fiscal periods, item opening rows, attachment metadata, workflow tables and event rules were added; every other table is left out with a reason in the manifest, and Vitest fails on an unclassified table.

### v9.0.386 — Streamed Zip Data Export
- **Fix (TD-592, B01-12, decision ت۷):** the data export streams a zip with one NDJSON file per table, read in primary-key batches with back-pressure, and a manifest of row counts; the audit log comes only with `activityLogs=1` and a business-day range. Before, one unbounded `SELECT *` per table and one `res.json` (950,000 audit rows: 3 GiB of memory, `/health/live` waited 13 s).

### v9.0.385 — Project Optimistic Lock
- **Project Optimistic Lock (TD-742, decision t3 A):** two users saving one project overwrote each other silently; `PUT /projects/:id` now requires the `version` the form was built from (400 without it), refuses a stale one with 409 `OCC_CONFLICT`, and every save, matrix status change and delivery completion raises the version; the edit form and the project tabs send and track it.

### v9.0.384 — Stages Read-Only in the Project Edit Form
- **Stages Read-Only in the Project Edit Form (TD-740, decision t2 A):** stages edited in «ویرایش پروژه» answered 200 and were silently dropped; the edit form now shows them read-only with a button to the stages section of the project detail, sends no `initial_stages`, and `PUT /projects/:id` refuses stages with 422 `PROJECT_STAGES_READ_ONLY`.

### v9.0.383 — Project and Stage Audit Rows
- **Project and Stage Audit Rows (TD-757):** a project edit was logged with `details: {}` outside its transaction and stage add, edit and delete wrote no audit row; `projectAudit.ts` now logs the project edit with before and after of the changed fields and every stage write under «مرحله پروژه تولید» (retained), each with the write's `tx`.

### v9.0.382 — One Clock for Stage Completion
- **One Clock for Stage Completion (TD-756):** a stage edit wrote `completed_at` in UTC with Z while the matrix sync and the matrix tick wrote the Tehran wall clock without a zone (210 minutes apart); every path now writes the server UTC time (`systemNowUtcIso`) through `stageCompletedAt`, a completed stage keeps its time and a reopened stage has none.

### v9.0.381 — Project Delivery and Quantity Input
- **Project Delivery and Quantity Input (TD-741):** a delivery quantity in Persian digits or below zero answered 200 «با موفقیت افزوده شدند» with nothing recorded, a Persian-digit unit price fell back to the WAC and a Persian-digit project quantity was stored as NaN; delivery and project quantities and prices now go through `decimalInput`, an invalid line is 422 `PROJECT_DELIVERY_LINE_INVALID` and a non-positive project quantity 422 `PROJECT_QUANTITY_INVALID`.

### v9.0.380 — Project Status and Priority Lists
- **Project Status and Priority Lists (TD-754):** a project status or priority and a stage status were free text («Completed», «خیلی فوری» and «تمام» were stored, and such a project fell out of every status filter); they are now `z.enum` of the UI lists in `lib/projects/projectStatus.ts` (400 otherwise), and the financial health check lists legacy values (`project_status_values`) without rewriting them.

### v9.0.379 — Rule and Webhook Counters Under the Row Lock
- **Rule and subscription counters (TD-718):** a rule's execution count and a webhook subscription's delivery counters were written from the row read before the action, so concurrent executions were lost (10 runs counted 3); they are now read under the row lock and written in the transaction of the attempt's log row.

### v9.0.378 — Durable Retries for Webhook and Rule Action Deliveries
- **Integration deliveries (TD-705):** webhook retries were three in-memory timers lost on a restart, a failed rule action was never run again, the outbox handlers always reported success and nothing reached the dead letter queue; each delivery now has its own durable row, a worker retries it with a growing delay, after its cap it goes to the dead letter queue on its own row, and a replay runs only that delivery.

### v9.0.377 — Fake Workflow and SMS Rule Actions Removed, Real Draft Evaluation
- **Rule actions (TD-712):** the workflow-trigger action did nothing and reported "queued", the SMS action only wrote a log line, and the draft test of the rule editor answered success for any draft (an invalid operator, an unknown event, an empty address); both actions are removed, earlier rules of those types are deactivated and listed by the health check, and the draft test really evaluates the draft without sending or writing anything.

### v9.0.376 — Demo Event Action Handlers Removed
- **Event action handlers (TD-714):** three demo handlers registered at boot only logged, yet wrote a "successful action handler" audit row (with voucherGenerated: true) and an idempotency row without expiry for every invoice, stock issue and reorder alert; boot no longer registers them.

### v9.0.375 — A Webhook Action That Fails Is Recorded as Failed
- **Webhook rule actions (TD-706):** a webhook rule action whose request failed (connection refused, no DNS, timeout) was recorded as a success with a made-up "200 OK (Simulated Fallback)" when its address contained webhook-echo, example.com, localhost, 127.0.0.1, httpbin.org or webhook.site anywhere; every failed request is now recorded as failed.

### v9.0.374 — Reservations Keyed by Item Id
- **Reservations (TD-822, B07-06):** reservation summaries, the reserved stock map and the item list key reservations by item id instead of the upper-cased code, so two items whose codes differ only in case keep their own reservations.

### v9.0.373 — Project Finalize Reserves Free Stock Only
- **Reservations (TD-819, B07-03, decision t3):** finalizing a project reserves min(need, stock minus the reservations of others) under a new advisory lock (91011), stores the shortage in reservationShortages (shown on the purchase tab), and the health check lists items reserved above their stock.

### v9.0.372 — Project Reservations Convert Units
- **Reservations (TD-820, B07-04, decision t4):** a project need is converted to the item unit with the row's own conversion rate before it is reserved and summed per item; a row in another unit without a valid conversion refuses the finalize with 422 PROJECT_RESERVATION_UNIT_MISMATCH; a directly entered conversion rate is no longer rounded to zero.

### v9.0.371 — Only Finalized Projects Reserve Stock
- **Reservations (TD-817, B07-01, decision t2):** only the stored reservation of a finalized project reserves stock; the reader no longer rebuilds an empty reservation from the sections or the purchase list, so a draft or unfrozen project reserves nothing and a consumed reservation stays consumed; legacy projects are listed by the health check.

### v9.0.370 — Only Sales Proformas Reserve Stock
- **Reservations (TD-818, B07-02, decision t1):** only a sales proforma (type invoice or proforma in proforma status) reserves stock; a purchase proforma (receipt in proforma status) and any draft reserve nothing, so a purchase order no longer blocks the sale of free stock.

### v9.0.369 — Package 7 Inventory Planning Audit
- **Audit (package 7):** inventory planning section of the stability audit report: 15 proven findings opened as TD-817..TD-831 plus TD-843 (decision t7) with the product-owner decisions t1-t8; documentation only.

### v9.0.368 — v9.0.368 — Stage Number and Percent Input
- **Stage Number and Percent Input (TD-755):** a text stage number or percent answered 500 with the SQL text and a manual duplicate number was stored; the stage route now reads them with `decimalInput` (a positive whole number, a whole percent 0 to 100, Persian digits accepted), a number another stage holds is 409 `STAGE_ORDER_TAKEN`, and a renumbered stage carries its matrix ticks.

### v9.0.367 — v9.0.367 — Stage Numbers Never Reused
- **Stage Numbers Never Reused (TD-737, TD-753):** a new stage took «live stages + 1», so after a deletion it reused a number and inherited the deleted stage's ticks (a project stayed completed with no work) and two stages could share a number; numbering now follows every number the project used under the project lock, a deleted stage drops its ticks, and migration 0084 adds a partial unique index and a foreign key to the project.

### v9.0.366 — v9.0.366 — Manual Stage Status Only Without Products
- **Manual Stage Status Only Without Products (TD-758, decision 1a):** in a project with a progress matrix a manual stage status or percent answered 200 and was silently reverted by the sync; it is now refused with 422 `STAGE_STATUS_FROM_MATRIX`, and the stage form asks for status and percent only in a project without products.

### v9.0.365 — v9.0.365 — Project Status Only on Writes
- **Project Status Only on Writes (TD-738, decision 1a):** reading a project ran the progress sync without a lock or audit row, so a cancelled project with a full matrix became completed on one GET by a warehouse reader and its delivery was accepted; the sync now runs only inside the tick, stage and project-edit transactions under the project row lock, never changes a cancelled or paused project, and audits each status change.

### v9.0.364 — v9.0.364 — One Progress Matrix Rule
- **One Progress Matrix Rule (TD-739):** the product × stage progress matrix had three copies that disagreed: a project defined by its main item showed no matrix row and its ticks were skipped, yet its completion was refused as «0 of 3»; the view, the ticks, the completion check (now 422 `PROJECT_MATRIX_INCOMPLETE` inside the project save) and the status sync share `computeProgressMatrix`.

### v9.0.363 — v9.0.363 — One Item-Matching Rule for Project Materials
- **One Item-Matching Rule for Project Materials (TD-749, TD-768):** the project purchase list matched a material to a warehouse item by part of its name («کارتن» took the stock of «کارتن بسته‌بندی بزرگ» and left the purchase list) while the server reserved by exact name, and the rule was copied in ten places; the screens and the reservation now share `findProjectItemMatch` (item id, then code, then exact name; never a substring or an empty name).

### v9.0.362 — v9.0.362 — Package 11 Project Control Audit
- **Audit (package 11):** project control and production section of the stability audit report: 35 proven findings, 30 of them opened as TD-737..TD-769 (TD-735, TD-736 and TD-747 were closed in package 12; B11-10 and B11-12 were fixed by TD-888 and TD-688) with the product-owner decisions t1-t10; documentation only.

### v9.0.361 — WooCommerce and Webhook Keys Encrypted at Rest
- **Integration secrets at rest (TD-898):** the WooCommerce consumer key and secret, the WooCommerce webhook secret and every webhook subscription's signing key and custom header values are now stored with `encryptSecret` (`ERP_SECRETS_KEY`) and decrypted only inside the server; a value that cannot be decrypted is never sent, and legacy plain values are encrypted with `npm run secrets:encrypt -- --apply`.

### v9.0.360 — Webhook Keys and Partner Tokens Masked in Every Answer
- **Webhook secrets (TD-710):** the webhook toggle and edit answers returned the full signing key to a non-admin manager, and any events viewer saw the partner API token in custom headers and the token of webhook rules; the key, rule token and header values are now masked in every answer for every user, and the key is shown once, after create or rotation.

### v9.0.359 — Server-Made Webhook Key and Entered Timeout
- **Webhook key and timeout (TD-720):** the webhook form made the signing key in the browser with Math.random (about 16 base-36 characters), so the server's CSPRNG key never ran, and the create route read only timeoutSeconds, so every entered timeout became 10 seconds; the server now makes the key and stores the entered timeout of 1 to 30 seconds.

### v9.0.358 — Webhook Edit Keeps the Signing Key
- **Webhook edit and ping (TD-719):** the edit form took the masked signing key from the list and every save, even a rename, stored the mask in place of the real key, breaking every receiver's HMAC check; an empty or masked key now keeps the stored one and a saved webhook is pinged with its own stored key.

### v9.0.357 — Server Start No Longer Rewrites Webhook Rules
- **Webhook rules at start (TD-715):** every server start turned a webhook rule URL containing «example.com» into the local echo simulator and put the system's echo token into every webhook rule without one, which then sent it to the external address; saved rules are now left as they are and the system token goes only to the server's own echo simulator.

### v9.0.356 — Webhook Connection Test Never Reaches an Internal Service
- **Webhook SSRF guard (TD-704):** the webhook connection test followed redirects and showed the internal service's answer, and the local echo exception opened any loopback port in production too; the test no longer follows a redirect, and the echo simulator passes only in test and development, on the server's own port and exact path.

### v9.0.355 — Persian Procurement Wording and Field Errors
- **Fix (TD-901, decision ت۵):** procurement UI says «مواد», «فهرست کالا», «سند حسابداری», «بسته» and «اقدام» (no «(Requisitions)»); requisition form and server Zod errors show under their field (`apiFieldErrors`), and server messages name actions in Persian (`requisitionActionLabel`) with Persian digits.

### v9.0.354 — Requisition Item Picker With Server Search
- **Fix (TD-700, B10-13):** the requisition form picks items with `SearchableSelect` over the item pick list (`/items/options`, server search) instead of a plain `<select>` of the items the desk had loaded; the desk no longer preloads items.

### v9.0.353 — Procurement Desk Pages and Server Filters
- **Fix (TD-697, B10-10):** the requisition list takes the statuses it writes and their groups (`REQUISITION_STATUS_FILTERS`: open, ordered, received, rejected, consolidated), the form priorities, item-name search in SQL and one shared limit (`PROCUREMENT_LIST_MAX_LIMIT`, answered as used); each requisition carries its order counts; the desk pages requisitions and orders on the server.

### v9.0.352 — Procurement Desk Sections and Buttons by Permission
- **Fix (TD-702, B10-15):** the procurement desk loads its summary, requisitions, orders and items one by one (`useProcurementDeskData`), so one refused or failed section shows its own error and the others still show; `GET /procurement/inbox/summary` opens for both page keys (`READ_PERMISSIONS.purchaseRequisitions`) and is listed among the page's APIs; each button follows the permission of its API (`useProcurementAccess`).

### v9.0.351 — Order Number and Supplier in Procurement Dialogs
- **Fix (TD-701, B10-14):** the delivery confirmation and the requisition detail read `refNumber`, `date` and `supplierName` of `GET /procurement/orders` instead of `orderNumber`, `orderDate` and `buyerName`, which the server never sends; the confirmation no longer shows «تامین‌کننده تدارکات» for every order.

### v9.0.350 — Receive Items Needs an Order
- **Fix (TD-699, B10-12, decision t4):** `receive_items` of a purchase requisition refuses a catalog row that was never ordered (409 REQUISITION_ROWS_NOT_ORDERED, «ابتدا سفارش خرید با تأمین‌کننده و قیمت صادر کنید») instead of a final receipt from the generic procurement supplier at the estimate, which posted donated-goods income (5204) with no supplier debt.

### v9.0.349 — Requisition Consolidation Closes Its Sources
- **Fix (TD-694, B10-07, decision t3):** `POST /procurement/consolidate` locks its sources in id order in one transaction, refuses a missing id (404 REQUISITION_NOT_FOUND) or a source that is approved, ordered, received, rejected or consolidated (409 REQUISITION_NOT_CONSOLIDATABLE), creates the consolidated requisition and marks each source `consolidated` with `consolidated_into_id` (migration 0083) and a terminated workflow; a consolidated requisition takes no action (409 REQUISITION_CONSOLIDATED).

### v9.0.348 — Procurement Double Submission
- **Fix (TD-693, B10-06):** `POST /procurement/requisitions`, `/requisitions/:id/convert-to-orders`, `/consolidate` and `/orders/:id/deliver` use `idempotency({ scope: 'procurement' })`, so a repeated submission with the browser's Idempotency-Key replays the first response instead of creating a second order or requisition.

### v9.0.347 — Procurement Orders Linked to Requisitions
- **Fix (TD-691 / TD-698, B10-04 / B10-11):** a procurement order is a document with `documents.procurement_requisition_id` (migration 0082, backfilled only from an unambiguous requisition tag; the rest is listed by the health check `procurement_order_link_unresolved`); the order list, the desk summary and delivery read only linked documents (else 422 PROCUREMENT_ORDER_NOT_LINKED), and the list filters, counts and pages in SQL.

### v9.0.346 — Persian Digits and Wording in Invoices and Stock Documents
- **Wording:** invoice and stock document messages show numbers in Persian digits and currency names instead of codes, the receipt summary no longer claims stock waits for a finance approval, and the screens drop transliterations and English words (TD-803).

### v9.0.345 — Settlement Account in the Invoice Currency
- **Settlement:** the invoice settlement form lists and pre-selects only bank accounts and cash funds in the invoice's currency and names each account's currency (TD-802).

### v9.0.344 — Document Type Names and the Sales Proforma Filter
- **Documents list:** the details and workflow windows name every document type in Persian, the «sales proforma» filter also lists proformas saved as invoices, and production receipts can be filtered (TD-800).

### v9.0.343 — Invoice List Cards Show Payable Totals
- **List cards:** the sales, purchase and proforma cards above the documents list now add up the payable amount (net + VAT + service charge), the same figure each row shows (TD-798).

### v9.0.342 — Document List Load Errors
- **Document list errors:** a failed load of the invoices and documents list (no permission, server error) now shows the server's message with a retry button instead of «no document found» (TD-797).

### v9.0.341 — Fresh Lists After Document Changes
- **Cache refresh:** saving a stock document and voiding a document now refresh Kardex, vouchers, items, the dashboard, reservations, projects, sales leads and parties, and a settlement refreshes bank accounts and treasury (TD-796).

### v9.0.340 — Document List Buttons by Permission
- **Document list buttons:** settlement, notes edit, workflow and void are shown only to users holding the permission of the action they call, and a refused notes edit shows the server's reason (TD-795).

### v9.0.339 — Paged Document List
- **Document list:** a list request without paging now answers one page of 50 documents with its total instead of the whole table, the full list comes only with `export=true`, and the stock count history and transfer tabs page through it (TD-787).

### v9.0.338 — Database Rules for Documents
- **Document constraints:** the database now refuses an unknown document type or status and a negative line quantity, price or discount; the document service refuses an unknown type or status even without lines, legacy rows are listed by the health check and a duplicate index on the project link was removed (TD-786).

### v9.0.337 — One Audit Row per Document Change
- **Document audit trail:** creating, editing, finalizing, changing the notes of and voiding a document each write one audit row in the same transaction with the stored document before and after; a void writes one row instead of two and the invoice event carries the buyer name (TD-785).

### v9.0.336 — The Party of a Document by Id
- **Document party:** a sales or purchase document now keeps its party by id; the voucher, the customer dossier, the treasury link and the party delete guard follow the id whatever the buyer name, a return takes its invoice's party, and old documents were linked by exact name, the rest listed by the health check (TD-778).

### v9.0.335 — Document Treasury Rows Only for Treasury Readers
- **Document read scope:** a document's receipts and payments (tracking number, bank account, description) are now shown only to treasury readers; other document readers see only the paid amount, the balance and the settlement status (TD-781).

### v9.0.334 — WooCommerce Bulk Stock Sync Reports Failed Items
- **WooCommerce bulk stock sync (TD-724):** the bulk stock sync showed the server's green message even when no item was updated; a failed item is now an error message with the counts and the first errors, and the WooCommerce order tables show a load error (403 / 500) instead of «no orders yet» (WooCommerce half of TD-730).

### v9.0.333 — WooCommerce Connection Test With Stored Keys
- **WooCommerce connection test (TD-723):** a non-admin sees the WooCommerce keys masked and the test button sent the mask as the keys, so the test always failed; the browser now leaves out an empty or masked key and the server uses the stored key, only at the stored store address.

### v9.0.332 — WooCommerce Namesake Buyers Get Their Own Customer
- **WooCommerce namesake buyers (TD-703):** a WooCommerce buyer whose name belongs to another customer with another phone gets a new customer named «name (phone)», so the sale is no longer debited to the existing customer's receivable; a name that differs only in letter case matches the stored customer, and the order log reports the distinct customer.

### v9.0.331 — Package 15 Events and Integrations Audit Documentation
- **Package 15 Audit:** section 15 of the V9 stability audit records the events, webhooks, automatic rules, dead-letter queue, notifications and WooCommerce package: 32 proven findings (one P1, a WooCommerce order of a namesake posted to the existing customer's receivable, and eighteen P2, among them a webhook test that follows redirects to internal addresses and delivery failures that never retry) opened as TD-703..TD-734 with the product-owner decisions. Documentation only.

### v9.0.330 — Work Log List Paged and Filtered on the Server
- **Work Log List Paged and Filtered on the Server (TD-811):** the piecework page loaded every work log ever recorded on each open and after each change (about 30 MB and 2.3 s for a workshop year) and filtered and summed it in the browser; `GET /piecework/logs` now filters in SQL and returns one page with the count and sum of every match, the page opens on the current Jalali month, `/piecework/logs/summary` sums the cards and project costs in SQL, and the «settled» filter now finds the logs on a payslip.

### v9.0.329 — Payslip Deductions Need a Description
- **Payslip Deductions Need a Description (TD-861):** the «سایر کسورات» box was labelled as insurance or tax although nothing computes either, and its amount reached the employee deductions payable account with no word on what it was; deductions above zero now need a description, stored with the payslip (migration 0079), printed on it and written into the deductions voucher row (account 3205).

### v9.0.328 — Payslip Shows Its Real State, Monthly Fixed Salary and Company Name
- **Payslip Shows Its Real State, Monthly Fixed Salary and Company Name (TD-815):** the payslip printed «۱ دوره ماهانه» for any fixed salary, called draft and approved payslips both ready to pay and carried a fixed company name, and «فیش‌های حقوقی من» showed a partly paid payslip as a draft with the currency twice; payslips now use one set of status labels, one fixed-salary row per Jalali month, the company name setting and an advance deduction column, and the UI says «کارمزدی» and «چاپ».

### v9.0.327 — Sales Document Numbers Only From the Server Series
- **Document numbers:** a sales invoice or sales return number now comes only from the server series; a stock document may keep a manual number, but a taken one is refused instead of being silently replaced, a manual number no longer moves the series, and the audit log records the stored number (TD-783).

### v9.0.326 — The Reference Invoice of a Sales Return by Fiscal Year
- **Sales returns:** the reference invoice lookup now finds only final invoices with one indexed query and knows the fiscal year: a number used in two years asks which year, so last year's invoice can be returned against, and each lookup error shows its real cause (TD-782).

### v9.0.325 — A Production Receipt Comes Only From the Project Delivery
- **Production:** a production receipt is now recorded only through the project's «ورود به انبار», where the project, its planned quantity and its delivery cost are checked; the stock document page no longer offers it and `POST /documents` or finalizing a draft one is refused (TD-780, decision ت۷).

### v9.0.324 — Stock Count Lines Need a Count and One Line per Item and Warehouse
- **Inventory:** a stock count line without a count is now refused instead of being counted as zero, a repeated item in the same warehouse is refused instead of being adjusted twice, and the count document shows each warehouse's own variance and book stock (TD-777).

### v9.0.323 — A Document Edit Links Its Sales Lead Under the Lead Lock
- **Sales:** `PUT /documents/:id` with `crmLeadId` now links or unlinks the sales lead inside the edit transaction under the lead lock: a missing lead or a lead with another proforma is 422 before anything is saved, and an unlinked lead is released for a new proforma; before, the link was written after the edit, without the one-proforma rule (TD-776).

### v9.0.322 — Payment From a Payslip Offers Its Remainder
- **Payment From a Payslip Offers Its Remainder (TD-814):** the pay button inside a payslip sent no paid amount, so a partly paid payslip's payment form offered the whole net, which the server refused; it now sends the paid amount and status, as the payslip list does.

### v9.0.321 — Custom Rate Readers Follow Decision t3
- **Custom Rate Readers Follow Decision t3 (TD-806):** a personnel's custom rates opened only for piecework.view, piecework.log and personnel.manage, so the rate writer (piecework.manage_tasks) and the payroll issuers and payers could not read them; they now open for exactly the decision t3 list, while projects.view and settings.manage read only titles and categories.

### v9.0.320 — Each Payroll Action Asks Its Own Key
- **Each Payroll Action Asks Its Own Key (TD-805):** personnel.manage alone set custom rates and issued, paid, voided and deleted payrolls while piecework.payroll could not issue one; titles, categories and rates now ask piecework.manage_tasks, work logs piecework.log, payrolls piecework.payroll and payments the new piecework.pay; migration 0078 gives existing roles the keys of what they did, and every button follows the same key.

### v9.0.319 — Requisition Edit Before Approval
- **Fix (TD-696, B10-09):** `PUT /procurement/requisitions/:id` edits only an unapproved (or rejected) requisition without orders (else 409 REQUISITION_NOT_EDITABLE), in one transaction under the row lock, with the create contract, the stored row ids kept and a before/after audit row.

### v9.0.318 — Requisitions With Orders Are Not Deleted
- **Fix (TD-695, B10-08):** a purchase requisition with a live purchase order is not deleted (409 REQUISITION_HAS_ORDERS naming the orders), under the requisition row lock with the workflow terminated in the same transaction; the desk shows the delete button only for a requisition without orders.

### v9.0.317 — Delivery Through the Workflow
- **Fix (TD-692, B10-05):** delivering a procurement order runs the receive transition in the delivery transaction with the deliverer's role and permissions, a refused transition refuses the delivery, an order of an unapproved requisition is delivered only after approval (decision t1), and the direct writes to workflow_instances, workflow_pending_approvals and workflow_tasks are gone (Vitest ratchet workflowTableWrites).

### v9.0.316 — Requisition Received After Every Row
- **Fix (TD-690, B10-03):** delivering an order marks its purchase requisition received only when no live order is left undelivered and every row is received or was closed at ordering; a row closed at ordering carries `closed` and is never received without an order.

### v9.0.315 — Requisition Orders Need Approval
- **Fix (TD-689, B10-02, decision t1):** a purchase requisition is ordered only from its approved step; for an unapproved one, a holder of the approval right first runs the approval transition in their own name, others get 409 REQUISITION_NOT_APPROVED; the workflow step moves only through executeTransition (the direct step writes of the conversion, A02-15, are gone).

### v9.0.314 — Purchase Requisition Contract
- **Fix (TD-688, B10-01):** the procurement desk, project shortage and reorder alert forms record purchase requisitions again; one contract for create and edit (requested quantity above zero, catalog item or item name, priority urgent/high/normal/low), and a body without a quantity is refused instead of storing zero.

### v9.0.313 — Package 10 Procurement Audit
- **Audit (package 10):** purchasing and procurement section of the stability audit report: 15 proven findings opened as TD-688..TD-702 plus TD-901 (decision t5) with the product-owner decisions t1-t5; documentation only.

### v9.0.312 — v9.0.312 — Production Error Answers Keep 4xx Details
- **Production error details (TD-594):** in production a 4xx answer keeps its details, so the over-delivery and over-order prompts list their items, and a broken request body gets a Persian message with its own code.

### v9.0.311 — v9.0.311 — Print Cleanup Runs Once
- **Print cleanup (TD-684):** printing cleans up once, keeps the print window's own state while it is open and no longer overwrites a newer page title, so the next Ctrl+P still prints only the document.

### v9.0.310 — v9.0.310 — Card and Sheba Fields Keep the Caret After Backspace
- **Card and Sheba caret (TD-682):** Backspace on a separator removes the digit before it and leaves the caret there instead of moving it to the end of the field.

### v9.0.309 — v9.0.309 — Searchable Select Shows the Label of a Preselected Value
- **Preselected picker label (TD-680):** a searchable picker filled from a draft, a sales file or a name match shows the chosen buyer instead of an empty box, and its search request no longer sends `limit` twice.

### v9.0.308 — v9.0.308 — Idempotency Key Kept While the Server Still Runs a Save
- **Idempotency key kept (TD-679):** when the browser stops waiting for a save the server is still running, it keeps the key, so a resend gets that save's result instead of starting a second, unguarded one.

### v9.0.307 — v9.0.307 — Saves Are Not Resent Automatically After a Lost Connection
- **No automatic resend of saves (TD-670):** after a network error only reads are retried automatically; a save tells the user to check whether it was recorded, and a resend by the user carries the same idempotency key.

### v9.0.306 — v9.0.306 — Form Drafts Expire
- **Form draft expiry (TD-676):** a draft lives 1 to 90 days, an expired draft no longer offers «restore», and a daily job soft-deletes expired drafts.

### v9.0.305 — v9.0.305 — Draft Routes Validate Their Input and Hide Database Errors
- **Form draft errors (TD-677):** a draft's type and key are checked against a pattern and a length cap, and a database error goes to the global error handler instead of returning the raw SQL text with status 400.

### v9.0.304 — Editing a Proforma Does Not Offer to Finalize It
- **Sales:** while a proforma is edited, «فاکتور نهایی» is closed with the reason that a proforma is finalized by its approval, and the item codes of its lines are shown; before, the option led to a false stock shortage message and the codes were empty (TD-801).

### v9.0.303 — A Failed Print Copy No Longer Leaves the Invoice Form Filled
- **Sales:** when the print copy of a just-saved invoice fails to load, the save still counts: the user is told to print it from the document list and the form is cleared; before, the save showed as failed, the form stayed filled and a second click created a second invoice (TD-794).

### v9.0.302 — A Sales Proforma Prints as a Sales Document
- **Sales:** a sales proforma stored as type `proforma` (recorded by a user without the finalize permission) now prints with the sales title and the seller and buyer boxes; before, it printed as a stock document without the buyer's address and phone (TD-793).

### v9.0.301 — Sales Form Lists Only Sales Proformas, Page by Page
- **Sales:** the open proformas of the sales invoice form are now only sales proformas (`GET /documents` takes `types=invoice,proforma`), read twenty at a time with a count and paging; before, purchase proformas were listed and edited there and the list was cut at 1,000 without notice (TD-792).

### v9.0.300 — Proforma Edit Keeps the Warehouse of Its Lines
- **Sales:** editing a proforma now reads each line's warehouse and saves the line there; before, every edit silently moved all lines (and their reservation) to the first warehouse (TD-790).

### v9.0.299 — Sales Invoice Form Resets Every Field
- **Sales:** clearing the sales invoice form (after a save or a cancelled edit) now puts the type, status, warehouse, date, currency, rate and sales lead back to their start values, and the form edits only sales documents; before, a cancelled edit of a purchase proforma made the next sale a receipt and a sales lead stuck to later documents (TD-789).

### v9.0.298 — Voucher Row Menu Offers Only Accepted Actions
- **Voucher Row Menu (P2, decision t8):** the menu offers per status only what the server accepts (no direct edit of an approved voucher, no correction of a permanent one, no reverse or correct of a reversal), a voucher with a source or of a year-end closing shows why it is locked, and the finalize confirmation promises no correction path (TD-568).

### v9.0.297 — Automation Status Counts Final Documents Only
- **Voucher Automation Status (P2):** the panel counts only final documents, takes a stock count as automatic when it has a valued difference and a transfer as without financial effect, reaches 100% only with every needed voucher, and warns only for types missing one (TD-560).

### v9.0.296 — Batch Finalize Reports Its Real Count
- **Batch Finalize Count (P3):** batch finalize returns only the vouchers it made permanent and lists each refused id with its reason (missing, deleted, already permanent, closed year, unbalanced); the message and the audit row say the same (TD-556).

### v9.0.295 — Voucher Edits Need Their Version
- **Voucher Edit Lock and Audit (P3):** a voucher edit sends the version it read (400 without, 409 `OCC_CONFLICT` when stale), a deleted voucher is never edited, and voucher and account edit and delete audit rows carry before and after (TD-555).

### v9.0.294 — Vouchers of a Source Change Only Through Their Source
- **Source Vouchers Locked on the Voucher Page (P2, decision t8):** a voucher issued by a document, treasury transaction, cheque, payroll or BOM allocation, and its reversal, is only approved and finalized from the voucher page; delete, edit, back to draft, reverse and correct answer 409 `VOUCHER_HAS_SOURCE` and the list shows each voucher's source (TD-552).

### v9.0.293 — v9.0.293 — Dashboard Banner Uses the Display Time Zone
- **Dashboard banner clock (TD-683):** the banner's date, clock and greeting follow the display time zone setting, so a device set to another zone no longer shows yesterday's date around midnight in Tehran.

### v9.0.292 — v9.0.292 — Dashboard Calendar Weekdays for Far Months
- **Dashboard calendar (TD-681):** the weekday of a month's first day comes from the calendar conversion, so months more than about 13 months away no longer start on Saturday.

### v9.0.291 — v9.0.291 — Global Search Finds the Exact Name and Arabic Letters
- **Global search (TD-675):** results come exact match first, then names that start with the text, then the rest; Arabic «ي» / «ك» and Persian digits match their Persian and Latin forms in both the search text and the stored names.

### v9.0.290 — v9.0.290 — Dashboard Reads Sales Data Only With Its Permission
- **Dashboard sales data (TD-674):** the dashboard reads sales files and recent activities only for holders of `crm.view`, and no longer loads parties, personnel, users or sales statistics it never shows.

### v9.0.289 — v9.0.289 — Warehouse Dashboard Counts the Kardex Ledger
- **Dashboard movement figures (TD-671):** recent documents count documents, not Kardex rows; a voided document and its reversal and warehouse transfers no longer count as consumption; the day windows follow the business time zone.

### v9.0.288 — Report Digits, Currency Names and Today
- **Accounting Report Digits (P3):** the journal book and the ratios show Persian digits, currencies are named, and the party statement and account explorer take today from the business time zone (TD-580).

### v9.0.287 — Persian Wording in the Accounting UI
- **Accounting UI Wording (P3):** the accounting screens have no English words or loanwords («دوبل», «آرتیکل», «داشبورد») and the voucher form button says it saves a draft (TD-579).

### v9.0.286 — Payslip Deductions Get Their Own Account
- **Payslip Deductions Account (P2):** payslip deductions credit the new standard account 3205 «employee deductions payable» instead of 3202 «customer prepayments»; migration 0077 adds it to existing charts, past vouchers stay and the health check lists what is left on 3202 (TD-554).

### v9.0.285 — Work Log and Payslip Writes Are Audited
- **Work Log and Payslip Writes Are Audited (TD-810):** editing a work log from 400,000 to 20,000,000 rials or deleting it left no trace, a batch wrote one «ثبت N ردیف» row without ids, and payslip rows were written after commit with no details, no IP and the raw status code; every log create, edit and delete and every payslip issue, status change and delete now writes its own audit row in its transaction with the request IP, before / after (changed fields on edit) and Persian status labels.

### v9.0.284 — Personnel Custom Rates Are Unique, Checked and Audited
- **Personnel Custom Rates Are Unique, Checked and Audited (TD-809):** a personnel custom rate was saved without a transaction, so concurrent saves made two active rows and the rates page and a work log read different rates; it is now saved under the personnel row lock with one active row per personnel and task (migration 0076), a negative rate or a missing personnel or task is refused, and every change writes a rate history row and an audit row with before and after.

### v9.0.283 — Workshop Schedule Logs Are Dated by the Work Day
- **Workshop Schedule Logs Are Dated by the Work Day (TD-747):** «ثبت کارمزد» in the project workshop schedule dated a work log by the row or project start date, so today's work landed in another payroll month; the tab now has a Jalali work-date picker defaulting to today in the display time zone, and both the row and the stage batch log use it.

### v9.0.282 — A Workshop Schedule Row Is Logged Once
- **A Workshop Schedule Row Is Logged Once (TD-736):** the «logged» flag of a workshop schedule row lived only in the browser, so reopening the tab logged and paid the same work twice; the server now writes the log id into the schedule row under the project row lock, refuses a second or concurrent log of the row with 409, and frees the row when its log is deleted or moved.

### v9.0.281 — Workshop Schedule Logs Take the Server Rate
- **Workshop Schedule Logs Take the Server Rate (TD-735):** the project workshop schedule read the task rate from a key the server never sends and posted work logs at rate 0; it now sends no rate, and the server gives a log posted from a schedule row the personnel custom rate, else the task base rate.

### v9.0.280 — Work Logs Are Checked Before They Are Saved
- **Work Logs Are Checked Before They Are Saved (TD-812):** a work log needs positive ids, a quantity above zero or hh:mm, a non-negative manual rate and live personnel, task and project; a batch is one transaction, so a bad row saves nothing, and editing a log follows the same rules.

### v9.0.279 — Piecework Base Rate Is Non-Negative
- **Piecework Base Rate Is Non-Negative (TD-813):** a task's base rate is a non-negative number in the task form, the API and the Excel import; a text or negative rate is refused and an Excel row with one is listed in the import errors instead of being saved as 0 or below zero.

### v9.0.278 — v9.0.278 — Approved Persian Words in the Shell and Settings
- **Shell wording (TD-686):** the sidebar, top bar, dashboard, settings, setup and connection error messages use the owner's Persian glossary instead of transliterations and English words; only «کاردکس», «ترنسفر» and «وبهوک» stay transliterated.

### v9.0.277 — v9.0.277 — Receipts Page Opens for Those Who Record Its Documents
- **Receipts page access (B16-04, TD-668 follow-up):** the stock in/out page opens for `warehouse.in`, `warehouse.out` or `documents.finalize`, the keys saving its documents asks, instead of `documents.view` / `documents.create`, which opened the page but could not save.

### v9.0.276 — v9.0.276 — Settings Values Are Validated
- **Settings validation (TD-672):** movement days must be whole numbers from 1 to 3650 with fast < slow < dead and the currency setting is rial or toman (422 otherwise); the dashboard falls back to the defaults 30 / 90 / 180 when a stored value is invalid.

### v9.0.275 — v9.0.275 — Currency Setting Is the Rial Display Unit
- **Rial display unit (TD-667):** the currency setting is now only the display unit of rial amounts, rial or toman (toman = rial ÷ 10); a record with its own foreign currency keeps it, and amount inputs and Excel exports stay in rial.

### v9.0.274 — v9.0.274 — A Sales Return Gives Back Its Share of the Invoice VAT
- **Documents:** a sales return of an invoice takes that invoice's VAT percent and its share of the invoice VAT for the returned net, so a full return in parts gives back exactly the invoice VAT, and its voucher debits VAT payable; before, a full return of a 1,000,000 invoice at 10% left the customer owing 100,000 and VAT payable 100,000 too high (TD-774).

### v9.0.273 — v9.0.273 — A Sales Return Takes Its Invoice's Currency, Rate and Net Price
- **Documents:** a sales return of an invoice takes that invoice's currency, exchange rate and net unit price after line discounts; any other price, currency or rate is refused with 422, also on draft edit and finalize, and the stock page fills and locks them; before, one unit sold at 900,000 was credited 5,000,000 and a full return of a 180 USD invoice credited 200 rials (TD-788).

### v9.0.272 — v9.0.272 — Settled Invoice Is Not Voided; Receipts Move On Account
- **Documents and treasury:** voiding a document with a live treasury receipt or payment is refused with 409 naming them; the treasury table can move such a row on account or to another invoice of the same party, so the void can follow; before, the receipt stayed on the voided invoice and the replacement showed as unpaid (TD-779).

### v9.0.271 — v9.0.271 — Invoice With a Live Return Is Not Voided
- **Documents:** voiding a sales invoice that still has a sales return (in any status) is refused with 409 naming the returns; before, the returned goods came back to stock twice and the customer kept a credit for a sale that no longer existed (TD-773).

### v9.0.270 — v9.0.270 — Zero-Price Invoice Gets Its Cost Voucher
- **Accounting:** a final sales invoice with zero gross (free sample, gift) now gets a voucher that moves its Kardex cost from inventory to cost of sales, with zero revenue; before, no voucher was issued and inventory stayed overstated in the ledger (TD-772).

### v9.0.269 — Only Approved Payslips Are Paid
- **Only Approved Payslips Are Paid (TD-816):** a draft payslip is refused at payment and the screens offer approval instead, and the payment date, method and reference are written only by the payment, never by the status route.

### v9.0.268 — Fixed Salary Up to the End of Service
- **Fixed Salary Up to the End of Service (TD-808):** a terminated personnel earns fixed salary only up to its end date (pro rata by days) and nothing after it, a terminated personnel without an end date gets no fixed-salary payslip, and a payslip whose period ends after today is refused.

### v9.0.267 — Advance Balance From the Ledger
- **Advance Balance From the Ledger (TD-807):** a personnel's outstanding advance is read only from its rows on the advance account (1301); treasury payments such as a salary settlement no longer count as an advance, so an advance deduction without a recorded advance is refused.

### v9.0.266 — Payslip Integrity
- **Payslip Integrity (TD-804):** negative bonuses, deductions and advance deductions are refused, a payslip voucher always credits wages payable with the net (invariant I10), a payslip without a voucher is not paid, and older mismatched payslips are listed by the financial health check.

### v9.0.265 — Package 12 Payroll Audit Documentation
- **Package 12 Payroll Audit:** section 10 of the V9 stability audit records the payroll part of package 12: 13 proven findings (one P1: negative deductions and bonuses make the payslip disagree with its voucher, and a payslip without a voucher can be paid) opened as TD-804..TD-816, with the product-owner decisions. Documentation only.

### v9.0.264 — بسته ۱۳ د: «اشاره» و «اعلان» در رابط گزارش کار
- «منشن» و «نوتیفیکیشن» در رابط گزارش کار جای خود را به «اشاره» و «اعلان» دادند (TD-646، تصمیم ت۶).

### v9.0.263 — بسته ۱۳ د: پیوند اعلان همان گزارش را باز می‌کند
- کلیک روی اعلان یا کارت پیشخوان همان گزارش کار را باز می‌کند (TD-645).

### v9.0.262 — بسته ۱۳ د: پیشخوان بی مجوز گزارش کار درخواستی نمی‌فرستد
- پیشخوان گزارش کار را فقط با مجوز دیدن آن می‌خواند و دیگر پیغام خطا نمی‌دهد (TD-639).

### v9.0.261 — بسته ۱۳ د: فرم بازخورد بی اشاره
- فرم بازخورد مدیر دیگر اشاره پیشنهاد نمی‌کند و می‌گوید اعلان فقط به نویسنده می‌رسد (TD-637).

### v9.0.260 — بسته ۱۳ د: نوع حضور فقط حضوری یا دورکاری
- مرخصی، مأموریت و ترکیبی از ورودی برداشته شد؛ گزارش‌های قدیمی «سایر» شمرده می‌شوند و ساعت مرخصی کارکرد نیست (TD-635، تصمیم ت۳).

### v9.0.259 — بسته ۱۳ د: ساعت شروع و پایان گزارش کار سنجیده می‌شود
- ساعت نادرست رد می‌شود و پایان باید بعد از شروع باشد؛ کار شبانه در دو گزارش ثبت می‌شود (TD-634، تصمیم ت۵).

### v9.0.258 — بسته ۱۳ ج: سقف طول گزارش کار
- عنوان، متن، برچسب‌ها و یادداشت مدیر گزارش کار سقف طول دارند (TD-644).

### v9.0.257 — بسته ۱۳ ج: کف ۵ دقیقه برای پاک‌سازی پیوست یتیم
- پاک‌سازی پیوست یتیم فایل جوان‌تر از ۵ دقیقه را پاک نمی‌کند (TD-643).

### v9.0.256 — بسته ۱۳ ج: خطای بارگذاری تصویر با پیام فارسی ۴۲۲
- تصویر بزرگ یا با قالب نادرست ۴۲۲ با پیام فارسی می‌گیرد و متن نادرست در ستون تصویر ذخیره نمی‌شود (TD-642).

### v9.0.255 — بسته ۱۳ ج: سقف یکسان پیوست و پیام فارسی ۴۱۳
- هر پیوست حداکثر ۱۰ مگابایت در همه لایه‌ها؛ مسیرهای پیوست‌دار بدنه ۱۴ مگابایتی می‌پذیرند و بدنه بزرگ‌تر پیام فارسی می‌گیرد (TD-641، تصمیم ت۴).

### v9.0.254 — بسته ۱۳ ج: خطای خواندن پیوست سرور را خاموش نمی‌کند
- فایل پیوست ناخوانا ۴۰۴ یا ۵۰۰ می‌دهد و دیگر سرور را خاموش نمی‌کند (TD-627).

### v9.0.253 — بسته ۱۳ ب: ابزارک اشاره‌ها با فیلد mentions
- ابزارک اشاره‌های پیشخوان شناسه کاربر را در فیلد `mentions` می‌جوید، نه «@نام» در متن (TD-638).

### v9.0.252 — بسته ۱۳ ب: زمان ثبت گزارش کار به وقت درست
- زمان ثبت گزارش کار با منطقه زمانی به مرورگر می‌رود و دیگر ۳:۳۰ عقب نیست (TD-636).

### v9.0.251 — بسته ۱۳ ب: سال‌های گزارش ماهانه از سال جاری
- سال‌های گزارش ماهانه مدیریت از سال شمسی جاری ساخته می‌شوند، نه فهرست ثابت ۱۴۰۲ تا ۱۴۰۵ (TD-632).

### v9.0.250 — بسته ۱۳ ب: «کارکرد امروز» با تاریخ کارکرد
- «کارکرد امروز» فقط گزارش‌های تاریخ امروز را می‌شمارد، نه گزارش روزهای دیگر که امروز ثبت شده‌اند (TD-631).

### v9.0.249 — بسته ۱۳ ب: فهرست و آمار گزارش کار با SQL و صفحه‌بندی
- فهرست گزارش کار صفحه‌بندی و در SQL فیلتر می‌شود و دیگر در ۲۰۰ ردیف بریده نمی‌شود؛ آمار همان مجموعه را می‌شمارد (TD-630).

### v9.0.248 — v9.0.248 — National ID Is Exactly Ten Digits
- **National ID (TD-673):** a personnel national ID must be exactly ten digits with a valid check digit; forms and the server never zero-pad a short one (422 `NATIONAL_ID_INVALID`), and only the Excel import pads 8 or 9 digits, which Excel drops, and lists those rows for review.

### v9.0.247 — v9.0.247 — Amount in Words Keeps Foreign Cents
- **Amount in words (TD-685):** a foreign-currency amount in words includes its cents (cent, fils, penny), so a 12.50 dollar invoice prints «دوازده دلار و پنجاه سنت» instead of «دوازده دلار».

### v9.0.246 — v9.0.246 — Numbers Shown With Persian Separators
- **Persian separators (TD-687):** every amount and quantity shown through `formatPersianPrice` / `formatPersianNumber` uses the Persian thousands separator «٬» and decimal separator «٫» (vibefarsi numbers rule) instead of the Latin comma and point; a number copied from the screen is read back exactly.

### v9.0.245 — v9.0.245 — Numbers Below 1,000 Keep Their Decimals
- **Number formatting (TD-678):** `formatPersianNumber` and `formatPersianPrice` no longer re-round their formatted text to two decimals below 1,000, so four-decimal quantities and work hours (`numeric(18,4)`) show in full on payslips and work logs.

### v9.0.244 — v9.0.244 — Amount Input Keeps Decimals and Persian Separators
- **Amount input (TD-665, TD-666):** the shared amount field keeps the typed text until editing ends, so «12.5» dollars is no longer stored as 125, allows the currency's decimals only (rial none, foreign two), reads the Persian «٫» and «٬», spaces and a copied currency label, and keeps the previous amount with a message instead of zeroing it on a stray character; the shared number parsers use the server's `normalizeDecimalString`.

### v9.0.243 — v9.0.243 — Package 16 Dashboard, Settings, Shell, Dates and Numbers Audit Documentation
- **Package 16 Audit:** section 10 of the V9 stability audit records the dashboard, settings, frontend shell and date and number utilities package: 23 proven findings (nine P2, among them amount inputs that drop decimals or zero a pasted amount, a currency setting that only relabels rial amounts, and resent writes after a network error) opened as TD-665..TD-687 with the product-owner decisions; TD-668 and TD-669 were already fixed in packages 2 and 4, and B01-14 (TD-594) joins this package's PR d. Documentation only.

### v9.0.242 — v9.0.242 — Stock Page Exit Cap by Source Warehouse
- **Documents (UI):** the stock document page caps an exit at min(source warehouse stock, total stock − other reservations), the server rule, so a remittance from an empty warehouse is stopped in the form instead of failing on save (TD-799).

### v9.0.241 — v9.0.241 — Stock Document Page by Record Permission
- **Documents (UI):** the stock document page offers each direction, document type and its submit button by the permission the server asks to record that type final, instead of the `viewer` role code, and names the missing permission (TD-791).

### v9.0.240 — v9.0.240 — Document Line Numbers Read as Decimals
- **Documents:** quantity, price, discount and stock-count numbers of a document line are read with `decimalInput`: Persian digits and thousands separators are accepted, hex and exponent text is refused, and a price sent empty is an error instead of zero (TD-784).

### v9.0.239 — v9.0.239 — One Sellable Gate for Create and Finalize
- **Documents:** every outgoing document recorded or finalized as final passes one sellable gate that sums each item and warehouse, with or without `inOut`, so a second line or a missing field no longer sells stock reserved for another customer (TD-775).

### v9.0.238 — v9.0.238 — Stock Direction From the Document Type
- **Documents (P1):** a document moves stock only in the direction of its type; an `inOut` against the type is refused with 422 `DOCUMENT_DIRECTION_MISMATCH` and a transfer is no longer recorded through `POST /documents`, so a receipt can no longer take goods out while its voucher adds them (TD-770, decision ت۲).

### v9.0.237 — v9.0.237 — Package 8 Documents and Invoices Audit Documentation
- **Package 8 Audit:** section 10 of the V9 stability audit records the documents and invoices package: 34 proven findings (seven P1, among them stock direction taken from the request body, a zero-price invoice without a voucher, voiding an invoice that has a return, and sales returns without VAT or tied price) opened as TD-770 and TD-772..TD-803 (TD-771 was closed in v9.0.125), with the product-owner decisions. Documentation only.

### v9.0.236 — بسته ۱۳ الف: حالت دید «عمومی» گزارش کار برداشته شد
- فرم دو حالت دید دارد؛ مهاجرت ۰۰۷۵ گزارش‌های عمومی را به «اشاره‌شده‌ها و خودم» برد و مقدار پیشین را نگه داشت (TD-900، تصمیم ت۷).

### v9.0.235 — بسته ۱۳ الف: CSV گزارش تجمیعی بی فرمول زنده
- خانه‌های CSV گزارش تجمیعی در گیومه و بی فرمول زنده؛ نام فایل فارسی (TD-640).

### v9.0.234 — بسته ۱۳ الف: اشاره و پروژه گزارش کار پیش از ذخیره سنجیده می‌شوند
- شناسه نادرست ۴۰۰، کاربر یا پروژه ناموجود ۴۲۲ بی ذخیره چیزی؛ گزارش و اعلان در یک تراکنش (TD-629).

### v9.0.233 — بسته ۱۳ الف: اعلان اشاره فقط برای خواننده گزارش
- اشاره در گزارش شخصی اعلان نمی‌دهد و فرم هشدار می‌دهد؛ ویرایش فقط به اشاره‌های تازه اعلان می‌دهد (TD-633).

### v9.0.232 — بسته ۱۳ الف: اشاره با بلندترین نام کامل
- «@علی رضایی» دیگر «علی» را اشاره‌شده نمی‌کند و اشاره پاک‌شده از متن از فهرست می‌رود (TD-628).

### v9.0.231 — بسته ۱۳ الف: دسترسی مدیریتی گزارش کار با مجوز
- بازخورد، ویرایش و حذف گزارش کار دیگران و دیدن گزارش شخصی فقط با `daily_logs.manage_all`؛ نوشتن‌ها در یک تراکنش با ردیف ممیزی (TD-626).

### v9.0.230 — Package 13 Daily Logs and Attachments Audit
- **Audit (package 13):** daily logs and attachments section of the stability audit report: 21 proven findings opened as TD-626..TD-646 plus TD-900 (decision t7) with the product-owner decisions t1-t7; documentation only.

### v9.0.229 — Party Statement Print Follows the Data
- **Party Statement Print (P2):** the header and final balance read the range and currency from the response, a filter change reloads, and «this month» / «this year» start on the Jalali month and year (TD-572).

### v9.0.228 — Accounting Buttons Only for Their Key Holders
- **Accounting Buttons (P2):** the dashboard voucher, treasury and cheque buttons, the year-closing execute button and the chart-of-accounts seed button show only for holders of their API key (TD-567).

### v9.0.227 — Journal Book Paged
- **Journal Book (P3):** one page of rows per request, sent once; row numbers and the running balance continue from the start of the range and totals cover the whole range (TD-561).

### v9.0.226 — Party Statement Counts Only the Party's Own Rows
- **Party Statement (P1):** rows belong to a party only by its own detailed type and id, or legacy rows without an id under its exact name; never another table's id or a longer name (TD-548).

### v9.0.225 — Ledger Reports Only for Accounting Keys
- **Accounting Reports (P1):** the account card, ledger, party statement and party list need `accounting.reports` or `accounting.view`; a card with no account or party and a statement with no party are 422 (TD-547, decision ت۵).

### v9.0.224 — Users, Roles and Audit Screens in Plain Persian
- **Users, Roles and Audit Screens in Plain Persian:** the users, roles, audit log, login, setup and profile screens and the permission list drop English words and transliterations, show counts in Persian digits and name roles instead of showing their codes (TD-540).

### v9.0.223 — The Simple User List Gives the Role Name, Not Its Code
- **The Simple User List Gives the Role Name, Not Its Code:** the user list every signed-in user reads for mentions carries each role's Persian name instead of its code (TD-534).

### v9.0.222 — Profile Picture Only From This System, Name Up to 100 Characters
- **Profile Picture Only From This System, Name Up to 100 Characters:** the profile refuses an outside image address or any other text as the picture, and a user name is at most 100 characters (TD-533).

### v9.0.221 — Clicking a Permission Title Ticks It
- **Clicking a Permission Title Ticks It:** in the role form a click on a permission's title or description ticks it once, like the box itself (TD-536).

### v9.0.220 — The Login Lock Shows Its Real Minutes in Persian
- **The Login Lock Shows Its Real Minutes in Persian:** a login lock answers locked and its minutes; the login page counts them down in Persian digits and a general 429 is no longer a fake lock (TD-539).

### v9.0.219 — A Temporary Password Must Be Changed First
- **A Temporary Password Must Be Changed First:** a password an administrator sets is temporary; until the user changes it the server opens only the session, profile and logout, and the browser shows only the password form (TD-523).

### v9.0.218 — Changing Your Own Password Keeps This Session
- **Changing Your Own Password Keeps This Session:** after a password change from the profile, this session gets a new token and goes on; the other sessions of the user end (TD-531).

### v9.0.217 — One Minimum Password Length Everywhere
- **One Minimum Password Length Everywhere:** creating, editing and restoring a user, the profile and the setup all ask eight characters, from one shared constant with one Persian message (TD-532).

### v9.0.216 — Audit Actions in Persian and Jalali Excel File Name
- **Audit Actions in Persian and Jalali Excel File Name:** one table gives the Persian label of every audit action on the page, the filter, the print and Excel; the Excel file is named with today's Jalali date (TD-538).

### v9.0.215 — Audit Print and Excel Cover the Whole Filter
- **Audit Print and Excel Cover the Whole Filter:** the official print and the Excel export come from one server request with every filter and the search, up to 1000 rows; the print shows the server total and all filters (TD-527).

### v9.0.214 — Audit Log Page Shows Refusals and Searches After Typing Pauses
- **Audit Log Page Shows Refusals and Searches After Typing Pauses:** a refused request shows a Persian permission message instead of an empty list; the search is sent once, from page 1 (TD-537).

### v9.0.213 — Audit Log Masks Bank Numbers and Secret Keys in Any Spelling
- **Audit Log Masks Bank Numbers and Secret Keys in Any Spelling:** card, account and Sheba numbers keep only their last four digits in audit snapshots; secret keys are found by "contains" in any spelling (TD-530).

### v9.0.212 — Audit Purge Keeps Financial, Security, Role and User Events
- **Audit Purge Keeps Financial, Security, Role and User Events:** the purge deletes only operational sections after the fixed 90 days; the options that turned protection off are gone (TD-522).

### v9.0.211 — Terminal Output Is English
- **Terminal English (owner rule t9):** AGENTS.md §6 records that everything a terminal shows is English (scripts, hooks, server logs, test names, commits), while UI text, user error messages and documents stay Persian. `npm run ratchet:terminal-english` (`scripts/terminal-english-ratchet.ts`, run by Vitest `terminalEnglishRatchet.test.ts`) counts the places that still print Persian per file and fails when a file gains one; translating them is the next step of TD-625.

### v9.0.210 — Item and Pricing UI Wording
- **Item and Pricing UI Wording:** item, Excel import and pricing text and item server messages use the decided Persian words (no «WAC», «Template», «استراتژی», «اتمیک», «آرشیو» …; «ترنسفر» stays); the Excel reorder header is «حد نقطه سفارش (هشدار کسری)» and the old header is still read (TD-664, `itemsWording.test.ts`).

### v9.0.209 — Item Page Actions by Permission
- **Item Page Actions by Permission:** the items and pricing pages show buttons and price fields by the permission of the server route (`products.create` / `edit` / `delete`, `woocommerce.manage`, `products.edit_price`) instead of the role code «viewer»; the average cost is shown in rials and the margin badge and markup buttons use rial prices only (TD-840, `itemActionsByPermission.test.tsx`).

### v9.0.208 — Excel Template From the Server
- **Excel Template From the Server:** `GET /items/excel-template` builds the import template with the columns the import reads (active warehouses with a matching total, every price list with its currency) without reading items or writing an export audit row (TD-842, `reg_excel_template_from_server_td_842`).

### v9.0.207 — Excel Currency per Price List
- **Excel Currency per Price List:** the item export and the pricing page export write «ارز - قیمت <title>» for each price list instead of one row-wide «واحد ارز», and the imports read it first, so an unchanged round trip keeps a rial price in rials (TD-841, `reg_excel_export_currency_per_price_list_td_841`).

### v9.0.206 — Item List and Excel Import Performance
- **Item List and Excel Import:** the item list builds reservations for its own page only; an Excel import reads its items once and its new items with stock share one opening voucher, recorded in `item_opening_voucher_items` (migration 0074) (TD-663, `perf_item_list_and_excel_opening_td_663`).

### v9.0.205 — Unique Category Names and Rename
- **Category Names:** a live category name is unique (partial index, migration 0073, only on clean data); a rename moves its items in the same transaction and a type change of a category with items is refused (TD-658, `reg_category_rename_keeps_items_td_658`).

### v9.0.204 — Category Soft Delete and Audit
- **Item Categories:** a category is soft-deleted and every create, edit, delete and default reset writes an audit row in its own transaction; the reset restores a deleted default instead of duplicating it (TD-659, `reg_category_soft_delete_and_audit_td_659`).

### v9.0.203 — Chart of Accounts Messages Shown Once
- **Chart of Accounts Page (P3):** each save, delete and error message is shown once, a refused seed is handled, and the delete confirmation says an account used in vouchers or with sub-accounts is not deleted (TD-576).

### v9.0.202 — Database Constraints on Vouchers and Accounts
- **Accounting Constraints (P3):** migration 0071 adds NOT VALID CHECK constraints on voucher row amounts, voucher status and type and account level, type and nature, and a parent foreign key on accounts, each validated only on clean data; the health check lists what is left (TD-562).

### v9.0.201 — Account Codes Are Latin Digits, Unique and Fixed
- **Account Codes (P2):** an account code is stored as Latin digits only (Persian and Arabic digits converted), is unique among active accounts also against legacy Persian-digit codes and concurrent requests (409 `ACCOUNT_CODE_TAKEN`), and cannot change after creation (422 `ACCOUNT_CODE_IMMUTABLE`) (TD-558).

### v9.0.200 — Account Edits Keep the Tree and Posted Accounts Intact
- **Account Edits (P2):** an account's parent must be exactly one level up and may not close a cycle; a system account takes only a new name and description and an account with voucher rows keeps its type, nature, level and parent; the tree and trial balance survive a legacy cycle (TD-553).

### v9.0.199 — Account Mapping Validated on Save
- **Account Mapping (P2):** each mapped code must be a posting account of the concept's account types (422 `ACCOUNT_MAPPING_INVALID`); resolution falls back only to the concept's default subsidiary code, never a group or general account, and the page lists all 26 concepts (TD-550).

### v9.0.198 — Voucher Rows Only on Posting Accounts
- **Posting Accounts (P2):** a manual, edited or correction voucher row goes only on an active subsidiary or detailed account without an active sub-account (422 `VOUCHER_ACCOUNT_NOT_POSTABLE`); the forms offer only those and the health check lists legacy rows elsewhere (TD-549).

### v9.0.197 — Accounts With Voucher Rows Are Not Deleted
- **Chart of Accounts (P1):** deleting an account that an active voucher row uses is refused with 409 `ACCOUNT_HAS_VOUCHER_ROWS`; the code of a deleted account always makes a new account, and deleted accounts that still carry rows are listed by the health check (TD-546, decision ت۴).

### v9.0.196 — Voucher Date Shown in Jalali
- **Accounting Date Inputs (P3):** the voucher, correction and reversal forms and the trial balance, account explorer and cash flow filters keep ISO dates and use `JalaliDateInput`; editing a voucher no longer shows its ISO date as a Jalali year 2026 (TD-578, Vitest `voucherDateInput.test.tsx`).

### v9.0.195 — Voucher Print Currency and Types
- **Voucher Print Currency (P2):** the voucher print follows the TD-551 balance rule (single-currency vouchers in their currency with the rate, multi-currency ones in rials with each row amount and rate) and names every voucher type from one shared list, settlement included (TD-573, Vitest `voucherPrintCurrency.test.tsx`).

### v9.0.194 — Account Picker Reads Persian Digits
- **Account Picker Digits (P2):** the account picker turns Persian and Arabic digits of the search and of account code, name, type and description to Latin before matching (TD-571, Vitest `accountSearchDigits.test.tsx`).

### v9.0.193 — Voucher Forms Offer Every Detailed Type
- **Voucher Detailed Types (P2):** the voucher and correction forms take the detailed types from the server schema list: «متفرقه» is `other`, project and bank account are offered and the correction form has the supplier; `accounting.vouchers` reads the project pick list (TD-569, `reg_manual_voucher_detailed_types_td_569`).

### v9.0.192 — Voucher Row Amounts Read as Decimals
- **Voucher Row Amounts (P3):** manual and correction voucher row debit, credit and rate go through `decimalInput`: Persian digits and separators are accepted, «0x10» and «1e3» are refused (TD-557, `reg_manual_voucher_row_amount_decimal_input_td_557`).

### v9.0.191 — Voucher Forms Send Each Row Currency and Rate
- **Voucher Form Row Currency (P1, decision t7):** the manual voucher form, its edit and the correction form send and keep each row's currency and rate, take the voucher rate, balance by the server rule and offer only the treasury currencies; the routes refuse «TOMAN» (TD-564, `reg_manual_voucher_currency_list_td_564`).

### v9.0.190 — Manual Vouchers Need a Rate on Foreign Rows and Balance in Rials
- **Manual Voucher Currency (P2, decision t7):** a manual or correction voucher row without a currency takes the voucher currency, every non-rial row needs a positive rate (422 `VOUCHER_ROW_RATE_REQUIRED`), and a multi-currency voucher balances in rials at each row rate; the journal book and the health check follow the same rule (TD-551, `reg_manual_voucher_foreign_rate_and_rial_balance_td_551`).

### v9.0.189 — Lock Order Behaves the Same Everywhere
- **Lock Order:** `withOrderedLocks` sorts resources by `LOCK_ORDER_MAP` in every environment and refuses a table without a lock level (pass `level` or add the table); `validateLockOrder` refuses an out-of-order declared sequence everywhere. Before, tests threw on input order while production sorted silently, and an unmapped table (`piecework_payrolls`, `crm_leads`, `journal_voucher_items`) was locked last at level 999.

### v9.0.188 — Long Statement Timeout on the Transaction Itself
- **Long Statement Timeout:** `extendStatementTimeout(tx)` (`src/db/drizzle.ts`) sets `statement_timeout` to 5 minutes with `SET LOCAL` on the transaction's own connection; the item Excel import calls it first. The removed `withLongQueryTimeout(fn)` set it on a separate pool connection the callback never used (its queries kept the 1-minute limit) and held that connection idle.

### v9.0.187 — Linux Install Writes the Secrets Key
- **Install Secrets:** `install.sh` runs the new `scripts/ensure-env-secrets.sh`, which adds a random `ERP_SECRETS_KEY` and `ERP_WEBHOOK_SECRET_TOKEN` to `.env` when missing and keeps existing values (run it once on an existing server); `go-live-verify.sh` fails without a 32-character key and `audit-env.sh` requires it. Before, saving a personnel's third-party password answered 503 on a Linux install and `audit-env` failed on the install's own `.env`.

### v9.0.186 — Test Runner Refuses Empty Runs
- **Test Runner:** `scripts/run-tests.ts` exits 1 on an unknown suite (listing the known ones) and when the suite and filter matched no test («No test ran»), and checks `NODE_ENV` before any schema, migration or seed is written. Before, a mistyped suite or test id reported `Passed Tests: 0 / 0 … PASSED`, which voided the «red on the previous version» rule, and a production run wrote 68 tables before it was refused.

### v9.0.185 — Audit Gate Fails When npm audit Fails
- **Audit Gate:** `npm run audit:gate` fails (`auditRunFailure` in `scripts/audit-gate.ts`) when `npm audit` returns an error object or no `vulnerabilities` object, and prints npm's error. Before, `report.vulnerabilities || {}` read the failed run as empty and passed.

### v9.0.184 — Failed Backups Leave No Partial Files
- **Backup Cleanup:** a failed `scripts/backup.sh` run removes the files it wrote (uncompressed dump, manifest, archives; a compressed dump that failed verification is still kept for inspection), retention also deletes stray `.dump` files of earlier failed runs, and `file_attachments` is looked up with `to_regclass` in its own query, so a database before its first migration is backed up instead of failing with `relation "file_attachments" does not exist`.

### v9.0.183 — .env Read Literally by update.sh and go-live-verify.sh
- **Literal .env:** `update.sh` and `scripts/go-live-verify.sh` no longer run `set -a; . ./.env`; they read the keys they need literally (`env_file_value` / `env_val`, surrounding quotes removed), as the service reads the file with `node --env-file`. A password such as `S3cr$et9` used to be cut or stop the script under `set -u`, and a value with `;` or a backtick ran as root.

### v9.0.182 — Zip Update Instruction Matches update.sh
- **Zip Update Documentation:** `deploy/DEPLOY_LINUX.md` §4 gives `sudo bash update.sh --zip <file.zip>` (and `--source <dir>`). It used to say to extract the zip over the app directory and run `update.sh`, which failed after the backup with `fatal: not a git repository`.

### v9.0.181 — Rollback Steps Keep the Branch
- **Rollback Steps:** the rollback and rehearsal hints of `update.sh` reset the branch (`git reset --hard <commit>`) instead of `git checkout <commit>`, which detached HEAD so the next `git pull --ff-only` failed with «You are not currently on a branch».

### v9.0.180 — Attachments Stay Out of Builds and Packages
- **Public Assets:** the client build copies `public/` without `uploads/` (`copyPublicAssets` in `scripts/publicAssets.ts`, a Vite plugin with `copyPublicDir: false`), `.dockerignore` excludes `public/uploads` and `package-source.ps1` drops it from the source package. Before, every build duplicated all attachments into `dist/uploads`, a deleted attachment stayed there, and a local Docker image or source zip carried them.

### v9.0.179 — Role Delete Counts Active Users Only
- **Role Delete Counts Active Users Only:** a role whose only user was deleted can be deleted (TD-535).

### v9.0.178 — Deleted Username Never Revives an Account
- **Deleted Username Never Revives an Account:** a new user always gets a new id; restoring a deleted user is a separate action with a new role and a temporary password (TD-519).

### v9.0.177 — System Admin Named by One Constant
- **System Admin Named by One Constant:** package 2 files and server routes name the system admin only through the shared constant or the admin flag; refactor (TD-896).

### v9.0.176 — Item Price Amount and Currency
- **Item Price Input:** a price is a decimal above zero in IRR, USD, EUR, AED or GBP; removal is explicit (`remove: true`), invalid Excel prices refuse the row and old invalid rows are listed by the health check (TD-657, `reg_item_price_amount_currency_td_657`).

### v9.0.175 — One Active Price per List Under Concurrent Saves
- **Item Price Writes:** price saves go through `ItemPricingService.applyPriceWrites` under the item row lock, so concurrent saves leave one active price per list; old duplicates are listed by the health check (TD-660, `conc_item_price_single_active_td_660`).

### v9.0.174 — Guard Test for Item Delete During a Receipt
- **Item Delete vs Receipt:** a guard test shows that deleting an item while a receipt of it commits waits for the receipt and is refused; the row lock dates from v9.0.40 (TD-661 closed without code change, `conc_item_delete_vs_receipt_td_661`).

### v9.0.173 — Item Numbers Through decimalInput
- **Item Numeric Input:** reorder point, cost, opening stock and weight go through `decimalInput` and are non-negative; text is 400 and Persian digits are read (TD-657 item part, `reg_item_numeric_input_validation_td_657`).

### v9.0.172 — Item Code Counter Moves on Save
- **Item Code Suggestion:** saving an item moves its code series counter in the same transaction, so the next suggested code is free (TD-656, `reg_item_code_peek_after_save_td_656`).

### v9.0.171 — Item Edit Version Lock
- **Item Version Lock:** editing an item needs its current version (400 without, 409 `OCC_CONFLICT` when stale), missing fields keep their values and the edit is audited in its transaction (TD-654, `sec_item_version_lock_td_654`).

### v9.0.170 — Unique Item Code and Name
- **Item Identity:** two active items never share a code (any letter case) or a name; partial unique indexes (migration 0070, only on clean data) turn concurrent duplicates into a Persian 409 and the health check lists old duplicates (TD-653, `conc_item_code_and_name_unique_td_653`).

### v9.0.169 — New Item Opening Voucher Inside Its Transaction
- **Item Opening Voucher:** a new item's opening voucher and audit row are written in the item's create transaction; a voucher failure refuses the item and its opening stock (TD-652, `inv_item_create_opening_voucher_atomic_td_652`).

### v9.0.168 — Build Details of /health Scoped and Real
- **Build Details:** `/health` returns `version` to everyone (`verify-startup.sh` reads it) and `buildInfo` only to the `METRICS_TOKEN` or a live system-admin session (`metricsReaderStatus` in `src/middleware/metricsAuth.ts`). `npm run build` writes `dist/build-info.json` with the commit and build time (`scripts/write-build-info.mjs`; the Docker build takes `--build-arg GIT_COMMIT_SHA`); without it they are `unknown`, never the old fixed `v4-master` and date.

### v9.0.167 — Logger Safe on Circular Values
- **Circular Log Values:** the log sanitizer marks an object already on its path `[Circular]` and cuts nesting deeper than 12 levels (`sanitizeObject` in `src/middleware/logger.ts`). Before, logging a circular object or an error whose `cause` points back threw `RangeError` from inside the caller's `catch`.

### v9.0.166 — HTTP Access Log Kept in Production
- **Access Log:** morgan writes access lines at `info` (`ACCESS_LOG_LEVEL` in `src/middleware/logger.ts`), the production default and the `LOG_LEVEL` written by `install.sh`. At `http` they were below it and production kept no access log.

### v9.0.165 — Pool Readiness and Gauges Read the Real Pool
- **Pool Stats:** `/health/ready` and the `db_pool_*` gauges read the pool exported by `src/db/drizzle.ts` (`dbPoolStats` in `src/middleware/metrics.ts`). drizzle-orm 0.45 exposes no `orm.pool` / `orm.client.pool`, so both always reported 0 and the «pool saturated» 503 never fired.

### v9.0.164 — API Waits for Migrations
- **Startup Gate (owner decision t2):** the port still opens at once, but until migrations, seed and the engines finish every `/api` request except `/api/health/*` and the WooCommerce webhook answers 503 `SYSTEM_STARTING` with `Retry-After: 5` (`src/middleware/startupGate.ts`, turned on only by `server.ts`), and `/health/ready` is 503. The browser shows a waiting page (`SystemStartingOverlay`) and resends the same request (`fetchThroughStartup`). Before, a Linux update served the new code on the old schema until migrations finished.

### v9.0.163 — Closing Without an Opening Voucher Says So
- **Fiscal Closing Opening-Voucher Text (P3):** with «صدور خودکار سند افتتاحیه» unticked, step 4 still said the opening voucher would be issued; step 4, the execution note and the confirm dialog now say none is issued and the next year starts without opening balances (TD-577, Vitest `fiscalOpeningVoucherText.test.tsx`).

### v9.0.162 — Fiscal Years Close in Order
- **Fiscal Year Closing Order (P1):** a year closed while an earlier year with vouchers was open took that year's revenue too, and the earlier year then closed only without an opening voucher, wiping the permanent balances (cash 12,300,000 shown as 2,000,000); a year now closes only after every earlier year with vouchers, the form starts on the oldest open one and out-of-order closings are listed by the health check (TD-544, `reg_fiscal_years_close_in_order_td_544`).

### v9.0.161 — A Fiscal Year Closes After It Ends; the Last Closed Year Reopens
- **Fiscal Year Closing Time and Reopening (P1):** the current year, and even the next one, could be closed, after which no invoice, receipt or voucher dated today was accepted and nothing reopened a year; a year now closes only after its last day, the form lists ended years only, and the last closed year reopens with a reason and the new permission `accounting.fiscal_reopen`, its closing vouchers reversed on their own dates (TD-543, `reg_fiscal_year_close_after_end_and_reopen_td_543`).

### v9.0.160 — A Manual Voucher Is an Opening Voucher, Never a Closing One
- **Manual Closing Vouchers (P2):** the voucher form saved opening balances as type closing and a manual reference «CLOSING-1400» blocked closing 1400; a manual voucher now takes neither the closing type nor a reserved reference, closing reads only `fiscal_periods`, and only the closing run's vouchers are locked until the year is reopened (TD-559, `reg_manual_voucher_cannot_be_closing_td_559`).

### v9.0.159 — Reports of a Closed Year Show Its Real Figures
- **Closed-Year Reports (P1):** after a year was closed, its income statement, balance sheet, trial balance and ratios showed zero because they counted the closing vouchers; the closing run's vouchers are now linked to the year (`source_fiscal_year`, migration 0069) and left out by default, with an «include closing vouchers» box (TD-545, `reg_reports_exclude_year_end_closing_td_545`).

### v9.0.158 — Excel Import Audits Each Item With Before and After
- **Item Excel Audit:** every item the Excel import creates or changes gets an audit row with its fields, stock per warehouse and prices before and after, plus one summary row, inside the import transaction (TD-655, `reg_excel_import_audit_snapshots_td_655`).

### v9.0.157 — Excel Total Stock Column No Longer Adds Phantom Surplus
- **Item Excel Stock:** «موجودی کل» alone changes only an item whose stock is all in the default warehouse, otherwise per-warehouse columns are required and must add up, so an unchanged file no longer doubles stock with a surplus voucher (TD-649, `inv_excel_total_stock_column_no_phantom_surplus_td_649`).

### v9.0.156 — Excel Import Finds Items by Code and Never Changes the Code
- **Item Excel Matching:** the item Excel import finds items by code only, refuses a name already held by another item and never changes an item's code, which is also its WooCommerce SKU (TD-651, `reg_excel_name_match_never_changes_code_td_651`).

### v9.0.155 — A Partial Excel File Leaves Item Fields Unchanged
- **Item Excel Partial Rows:** a missing column or blank cell leaves an existing item's field unchanged and its type comes from the item, so a price-only file no longer resets unit and reorder point or refuses raw materials (TD-650, `reg_excel_partial_row_keeps_fields_td_650`).

### v9.0.154 — Excel Import Follows Price and Stock Permissions
- **Item Excel Permissions:** the item Excel import changes prices only with the price permission, stock only with the warehouse in / out permissions and creates items only with the item creation permission; other parts are reported and skipped (TD-648, `sec_item_import_respects_price_and_stock_permissions_td_648`).

### v9.0.153 — Re-Importing an Unchanged Excel File Keeps the Price History
- **Item Price History:** importing the same Excel file again no longer rewrites unchanged prices, so the price history keeps only real changes, and the history shows when each price was recorded (TD-662, `reg_excel_reimport_keeps_price_history_td_662`).

### v9.0.152 — Excel Prices Come From Configured Price Lists Only
- **Item Excel and Price Lists:** an unchanged Excel round trip no longer turns the cost column into a sale price list, the pricing page quick import ignores stock and cost columns, the invoice price list shows configured price lists only and migration 0068 cleans the three mistaken titles (TD-647, `reg_excel_roundtrip_no_cost_price_list_td_647`).

### v9.0.151 — Package 5 Items and Pricing Audit Documentation
- **Package 5 Audit:** section 7 of the V9 stability audit records the items and pricing package: 18 proven findings (two P1: an unchanged Excel round trip turns the cost column into a sale price list, and Excel import bypasses the price and warehouse permissions) opened as TD-647..TD-664, with the product-owner decisions. Documentation only.

### v9.0.150 — Fiscal-Year Test Cleanup
- **Fiscal-Year Test Cleanup:** the fiscal-year closing test reopens its year so another test posting in that year is not refused (TD-895).

### v9.0.149 — Role Label From the Role Name
- **Role Label From the Role Name:** the top bar and the profile show the stored name of the user's role, the system admin's too (TD-894).

### v9.0.148 — Action Buttons by Permission
- **Action Buttons by Permission:** the customers page, sales file delete and the stock form item button follow the API permission, not the role code (TD-893).

### v9.0.147 — Client Trace IDs Validated
- **Trace IDs:** a client `X-Request-ID` / `X-Correlation-ID` becomes the trace id only when it matches `^[A-Za-z0-9_-]{8,64}$` (`acceptedTraceId` in `src/lib/requestContext.ts`); otherwise a new id is issued, and the error handler never reads the raw header. Before, a 4,000-character id was repeated in the response and every log line.

### v9.0.146 — Metrics Guard Checks the Admin Session Live
- **Metrics Guard:** `/metrics` and `/api/metrics` check a session token live like every other route (`resolveLiveSession` in `src/middleware/auth.ts`, shared with `authenticateToken`): a deleted user or a stale `tokenVersion` gets 401 and the role is read from the database (non-admin 403). `METRICS_TOKEN` scraping is unchanged. Before, a deleted or demoted admin still read the metrics.

### v9.0.145 — Production CSP Frames and Connects Only to Itself
- **Production CSP (owner decision t3):** in production `frame-ancestors` and `connect-src` are `'self'` only, plus the origins listed in the new `FRAME_ANCESTORS` and the existing `EXTERNAL_API_ORIGINS` (`buildCspDirectives` in `src/lib/cspDirectives.ts`); the Google preview hosts and the dev server connections stay allowed outside production. Before, any page on `*.run.app` or `*.googleusercontent.com` could frame the app with the user's `SameSite=None` session (clickjacking), and the browser could connect to every HTTPS origin.

### v9.0.144 — Global Rate Limit Keyed by Client Address
- **Global Rate Limit:** the general limiter (10,000 requests per minute in production) is keyed by the client address only (`req.ip`, honouring `TRUST_PROXY`). It runs before authentication, so the old key, the last 16 characters of an unverified cookie, gave every forged cookie a fresh bucket.

### v9.0.143 — Bounded HTTP Metric Labels
- **Metric Labels (P1):** the HTTP request metrics label a request by its mount prefix and route pattern (`metricsRouteLabel`); a request that matched no route (404, 401 before a router, static files) is counted under `unmatched_api` or `unmatched`. Before, every unknown path, even without login, added series that were never freed (about 10 KB each), so random paths could exhaust the single server process.

### v9.0.142 — Piecework Read Scope
- **Piecework Read Scope:** every personnel's work logs and special rates need a piecework permission; a project reads only its own logs (TD-892).

### v9.0.141 — Item Price Read Scope
- **Item Price Read Scope:** the invoice form reads the sale prices of the chosen item; all prices need the products permission (TD-891).

### v9.0.140 — Document Read Scope
- **Document Read Scope:** the full document list needs a document permission; the stock count page reads only its own documents (TD-890).

### v9.0.139 — Project Pick List for Forms
- **Project Pick List for Forms:** forms of other sections pick projects from a short list; the full project list needs the projects permission (TD-889).

### v9.0.138 — Item Pick List for Forms
- **Item Pick List for Forms:** forms of other sections pick items from a list without the average cost; the full item list needs the products permission (TD-888).

### v9.0.137 — Customer Pick List for Forms
- **Customer Pick List for Forms:** forms of other sections pick parties from a list without notes; the full customer list needs the customers view permission (TD-887).

### v9.0.136 — System Admin Role Ticks Are Fixed
- **System Admin Role Ticks Are Fixed:** the system admin role lists every permission, locked; its permissions cannot be edited (TD-886).

### v9.0.135 — Only the System Admin Role Is Fixed
- **Only the System Admin Role Is Fixed:** former default roles are ordinary roles that the admin edits and deletes (TD-885).

### v9.0.134 — Fresh Install With the System Admin Only
- **Fresh Install With the System Admin Only:** a fresh production install gets its base data at boot and only the system admin role; other roles come from role templates (TD-526).

### v9.0.133 — Seed Inserts Only What Is Missing
- **Seed Inserts Only What Is Missing:** the boot seed no longer restores permissions, categories, settings or account natures an admin changed (TD-591).

### v9.0.132 — Menu From Permissions Only
- **Menu From Permissions Only:** the per-role menu hiding is removed; a role sees exactly the pages its permissions open (TD-884).

### v9.0.131 — One Page-Access Table
- **One Page-Access Table:** menu, page routes, dashboard shortcuts and settings tabs read one table checked against the API guards (TD-668).

### v9.0.130 — Users and Roles Page by Permission
- **Users and Roles Page by Permission:** the page and menu open for user and role managers, and the forms offer only what the user may grant (TD-525).

### v9.0.129 — No Self-Escalation by User and Role Managers
- **No Self-Escalation:** a non-admin user or role manager no longer edits its own role, grants keys it lacks, or takes over an account stronger than its own (TD-520).

### v9.0.128 — Workflow Steps by Permission and Exact Role
- **Workflow Steps by Permission and Exact Role:** a step role matches only that role and the system admin and who signs is the step's required permission; designs keep only defined roles and catalog keys, and migration 0065 lists the steps another role used to sign (TD-542).

### v9.0.127 — Notification Recipients by Permission
- **Notification Recipients:** event-rule notifications and the won-lead notice go to the holders of a catalog permission instead of fixed role codes; the rule editor picks the permission from the catalog (TD-883).

### v9.0.126 — Personnel Bank Details by Permission
- **Personnel Bank Details:** unmasked card, Sheba and account numbers of personnel and payslips need a catalog permission; the role code manager and «*» no longer open them, and migration 0064 grants the keys to the roles that saw them before (TD-882).

### v9.0.125 — Document Permissions by Type
- **Document Permissions:** a document is recorded and finalized with the permission of its type and status, never the role code; the new documents.finalize finalizes sales documents, and migration 0063 grants it to the roles that finalized before (TD-541, TD-771).

### v9.0.124 — Update Checks Startup on the Configured Port
- **Update Port:** `update.sh` waits for `/health/startup` on `PORT` from `.env` (written by `install.sh`, read by the server; an `APP_PORT` environment variable still wins, default 3000). Before, a server installed on another port reported "Update NOT completed" after a good update and was offered a backup restore. `setup-domain.sh` reads the port the same way (not covered by a test: it needs root, apt and certbot).

### v9.0.123 — Failed Build During Update Keeps the Previous Build
- **Update Build Failure:** `update.sh` keeps a copy of `dist/` before `npm run build` and puts it back when the build fails, then stops without restarting the service. From the moment the source changes, any failure prints the rollback steps once (an `EXIT` trap), and the backup step warns that restoring it erases every change made after it, so it is only for a version that has accepted no writes. Before, a failed build left `dist/server.cjs` missing and printed no rollback steps.

### v9.0.122 — Private Backup Files
- **Private Backups:** `scripts/backup.sh` writes under `umask 077` and makes the backup directory `0700`, so the dump, manifest and uploads archive are `0600` whatever the caller's umask; `scripts/go-live-verify.sh` fails a backup directory or any backup file other users can read (older backups are listed there to `chmod` by hand). Before, every local user could read payslips and attachments from the backups.

### v9.0.121 — Test Data Cleanup Guarded and Marker-Only
- **Test Data Cleanup (P1):** `npm run db:cleanup-test` runs only with `NODE_ENV` set to `test` or `development` and `ERP_ALLOW_TEST_CLEANUP=1` (checked before connecting), previews by default inside a rolled-back transaction and deletes only with `--force`, and then only `ERP-TEST-MARKER` rows that nothing else refers to. Kardex, treasury, users, audit logs, counters and sequences are never touched. Before, it deleted real payslips, reversal vouchers, items and users on a production database.

### v9.0.120 — Package 1 Data Infrastructure and Deployment Documentation
- **Stability Audit, Package 1 (Data Infrastructure, Startup, Deployment and Tooling):** `docs/audit/STABILITY_AUDIT_V9.md` gets the package 1 section with the owner decisions t1 to t9 (t9: all terminal output in English); its proven findings are registered as open rows TD-581 to TD-625 (TD-583 unused, B01-03 was fixed as TD-472; TD-591 and TD-594 are opened by package 2 M5 and package 16). Two P1: the test-data cleanup script deletes real data without an environment guard, and unknown paths grow the `/metrics` label set without bound. Documentation only; no behaviour change.

### v9.0.119 — Financial Ratios Show No Made-Up Score Before Data
- **Ratios Score (P3):** before any data arrived, or after an error, the ratios page showed a health score of 75 out of 100 and «critical» statuses; it now shows no score, status or value until the server answers (TD-575, `financialRatiosNoScore.test.tsx`).

### v9.0.118 — Account Card Prints the Opening Row Once and Names the Account
- **Account Card View (P3):** the account card printed the «opening balance» row twice (its own and the server's) and its title lacked the account name; the card now shares one contract with the server, prints the opening row once and names the account (TD-574, `ledgerViewOpeningRow.test.tsx`).

### v9.0.117 — Group and General Account Cards Roll Up Their Sub-Accounts
- **Account Card Roll-Up (P2):** clicking a group or general row of the trial balance opened an empty account card with a zero balance, because the card read only that account's own rows; the card of a group or general account now carries the rows and balances of all its sub-accounts (TD-570, `reg_account_card_rolls_up_sub_accounts_td_570`).

### v9.0.116 — Balance Sheet and Ratios Take a Date, the Income Statement Its Own Period
- **Statement Dates (P2):** the balance sheet and the financial ratios were always as of today and the income statement silently took the trial balance dates; each statement now has its own date fields in its header and shows its date or period (TD-566, `financialStatementDates.test.tsx`).

### v9.0.115 — The Voucher List Pages Through Every Voucher
- **Voucher List (P1):** the accounting voucher list loaded only the newest 20 vouchers and ran its counters, search, filters and batch approval on those 20; page, search and filters now run on the server, which also returns each status count (TD-565, `reg_voucher_list_paging_and_status_counts_td_565`, `voucherListServerPaging.test.tsx`).

### v9.0.114 — Income Statement and Balance Sheet Show the Server Figures
- **Financial Statements (P1):** the income statement showed a revenue total of 0, a 0% margin and no expense rows, and the balance sheet showed no asset, liability or period-profit rows, because the views read keys the server never sends; both now share one contract with the server (TD-563, `financialStatementsView.test.tsx`).

### v9.0.113 — Package 3 Accounting and Money Core Audit Documentation
- **Stability Audit, Package 3 (Accounting and Money Core):** `docs/audit/STABILITY_AUDIT_V9.md` gets the accounting section; its 38 proven findings are registered as open rows TD-543 to TD-580 (nine P1: closing the running or next year and closing years out of order, statements of a closed year showing zero, deleting an account that has postings, ledger reports open to document and customer viewers, the party ledger matching any id or a contained name, the income statement and balance sheet reading keys the server never sends, the manual voucher form dropping the row currency, and the voucher list showing only the newest 20). Documentation only; no behaviour change.

### v9.0.112 — Warehouse Deactivation Lock and Reactivation
- **Warehouse deactivation:** it waits for in-flight movements and refuses a warehouse that got stock, the last active warehouse stays active, and the system admin can reactivate an inactive warehouse (TD-490, `reg_warehouse_deactivation_td_490`).

### v9.0.111 — Inventory Layer in the System Reconciliation Scan
- **System reconciliation scan:** the inventory layer check warns when the stock integrity report finds discrepancies or negative Kardex balances instead of always reporting healthy (TD-495, `reg_system_inventory_check_td_495`).

### v9.0.110 — Reserved Warehouse Code
- **Warehouse code `default`:** a new warehouse can no longer take a code the Kardex reads as the default warehouse, a void reversal writes the real default code, and a legacy one is listed by the health check (TD-482, `reg_warehouse_reserved_code_td_482`).

### v9.0.109 — Merge-Time Renumbering Tool for Parallel Lanes
- **Release Renumbering:** `npm run release:renumber -- origin/master` (`scripts/release-renumber.ts`) merges the base without committing, resolves the conflicts of the release files, moves the branch's own versions, migrations (file, journal idx, tag and a later `when`) and audit report sections after those of the base, rewrites only lines the branch added, sorts the active changelog, sets the four version locations, recounts TECH_DEBT.md and runs `check:version` and the migration plan test (TD-473, `releaseRenumber.test.ts`).

### v9.0.108 — Treasury Running Balance After a Void
- **Treasury Running Balance After a Void (P3, product-owner decision):** the treasury list's running balance counts a voided row on its date and its reversal on the void date, and no legacy cheque-method row, so the last row equals the bank balance. Before, after voiding a receipt of 250,000 every later row showed 250,000 less (TD-860, `reg_treasury_running_balance_void_td_860`).

### v9.0.107 — Route Guards Ask Permissions Only
- **Route Guards:** no route guard takes a role code any more; system maintenance is for the system admin only, warehouses and the fiscal-year close get their own permissions, and migration 0062 turns access seed roles had only by their code into logged ticks (TD-516).

### v9.0.106 — Treasury Forms and Export
- **Treasury Forms and Export (P3):** a receipt or payment for an account without a ledger account is stopped in the form, treasury and cheque dates use the Jalali date input, and the treasury Excel export has Persian labels and a Jalali file date. Before, the form promised a voucherless save the server refused, and the date field showed «2026/10/07» in the Jalali calendar (TD-515, Vitest `treasuryFormWording.test.tsx`).

### v9.0.105 — Cheque History and Status Wording
- **Cheque History and Status Wording (P3):** the cheque history window shows the stored step notes, messages name statuses in Persian, and the status filter offers «در خزانه / صندوق». Before, notes never showed and messages said «bounced» / «passed» (TD-513, `reg_cheque_status_messages_persian_td_513`).

### v9.0.104 — Cheque Audit Before and After
- **Cheque Audit Before and After (P3):** a cheque status change or delete records the previous and new status in Persian, the bank account and the vouchers it issued or voided. Before, the audit held only `{"status":"in_collection"}` or `{"chequeId":6}` (TD-512, `reg_cheque_audit_before_after_td_512`).

### v9.0.103 — Bank Reconciliation Rows
- **Bank Reconciliation Rows (P3):** reconciling a row of another bank or a voided row is refused with the list, only changed rows are written and audited, and the reconciliation time is the server UTC time. Before, three ids (bank A, bank B, voided) gave `{"updated": 2}` and the voided row was reconciled (TD-511, `reg_treasury_reconcile_rows_td_511`).

### v9.0.102 — Paged Treasury List
- **Paged Treasury List (P2):** bank balances are summed in SQL and the treasury page reads one server page with its total and running balance. Before, every request read all approved ledger rows (200,000 rows, 1,639 ms for 15 banks) and the page loaded all 20,000 transactions (15.88 MB) (TD-509, `reg_treasury_list_paging_and_bank_balances_td_509`).

### v9.0.101 — Treasury Amount Input
- **Treasury Amount Input (P3):** treasury, transfer and cheque amounts, opening balances and exchange rates accept Persian digits and thousands separators, text gets a Persian message, and the currency must be a supported one. Before, «۲۵۰۰۰۰۰» and «2,500,000» were refused with an English NaN message (TD-514, `reg_treasury_decimal_inputs_td_514`).

### v9.0.100 — Bank Ledger and Cheque Bank Links
- **Bank Ledger and Cheque Bank Links (P3):** a bank account links only to an active subsidiary account under cash and bank (general 10), and a cheque only to an active bank account. Before, a bank on a missing account or on trade receivables 1201 and a cheque on a missing bank were saved (TD-510, `reg_bank_ledger_and_cheque_bank_td_510`).

### v9.0.99 — Bank Account Currency
- **Bank Account Currency (P2):** the bank account form takes a currency (rial, dollar, euro, dirham, pound) and the currency is fixed after the account's first transaction, cheque or opening balance. Before, a currency edit returned success and was silently ignored, so a foreign account could be made only through the API (TD-508, `reg_bank_account_currency_td_508`).

### v9.0.98 — Cheque and Treasury Dates
- **Cheque and Treasury Dates (P2):** a cheque issue or action date after today and a non-existent day such as 1404/12/30 in a receipt, payment, transfer or cheque action are refused; the cheque status form sends the action date. Before, 1404/12/30 was posted on 1 Farvardin 1405 in the next fiscal year (TD-506, TD-669, `reg_cheque_and_treasury_dates_td_506`).

### v9.0.97 — Bank Pick List for Forms
- **Bank Account Readers (P2):** forms that only pick a bank account read a pick list without account, card or Sheba numbers or balances; the full list goes only to treasury readers. Before, warehouse and document users read every number and balance (TD-505, `reg_bank_account_options_td_505`).
### v9.0.96 — Warehouse UI Wording, Export Names and Warehouse Chart
- **Warehouse UI:** decided Persian terms, Persian digits and surplus/shortage labels on the count sheet, Persian export file names with a failure message, and a warehouse chart that counts items instead of adding units (TD-496, `reg_warehouse_item_count_td_496`).

### v9.0.95 — Deleted Transfer Codes Are Gone and Can Be Saved Again
- **Transfer Codes:** a deleted design answers 404, saving its code again revives it instead of a 409, and the page lists every code (TD-493, `reg_transfer_code_lifecycle_td_493`).

### v9.0.94 — Stock Movement Chart Counts the Kardex Ledger
- **Stock Movement Chart:** transfers between warehouses, voided documents and rows dated after the current month no longer enter the in/out chart (TD-492, `reg_movement_trend_ledger_td_492`).

### v9.0.93 — Item Opening Voucher From Opening Kardex Rows
- **Item Opening Voucher:** the opening voucher is worth the item's opening Kardex rows with or without the item workflow, no Kardex row is repriced, and mismatched opening vouchers are listed by the health check (TD-481, `reg_item_opening_voucher_value_td_481`).

### v9.0.92 — Initial Kardex Backfill Never Reprices Its Rows
- **Kardex Backfill:** a second run of the initial Kardex backfill no longer reprices its earlier zero-cost rows with the WAC of the day, so the Kardex replay keeps the live WAC (TD-488, `reg_kardex_backfill_no_rewrite_td_488`).

### v9.0.91 — Kardex Rebuild Writes Only for Changed Items
- **Kardex Rebuild:** an item whose warehouse stock already matches its Kardex gets no version bump, outbox event or audit row; only changed items do (TD-491, `reg_kardex_rebuild_quiet_td_491`).

### v9.0.90 — Kardex Rebuild Keeps WAC; WAC Correction Posts a Voucher
- **Kardex Rebuild and WAC Correction:** the rebuild only rebuilds quantities and lists items whose WAC differs from the Kardex; correcting the WAC is a separate action with its own permission that issues a draft voucher for the value difference against 7012 (TD-487, `reg_kardex_wac_correction_td_487`).

### v9.0.89 — Inventory Integrity Table Reads the Server Report
- **Inventory Integrity Tab:** the table and Excel export read the report the server sends (one shared type), so discrepant items are listed and exported instead of an always-empty table (TD-485, Vitest `inventoryIntegrityReport.test.tsx`).

### v9.0.88 — Integrity Report WAC Uses the Kardex Replay
- **Inventory Integrity Report:** the WAC check compares the live WAC with the same Kardex replay the rebuild and invariant I13 use, so an item that ran out and was bought again at another price is no longer reported as mismatched (TD-486, `reg_integrity_report_replay_wac_td_486`).

### v9.0.87 — One Permission Check and Permission Ratchets
- **Permission Check:** `can()` and `requirePermission` ask catalog permission keys only (an unknown key or a role code fails when the router is built); `npm run ratchet:permissions` keeps role-code literals and stray permission keys from growing (TD-881).

### v9.0.86 — Role Permissions Carry Their Requirements
- **Permission Dependencies:** the permission catalog is one shared file where every action requires its section's view; saving a role adds the missing requirements and the role form ticks them (TD-880).

### v9.0.85 — Spent Cheques Need a Supplier
- **Spent Cheque Supplier (P1):** spending a cheque needs a supplier picked from the list and posts to that supplier's detail; before, the form sent only a typed name and the voucher missed the supplier's account card (TD-498, `reg_cheque_spent_needs_supplier_td_498`).

### v9.0.84 — Cheque Vouchers Follow the Party Type
- **Cheque Party Account (P1):** a cheque voucher posts to the account and detail of its party type (personnel by purpose, misc to a chosen account) and its bounce and return follow it; before, a personnel cheque landed on the customer with the same id (TD-497, `reg_cheque_voucher_follows_party_type_td_497`).

### v9.0.83 — Treasury Links Are Checked
- **Treasury Links (P2):** a receipt or payment is refused when its document is missing, voided, of the other direction or of another party, or its party id is not in the table of its type; before, a receipt from one customer settled another customer's invoice (TD-501, `reg_treasury_document_and_party_links_td_501`).

### v9.0.82 — Misc Receipts and Payments Take a Chosen Account
- **Misc Counter Account (P2):** a misc receipt or payment and a personnel «other» payment post to the counter account the user chooses, and a personnel payment requires its purpose; before, they went to trade receivables and wages payable (TD-507, `reg_treasury_misc_contra_account_td_507`).
### v9.0.81 — Clear Errors for Transfers and Kardex Rebuild
- **Inventory Errors:** a transfer accepts a warehouse code or name in any case, and transfer and Kardex rebuild errors answer 422 or 404 with Persian messages instead of 500; the running Kardex of a missing item is 404 (TD-494, `reg_inventory_business_errors_td_494`).

### v9.0.80 — Warehouse Transfers Are Documents
- **Transfer Document:** every warehouse transfer is a numbered «حواله انتقال» document with its lines and linked Kardex rows, listed with source and destination, printable and voidable without changing WAC (TD-489, `reg_warehouse_transfer_document_td_489`).

### v9.0.79 — No Future-Dated Stock Movements
- **Future Stock Dates:** a stock movement dated after the business today is refused for every user, a transfer date is normalized (Jalali accepted, text 422), and earlier future-dated Kardex rows are listed by the financial health check (TD-483, `reg_stock_movement_future_date_td_483`).

### v9.0.78 — Persian Validation Messages
- **Validation Messages:** every 400 validation message is a Persian sentence naming the field and what to change, with Persian digits; schema-written messages are kept (TD-529, `persianValidationMessages.test.ts`).

### v9.0.77 — Login and Logout Only From the Application Itself
- **Session Endpoints:** login, logout and setup accept only the application's own origin, and logout of a valid session needs its CSRF header, so a forged form on another site can no longer log a user out or into another account (TD-528, `sec_session_endpoints_same_origin_td_528`).

### v9.0.76 — Test-Prefixed Usernames Are Refused and Listed
- **Synthetic Usernames:** `POST /users` and `/setup` refuse usernames starting with `test_`, `e2e_` or `testuser_` (422); user lists show every active user and the financial health check lists existing ones (TD-521, `sec_synthetic_username_refused_td_521`).

### v9.0.75 — Last System Admin Keeps the Admin Role
- **Last Admin:** editing a user can no longer move the last active system admin out of the admin role (409); edits and deletes of users run under one admin-set lock, so two concurrent changes cannot both remove an admin (TD-524, `sec_last_admin_role_change_td_524`).

### v9.0.74 — Session End Clears the Browser Cache
- **Session Cache:** logout and a 401 clear the React Query cache, so the next user of the same browser never sees the previous user's cached data (TD-518, `sessionCacheClear.test.tsx`).

### v9.0.73 — New-User Form Preselects No Role
- **New-User Role:** the new-user form opens with an empty «choose a role» option and sends nothing until a role is picked; the system admin is listed last with a full-access warning (TD-517, `userFormRole.test.tsx`).

### v9.0.72 — Package 2 Access and Audit Log Documentation
- **Stability Audit, Package 2 (Authentication, Access and Audit Log):** `docs/audit/STABILITY_AUDIT_V9.md` gets the package 2 section with the approved permission model; its 27 proven findings are registered as open rows TD-516 to TD-542 (four P1: role codes in route guards, the new-user form preselecting the system admin, the browser cache surviving logout, and a deleted username reviving the old account). Documentation only; no behaviour change.

### v9.0.71 — Opening Balance Edit Waits for Approval
- **Opening Balance Approval (P2):** editing the opening balance of a treasury account whose approval workflow is still open is refused with 409; before, the edit issued the opening voucher at once, bypassing the approval (TD-504, `reg_opening_balance_edit_refused_while_approval_pending_td_504`).

### v9.0.70 — Deleting a Bank Account Voids Its Opening Voucher
- **Bank Account Delete (P2):** deleting a treasury account now voids its opening and opening-adjustment vouchers in the same transaction (draft removed, approved reversed) and is refused with 409 when one is permanent; before, the opening voucher stayed and the bank ledger kept a balance no account explained (TD-503, `reg_bank_delete_voids_opening_voucher_td_503`).

### v9.0.69 — Cheques With a Permanent Voucher Are Not Deleted
- **Cheque Delete (P2):** deleting a cheque whose voucher is permanent is refused with 409 naming the voucher; before, the cheque was deleted and the permanent voucher stayed in the ledger with no cheque behind it. The cheque menu no longer offers status change or delete in a terminal status (TD-502, `reg_cheque_with_permanent_voucher_not_deleted_td_502`, Vitest `chequeTerminalActions.test.tsx`).

### v9.0.68 — Invoice Settlement After a Voided Receipt
- **Invoice Settlement (P1):** an invoice whose receipt was voided and then received again now shows the new receipt as paid; before, the void was subtracted twice and the invoice stayed «unpaid» while the customer's ledger was settled (TD-500, `reg_invoice_settled_after_void_and_rereceipt_td_500`).

### v9.0.67 — Treasury Reversal Rows Can No Longer Be Voided
- **Treasury Void (P0):** voiding the reversal row of a voided receipt or payment is refused with 409 and the button is gone; before, it put the money back in the bank with no voucher and without the no-voucher permission. Legacy revived rows are listed by the financial health check, and new bank invariants I15/I16 compare each bank with its ledger (TD-499, `reg_treasury_reversal_void_refused_td_499`, `inv_td_499_bank_invariants_hold`).

### v9.0.66 — Package 4 Treasury and Cheques Audit Documentation
- **Stability Audit, Package 4 (Treasury and Cheques):** `docs/audit/STABILITY_AUDIT_V9.md` gets the treasury section; its 19 proven findings are registered as open rows TD-497 to TD-515 (one P0: voiding the reversal row of a voided receipt put the money back in the bank with no voucher). Documentation only; no behaviour change.

### v9.0.65 — Workflow UI and Messages Fully Persian
- **Workflow Wording:** workflow UI and messages follow the owner glossary (decision t10), with Persian role and entity names and digits; `WF_*` codes go only into the error `code` field (TD-470, Vitest `workflowWording.test.ts`, `sec_workflow_error_code_td_470`).

### v9.0.64 — Workflow Approvals Refresh Domain Lists
- **Workflow Cache Refresh:** an approval invalidates documents, procurement, accounting and inventory queries, and design and position saves refetch the definition detail (TD-469, Vitest `workflowQueryInvalidation.test.tsx`).

### v9.0.63 — Workflow Times in UTC, Delegations Cover Whole Days
- **Workflow Timestamps and Delegation Days:** workflow API responses send server timestamps with `Z` (`withUtcTimestamps`), and a day-only delegation covers whole business days (TD-468, `sec_workflow_utc_timestamps_td_468`).

### v9.0.62 — Delegation Scope Is All or a Defined Workflow
- **Delegation Scope:** a delegation scope is `ALL` / `*` or a defined workflow code, else 422; the form offers only these (TD-467, decision t6, `sec_workflow_delegation_scope_td_467`).

### v9.0.61 — Workflow Stepper Shows the Rial Amount
- **Stepper Amount Currency:** the workflow stepper shows the context amount in IRR and a foreign document's own amount beside it (TD-466, Vitest `WorkflowStepperWidget.test.tsx`).

### v9.0.60 — Inbox Card Shows Amount, Delegation, Step and Starter
- **Inbox Card Fields:** inbox rows carry `currentStepTitle` from the instance snapshot, `instance.startedByName` and a numeric IRR `amount`; the card reads them and `delegationInfo` (TD-465, `sec_workflow_inbox_card_fields_td_465`).

### v9.0.59 — Inbox Ignores Late Responses of Another Task
- **Task Preview Belongs to Its Task:** the inbox reads the task's document or requisition through `useApprovalTaskEntity`, aborting the previous request and ignoring late responses (TD-464, Vitest `approvalInboxPage.test.tsx`).

### v9.0.58 — Inbox Chooses Among Several Reject Actions
- **Reject Choice in the Inbox:** inbox rows carry the reject actions of the current step and the task modal sends the chosen `transitionId` when there are several (TD-463, `sec_workflow_inbox_reject_choice_td_463`).

### v9.0.57 — Inbox Clears a Cancelled Decision
- **Approval Inbox Decision Reset:** closing the task modal or opening another task resets the decision, comment and chosen reject action (TD-462, Vitest `approvalInboxPage.test.tsx`).

### v9.0.56 — Changing the Stock-Count Warehouse Clears the Counts
- **Stock-Count Warehouse Change:** switching the warehouse after entering counts asks first and clears the counts on confirmation, so counts of one warehouse are never posted for another (TD-484, Vitest `stockCountSheet.test.tsx`).

### v9.0.55 — The Stock-Count Sheet Reads the Real Book Stock
- **Stock-Count Sheet:** the sheet selects warehouses by code and reads each item's book stock of that warehouse (code or name accepted, unknown 422), so «copy + submit» can no longer zero a warehouse; a count whose shown book stock changed before posting is refused with 409 and the sheet reloads (TD-480, `reg_stock_count_sheet_book_stock_td_480`).

### v9.0.54 — Package 6 Inventory and Kardex Audit Documentation
- **Stability Audit, Package 6 (Inventory and Kardex):** `docs/audit/STABILITY_AUDIT_V9.md` gets the inventory section; its 17 proven findings are registered as open rows TD-480 to TD-496 (one P0: the stock-count sheet can zero the whole stock of a warehouse). Documentation only; no behaviour change.

### v9.0.53 — node_modules No Longer Tracked by Git
- **Deployment:** the `node_modules` symlink committed in v9.0.25 is removed, `.gitignore` uses `/node_modules` (also matches a symlink), and `update.sh` untracks a leftover symlink entry before `git pull`; servers on v9.0.25+ run `git rm -q --cached node_modules` once before updating (TD-472, B01-03, `node_modules_never_tracked_td_472`).

### v9.0.52 — CI Actions on Node 24 and a Pinned Ubuntu Runner
- **CI Maintenance:** `actions/checkout`, `actions/setup-node` and `actions/upload-artifact` move from v4 (Node 20) to v7 (Node 24) and every job runs on `ubuntu-24.04` instead of the moving `ubuntu-latest` label (TD-471, `ci_actions_node24_runner_pinned_td_471`).

### v9.0.51 — Workflow Tables Get Foreign Keys and Indexes
- **Workflow Referential Integrity:** migration 0059 adds foreign keys between the workflow tables (NOT VALID, validated only on clean data; instance children cascade), the instance-by-entity and by-instance indexes and a unique definition version; the health check lists gaps as `workflow_reference_integrity` (TD-461, `sec_workflow_db_constraints_td_461`).

### v9.0.50 — Workflow Write Routes Validate Their Bodies
- **Workflow Route Bodies:** `/transition`, `/definitions`, `/positions` and `/delegations` validate their bodies with Zod (400, Persian); `/positions` needs the definition id and moves only that definition's steps in one transaction with an audit row (TD-459, `sec_workflow_route_bodies_td_459`).

### v9.0.49 — SLA Analytics Read Each Instance's Own Snapshot
- **SLA Analytics from the Snapshot:** a running instance's step title and SLA come from its own definition snapshot and it is counted under the current step with the same key, so re-saving a design no longer marks it unknown and overdue (TD-457, `sec_workflow_sla_from_snapshot_td_457`).

### v9.0.48 — Invalid Workflow Rules Are Refused and Fail Closed
- **Workflow Rule Validation:** a transition rule is validated on save (422), and a stored node that is neither a rule nor a group evaluates closed with a Persian reason; an empty expression still means no condition (TD-456, `sec_workflow_rule_validation_td_456`).

### v9.0.47 — Designer Saves Keep the Step Order
- **Workflow Step Order:** saving a design keeps each step's `stepOrder` (a missing one takes the step's list position) and the designer reads, assigns and edits it (TD-454, `sec_workflow_step_order_td_454`).

### v9.0.46 — Default Workflows Are Seeded Only When Missing, at Startup
- **Workflow Seed:** default definitions are created only when their code is missing and only at startup; listing definitions, starting an instance and creating a requisition no longer seed, and the manual sync route is removed (TD-453, `sec_workflow_seed_keeps_edited_definition_td_453`).

### v9.0.45 — Workflow Designs Are Validated Before Saving
- **Workflow Design Validation:** a definition is saved only with exactly one initial step, at least one terminal step, unique keys and resolvable actions, no exit from a terminal step except `rejected` (422 otherwise); renaming a step key in the designer keeps its actions (TD-452, `sec_workflow_design_validation_td_452`).

### v9.0.44 — Roleless Step Reminders Only to Workflow Approvers
- **SLA Reminder Recipients:** a roleless (`ALL`) task's due reminder goes only to admins and holders of `workflow.approve` / `workflow.execute` (plus their active delegates) (TD-460, `sec_workflow_sla_reminder_recipients_td_460`).

### v9.0.43 — Workflow SLA Analytics No Longer Fails
- **SLA Analytics Route:** every `WorkflowEngineService` facade method is bound to its own class, so `GET /workflow/analytics/sla` answers instead of a 500 (TD-450, `sec_workflow_sla_analytics_route_td_450`).

### v9.0.42 — Instances View Removed From the Approval Inbox
- **Instances View Removed:** `GET /workflow/inbox` and the inbox «instances» view are removed; the approval inbox has only the tasks view (TD-449, `sec_workflow_instances_inbox_removed_td_449`).

### v9.0.41 — Approval Inbox Tabs Show Their Own Tasks
- **Inbox Tabs:** `GET /workflow/tasks/my-tasks` serves pending, overdue (`due_at < now()` in SQL), delegated and completed (the user's own actions from history, paginated in SQL); `/tasks/stats` counts each with the same rule; status, page and limit are validated (TD-448, `sec_workflow_inbox_tabs_td_448`).

### v9.0.40 — Voiding or Deleting an Entity Closes Its Workflow
- **Workflow Closes on Void:** voiding a document or deleting a draft voucher, item, bank account or purchase requisition terminates its running workflow in the same transaction (tasks canceled, one history row); migration 0058 closes the open workflows of entities deleted earlier (TD-447, `sec_workflow_void_closes_instance_td_447`).

### v9.0.39 — Only Unfinalized Sales Documents Enter the Approval Workflow
- **Document Approval Scope:** only an invoice or proforma in draft or proforma status starts the approval workflow, in its own create transaction; finalizing outside the workflow and migration 0057 close the open instances of final documents (TD-446, `sec_workflow_document_auto_start_td_446`).

### v9.0.38 — Workflow Widget Requires the Entity's Read Permission
- **Workflow Widget Read Scope:** `GET /workflow/instance/:entityType/:entityId` also requires the entity's own read permission (document, journal voucher, item, bank account, purchase requisition), else 403 (TD-458, `sec_workflow_instance_entity_read_td_458`).

### v9.0.37 — One Open Workflow Instance per Entity
- **Single Open Instance:** `startInstance` serializes starts on an entity with a transaction advisory lock and the partial unique index `uq_workflow_instances_open_entity` (migration 0056, created only on clean data) backs it; duplicates are listed by the financial health check (TD-455, `sec_workflow_single_open_instance_td_455`).

### v9.0.36 — Workflow Start Failures Are Not Swallowed
- **Workflow Start Failures (P1):** `maybeStartWorkflow` returns null only when no active definition exists and otherwise throws, so a broken active definition rejects the bank account or item instead of issuing its opening voucher without approval; item creation and its workflow start share one transaction (TD-451, `sec_workflow_start_failure_td_451`).

### v9.0.35 — Document Workflow Steps Guarded by Permissions
- **Document Workflow Permissions (P1):** the default document workflow's warehouse and accounting steps require `warehouse.out` / `accounting.vouchers` (direct approval `workflow.admin`), an untouched installed definition is upgraded, and a step that runs a domain action requires the entity's own permission from the signer (TD-445, `sec_workflow_document_steps_permission_td_445`).

### v9.0.34 — Workflow Signer Permissions From the Role
- **Workflow Signer Permissions (P1):** the engine reads the signer's role permissions itself, so the department posting-permission rule (TD-374) works and the inbox, its counts and task execution follow the same rule as the document widget; `workflow.manage` / `workflow.admin` no longer sign other roles' steps (TD-444, `sec_workflow_signer_permissions_td_444`).

### v9.0.33 — Workflow Start Scoped to the Definition's Entity Type
- **Workflow Start Scope (P0):** `POST /workflow/start` and `startInstance` accept only an active definition whose entity type is the entity's own, on an existing entity; a mismatched instance created earlier no longer advances or shows in the document widget (TD-443, `sec_workflow_start_entity_scope_td_443`).

### v9.0.32 — Package 14 Workflow Audit Documentation
- **Stability Audit, Package 14 (Workflow and Approvals):** `docs/audit/STABILITY_AUDIT_V9.md` gets the workflow section; its 28 proven findings are registered as open rows TD-443 to TD-470 (one P0: starting any workflow on any entity approves a journal voucher without permission). Documentation only; no behaviour change.

### v9.0.31 — Persian Wording in the Personnel UI
- **Personnel Wording:** The personnel pages no longer show «(Update Existing)», «(IBAN)», «اکانت» or «کلیپ‌بورد»; a Vitest check keeps English words out of the Persian personnel UI (TD-440, `personnelWording.test.ts`).

### v9.0.30 — Personnel Edit Optimistic Lock
- **Personnel Edit Lock:** Saving a personnel form opened before someone else's save is refused with a conflict message instead of silently erasing the other change (owner decision D5; TD-442, `reg_personnel_edit_occ_td_442`).

### v9.0.29 — Personnel With Open Business Is Not Deleted
- **Personnel Delete Guard:** A personnel with an unsettled payroll, a work log without a payroll, an account balance or a draft voucher is no longer deleted; the refusal lists the reasons and suggests «قطع همکاری» (owner decision D4; TD-441, `reg_personnel_delete_guard_td_441`).

### v9.0.28 — Unique Personnel Code
- **Personnel Code:** A personnel code is unique among active personnel regardless of letter case and surrounding spaces, now also under concurrent saves (partial unique index, migration 0054); old duplicates are listed by the financial health check (owner decision D6; TD-439, `reg_personnel_code_unique_td_439`).

### v9.0.27 — Personnel Monthly Salary Validated
- **Personnel Salary:** The monthly salary on the personnel form now rejects text and negative values instead of saving 0 or a negative salary; Persian digits and thousands separators are accepted (TD-438, `reg_personnel_salary_decimal_input_td_438`).

### v9.0.26 — Personnel Audit Rows Carry Before and After
- **Personnel Audit:** Creating, editing, deleting and importing personnel now records the changed values (before/after) and the user's IP in the activity log, one row per person; the Nobitex password is never logged (TD-437, `reg_personnel_audit_snapshot_td_437`).

### v9.0.25 — Personnel Excel Import Keeps Empty Cells
- **Personnel Excel Import:** With «به‌روزرسانی», an empty gender, employment-status or nationality cell no longer resets an existing employee to «مرد», «فعال» and «ایرانی»; defaults apply only to new personnel (owner decision D3; TD-436, `reg_personnel_import_keeps_status_td_436`).

### v9.0.24 — One Active Personnel per User
- **Personnel User Link:** A system user is linked to at most one active personnel and only when the user exists; a second link is refused under the user's row lock and by the partial unique index of migration 0053, so «فیش‌های من» never shows another employee's payslip; legacy duplicates are only listed by the health check (owner decision D2; TD-435, `sec_personnel_user_link_unique_td_435`).

### v9.0.23 — Personnel List Field Scope
- **Personnel Field Scope:** The personnel list and detail give pick-list readers (projects, CRM, accounting, warehouse, piecework) only names, code, job title and status; the dossier needs `personnel.view` / `personnel.manage`, the salary the payroll-amount permissions, and the Nobitex password appears only in the detail (owner decision D1; TD-434, `sec_personnel_field_scope_td_434`).

### v9.0.22 — Package 12 Personnel Audit Documentation
- **Stability Audit, Package 12 (Personnel):** `docs/audit/STABILITY_AUDIT_V9.md` gets the personnel section; its 7 proven findings are registered as open rows TD-434 to TD-440 (two P1 salary-data leaks). Documentation only; no behaviour change.

### v9.0.21 — Party Bank Details Scope
- **Party Bank Details Scope:** A party's bank details reach only admins and holders of `customers.view`, `customers.manage` or an `accounting.*` permission; the customer list, its export and «تبدیل به مشتری» drop them for other readers (owner decision ت۶; TD-433, `sec_party_bank_info_scope_td_433`).

### v9.0.20 — CRM Wording in the Persian UI
- **CRM Wording:** Persian UI text says «ارتباط با مشتری» instead of «CRM», and package-9 text uses «پیگیری»، «پرونده فروش» and «اشاره» instead of transliterations (owner decision ت۷; TD-432, Vitest `crmWording.test.ts`).

### v9.0.19 — CRM Follow-up Explicit Actions
- **CRM Follow-up Actions:** The two-way `toggle-followup` is replaced by `complete-followup` and `reopen-followup` with a target state, under the activity row lock and with an audit row per change (`setFollowupCompleted`; TD-430, package-9 finding B09-15).

### v9.0.18 — Sales Lead Input Validation
- **Sales Lead Input:** Lead amounts and probabilities go through `decimalInput`; the amount is non-negative, the probability an integer 0 to 100, and stage, status and currency come from fixed lists (`src/lib/crm/leadFields.ts`; TD-427, package-9 finding B09-12).

### v9.0.17 — CRM Activity Parents Exist
- **CRM Activity Parents:** A CRM activity is saved only when its sales lead and party exist and are not deleted; otherwise 422 (`resolveActivityParents`; TD-426, package-9 finding B09-11).

### v9.0.16 — Sales Lead Delete Guards
- **Sales Lead Delete:** Deleting a sales lead runs under its row lock: a missing lead is 404, a lead with an active document is refused with 409, and activities of deleted leads leave the stats, lists and due reminders (`deleteLead`, `liveLeadActivityCondition`; TD-425, package-9 finding B09-10).

### v9.0.15 — CRM Customer Filter by Party Id
- **CRM Customer Filter:** The CRM customer filter sends the party id; the server returns that party's leads and legacy leads without an id whose customer or company name equals the party name exactly (`leadCustomerCondition`; TD-429, package-9 finding B09-14).

### v9.0.14 — Open CRM Follow-Ups From the Server
- **Open Follow-Ups:** The follow-ups tab, the dashboard «today and overdue» widget and the tab badge read open follow-ups from `GET /crm/followups` with no activity-date range and with pagination; the stats counter uses the same condition (`listFollowups`, `countDueFollowups`; TD-428, package-9 finding B09-13, product-owner decision).

### v9.0.13 — One Proforma Per Lead Under Concurrency
- **Single Proforma Per Lead:** Issuing a proforma for a sales lead locks the lead row inside the document transaction, so concurrent requests can no longer create several proformas for one lead; the lead link and its note are written in the same transaction (`lockLeadForNewProforma`, `markLeadProforma`; TD-424, package-9 finding B09-09).

### v9.0.12 — Voiding a Lead Proforma Reopens a Won Lead
- **Lead Proforma Void:** Voiding the proforma of a sales lead, or the invoice finalized from it, releases the lead inside the void transaction and moves a won lead back to the proposal stage (`releaseLeadOfVoidedDocument`; TD-423, package-9 finding B09-08).

### v9.0.11 — CRM Lead Values Per Currency
- **CRM Stats Per Currency:** The CRM stats card and the customer dossier show the pipeline, won and per-stage lead values per currency; amounts of different currencies are no longer added together (`getCrmStats`, `sumByCurrency`; TD-422, package-9 finding B09-07, product-owner decision).

### v9.0.10 — Customer Delete Refused With Open Items
- **Customer Delete Guard:** Deleting a party is refused (409, Persian reasons) while it has a nonzero approved balance in any currency, draft voucher rows, a draft or proforma document under its name, an active sales lead, an open project or an open cheque; the check runs under the customer row lock (`assertCustomerDeletable`; TD-431, package-9 finding B09-16, product-owner decision).

### v9.0.9 — Excel Import Keeps the Party Type
- **Party Type in Customer Excel Import:** An empty type cell leaves an existing party's type unchanged and makes a new party a customer; supplier is read with or without hamza and «هر دو (مشتری و تامین‌کننده)» as both (`parsePartyTypeCell`, shared by the server and the preview) (TD-421, package-9 finding B09-06).

### v9.0.8 — Unique Active Customer Names
- **Customer Name Uniqueness:** Migration 0052 adds the partial unique index `uq_customers_name_active` on `lower(btrim(name))` of active parties, created only when existing data has no duplicate (old rows are never renamed or merged; the financial health check lists duplicates as `customer_name_uniqueness`). The form, the sales lead link and the Excel import check the same key, and a race ends in the same Persian duplicate-name error (TD-420, package-9 finding B09-05).

### v9.0.7 — Customer Phone Matching by Key
- **Customer Phone Identity:** The sales lead link, the customer form's duplicate check and the customer Excel import compare phones with `phoneMatchKey` (the WooCommerce key of TD-296): spaces, +98 / 0098, Persian digits and a leading zero dropped by Excel no longer create a second customer for one number. Existing duplicates are left as they are (TD-419, package-9 finding B09-04).

### v9.0.6 — Customer Dossier Documents by Exact Buyer
- **Customer Dossier:** The «پیش‌فاکتورها و اسناد» tab loads `GET /customers/:id/documents`: only sales documents (invoice, proforma, return) whose buyer name equals the party's current name exactly, instead of a text search over number, buyer, notes, user, phone and city. Each row shows its own type and status (TD-417, package-9 finding B09-02).

### v9.0.5 — Sales Leads No Longer Change an Existing Customer
- **CRM ↔ Customer Master:** Creating, editing or converting a sales lead only links a customer (by id, then exact phone, then exact name) or creates a new one; it never rewrites an existing customer's name, phone or contact person, so the customer's optimistic lock and the `customers.manage` permission can no longer be bypassed. A differing phone or company name is noted once in the lead's notes (TD-418, package-9 finding B09-03).

### v9.0.4 — Party Account Card by Id
- **Party Balance:** The customers page «تراز مالی» card and the customer dossier load the account card from `GET /customers/:id/account-card`, which selects customer and supplier voucher rows by the party's detailed id; legacy rows without an id match the current name exactly. A similarly named party is no longer added in, and renaming a party no longer empties its card (TD-416, package-9 finding B09-01).

### v9.0.3 — Package 9 Audit Documentation (Customers & CRM)
- **Stability Audit, Package 9:** `docs/audit/STABILITY_AUDIT_V9.md` opens with the customers and CRM section; its 16 proven findings are registered as open rows TD-416 to TD-431 (two P1). The phase-1 baseline and the series targets the product owner confirmed are recorded in the roadmap. Documentation only; no behaviour change.

### v9.0.2 — Workflow Auto-Actions Inside the Approval Transaction
- **Workflow Approval Atomicity:** What a workflow transition does to its entity (invoice finalize, item and treasury opening vouchers, journal voucher status, purchase requisition status and goods receipt) now runs in the transition's own transaction; a failing action refuses the approval with its real error. The in-process `workflowEventBus` and its duplicate `publishEvent` bridge are removed; workflow events go through the outbox only (TD-415, phase-2 finding A02-01).

### v9.0.1 — Test Runner Security Upgrade (vitest 5)
- **Security Gate:** `vitest` upgraded from 3.2.7 to 5.0.3 (dev-only). The CI audit gate was red on every branch because of two critical advisories in `tinypool@1.1.1` (GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr) and one moderate advisory in `@vitest/mocker` (GHSA-82fw-gwwq-j7x9); the new chain has no `tinypool` and a patched mocker (TD-414).

### v9.0.0 — Closure of Version 8 & Launch of Version 9
- **Version 8 Closure:** Concluded and archived the v8.x series (`v8.0.0` through `v8.0.128`). `V8_MASTER_ROADMAP.md` is archived with a closing report; 129 debt rows (TD-250 – TD-413) were recorded and all are resolved or closed by product-owner decision (TD-369 closed as an accepted risk); `src/data/changelogs/8.ts` is frozen.
- **Version 9 Mission:** `V9_MASTER_ROADMAP.md` — package-by-package stability audit (architecture and layering, data integrity, concurrency, security, error handling, performance, code quality, tests, UI) of the modules V8 did not cover as areas; stability over rewrites. New debt rows start at TD-414.
- **Governance:** `npm run check:version` now also rejects any change to the closed 8.x series; release paperwork moved to the generic `npm run release` (`scripts/release.ts`, reads the active series), and changes land only through a branch and a draft pull request (`AGENTS.md` §24).

---

## Version 8.x Series (Archived at v8.0.128)

### v8.0.128 — پاکسازی تست‌ها و ابزارهای بلااستفاده
- - سوئیت stress (دو سناریوی آن کد برنامه را اجرا نمی‌کرد)، سرویس‌های فقط‌تستی SystemRecoveryService و DataReconciliationService، شابلون ماژول v4، اسکریپت‌های قدیمی (start/stop/clean-install، db:baseline، setup:init، create-local-db)، فایل‌های AI Studio، دو سند قدیمی، سه وابستگی و خروجی‌های بی‌استفاده حذف شدند؛ رفتار برنامه تغییری نکرد.

### v8.0.127 — کلید ووکامرس روی HTTPS فقط در هدر
- کلید و رمز API ووکامرس روی HTTPS دیگر در آدرس درخواست (و لاگ وب‌سرور فروشگاه) نمی‌آیند و فقط در هدر می‌روند (TD-408).

### v8.0.126 — سفارش حذف‌شده ووکامرس نیازمند بررسی می‌شود
- سفارشی که در ووکامرس به سطل زباله برود یا حذف شود «نیازمند بررسی حسابدار» می‌شود و فاکتورش دست نمی‌خورد (TD-407).

### v8.0.125 — آمار گزارش کار بی گزارش‌های محرمانه
- TD-406: آمار گزارش کار فقط گزارش‌هایی را می‌شمارد که کاربر در فهرست می‌بیند.

### v8.0.124 — گام درخواست خرید بی بازنویسی
- TD-405: اقدام درخواست خرید گام گردش‌کار را بی انتقال و بی تاریخچه از وضعیت درخواست بازنویسی نمی‌کند.

### v8.0.123 — مبلغ ریالی در قاعده‌های گردش‌کار
- TD-404: قاعده مبلغ گردش‌کار مبلغ قابل پرداخت ریالی سند را با مالیات، هزینه خدمات و تسعیر می‌سنجد.

### v8.0.122 — قفل خوش‌بینانه ویرایش طرف حساب
- TD-403: ویرایش طرف حساب و درون‌ریزی اکسل با نسخه کهنه رد می‌شود و روی ویرایش دیگری نمی‌نویسد.

### v8.0.121 — حذف پروژه با تخصیص باز رد می‌شود
- - TD-412: پروژه‌ای که تخصیص مواد باز دارد تا آزادسازی تخصیص‌ها حذف نمی‌شود.

### v8.0.120 — پرداخت حقوق بدون روش چک
- - TD-411: روش «چک» از پرداخت حقوق حذف شد؛ پرداخت چکی رد می‌شود.

### v8.0.119 — فاکتور پیش‌فاکتور با تاریخ نهایی‌سازی
- - TD-410: فاکتورِ حاصل از پیش‌فاکتور تاریخ روز نهایی‌سازی را می‌گیرد؛ شماره و تاریخ پیش‌فاکتور در یادداشت می‌ماند.

### v8.0.118 — ثبت خزانه بی‌سند فقط با مجوز جدا
- - TD-409: دریافت، پرداخت، انتقال و چک «بدون سند حسابداری» فقط با مجوز جدا ثبت و در بررسی سلامت مالی فهرست می‌شوند.

### v8.0.117 — سند فیش حقوق با مبالغ دقیق
- TD-402: سند حسابداری فیش حقوق مبالغ را با محاسبه اعشاری دقیق می‌گیرد، نه عدد جاوااسکریپت.

### v8.0.116 — ارزش انبار سلامت مالی فقط به بهای تمام‌شده
- TD-401: بررسی سلامت مالی کالای بی میانگین موزون را صفر و جدا می‌شمارد و قیمت فهرست فروش را ارزش انبار نمی‌گیرد.

### v8.0.115 — سند حواله و ضایعات به بهای کاردکس
- TD-400: سند حسابداری حواله و ضایعات بهای ردیف‌های خروج کاردکس همان سند را می‌گیرد و همگام‌سازی دوباره پیش‌نویس عددش را عوض نمی‌کند.

### v8.0.114 — نام حساب ۶۰۰۱ و حساب جدای ضایعات
- TD-413: ۶۰۰۱ «بهای تمام‌شده کالای فروش‌رفته» نام گرفت و سند ضایعات حساب نگاشت‌شده «ضایعات و افت کیفی» (۶۰۰۴) را بدهکار می‌کند.

### v8.0.113 — مشاهده‌های ممیزی در دفتر بدهی فنی
- ۱۴ مشاهده بی‌ردیف گزارش‌های ممیزی به‌عنوان بدهی باز ثبت شد، پنج مورد با تصمیم مالک محصول (فقط مستندات).

### v8.0.112 — مبلغ قابل پرداخت در کارتابل تأیید و پرونده مشتری
- TD-389: کارتابل تأیید و پرونده مشتری مبلغ قابل پرداخت سرور را با مالیات و هزینه خدمات نشان می‌دهند.

### v8.0.111 — پیش‌نویس فاکتور پس از ثبت برنمی‌گردد
- TD-388: پیش‌نویس سرور فاکتور فروش پس از ثبت دوباره ساخته نمی‌شود و پیوند پرونده CRM را نگه می‌دارد.

### v8.0.110 — صدور مستقیم رسید از هشدار نقطه سفارش
- TD-387: «صدور مستقیم سند» از نقطه سفارش رسید را با شماره سرور و نام تأمین‌کننده ثبت می‌کند؛ پیش‌تر همیشه رد می‌شد.

### v8.0.109 — نرخ اختصاصی پرسنل در فرم ثبت کارکرد
- TD-386: فرم ثبت کارکرد نرخ اختصاصی پرسنل را پیشنهاد می‌دهد و فقط نرخ دستی را می‌فرستد.

### v8.0.108 — ارقام فارسی در مبلغ‌های حقوق و شماره چک
- TD-385: مبلغ و نرخ با ارقام فارسی یا عربی دیگر صفر نمی‌شود و متن نامعتبر خطا می‌گیرد؛ شماره چک و صیادی لاتین ذخیره می‌شوند.

### v8.0.107 — قیمت فهرست قیمت فقط به ارز خود فاکتور
- TD-384: فرم فاکتور فروش فقط قیمت‌های همان ارز را پیشنهاد می‌دهد و ارز فاکتور دارای ردیف عوض نمی‌شود.

### v8.0.106 — فاکتور ارزی در فرم و چاپ با اعشار نمایش داده می‌شود
- TD-383: فرم فاکتور فروش و فاکتور چاپی مبالغ ارزی را با دو رقم اعشار و جمع چاپی را از مبلغ قابل پرداخت سرور نشان می‌دهند.

### v8.0.105 — مالیات فاکتور ارزی به سِنت گرد می‌شود
- TD-382: مالیات درصدی فاکتور ارزی به کوچک‌ترین واحد ارز گرد می‌شود، نه به دلار کامل.

### v8.0.104 — مبلغ مالیات فاکتور را سرور از درصد حساب می‌کند
- TD-381: مبلغ مالیاتی که با درصد نمی‌خواند رد می‌شود و فرم فاکتور فروش فقط درصد را می‌فرستد.

### v8.0.103 — تخفیف ردیف حداکثر برابر مبلغ همان ردیف
- TD-380: تخفیف ردیف بیشتر از مقدار × قیمت واحد رد می‌شود؛ مازاد تخفیف دیگر از درآمد ردیف‌های دیگر کم نمی‌شود و بدهکاری مشتری با مبلغ فاکتور می‌خواند. ده یافته حوزه L ثبت شد.

### v8.0.102 — A Workflow Step Can Exclude the Initiator
- The workflow designer has a per-transition «آغازکننده تأیید نکند» option (off by default); when set, the user who started the process, directly or through a delegate, cannot run that step and does not see its task, while colleagues of the role and admins can.

### v8.0.101 — Receiving an Unapproved Requisition Approves It in the Receiver's Name
- Receiving goods on a purchase requisition that is not yet approved now runs the approval step in the receiver's name, with their role checked and the approval recorded in the history; a receiver without approval rights is refused and nothing enters stock.

### v8.0.100 — A Transition's Required Permission Is Enforced
- A workflow transition with a required permission now runs, and is offered, only for an admin or a user whose role or own permissions include it; the workflow designer shows and keeps the field instead of clearing it on save.

### v8.0.99 — Requisition Workflow Actions Follow the Current Step
- A purchase requisition action with no transition from its current workflow step is refused (409) instead of changing the status directly, so a received requisition can no longer be reopened, ordered and received into stock again; a rejected workflow continues only through a transition drawn out of its rejected step, such as reopen.

### v8.0.98 — Only the Delegator or an Admin Revokes a Delegation
- A delegate can no longer revoke the delegation given to them (403, and the revoke button is hidden); invalid delegation input returns 422 and a missing delegation or user 404 instead of a server error.

### v8.0.97 — A Delegate Does the Delegator's Role Tasks
- During an active delegation and within its scope, the delegate sees and runs the delegator's role tasks; the signature is recorded in the delegator's name with the delegate as signer, and neither of them can sign the same step twice.

### v8.0.96 — All-Members Approval Means Every Member of the Role
- An AND_ALL workflow step now passes only when every active user of the step's required role has signed (a one-member role passes with that member); a step without a role asks for the K set in the designer.

### v8.0.95 — No Deadlock Between Inbox Tasks and Direct Transitions
- Running an inbox task while the same step is executed from the document widget no longer deadlocks: the task locks the workflow instance before the task, in the same order as a direct transition.

### v8.0.94 — View Permissions No Longer Approve Workflow Steps
- A workflow step that requires the warehouse or accountant role can no longer be approved with a view or treasury permission alone, and production roles no longer count as managers; the role itself, a role of the same department or that department's posting permission is required.

### v8.0.93 — Step Signatures Restart When a Workflow Returns
- When a workflow comes back to a step after a rejection or return, the signatures of that step start from zero: the same user can resubmit, and an old signature no longer fills the quorum.

### v8.0.92 — Running Workflows Keep Their Tasks After a Design Edit
- After a workflow design is saved again, a running instance still gets the tasks and deadline of its next step from its own version snapshot instead of dropping out of the inbox.

### v8.0.91 — Multi-Signature Tasks Stay Open Until the Quorum
- A K-of-N or all-members approval task stays in every signer's inbox until the quorum is met; a partial or repeated signature no longer closes it, and the signer sees how many signatures are collected.

### v8.0.90 — Inbox Tasks Run Their Own Transition
- Approving a workflow task runs that task's own transition instead of the first forward transition of the step, and rejecting runs only a reject transition of the current step; a step without one refuses the rejection instead of approving it.

### v8.0.89 — Upgrade From v7.0.137 Passes Vouchers Refused by 0044
- Migration 0047 backfills source_cheque_id through erp_update_with_unvalidated_checks, so a voucher whose date 0044 refused to convert (closed fiscal year) no longer violates its NOT VALID date constraint and roll back the whole upgrade from v7.0.137; databases that ran the old 0047 are unaffected.

### v8.0.88 — Upgrade Rehearsal on a Restored Copy
- scripts/upgrade-rehearsal.sh (and update.sh --rehearse, before the restart) restores the latest backup into a drill database, runs the new migrations on it and compares ledger totals per account, stock per item and warehouse, bank balances and the financial health check before and after; the live database is never touched.

### v8.0.87 — Restore Apply Builds a New Database and Swaps It In
- RESTORE_MODE=apply no longer restores over the live database: it restores into a new database, verifies it like a drill, refuses while sessions are connected, swaps names and keeps the previous database and uploads directory; attachment files are restored too.

### v8.0.86 — Restore Drill Works With the Installed Database Role
- The role install.sh creates has no CREATEDB: restore.sh now creates, drops and renames databases through RESTORE_ADMIN_URL or sudo -u postgres, restores as the application role and stops with guidance before changing anything when neither is available.

### v8.0.85 — Restore Drill Compares Content With the Backup Manifest
- backup.sh writes the dump and a content manifest (rows and content hash of every table, every constraint) from one exported snapshot; the restore drill compares the restored database with it and checks sequences, attachment files and the migration level. The always-green recovery check was removed.

### v8.0.84 — Backups Run From Cron and Include Attachments
- scripts/backup.sh finds the application directory from its own location, reads DATABASE_URL and ATTACHMENTS_DIR from its .env and archives public/uploads, so a cron line backs up the database and the attachment files; attachment records without an attachment directory fail the backup.

### v8.0.83 — update.sh Waits for Startup and the Built Version
- update.sh reports success only when /health/startup answers (migrations and seed finished) and /health shows the built version (scripts/verify-startup.sh); on failure it prints the rollback steps with the previous commit and the pre-deployment backup.

### v8.0.82 — Migrations Run Without the Request Timeout, One at a Time
- Migrations run on a dedicated connection without the 60 s request statement timeout (MIGRATION_STATEMENT_TIMEOUT, default 0) under advisory lock 91008: the 0044 date migration no longer dies on large voucher tables and two concurrent runs queue instead of failing.

### v8.0.81 — Skipped Migrations and Newer Databases Stop Startup
- Before running, the migrator compares the code journal with __drizzle_migrations: a migration whose `when` is older than the last applied one (Drizzle skipped it silently) or a database newer than the build stops startup with the migration named; a journal lint checks strictly increasing `when` values.

### v8.0.80 — Atomic Project Codes
- - Automatic project codes (PRJ-<year>-<number>) come from an atomic yearly counter in `document_ref_counters` instead of `COUNT(*) + 1`, so concurrent project creation no longer fails on a duplicate code; a custom code is checked under the same lock.

### v8.0.79 — Idempotency Keys Keep Only Successful Responses
- The browser derives the Idempotency-Key from the submission's content and keeps it until a definitive answer, so a resubmission after a lost response returns the first result; the server stores only successful responses, refuses a key reused for another path or body, and extends the key's lock while a long request runs.

### v8.0.78 — Bank Account Maintenance Under Locks
- Editing a bank account locks its row, so two concurrent opening-balance edits no longer double the difference; treasury account codes come from an atomic counter per prefix and a duplicate custom code is refused; deleting a bank account runs under its lock and is refused while it has transactions or cheques.

### v8.0.77 — No Second Pool Connection Inside Transactions
- The first voucher of a new fiscal year, document voids, purchase requisitions and bank accounts with an opening balance now finish with a single free pool connection: the fiscal year row, audit log and workflow start run in the same transaction and a stale timezone cache no longer waits for the database.

### v8.0.76 — Work Logs Stay Consistent With Their Payroll
- Editing or deleting a work log now locks it and checks the payroll link under that lock, so a change racing with payroll issue either lands before the payroll or is refused after it; a work log whose payroll was deleted can be edited again.

### v8.0.75 — Dead-Letter Events Are Replayed Once
- Replaying a dead-letter event now runs under a lock on that event: a concurrent replay, dismissal or outbox requeue of the same event is refused, and an event already replayed is not replayed again, so webhooks and SMS are not sent twice.

### v8.0.74 — Bank Balance Sync Uses Treasury Transactions
- The bank balance sync now rebuilds each balance under the bank locks from the opening balance, treasury transactions and cleared cheques and only reports the difference from the general ledger (product-owner decision); draft vouchers and a concurrent payment no longer corrupt the balance.

### v8.0.73 — Bank Transfers Are Voided as a Whole
- Voiding either side of a bank-to-bank transfer now voids both sides, restores both balances and voids the shared voucher once (product-owner decision); the remaining side of an old half-voided transfer can be voided.

### v8.0.72 — Project Delivery Over Plan Needs a Reason
- Delivering a project's products to stock beyond the planned quantity now needs a recorded reason (product-owner decision), concurrent deliveries are counted under the project lock, and a cancelled project or an item outside the project is refused.

### v8.0.71 — Requisition Receipt Enters Stock Once
- Receiving a purchase requisition now runs in one transaction under the requisition lock: concurrent or later ordering no longer brings the goods in twice, a received or rejected requisition cannot be received or ordered again, a failed order finalization refuses the receipt, and the received quantity comes from the documents.

### v8.0.70 — Reversed Vouchers Keep Their Reversal
- A draft voucher can no longer be reversed or corrected, and a voucher with an active reversal can no longer go back to draft or be deleted, which used to leave an orphan reversal in the ledger.

### v8.0.69 — Deleted Cheques Stay Deleted
- A deleted cheque can no longer be cleared, bounced or deleted again; clearing it used to add its amount to the bank balance, and a concurrent delete and clear were both accepted.

### v8.0.68 — Each Voucher Is Reversed Only Once
- Two concurrent correction vouchers, or a correction and a reversal at the same time, no longer both reverse the same voucher; correction and repost lock the original voucher and every path refuses a voucher that already has an active reversal.

### v8.0.67 — Stock Paths Without Deadlocks
- Area J (concurrency) reviewed. Every stock path locks all its items at once, in id order and before any other lock, with FOR NO KEY UPDATE, so concurrent voids, invoices, receipts and returns sharing items no longer deadlock and a void's reversal row keeps the Kardex replay equal to the live WAC.

### v8.0.66 — Project Reservations Are Built by the Server (TD-306)
- A project's stock reservation is no longer taken from the browser: finalizing builds it on the server from the inventory control sections and item stock, and later saves keep it.

### v8.0.65 — Piecework Logs Need the Piecework Permission; Rates From the Server (TD-300)
- Recording piecework needs the piecework log permission instead of the daily-log one, and only personnel or rate managers enter a manual rate; others get the personnel or task rate.

### v8.0.64 — CRM Won Needs a Proforma on Every Path (TD-309)
- A sales lead can be marked won only after a proforma, whether through its stage or its status; a new lead cannot start as won.

### v8.0.63 — Vouchers Approved at Creation Record Their Approver (TD-308)
- A manual journal voucher created as approved records its creator as the approver.

### v8.0.62 — Document Creator Name Comes From the Session (TD-307)
- The creator name of a document, its Kardex rows and its voucher is the signed-in user, not a name sent in the request.

### v8.0.61 — Editing an Item Keeps the WAC of Stocked Items (TD-305)
- Editing an item that has stock no longer overwrites its weighted average cost without a Kardex row or voucher; the WAC changes only through stock in.

### v8.0.60 — Roles Accept Only Catalog Permissions (TD-304)
- A role can be given only permission keys from the catalog; "*" and unknown keys are refused.

### v8.0.59 — Payroll Payments Follow the Payroll Read Permission (TD-303)
- Payroll payments and personnel advance balances are read with the payroll read permissions only, like the payslips themselves.

### v8.0.58 — Pending Material Edits Need the Approval Permission (TD-302)
- Editing a pending raw-material request needs the approval permission and is refused once the request was approved or rejected.

### v8.0.57 — Private Daily Logs Stay Private by ID (TD-301)
- Opening a daily work log by its id applies the same visibility rule as the list; private and manager-only logs of others are no longer returned.

### v8.0.56 — Only an Admin Manages Admin Accounts (TD-299)
- A user manager without the admin role can no longer grant or remove the admin role, or change or delete an admin account.

### v8.0.55 — Area H Audit; Route Permission Table and View-Only Mutations (TD-298)
- Area H (security and access) was audited from a route → permission table built from the Express routers; BOM allocation and workflow start no longer open to view-only permissions, and a test keeps every route within the access policy.

### v8.0.54 — Stock Movement Chart by Jalali Month (TD-316)
- The stock movement chart now groups inflows and outflows by Jalali month over the current Jalali month and the five before it, instead of labelling Gregorian months with Jalali month names.

### v8.0.53 — Activity Log Shows Tehran Time and Filters Tehran Days (TD-315)
- The activity log API returns its UTC timestamps with a zone marker, so the page shows the time in the business time zone, and its date filter covers the business day rather than the UTC day.

### v8.0.52 — Database Session and Server Process Run in UTC (TD-314)
- The connection pool pins the PostgreSQL session time zone to UTC and the server process runs with TZ=UTC, so server timestamps written by the database and by the code agree on hosts set to Tehran time.

### v8.0.51 — Invoices From Proformas Take the Invoice Series Number (TD-317)
- Finalizing a proforma gives the invoice the next number of the invoice series for its fiscal year and keeps the proforma number in the notes; a proforma whose number already exists among that year's invoices no longer fails with a database error.

### v8.0.50 — Strict Document Dates and Cross-Year Draft Numbering (TD-313)
- A non-existent document date (30 Esfand of a common year, 30 February) or a non-date is refused with 422 instead of shifting silently or failing with 500; the numbering year comes from the stored date, and a draft moved to another fiscal year takes that year's next number.

### v8.0.49 — Browser «Today» in the Business Time Zone (TD-312)
- Stock counts and the invoice and treasury date fallbacks take today's date in the business time zone; a count saved after midnight in Tehran (on Nowruz night, in the new fiscal year) no longer gets yesterday's UTC date.

### v8.0.48 — Default Numbering Year Follows the Business Clock (TD-311)
- Without a date, the numbering year is today's Jalali year in the business time zone; requisition codes and the next-number preview no longer jump to the next year between 1 January and Nowruz.

### v8.0.47 — Fiscal Year Closing Always Ends on the Year's Last Day (TD-310)
- Closing vouchers are dated the year's last day (30 Esfand in a leap year) and the opening voucher 1 Farvardin; other dates are refused, so a leap year's 30 Esfand documents are closed too.

### v8.0.46 — No Floating Promises
- All 209 floating promises in the browser code are marked or handled; `no-floating-promises` is now an ESLint error, and clipboard copies report failure instead of a false «copied» message.

### v8.0.45 — Session-Start Hook and Release Tooling
- Tooling only: a Claude Code session-start hook prepares dependencies and PostgreSQL 16, `scripts/ci-test-env.sh` holds the CI test environment, and `npm run release:v8` writes a release's paperwork.

### v8.0.44 — Online Shop Warehouse for WooCommerce (TD-293)
- A new setting picks the online shop's warehouse: WooCommerce invoices draw from it and the stock sync pushes its sellable stock instead of the total of all warehouses.

### v8.0.43 — Changed Invoiced WooCommerce Orders Need Review (TD-294)
- When an invoiced order is edited in the shop or gets a partial refund, the order is flagged for review with the difference instead of being ignored.

### v8.0.42 — WooCommerce Negative Fees Become Line Discounts (TD-295)
- An order discount sent as a negative fee is spread over the invoice lines as line discounts in proportion to their amounts instead of rejecting the order.

### v8.0.41 — WooCommerce Line Totals Stay Exact (TD-297)
- A WooCommerce order line whose total is not divisible by its quantity is split into two lines with whole-rial prices, so the customer is charged exactly the order amount.

### v8.0.40 — WooCommerce Customer Matched by Phone in Any Format (TD-296)
- A WooCommerce order finds an existing customer whatever the phone format (+98, 0098, spaces, Persian digits) instead of creating a duplicate.

### v8.0.39 — WooCommerce Audit; Thousand-Toman and Thousand-Rial Units (TD-292)
- Area F (WooCommerce) audited with six findings; orders in the Persian plugin's thousand-toman (IRHT) and thousand-rial (IRHR) units are converted to rials and invoiced.

### v8.0.38 — Over-Ordering a Requisition Needs a Recorded Reason (TD-289)
- Ordering beyond a purchase requisition's remaining quantity is refused without a reason; the form warns, and the reason is recorded on the requisition and the order.

### v8.0.37 — Split-Order Form Accepted by the Convert Route (TD-291)
- The requisition convert route validates exactly the split-order form body, so the form works again and keeps each package's warehouse and status.

### v8.0.36 — Requisition Receipt Counts Every Line (TD-290)
- Delivering a purchase order counts every line of an item in its requisition and updates the requisition in the delivery transaction under a row lock.

### v8.0.35 — Project Delivery Issues a Production Receipt (TD-285)
- Delivering a project's finished goods to stock issues a final production receipt linked to the project: debit finished goods, credit work in progress.

### v8.0.34 — BOM Allocation Posts Work in Progress (TD-286)
- Allocating materials to a project posts debit work in progress, credit inventory at the Kardex cost; releasing the allocation voids that voucher.

### v8.0.33 — BOM Release at the Allocation's Own Cost (TD-288)
- Releasing a project material allocation returns the stock at the cost it left the warehouse, not at the current average cost.

### v8.0.32 — Area E Findings; BOM Receipt Allocation Needs a Receipt (TD-287)
- A direct BOM receipt allocation without a registered receipt is refused; with a receipt it moves stock out like a normal allocation. Five other procurement and project findings recorded.

### v8.0.31 — Payroll Payments Can Be Voided (TD-283)
- A payroll payment is voided with a reason from the payroll's payment window; bank balance, voucher, paid amount and payroll status step back.

### v8.0.30 — Fixed Salary per Jalali Month, Partial Months Pro Rata (TD-284)
- A payroll's fixed salary covers every Jalali month of its period, a partial month by days; two half-month payrolls add up to exactly one month.

### v8.0.29 — Advance Deduction Limited to the Outstanding Advance (TD-282)
- A payroll whose advance deduction exceeds the employee's outstanding advance is refused; the payroll form disables issuing it.

### v8.0.28 — Payroll Status Limited to Draft/Approved; Area D Findings (TD-281)
- Payroll status accepts only draft and approved by hand and a paid payroll keeps its status; three payroll findings await product-owner decisions.

### v8.0.27 — Cheque Reconciliation Report Matches the Ledger (TD-280)
- The cheque reconciliation compares cheque payables by their credit balance and no longer expects bounced or returned paid cheques there.

### v8.0.26 — Cheque Method Removed From the Treasury Form (TD-278)
- Cheques are registered only from the cheque book; the treasury and invoice-settlement forms no longer offer a cheque method and the server refuses it.

### v8.0.25 — Cheque Clearing Needs a Bank Ledger Account (TD-277)
- Clearing a cheque into a bank account without a ledger account is refused, like a treasury transaction, instead of marking it cleared without a voucher.

### v8.0.24 — Cleared Cheques Count in the Bank's Treasury Balance (TD-276)
- A cleared received cheque adds to, and a cleared paid cheque subtracts from, its bank account's treasury balance, so the account stays in sync with the ledger.

### v8.0.23 — Foreign-Currency Cheques Are Refused (TD-275)
- A cheque in a currency other than IRR is refused; foreign receipts and payments are recorded from the treasury form at an exchange rate.

### v8.0.22 — Returned Bounced Cheque Moves the Claim to the Customer (TD-273)
- Returning a bounced cheque to its drawer posts debit customer, credit protested cheques, so the claim is back on the customer's account.

### v8.0.21 — Bounced Paid Cheque Restores the Supplier (TD-272)
- A bounced paid cheque now posts a voucher: debit cheques payable, credit the supplier, so the debt to the supplier is open again.

### v8.0.20 — Foreign Treasury Transactions Use Their Rate (TD-274)
- Foreign-currency receipts, payments and transfers post at their exchange rate (explicit, the settled invoice's rate, or the setting) and are refused without one; the treasury form asks for the rate of a foreign account.

### v8.0.19 — Treasury and Cheque Evaluation; Cheque Delete by Link (TD-271)
- Second evaluation part (treasury and Sayad cheques): nine findings recorded; deleting a cheque no longer voids the vouchers of another cheque with the same number.

### v8.0.18 — Exact Rial Cost Rows in Foreign Vouchers (TD-261)
- Cost-of-sales, inventory and donated-goods rows of a foreign-currency voucher keep the document currency with their own rate, so their rial value equals the Kardex exactly; all findings of the first v8 evaluation part are closed.

### v8.0.17 — Free Goods Post to Donated-Goods Income (TD-268)
- A free line in a receipt or purchase (price 0 or a full discount) enters stock at the current WAC and its voucher credits the new account «درآمد کالای اهدایی» (5204); the supplier is credited only with priced lines.

### v8.0.16 — Foreign Rows Converted in Account Cards (TD-260)
- The account card, party ledger and financial health check convert foreign-currency rows to rials at their own rate in the all-currencies view, like the trial balance; a single-currency view shows that currency only.

### v8.0.15 — Reports Skip Deleted Voucher Rows (TD-270)
- The financial health check, project reports, bank ledger balances and personnel advance balances no longer count the old rows of a draft voucher that was edited or re-synced before approval.

### v8.0.14 — Purchase Vouchers Follow the Account Mapping (TD-259)
- Purchase, production receipt and sales return vouchers take inventory, payables and receivables accounts from the account mapping, like sales and remittances.

### v8.0.13 — Kardex Rebuild Starts From Zero Cost (TD-269)
- The Kardex rebuild replays WAC from zero, like an item with no movements; an item first received at price 0 keeps its live WAC after a rebuild.

### v8.0.12 — Zero-Price Receipt Kardex Cost (TD-256)
- A zero-price stock-in records the current WAC in its Kardex row, so voiding it and the Kardex rebuild keep WAC; a production receipt voucher takes such items at their Kardex cost.

### v8.0.11 — Void of an Outflow Restores Its Cost (TD-254)
- Voiding a sale, remittance or waste returns the goods at that outflow's own Kardex cost and recomputes WAC (same rule as stock-in and sales returns); the Kardex replay applies the same rule, also to older voids.

### v8.0.10 — Procurement Delivery Is Stock-In Only (TD-267)
- Procurement delivery finalizes only receipts and purchases; a purchase proforma is a receipt with status proforma (it used to finalize into a sales invoice that took the goods out of stock); finalizing a `purchase` document is stock-in.

### v8.0.9 — Purchase Line Discount in Stock Cost (TD-250)
- Incoming lines enter stock at the net unit price after the line discount (the same net the purchase voucher posts); foreign-currency lines are converted on the net price without intermediate rounding.

### v8.0.8 — Sales Return Capped at Quantity Sold (TD-253)
- A sales return with an original invoice is accepted only up to the invoice's sold quantity minus its earlier final returns (on create and on finalize, with row locks); voiding a return frees its quantity again.

### v8.0.7 — Running Kardex Shows Voided Documents (TD-266)
- Product-owner decision: the item Kardex report shows a voided document's original row (label «باطل‌شده») and its reversal («معکوس ابطال»); the running balance matches stock at every row, totals count only real movements, and each row's WAC is the live engine's WAC after that row.

### v8.0.6 — Void of a Consumed Incoming Document Refused (TD-265)
- Product-owner decision (option A): voiding a receipt, purchase, production receipt, sales return or count surplus is refused when, without it, a warehouse balance in date order would go negative; the error names the consuming documents. Voids of outflows are never refused.

### v8.0.5 — Excel Import Never Revalues Stock (TD-264)
- Product-owner decision (option A): an Excel row that changes the WAC of an item with stock is not applied and is listed in the import errors; a value within 1 rial of the current WAC is treated as unchanged; items without stock take the file's WAC.

### v8.0.4 — Stock Movement Date Rule and Kardex Replay (TD-257, TD-258)
- Product-owner decision: a stock movement (document, finalize, transfer) may not be dated before the item's last movement, except with the new permission `warehouse.backdate` (granted to no role by default); a permitted backdated outflow must keep the warehouse balance non-negative from that date on. Voided documents do not count, so void + reissue keeps the original date.
- The Kardex rebuild replays WAC in registration order with the live engine's formulas (`replayKardexWac`). New findings TD-265 (void of a consumed receipt) and TD-266 (running Kardex report after a void) registered; TD-264 decision (option A) recorded.

### v8.0.3 — Stock-Count and Excel Adjustment Vouchers (TD-255, TD-262, TD-263)
- Product-owner decision: stock-count shortages/surpluses and Excel stock adjustments post a draft voucher at Kardex cost against the new account «کسری و اضافات انبار» (7012, configurable mapping); a surplus of an item without WAC enters at cost 0; new Excel items with stock get the opening voucher; past counts get no voucher.
- A stock count is recorded only as final (a draft count used to deduct stock twice on finalize). New finding TD-264 (Excel WAC overwrite) registered for decision.

### v8.0.2 — Draft Vouchers at Fiscal Closing and Void (TD-252, TD-251)
- Product-owner decision: automatic vouchers stay draft; a fiscal year with draft vouchers is not closed (the preview lists them) and voiding a document, treasury transaction, cheque or payroll soft-deletes its draft voucher instead of issuing an approved reversal.

### v8.0.1 — Business-Logic Verification Tooling (test only)
- Executable inventory/ledger invariants, a seeded one-business-year simulator (`npm run simulate:year`) and the `business_invariants` suite with a shrink-only known-findings baseline.
- First evaluation report `docs/audit/BUSINESS_LOGIC_AUDIT_V8.md` (inventory and accounting): 12 proven findings registered as TD-250 – TD-261; no application behaviour changed.

### v8.0.0 — Closure of Version 7 & Launch of Version 8
- **Version 7 Closure:** Concluded and archived the v7.x series (`v7.0.0` through `v7.0.140`). `V7_MASTER_ROADMAP.md` is archived with a closing report; the debt registry ends the series with 0 open and 236 resolved rows; `src/data/changelogs/7.ts` is frozen.
- **Version 8 Mission:** `V8_MASTER_ROADMAP.md` — prove or refute the business-logic correctness of inventory, costing, accounting, treasury and payroll with executable invariants and a seeded one-business-year simulation on PostgreSQL 16; every finding gets a failing test, a `TD-###` row and its own `v8.0.x` fix.
- **Governance:** The active and closed series are declared in `src/data/changelogs/index.ts`; `npm run check:version` rejects a version outside the active series and any change to a closed series file.

---

## Version 7.x Series (Archived at v7.0.140)

### v7.0.0 – v7.0.140 — Quality Roadmap & Independent Audit Remediation
- **V7 Roadmap:** strict TypeScript (`strict: true`, v7.0.79), Zod on procurement/transactions/dashboard routes, batched stock and voucher lines, formal Drizzle migrations, per-warehouse stock normalized into `item_warehouse_stocks`.
- **Independent Audit Phases 0–3** (`docs/audit/TECHNICAL_AUDIT_REPORT.md`, base v7.0.17): fiscal-year reference numbering, negative-stock policy, tracked outbox delivery, WooCommerce order sync, structured VAT / exchange rate / service charges, decimal money columns, fiscal periods, attachments on disk, read permissions on every read route, flag and date CHECK constraints, Gregorian ISO date storage, Vitest and Playwright, ESLint ratchet.
- **Closure:** 236 technical-debt rows resolved, none open; details in `V7_MASTER_ROADMAP.md` (closing report) and `TECH_DEBT_ARCHIVE.md`.

---

## Version 6.x Series (Archived at v6.0.28)

### v6.0.0 — Official Launch of Version 6 & Version 5 Closure
- **Version 5 Closure:** Concluded and archived the v5.x series (`v5.0.0` through `v5.0.20`) after successfully completing inter-module integration, the 5-phase invoice-stock fix plan, 15-suite test runner isolation, and conducting the comprehensive independent data-integrity audit.
- **Version 6 Mission:** Enacted the Master Roadmap for Version 6 (`V6_MASTER_ROADMAP.md`) focusing on systemic remediation of 26 audited technical findings across 6 strategic pillars: Event-Sourced Kardex & True WAC preservation, double-entry ledger & year-end closing hardening, treasury separation of cash vs promissory cheques, deadlock-free row-locking hierarchy, and 100% architecture rules compliance (zero direct route mutations and zero hard deletes).
- **Governance Alignment:** Synchronized `AGENTS.md`, `package.json` (`6.0.0`), `check-version-sync.ts`, active roadmap `V6_MASTER_ROADMAP.md`, and activated `src/data/changelogs/6.ts`.

---

## Version 5.x Series (Archived / Finalized)

### v5.0.20 — Final Release & Conclusion of Version 5
- **Inter-Module Integration & Audit:** Completed 20 iterative releases across cross-module integration, stock movement automation, test-suite decoupling, and execution of comprehensive independent business logic audit.

### v5.0.0 — Official Launch of Version 5 & Version 4 Closure
- **Version 4 Closure:** Officially concluded and archived the v4.x series (`v4.0.0` through `v4.0.42`) encompassing major architectural refactorings, strict financial decimal precision, runtime contract hardening with Zod, frontend decluttering, and chunk error resilience.
- **Version 5 Mission:** Initiated Version 5 series with full continuity of Version 4 architectural rules and UI decluttering principles, focusing on deep cross-module integration (Inter-Module Workflows), end-to-end testing, error correction, and cross-functional performance optimization across Inventory, Accounting, Treasury, Production, Procurement, and Orders.
- **Governance Alignment:** Synchronized `AGENTS.md`, `package.json` (`5.0.0`), `check-version-sync`, active roadmap `V5_MASTER_ROADMAP.md`, and activated `src/data/changelogs/5.ts`.

---

## Version 4.x Series (Archived / Finalized)

### v4.0.42 — Final Release & Stabilization of Version 4
- **React Singleton & Chunk Resilience:** Resolved hook dispatch collision across lazy-loaded routes by pinning physical React/ReactDOM resolution in Vite, optimizing JSX runtimes, and hardening ErrorBoundary automated reload logic.
- **Final v4 Milestone:** Successfully delivered 42 iterative releases across architecture, security, financial calculation integrity, and UI/UX decluttering.

### v4.0.27 — Official Milestone Completion of Version 4 Architecture & Governance
- **Phase 1 (Database & Domain Schema):** Modular schema split across 8 domain files, `numeric(..., { mode: 'number' })` type consistency (D-1), soft-delete `isDeleted` standard (D-2), and strict foreign key integrity.
- **Phase 2 (Security Hardening):** Strict production CORS lockdown (S-1), IPv6/IPv4-mapped comprehensive SSRF normalization guard (S-2), authenticated Prometheus `/metrics` protection (S-3), elimination of default secrets in production (S-4), and PII data masking for personnel bank details (S-5).
- **Phase 3 (Financial & Payroll Integrity):** Transactional piecework payroll pipeline with `FinancialDecimal` (F-1, F-2), atomic sequence numbering (`piecework_payroll_number_seq`), strict voucher validation eliminating log-and-continue (F-3), and 3-step atomic document finalization (DB-008).
- **Phase 4 (Runtime Zod Contracts):** Sanitized payload replacement in Express `validate` middleware (S-6), strict mutation permission verification, and runtime validation across documents, inventory, transfers, BOM, vouchers, and treasury.
- **Phase 5 (Idempotency & Concurrency):** Triple-key composite idempotency (`user_id + scope + key`) (F-4), deadlock prevention via table priority lock ordering (`withOrderedLocks`) (A-1), auth caching, N+1 query elimination, and paginated transfers (A-2).
- **Phase 6 (Frontend Optimization & UX):** Refactored 1,875-line `BankAndTreasuryTab` into 9 modular components and `useTreasuryCalculations` hook (Q-1), debounce hooks across all search inputs (U-1), base `Modal` & `PrintModal` components (Q-2), and unified `ErrorBoundary`.
- **Phase 7 (CI/CD, Testing & Modular Scaffold):** Multi-stage GitHub Actions CI with live PostgreSQL 16 container (T-1), unified lockfile & test runner metrics (T-2), standardized domain module scaffold in `src/modules/_template/`, and 100% resolution of all 17 independent audit items (TD-088..TD-103).

### v4.0.0 — Official Launch of Version 4 & Version 3 Closure
- **Version 3 Closure:** Officially concluded and archived the comprehensive v3.x series (`v3.0.0` through `v3.3.22`) covering financial core automation, 4-level trial balance, multi-warehouse management, workflow FSM, domain event bus, and Iranian identifier normalization.
- **Version 4 Mission:** Initiated Version 4 series focusing on architectural optimization, codebase simplification, and targeted UI/UX refinements following the principles of visual decluttering, simplicity, and full Persian terminology.
- **Governance Alignment:** Synchronized `AGENTS.md`, `package.json` (`4.0.0`), and activated `src/data/changelogs/4.ts`.

---

## Version 3.x Series (Archived / Finalized)

### v3.1.16 — Strict Project Completion Gate & Progress Matrix Enforcement
- **Strict Matrix Gate:** Enforced backend validation on `PUT /projects/:id` and `POST /projects/:id/add-to-inventory` requiring 100% completion of the SKU × stage physical progress matrix before allowing project status transition to `completed`.
- **UI Lock & Indicators:** Disabled the "تغییر وضعیت پروژه به تکمیل‌شده" checkbox in `ProjectStockEntryTab` with lock icon, remaining items counter, and intuitive warning toast if clicked while incomplete.
- **Progress Matrix Feedback Banner:** Added status indicator banner in `ProjectProductProgressTab` showing total matrix items completed vs remaining and completion readiness.
- **Over-Reservation Inventory Governance:** Integrated comprehensive inventory availability policies for project material reservations.

### v3.0.4 — Version Drift Resolution & Build SSOT (TD-043)
- **Version Single Source of Truth (SSOT):** Centralized version resolution in `src/lib/version.ts` dynamically deriving build metadata and package version.
- **Probe & Health Endpoint Harmonization:** Updated `/health` and `/api/health` to return synchronized `version` and `buildInfo` payload.
- **Manifest & Backup Alignment:** Unified backup export metadata, Release Gate reports, Recovery verification manifests, and Kubernetes deployment YAML.
- **Automated Version Guard:** Added automated unit test assertion (Test 11 in `unitSuite.ts`) to prevent future version drift regressions.

### v3.0.3 — Performance, Memory Caching & Maintenance (TD-039..TD-042)
- **Frontend Code Splitting:** Dynamic `import('xlsx')` and React.lazy Suspense across Excel export/import and reconciliation components.
- **In-Memory TTL Caching:** Lightweight memory cache for RBAC role permissions lookup and system settings with automatic mutation invalidation.
- **Data Archival & Maintenance:** Purge utilities for old outbox events (`purgeProcessedEvents`) and audit trail records (`purgeOldAuditLogs`).
- **Test Scripts Separation:** Split `test:unit` and `test:full` execution scripts in package.json.

### v3.0.2 — Drizzle Migration Unification (TD-038)
- **Migration Pipeline Unification:** Consolidated all schema definitions into `drizzle/0000_v3_baseline.sql` and adopted standard Drizzle ORM migrator runner.

### v3.0.1 — Repository Architecture & Harmonization
- **Harmonization:** Standardized test suite naming, cleaned up development artifacts, and synchronized project documentation.

### v3.0.0 — Comprehensive UI/UX Overhaul & Financial Automation Milestone
- **Phase 1 (Flexible Multi-Step Invoice Settlements):** Full settlement modal supporting Cash, POS/Bank, Sayad Cheques, and Bank Transfers with automatic double-entry voucher generation and status tracking.
- **Phase 2 (3-Stage Accounting Voucher Lifecycle & Voiding):** Clear draft/audited/final voucher states, reversal vouchers for voiding, and correction vouchers with audit logs.
- **Phase 3 (Floating Detailed Party Ledger):** Comprehensive customer/vendor/personnel ledger with running balances, debt/credit indicators, and clean printing/export formats.
- **Phase 4 (Line & Cash Discounts):** Segregated line-item discounts and prompt cash payment discounts automatically mapped to designated discount accounts.
- **Phase 5 (Smart Financial Health Inspector):** Automated audit engine checking 6 critical areas (equilibrium, abnormal balances, inventory-to-ledger reconciliation, missing vouchers, overdue cheques, and bank bindings) with one-click automated sync.
- **Phase 6 (Global UI Simplification & Decluttering):** Universal adoption of the clean `ActionMenu` pattern across all system tables (invoices, items, vouchers, treasury, cheques, personnel, users) and complete Persian translation of technical/Latin terms.

---

Rules:
- Every functional/UI/security change adds an `AIUpdateLog` entry to the active
  version file (`2.ts`) with a unique semver bump; duplicates are never allowed.
- The old per-major-version files (`v1.ts … v9.ts`, ~700 KB of static data) were
  removed from the client bundle on purpose; consult Git for their content.

---

## Pre-1.0 history summary (v8.29.0 → v9.0.0 → baseline)

### v9.0.0 — Stability & Production-Ready (final V9 release; pre-reset era, unrelated to the current 9.x series)
**Phase 0 — P0 hotfixes**
- Locked down `PUT /documents/:id` finalization bypass (status transitions may no longer reach `final`; Zod body schema + service guard).
- Positive quantity / non-negative price validation on document line items and inside `applyStockMovement`.
- WooCommerce order processing made fully transactional (`externalTx` threading) + mandatory HMAC signature (fail-closed).

**Phase 1 — Financial integrity**
- Accounting voucher reversal issued automatically when a finalized document is deleted (+ DB-009 kardex reversal rows via `reversal_of_id`).
- Non-destructive `next-ref` peek (no more burned invoice numbers); atomic cold-start counter seeding.
- Decimal.js accumulators across voucherSync/treasury/documents; NaN-safe pagination caps (`parsePagination`, MAX_PAGE_LIMIT).

**Phase 2 — API hardening & edge security**
- Global error handler migration: ~175 ad-hoc handlers removed; uniform `{error, code, traceId}` responses.
- User lifecycle: soft delete, last-admin protection, `tokenVersion` session invalidation with live per-request user validation.
- CSRF fail-closed for legacy tokens; exact-match webhook auth paths; protected `/metrics` (`METRICS_TOKEN`); dead routes removed.

**Phase 3 — Currency UX**
- Eliminated ~100+ hardcoded «ریال» labels via `<Money>` + `useAppCurrency()`; per-currency KPI totals.
- SearchableSelect adopted in CRM/Documents/Accounting/Cheques forms.

**Phase 4 — UX polish**
- Modal scroll contract on 15 modals; real error display for rule tester (was faking success).
- Minimal responsive shell (<1024px auto-collapse), AbortController on global search, visibility-aware polling.
- SafeImage placeholders, RolesTab empty state, login lockout countdown + password reveal.

**Phase 5 — Code quality**
- React Query migration: Users/ActivityLogs/InvoicesList/Documents/Pricing/Transactions pages (hierarchical keys, placeholderData, cache-first reference lists).
- Giant component decomposition (~1400 LOC out of main pages): approval inbox, customers, NewVoucherModal, pricing, documents → 11 modular components.

**Phase 6 — Regression suite**
- `v9RegressionSuite`: bypass blocking, negative item validation, accounting reversal on deletion, peek idempotence, pagination caps, live session validation. Discovered & fixed a hidden bug: reversal-voucher read-back used outer ORM connection instead of caller's `externalTx`.

### Earlier eras (v1 … v8.29)
Accumulated feature set summarized in the baseline entry (`src/data/changelogs/0.ts`):
warehouse & multi-currency WAC inventory, warehouse docs with workflow approvals,
double-entry accounting with auto vouchers (sales/purchase/warehouse/payroll/treasury/Sayad-cheque),
fiscal-year closing, CRM kanban, production projects with BOM allocation, piecework payroll,
visual workflow designer (SLA analytics), domain-event bus + transactional outbox + DLQ,
webhook subscriptions with HMAC signatures, WooCommerce sync with idempotency,
RBAC permission catalog, observability stack (Winston rotation, Prometheus, K8s probes,
graceful shutdown) and atomic tracked migrations.

---

## v1.1.0 — V10 Release Sign-off (پایدار)

**Date:** 1405/06/06 • **Roadmap:** V10 Master Blueprint (phases 0→7 complete; docs archived in Git history)

| Phase | Deliverables (release series v1.0.x → v1.1.0) |
|---|---|
| 0 — Hotfix | Data-safety hard gate on test cleanup, Kardex envelope contract, ConfirmModal standardization, changelog reset |
| 1 — Date/TZ | Agreed business clock (`businessClock.ts`), client TZ provider, atomic Jalali date-normalization migration (alt_034) |
| 2 — Items & Coding | Unified tabbed products page, 300KB image standard + shared compressor, atomic `item_code_counters` next-code (alt_035), segmented code-builder UI |
| 3 — Unified UX | 21 native dialogs removed (Promise-based ConfirmDialogHost), unified print system (`.no-print`, DocPrintModal, isolated print area), movement analysis relocated, two-step inventory-audit confirmation |
| 4 — CRM & HR | Sellers as personnel (`assigned_personnel_id`, alt_036), formal `documents.crm_lead_id` (alt_037) + gated-lead unlock + customer-sync audit diffs, treasury-locked payroll payments (`PayrollPaymentService`) + fixed/mixed salary models (alt_038) |
| 5 — RBAC & Menu | Approved 8-group menu restructure + `/inventory-status`, permission vocabulary unification + dead-permission enforcement, per-role `menu_visibility` matrix (deny-list) |
| 6 — Finance & Print | Automation-status report (voucher coverage per doc type), per-project accounting report with running balance, workflow approver signatures on printed documents |
| 7 — Release Eng. | Docs consolidated into AGENTS.md (single source), new README with Linux install/update scripts (`install.sh`, `update.sh`, systemd), V10 regression suite (6 critical scenarios) |

**Sign-off:** All 15 critical-scenario suites + V10 regression suite green; lint and production build clean; `package.json`, `/health` and `src/data/changelogs/1.ts` version strings aligned at **v1.1.0**.

---

## v2.8.7 — تکامل و پاکسازی بدهی‌های فنی (سری 2.x پایدار)

**Date:** 1405/06/15 • **Series:** 2.x • **Milestone:** رفع جامع بدهی‌های فنی باز (TD-033 تا TD-037) و بهبود استحکام معماری

| حوزه | دستاوردها و اقدامات انجام‌شده |
|---|---|
| **TD-033 (Backend Types)** | جایگزینی بیش از ۳۸۰ نقطه `: any` در سرویس‌های رویدادها، ورکفلو، ریکاوری، اکشن‌ها و روت‌های اکسپرس با تایپ‌های صریح و بدون خطای تایپ‌اسکریپت |
| **TD-034 (Dates & Calendars)** | استانداردسازی کامل تاریخ‌های میلادی ISO و ثبت همزمان (Dual-Write) در جداول `daily_work_logs`, `piecework_logs`, `crm_activities` به همراه مایگریشن بک‌فیل و ایندکس‌ها |
| **TD-035 (Migrator)** | رفع وابستگی و اصلاح سال مالی در backfill قدیمی مایگریتر |
| **TD-036 (DB Hygiene)** | توسعه اسکریپت تراکنشی `scripts/cleanup-test-data.ts` (`npm run db:cleanup-test`)، پاکسازی کامل داده‌های آزمایشی و تسویه‌نشده، کالیبراسیون توالی‌های PostgreSQL و اسکن ۱۰۰٪ سالم مغایرت‌گیری ۱۲ گانه |
| **TD-037 (Dead Code Elimination)** | حذف کامل کامپوننت بلااستفاده `src/components/SystemTestRunner.tsx` (۳۰۰ خط کد مرده)، کاهش حجم باندل نهایی فرانت‌اند و تثبیت مسیر رسمی آزمون‌ها از طریق CLI استاندارد `npm run test` |

**Sign-off:** تمامی بدهی‌های فنی رده مهم و بحرانی حل شده؛ بیلد و linter کاملاً سبز (`tsc --noEmit` + `vite build`)؛ هماهنگی نسخه‌ها در `package.json`, `src/app.ts (/health)`, `src/data/changelogs/2.ts` روی **v2.8.7**.

