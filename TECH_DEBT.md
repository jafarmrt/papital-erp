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

## 🔵 اقلام فعال نسخه ۸ (open / scheduled / in_progress)

| ID | حوزه | شرح | منبع (فایل) | وضعیت |
|----|------|-----|--------------|-------|
| TD-250 | انبار / بهای تمام‌شده | P1 — تخفیف ردیف خرید در سند حسابداری کم می‌شود ولی در WAC و کاردکس نه؛ کالا با قیمت پیش از تخفیف وارد انبار می‌شود، WAC بیش از بهای واقعی است و ارزش انبار از مانده حساب موجودی بیشتر می‌شود (ممیزی v8، کلاس I3:purchase-discount، آزمون inv_known_findings_baseline) | documentCreation.service.ts (applyStockMovement با price)، voucherSync.service.ts (syncPurchaseInvoiceVoucher) | open |
| TD-251 | حسابداری / ابطال | P1 — ابطال سند تجاری‌ای که سند حسابداری‌اش هنوز پیش‌نویس است، سند معکوس «تأییدشده» می‌سازد؛ تراز آزمایشی و صورت‌ها (فقط تأییدشده و دائم) سند معکوس را بدون سند اصلی می‌بینند و حساب دریافتنی و فروش منفی می‌شوند (کلاس I6:void-draft-reversal-approved) | documentLifecycle.service.ts (deleteDocument)، voucher.service.ts (reverseVoucher) | open |
| TD-252 | حسابداری / سال مالی | P0 — بستن سال مالی اسناد حسابداری پیش‌نویس همان سال (همه اسناد خودکار فروش، خرید و انبار) را بی‌هشدار کنار می‌گذارد و سود را بدون آن‌ها می‌بندد؛ پس از بستن، آن اسناد دیگر تأییدشدنی نیستند (کلاس FOCUSED:fiscal-closing-ignores-draft-vouchers) | fiscalYear.service.ts (executeFiscalYearClosing)، accountingReport.service.ts (getTrialBalance) | open |
| TD-253 | فروش / برگشت | P1 — برگشت از فروش بیش از مقدار فروخته‌شده فاکتور مرجع و برگشت چندباره یک فاکتور پذیرفته می‌شود؛ موجودی و بستانکاری مشتری بی‌پشتوانه زیاد می‌شود (کلاس I14:over-return) | salesReturnCost.ts (resolveSalesReturnUnitCosts)، documentCreation.service.ts | open |
| TD-254 | انبار / ابطال | P2 — ابطال سند خروجی (فروش، حواله، ضایعات) پس از تغییر WAC: کالا با WAC جاری برمی‌گردد و WAC بازمحاسبه نمی‌شود، ولی سند معکوس بهای خروج اصلی را برمی‌گرداند؛ ارزش انبار با دفتر کل اختلاف می‌گیرد (کلاس I3:void-out-at-current-wac) | documentStockEngine.service.ts (applyStockReversal) | open |
| TD-255 | انبار / حسابداری | P2 — اسناد انبارگردانی (کسری و اضافی) هیچ سند حسابداری ندارند؛ ارزش انبار تغییر می‌کند ولی دفتر کل نه (کلاس I3:stock-count-without-voucher؛ سرفصل‌ها نیازمند تصمیم مالک محصول) | documentCreation.service.ts (شاخه audit)، voucherSync.service.ts | open |
| TD-256 | انبار / کاردکس | P2 — رسید با قیمت صفر به WAC جاری ارزش‌گذاری می‌شود (WAC تغییر نمی‌کند و سند حسابداری به WAC صادر می‌شود) ولی ردیف کاردکس قیمت صفر دارد؛ ابطال آن با قیمت صفر برمی‌گردد، WAC بالا می‌رود و ارزش انبار از دفتر کل جدا می‌شود (کلاس I3:zero-price-receipt-void) | documentStockEngine.service.ts، financialDecimal.ts (calculateWAC) | open |
| TD-257 | انبار / تاریخ | P2 — سند خروج با تاریخ پیش از ورود کالا پذیرفته می‌شود (کنترل موجودی فقط لحظه ثبت)؛ کاردکس به ترتیب تاریخ منفی می‌شود و بازسازی کاردکس آن کالا رد می‌شود (کلاس I13:backdated-out-before-stock؛ سیاست نیازمند تصمیم مالک محصول) | documentCreation.service.ts، kardexWacRecalculator.service.ts | open |
| TD-258 | انبار / بازسازی | P2 — بازسازی کاردکس WAC را با الگوریتمی جدا از موتور زنده حساب می‌کند (ترتیب تاریخ به‌جای ترتیب ثبت، حذف کامل رسید ابطال‌شده)؛ ابزار تعمیر WAC سالم را تغییر می‌دهد و آن را از دفتر کل جدا می‌کند (کلاس I13:rebuild-wac-diverges) | kardexWacRecalculator.service.ts (rebuildItemFromLedger) | open |
| TD-259 | حسابداری / نگاشت | P2 — سند خرید و رسید تولید (و بخشی از اسناد برگشت و ضایعات) سرفصل‌ها را با کد ثابت ۱۴۰۱، ۱۴۰۳، ۳۰۰۱، ۵۱۰۱، ۱۲۰۱ و ۶۰۰۳ می‌گیرند و نگاشت حساب‌ها را نادیده می‌گیرند؛ با نگاشت سفارشی، خرید و فروش یک کالا به دو حساب موجودی می‌روند (کلاس FOCUSED:purchase-voucher-ignores-account-mapping) | voucherSync.service.ts (syncPurchaseInvoiceVoucher، syncWarehouseDocumentVoucher) | open |
| TD-260 | گزارش / ارز | P2 — کارت حساب (دفتر معین و تفصیلی) مبلغ ردیف ارزی را بدون تسعیر با ریال جمع می‌زند و با تراز آزمایشی نمی‌خواند؛ ارزش‌گذاری انبار در بررسی سلامت مالی هم ردیف ارزی را تسعیر نمی‌کند (کلاس FOCUSED:account-card-mixes-currencies) | accountingReport.service.ts (getDetailedAccountCard)، financialHealth.service.ts | open |
| TD-261 | حسابداری / ارز | P3 — ردیف‌های بهای تمام‌شده و موجودی کالای سند ارزی از ریال به ارز سند تبدیل و تا ۴ رقم اعشار گرد می‌شوند؛ هر ردیف تا نرخ/۲۰۰۰۰ ریال با ارزش ریالی انبار اختلاف می‌گیرد (کلاس I3:foreign-rounding) | voucherSync.service.ts (تبدیل COGS به ارز سند) | open |

