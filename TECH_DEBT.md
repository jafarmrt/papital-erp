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
| TD-462 | گردش کار (بسته ۱۴) | P2 (B14-20) — بستن مودال کار تصمیم و توضیح را پاک نمی‌کند و کار بعدی با «رد» و دلیل کار قبلی ثبت می‌شود | ApprovalInboxPage.tsx | open (P2) |
| TD-463 | گردش کار (بسته ۱۴) | P3 (B14-21) — مودال کار انتقال «رد» را انتخاب نمی‌کند و `transitionId` نمی‌فرستد؛ گام با چند انتقال رد از کارتابل رد نمی‌شود | ApprovalInboxPage.tsx، useWorkflowQueries.ts | open (P3) |
| TD-464 | گردش کار (بسته ۱۴) | P3 (B14-22) — جزئیات مودال کار بی `AbortController`: پاسخ دیررس کار ۱ جزئیات کار ۲ را جایگزین کرد (AGENTS §21 FE-008) | ApprovalInboxPage.tsx | open (P3) |
| TD-465 | گردش کار (بسته ۱۴) | P3 (B14-23) — کارت کار مبلغ، نشان «از تفویض»، «گام جاری» و «متقاضی» را از فیلدهایی می‌خواند که سرور نمی‌فرستد | ApprovalInboxPage.tsx | open (P3) |
| TD-466 | گردش کار (بسته ۱۴) | P2 (B14-24) — ویجت مراحل مبلغ ریالی زمینه (TD-404) را با ارز سند نشان می‌دهد: فاکتور ۱۰۰ دلاری «۶۰٬۰۰۰٬۰۰۰ دلار» | WorkflowStepperWidget.tsx | open (P2) |
| TD-467 | گردش کار (بسته ۱۴) | P2 (B14-25) — حوزه‌های تفویض `invoice`، `transfer` و `project` با هیچ کد گردش‌کاری جور نمی‌شوند و تفویض ذخیره‌شده بی‌اثر است | WorkflowDelegationTab.tsx | open (P2، تصمیم ت۶ الف) |
| TD-468 | گردش کار (بسته ۱۴) | P3 (B14-26) — زمان‌های گردش‌کار بی `Z` به مرورگر می‌رسند (AGENTS §1.10) و تاریخ شروع تفویض نیمه‌شب UTC است: زمان ۰۰:۰۰ تا ۰۳:۳۰ تهران روز قبل نشان داده می‌شود | ApprovalInboxPage.tsx، WorkflowStepperWidget.tsx، WorkflowDelegationTab.tsx، workflow.routes.ts | open (P3) |
| TD-469 | گردش کار (بسته ۱۴) | P3 (B14-27) — تأیید گردش‌کار کش اسناد، تدارکات، حسابداری و انبار را تازه نمی‌کند و کلید کش جزئیات تعریف با کلید ذخیره جور نیست (مختصات قدیم طراح دوباره ذخیره می‌شود) | queryInvalidation.ts، useWorkflowQueries.ts | open (P3) |
| TD-470 | گردش کار (بسته ۱۴) | P3 (B14-28) — اصطلاح انگلیسی و آوانویسی (SLA، State، Transition، AND_ALL، «ورکفلو»، «اکشن»، «متریال»)، کد نقش خام، رقم لاتین و کد `WF_*` در متن رابط و پیام‌های گردش‌کار | WorkflowDesignerCanvas.tsx، WorkflowSlaAnalyticsTab.tsx، WorkflowManagementPage.tsx، useWorkflowQueries.ts، workflow.routes.ts | open (P3، تصمیم ت۱۰ الف) |
| TD-497 | خزانه و چک (بسته ۴)؛ اثر روی ۳ و ۱۲ | P1 (B04-01) — سند چک (ثبت، برگشت، عودت) همیشه ۱۲۰۱ با تفصیلی `customer` یا ۳۰۰۱ با `supplier` و شناسه `partyId` می‌زند: چک دریافتی ۴٬۰۰۰٬۰۰۰ از پرسنل #۱ و چک پرداختی ۱٬۵۰۰٬۰۰۰ به او روی کارت حساب **مشتری #۱** نشست (مانده −۲٬۵۰۰٬۰۰۰)؛ چک «متفرقه» به ۱۲۰۱ مشتری بی‌شناسه رفت | chequeLifecycle.service.ts، ChequesTab.tsx | open (P1، تصمیم ت۲ الف) |
| TD-498 | خزانه و چک (بسته ۴) | P1 (B04-02) — خرج چک دریافتی از رابط فقط نام گیرنده را می‌فرستد و سند `3001 dr` با تفصیلی `other` بی شناسه می‌گیرد: از دو چک ۴٬۰۰۰٬۰۰۰ و ۲٬۵۰۰٬۰۰۰ خرج‌شده به یک تأمین‌کننده، کارت او فقط ۲٬۵۰۰٬۰۰۰ را دید | chequeLifecycle.service.ts، useChequeQueries.ts، ChequesTab.tsx | open (P1، تصمیم ت۳ الف) |
| TD-501 | خزانه و چک (بسته ۴)؛ اثر روی ۸ | P2 (B04-05) — `documentId` و `partyId` تراکنش خزانه بی هیچ بررسی ذخیره می‌شوند: دریافت از مشتری الف فاکتور مشتری ب را تسویه کرد؛ پرداخت به تأمین‌کننده روی فاکتور فروش، و `documentId` / `partyId` ناموجود ۲۰۱ گرفتند | treasuryTransaction.service.ts | open (P2) |
| TD-502 | خزانه و چک (بسته ۴) | P2 (B04-06) — حذف چک سند `permanent` را بی‌صدا رد می‌کند و چک را حذف می‌کند: چک دریافتی ۶٬۰۰۰٬۰۰۰ با سند قطعی حذف شد (۲۰۰) و `1101 dr 6000000` بی چک ماند؛ منوی چک وصول‌شده «حذف» را نشان می‌دهد | chequeLifecycle.service.ts، ChequesTab.tsx | open (P2، تصمیم ت۹ الف) |
| TD-503 | خزانه و چک (بسته ۴) | P2 (B04-07) — حذف حساب بانکی فقط تراکنش و چک را می‌سنجد: حساب با مانده اول دوره ۷٬۰۰۰٬۰۰۰ (سند افتتاحیه تأییدشده) حذف شد و سرفصل بانک ۷٬۰۰۰٬۰۰۰ بی حساب ماند | bankAccount.service.ts | open (P2، تصمیم ت۹ الف) |
| TD-504 | خزانه و چک (بسته ۴)؛ اثر روی ۱۴ | P2 (B04-08) — ویرایش مانده اول دوره حسابی که نمونه گردش‌کار `bank_account` آن باز است سند افتتاحیه را مستقیم صادر می‌کند: حساب ۵٬۰۰۰٬۰۰۰ در انتظار تأیید، `PUT initialBalance 5,500,000` ← سند افتتاحیه ۵٬۵۰۰٬۰۰۰ و نمونه هنوز `IN_PROGRESS` | bankAccount.service.ts | open (P2، تصمیم ت۸ الف) |
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

- **فعال:** ۲۶ ردیف
- **آرشیو شده (resolved):** ۴۱۷ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`
- مبنای آمار و IDs یکتا: هر دو فایل مجموعاً فضای ID مشترک دارند؛ IDs جدید باید
  از بزرگ‌ترین ID موجود در **هر دو** فایل + ۱ انتخاب شود.

---

> **فاز ۰ ممیزی مستقل (v7.0.18 به بعد):** ردیف‌های TD-171 به بعد که در همان change-set حل شده‌اند مستقیماً در بخش «فاز ۰» فایل `TECH_DEBT_ARCHIVE.md` ثبت شده‌اند.
> ✅ v7.0.44: ردیف‌های `resolved` که در جدول فعال مانده بودند (TD-110، TD-129، TD-132، TD-134، TD-160 تا TD-170) عیناً به بخش «نسخه ۷ — نقشه راه V7» آرشیو منتقل شدند.

*آخرین بازبینی: v9.0.56 — TD-500 (تسویه فاکتور پس از ابطال و دریافت دوباره، P1) رفع و بایگانی شد. شناسه‌های رزروشده: `v9/PHASE4_LANES.md` §۷.۲.*
