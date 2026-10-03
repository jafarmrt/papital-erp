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

## 🔵 اقلام فعال نسخه ۷ (open / scheduled / in_progress)

| ID | حوزه | شرح | منبع (فایل) | وضعیت |
|----|------|-----|--------------|-------|
| TD-189 | Plaintext Third-Party Credential | ستون `personnel.nobitex_password` رمز حساب صرافی پرسنل را به‌صورت متن ساده در پایگاه‌داده نگه می‌دارد (از v7.0.29 در خروجی داده‌ها حذف می‌شود، اما در دیتابیس و احتمالاً پاسخ‌های API پرسنل باقی است) | src/db/schema/personnel.ts:34 | open — حذف نگهداری رمز شخص ثالث یا رمزنگاری در سطح برنامه با کلید جدا، و حذف از پاسخ‌های API |
| TD-232 | Mixed-Calendar Text Date Columns | قید قالب v7.0.75 (P3-15) فقط تاریخ بدشکل را رد می‌کند؛ ستون‌های تاریخ متنی (چک، پرسنل، CRM، پروژه، فیش حقوقی، کارکرد روزانه) هنوز هم تاریخ شمسی و هم میلادی، و گاهی ارقام فارسی (`effective_date` نرخ کارمزدی) نگه می‌دارند و مقایسه متنی بازه‌ها روی آن‌ها دقیق نیست | drizzle/0028 و 0030، ستون‌های تاریخ متنی | open — یکسان‌سازی تقویم هر ستون (نرمال‌سازی ورودی سرور و تبدیل داده قدیمی با گزارش) نیازمند تصمیم مالک محصول؛ سپس قید `iso` |
| TD-238 | Procurement Workflow Snapshot | `ProcurementService` (اجرای اقدام درخواست خرید و تحویل انبار) تصویر فرایند `snapshotDsl` را مستقیم می‌خواند و از `isUsableSnapshot` عبور نمی‌دهد؛ تصویر نسخه ۱ پیش از v7.0.87 (بدون شناسه پایگاه‌داده) برخلاف AGENTS.md §14.3 به کار می‌رود (شناسایی‌شده در v7.0.108) | src/services/procurement.service.ts | open |
| TD-239 | Money via Number() in Procurement / Reservation Totals | جمع مبلغ اسناد خرید (`Number(l.unitPrice)`، `lineQty * linePrice`، `totalAmt +=`) و ارزش رزرو پروژه (`Number(weightedAverageCost)`، `reservedQty * price`) برخلاف AGENTS.md §1.8 با عدد JS حساب می‌شوند (شناسایی‌شده در v7.0.108) | src/services/procurement.service.ts، src/services/items/itemStockReservation.service.ts | open |
| TD-240 | Treasury / Cheque «all» Filter | `GET /accounting/treasury-transactions?type=all` و `GET /accounting/cheques?type=all|status=all` را Zod می‌پذیرد ولی سرویس‌ها `eq(column, 'all')` می‌سازند و هیچ ردیفی برنمی‌گردد (سرویس اسناد حسابداری `'all'` را نادیده می‌گیرد)؛ صفحه فعلی فیلتر را در مرورگر اعمال می‌کند و این پارامترها را نمی‌فرستد (شناسایی‌شده در v7.0.109) | src/services/accounting/treasury/treasuryTransaction.service.ts، src/services/accounting/treasury/chequeLifecycle.service.ts | open |

---

## 📊 آمار رجیستری

- **فعال:** ۵ ردیف
- **آرشیو شده (resolved):** ۲۲۲ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`
- مبنای آمار و IDs یکتا: هر دو فایل مجموعاً فضای ID مشترک دارند؛ IDs جدید باید
  از بزرگ‌ترین ID موجود در **هر دو** فایل + ۱ انتخاب شود.

---

> **فاز ۰ ممیزی مستقل (v7.0.18 به بعد):** ردیف‌های TD-171 به بعد که در همان change-set حل شده‌اند مستقیماً در بخش «فاز ۰» فایل `TECH_DEBT_ARCHIVE.md` ثبت شده‌اند.
> ✅ v7.0.44: ردیف‌های `resolved` که در جدول فعال مانده بودند (TD-110، TD-129، TD-132، TD-134، TD-160 تا TD-170) عیناً به بخش «نسخه ۷ — نقشه راه V7» آرشیو منتقل شدند.

*آخرین بازبینی: v7.0.109 — TD-106 (any؛ مسیرهای پول و انبار سرور صفر و قفل خطا، بقیه با چرخ‌دنده به تفکیک فایل) حل و آرشیو شد؛ TD-240 ثبت شد.*