---

## 📊 آمار رجیستری

- **فعال:** ۱۲ ردیف
- **آرشیو شده (resolved):** ۲۳۶ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`
- مبنای آمار و IDs یکتا: هر دو فایل مجموعاً فضای ID مشترک دارند؛ IDs جدید باید
  از بزرگ‌ترین ID موجود در **هر دو** فایل + ۱ انتخاب شود.

---

> **فاز ۰ ممیزی مستقل (v7.0.18 به بعد):** ردیف‌های TD-171 به بعد که در همان change-set حل شده‌اند مستقیماً در بخش «فاز ۰» فایل `TECH_DEBT_ARCHIVE.md` ثبت شده‌اند.
> ✅ v7.0.44: ردیف‌های `resolved` که در جدول فعال مانده بودند (TD-110، TD-129، TD-132، TD-134، TD-160 تا TD-170) عیناً به بخش «نسخه ۷ — نقشه راه V7» آرشیو منتقل شدند.

*آخرین بازبینی: v8.0.1 — ۱۲ یافته ارزیابی صحت منطق کاری (TD-250 تا TD-261، گزارش `docs/audit/BUSINESS_LOGIC_AUDIT_V8.md`) ثبت شد؛ هر کدام یک کلاس در خط پایه `src/tests/simulation/knownFindings.ts` دارد و نسخه رفع آن، کلاس را از خط پایه برمی‌دارد.*
