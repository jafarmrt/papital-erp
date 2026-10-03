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
| TD-245 | System Route Findings | یافته‌های انتقال روت سیستم به سرویس (v7.0.123)، بدون تغییر: (۱) بازنشانی کارخانه‌ای `runSeed()` را بی قفل seed اجرا می‌کند و `fiscal_periods`، `file_attachments` (و فایل‌ها)، `legacy_date_repairs`، `ref_fiscal_year_corrections`، `workflow_task_reopen_log` را پاک نمی‌کند؛ پس از بستن سال احتمالاً با خطای FK `fiscal_periods.closing_voucher_id` شکست می‌خورد؛ (۲) `requeue_dlq` ردیف‌های replayed/dismissed را هم دوباره می‌فرستد، ردیف‌ها را سخت حذف می‌کند و تراکنشی نیست؛ شمارش DLQ در سلامت سیستم ردیف‌های بسته‌شده را هم می‌شمارد؛ (۳) بررسی سند نامتوازن بدون `VOUCHER_BALANCE_TOLERANCE` و با اسناد حذف‌شده؛ `totalVouchers` و شمارش کالاها فیلتر حذف نرم ندارند؛ `unbalancedVouchers` همیشه ۰؛ (۴) `clear_stuck_outbox` و `requeue_dlq` بدون `logActivity` کامل؛ (۵) `new Date()` به جای businessClock و ورودی‌های بی Zod در activity-logs و reconciliation-fix | src/services/system/factoryReset.service.ts، systemReconciliation.service.ts، systemHealth.service.ts، src/routes/system.routes.ts | open |

---

## 📊 آمار رجیستری

- **فعال:** ۳ ردیف
- **آرشیو شده (resolved):** ۲۲۹ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`
- مبنای آمار و IDs یکتا: هر دو فایل مجموعاً فضای ID مشترک دارند؛ IDs جدید باید
  از بزرگ‌ترین ID موجود در **هر دو** فایل + ۱ انتخاب شود.

---

> **فاز ۰ ممیزی مستقل (v7.0.18 به بعد):** ردیف‌های TD-171 به بعد که در همان change-set حل شده‌اند مستقیماً در بخش «فاز ۰» فایل `TECH_DEBT_ARCHIVE.md` ثبت شده‌اند.
> ✅ v7.0.44: ردیف‌های `resolved` که در جدول فعال مانده بودند (TD-110، TD-129، TD-132، TD-134، TD-160 تا TD-170) عیناً به بخش «نسخه ۷ — نقشه راه V7» آرشیو منتقل شدند.

*آخرین بازبینی: v7.0.124 — TD-241 بسته شد: پنج صفحه کلیدی روی React Query.*
