# Technical Debt Registry — رجیستری بدهی‌های فنی

> **قاعده الزامی:** هر بدهی/میان‌بر شناسایی‌شده در توسعه باید به این فایل اضافه شود
> (ردیف جدید با ID یکتا). این فایل مرجع برنامه‌ریزی دورهای نگهداری است و بخشی از
> قرارداد مستندسازی پروژه محسوب می‌شود (بخش ۲۳ `AGENTS.md`).
>
> وضعیت‌ها: `open` | `scheduled:فاز ۳ ممیزی` | `in_progress` | `resolved` — فازهای گذشته برچسب زمان‌بندی ندارند (بررسی خودکار در تست واحد unit_governance_docs_consistency_p3_12)
>
> 📦 **آرشیو:** ردیف‌های `resolved` به‌محض حل، به `TECH_DEBT_ARCHIVE.md` منتقل
> می‌شوند تا این فایل فقط اقلام فعال (open / scheduled / in_progress) را نگه دارد.
> تاریخچه کامل با متن و شواهد عیناً در آرشیو حفظ می‌شود.

---

## 🔵 اقلام فعال نسخه ۹ (open / scheduled / in_progress)

| ID | حوزه | شرح | منبع (فایل) | وضعیت |
|----|------|-----|--------------|-------|
| TD-481 | انبار و کاردکس (بسته ۶) | P1 (B06-02) — سند افتتاحیه کالای تأییدشده از گردش کار با «موجودی جاری × WAC جاری» صادر می‌شود و ردیف افتتاحیه کاردکس با WAC روز بازنویسی می‌شود: رسید میانه دو بار در دفتر نشست (۱٬۹۹۹٫۹۹۹۵ به‌جای ۱٬۰۰۰) و I3 و I13 شکستند | itemOpening.service.ts، itemOpeningWorkflowAction.ts، items.crud.routes.ts | open (P1، تصمیم ت۴ الف) |
| TD-482 | انبار و کاردکس (بسته ۶) | P1 (B06-03) — انبار با کد `default` ساخته می‌شود ولی `createLedgerLocationResolver` این کد را انبار پیش‌فرض می‌خواند: آشتی مغایرت دروغین نشان داد، «اصلاح از روی کاردکس» و بازسازی موجودی را به `main` بردند و فروش از انبار واقعی ۴۲۲ گرفت | warehouse.service.ts، warehouseResolver.ts، documentLifecycle.service.ts | open (P1) |
| TD-490 | انبار و کاردکس (بسته ۶) | P2 (B06-11) — غیرفعال کردن انبار بی قفل ردیف انبار است و با رسید هم‌زمان ۷ واحد را در انبار غیرفعال گذاشت؛ آخرین انبار فعال هم غیرفعال می‌شود و فعال‌سازی دوباره نیست | warehouse.service.ts، warehouses.routes.ts | open (P2، تصمیم ت۵ الف) |
| TD-492 | انبار و کاردکس (بسته ۶) | P2 (B06-13) — نمودار «گردش کالا» ردیف‌های انتقال بین انبارها را ورود و خروج می‌شمارد و مرز بالای بازه ندارد (ماه 1477/10 در نمودار) | monthlyMovementTrend.ts | open (P2) |
| TD-493 | انبار و کاردکس (بسته ۶) | P2 (B06-14) — کد ترنسفر طرح: کد حذف‌شده با `GET` خوانده می‌شود، ذخیره دوباره‌اش ۴۰۹ با پیام کلی می‌گیرد و صفحه فقط ۵۰ کد اول را می‌بیند | transfers.routes.ts، transfer.service.ts، useTransferQueries.ts | open (P2) |
| TD-495 | انبار و کاردکس (بسته ۶) | P3 (B06-16) — بررسی سلامت سامانه لایه انبار را با `status: 'ok'` ثابت گزارش می‌کند، حتی با مغایرت در گزارش سلامت انبار | systemReconciliation.service.ts | open (P3) |
| TD-496 | انبار و کاردکس (بسته ۶) | P3 (B06-17) — رابط انبار: اصطلاح انگلیسی و آوانویسی (داشبورد، آلارم، متریال، فیلتر، WAC، کارتکس)، «بروزرسانی»، رقم لاتین، برچسب «کسری سیستمی» برای اضافی و «قلم» برای جمع مقدار، نام انگلیسی فایل‌های خروجی، پیام‌های کلی و `window.confirm` | InventoryStatusPage.tsx، InventoryAuditPage.tsx، PhysicalAuditSheetTab.tsx، WarehouseStockReconciliationPanel.tsx، auditSheet.ts، RunningKardexModal.tsx، useTransactionsExport.ts | open (P3، تصمیم ت۶) |
| TD-497 | خزانه و چک (بسته ۴)؛ اثر روی ۳ و ۱۲ | P1 (B04-01) — سند چک (ثبت، برگشت، عودت) همیشه ۱۲۰۱ با تفصیلی `customer` یا ۳۰۰۱ با `supplier` و شناسه `partyId` می‌زند: چک دریافتی ۴٬۰۰۰٬۰۰۰ از پرسنل #۱ و چک پرداختی ۱٬۵۰۰٬۰۰۰ به او روی کارت حساب **مشتری #۱** نشست (مانده −۲٬۵۰۰٬۰۰۰)؛ چک «متفرقه» به ۱۲۰۱ مشتری بی‌شناسه رفت | chequeLifecycle.service.ts، ChequesTab.tsx | open (P1، تصمیم ت۲ الف) |
| TD-498 | خزانه و چک (بسته ۴) | P1 (B04-02) — خرج چک دریافتی از رابط فقط نام گیرنده را می‌فرستد و سند `3001 dr` با تفصیلی `other` بی شناسه می‌گیرد: از دو چک ۴٬۰۰۰٬۰۰۰ و ۲٬۵۰۰٬۰۰۰ خرج‌شده به یک تأمین‌کننده، کارت او فقط ۲٬۵۰۰٬۰۰۰ را دید | chequeLifecycle.service.ts، useChequeQueries.ts، ChequesTab.tsx | open (P1، تصمیم ت۳ الف) |
| TD-501 | خزانه و چک (بسته ۴)؛ اثر روی ۸ | P2 (B04-05) — `documentId` و `partyId` تراکنش خزانه بی هیچ بررسی ذخیره می‌شوند: دریافت از مشتری الف فاکتور مشتری ب را تسویه کرد؛ پرداخت به تأمین‌کننده روی فاکتور فروش، و `documentId` / `partyId` ناموجود ۲۰۱ گرفتند | treasuryTransaction.service.ts | open (P2) |
| TD-505 | خزانه و چک (بسته ۴)؛ اثر روی ۲ | P2 (B04-09) — `GET /accounting/bank-accounts` با گارد درون‌خطی `warehouse.in` / `warehouse.out` / `documents.view` / `documents.create` همه ستون‌ها (شماره حساب، کارت، شبا) و مانده خزانه، مانده دفتر و مغایرت را می‌دهد، در حالی که همان کاربر `GET /accounting/treasury` را ۴۰۳ می‌گیرد | treasury.routes.ts، InvoiceSettlementModal.tsx، PayrollPaymentModal.tsx | open (P2، تصمیم ت۷ الف) |
| TD-506 | خزانه و چک (بسته ۴) | P2 (B04-10) — چک با `issueDate` پنج ماه آینده (۲۰۱) و وصول با `actionDate` آینده (۲۰۰، مانده بانک همین امروز زیاد شد) پذیرفته می‌شود؛ پنجره وضعیت چک کادر تاریخ ندارد و چک دیروز پاس‌شده امروز در دفتر می‌نشیند | chequeLifecycle.service.ts، ChequesTab.tsx | open (P2، تصمیم ت۶ الف؛ با TD-669 (B16-05)) |
| TD-507 | خزانه و چک (بسته ۴)؛ اثر روی ۱۲ | P2 (B04-11) — `resolveContraAccount` «متفرقه» را به ۱۲۰۱ (یا ۳۰۰۱) و پرسنل با هدفی جز مساعده را به ۳۲۰۱ می‌برد و هدف ذخیره نمی‌شود: پرداخت ۲٬۰۰۰٬۰۰۰ اجاره ← `1201 dr`؛ دریافت ۵۰٬۰۰۰٬۰۰۰ وام ← `1201 cr` | treasuryTransaction.service.ts، TreasuryTransactionModal.tsx | open (P2، تصمیم ت۴ الف) |
| TD-508 | خزانه و چک (بسته ۴) | P2 (B04-12) — فرم حساب بانکی کادر ارز ندارد و `PUT currency USD` ۲۰۰ می‌گیرد ولی ارز `IRR` می‌ماند؛ پس مسیر ارزی خزانه (TD-274) فقط از API باز است | BankAccountModal.tsx، bankAccount.service.ts | open (P2، تصمیم ت۵ الف) |
| TD-509 | خزانه و چک (بسته ۴) | P2 (B04-13) — `computeBankBalances` همه ردیف‌های تأییدشده دفتر کل را در هر درخواست می‌خواند (۲۰۰٬۰۰۰ ردیف ← ۱٬۶۳۹ ms برای ۱۵ بانک) و `GET /accounting/treasury` `page` / `limit` را نادیده می‌گیرد (۲۰٬۰۰۰ ردیف، ۱۵٫۸۸ MB) | bankAccount.service.ts، treasuryTransaction.service.ts | open (P2) |
| TD-510 | خزانه و چک (بسته ۴) | P3 (B04-14) — حساب بانکی با `accountId 999999` یا روی سرفصل ۱۲۰۱ و چک با `bankAccountId 999999` ۲۰۱ می‌گیرند؛ ۱۰ FK اعلام‌شده سه جدول خزانه در پایگاه‌داده نیست | bankAccount.service.ts، chequeLifecycle.service.ts | open (P3) |
| TD-511 | خزانه و چک (بسته ۴) | P3 (B04-15) — تطبیق با سه شناسه (بانک الف، بانک ب، ردیف باطل‌شده) `{"updated": 2}` داد، ردیف باطل‌شده «تطبیق‌یافته» شد، ممیزی هر سه را نوشت و `reconciled_at` تاریخ کسب‌وکار است نه زمان UTC | treasuryTransaction.service.ts | open (P3) |
| TD-512 | خزانه و چک (بسته ۴) | P3 (B04-16) — ممیزی تغییر وضعیت چک فقط `{"status":"in_collection"}` با شرح «… به in_collection» و حذف فقط `{"chequeId":6}` است؛ نه وضعیت قبلی، نه حساب بانکی، نه سند صادر یا باطل‌شده (AGENTS §۵) | treasury.routes.ts | open (P3) |
| TD-513 | خزانه و چک (بسته ۴) | P3 (B04-17) — پنجره تاریخچه `description` می‌خواند و سرور `notes` می‌نویسد؛ پیام‌ها «in_collection» / «passed» / «bounced» دارند؛ فیلتر وضعیت `in_treasury` ندارد؛ «کلیپ‌بورد» در دو پیام | ChequesTab.tsx، chequeLifecycle.service.ts | open (P3) |
| TD-514 | خزانه و چک (بسته ۴) | P3 (B04-18) — `amount`، `initialBalance` و `exchangeRate` با `z.coerce.number()`: «۲۵۰۰۰۰۰» و «2,500,000» ← ۴۰۰ «Invalid input: expected number, received NaN» (AGENTS §۶، TD-385)؛ ارز آزاد است | accounting.schemas.ts | open (P3) |
| TD-515 | خزانه و چک (بسته ۴) | P3 (B04-19) — فرم برای حساب بی سرفصل «سند دوبل صادر نخواهد شد» می‌گوید و سرور ۴۲۲ می‌دهد؛ سرعنوان «… / چک …»؛ اکسل خزانه `customer` و `bank_transfer` خام و نام فایل با تاریخ UTC؛ `react-multi-date-picker` به‌جای `JalaliDateInput` | TreasuryTransactionModal.tsx، BankAndTreasuryTab.tsx | open (P3) |

---

## 📊 آمار رجیستری

- **فعال:** ۲۱ ردیف
- **آرشیو شده (resolved):** ۴۳۹ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`
- مبنای آمار و IDs یکتا: هر دو فایل مجموعاً فضای ID مشترک دارند؛ IDs جدید باید
  از بزرگ‌ترین ID موجود در **هر دو** فایل + ۱ انتخاب شود.

---

> **فاز ۰ ممیزی مستقل (v7.0.18 به بعد):** ردیف‌های TD-171 به بعد که در همان change-set حل شده‌اند مستقیماً در بخش «فاز ۰» فایل `TECH_DEBT_ARCHIVE.md` ثبت شده‌اند.
> ✅ v7.0.44: ردیف‌های `resolved` که در جدول فعال مانده بودند (TD-110، TD-129، TD-132، TD-134، TD-160 تا TD-170) عیناً به بخش «نسخه ۷ — نقشه راه V7» آرشیو منتقل شدند.

*آخرین بازبینی: v9.0.79 — TD-488 (ثبت موجودی اولیه کاردکس ردیف‌های پیشین را بازنویسی نمی‌کند، P2) رفع و بایگانی شد. شناسه‌های رزروشده: `v9/PHASE4_LANES.md` §۷.۲.*
