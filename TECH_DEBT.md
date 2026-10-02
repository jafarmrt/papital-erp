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
| TD-080 | Refactoring Budget | خردسازی گادفایل‌ها و توابع با پیچیدگی بالا: (۱) تجزیه کامل src/utils.ts به ۴ ماژول در utils/ [انجام شد: v7.0.16]؛ (۲) تفکیک کامل document.service.ts به ۵ ماژول در services/documents/ [انجام شد: v7.0.17]؛ (۳) تفکیک صفحات DocumentsPage و InvoicesListPage | src/utils.ts، src/services، src/pages | in_progress — فاز ۴.۴ نسخه ۷ |
| TD-085 | Workflow/Events UX | (۱) پیش‌نمایش شرایط لازم به فارسی از `evaluateRuleBreakdown` قبل از اقدام؛ (۲) نمایش پیشرفت امضا «n از m» در Stepper از `approvalProgressJson`؛ (۳) انتخاب‌گر فیلد payload به‌جای تایپ دستی `{{payload.x}}` در RuleEditorModal؛ (۴) قوانین پیش‌فرض یادآوری SLA | workflow/task/rule UI | scheduled:فاز ۳ نسخه ۷ |
| TD-106 | Frontend / Type Safety (FE-007) | ۹۱۸ مورد `: any` و ۲۷۹ مورد `as any` در سورس‌کد | سراسر src | scheduled:فاز ۳ نسخه ۷ |
| TD-108 | FE Helpers (Badges) | ۱۲ کپی `getStatusBadge`/`getPriorityBadge` با الگو یکسان ولی واژگان/رنگ متفاوت — تجمیع در PillBadge | components/pages | scheduled:فاز ۳ نسخه ۷ |
| TD-109 | Runtime Flags Cleanup | پاکسازی کامل سرویس/کلیدهای موقت test_endpoints پس از حذف روت‌های تست | src/lib/runtimeFlags.ts | scheduled:فاز ۲ نسخه ۷ |
| TD-112 | Workflow Keep-List | روت‌های بدون مصرف‌کننده فرانت‌اند در انتظار رابط کاربری فاز ۳ | workflow.routes.ts | scheduled:فاز ۳ نسخه ۷ |
| TD-177 | Docker Image Size | کتابخانه‌های صرفاً فرانت‌اند (react، lucide-react، xlsx، فونت‌ها، react-multi-date-picker و ...) در `dependencies` هستند و با `npm ci --omit=dev` وارد ایمیج رانتایم می‌شوند در حالی که سرور فقط ۲۴ ماژول require می‌کند | package.json، Dockerfile | open — انتقال وابستگی‌های فقط-کلاینت به devDependencies پس از بررسی |
| TD-179 | Business Clock / Nowruz Approximation | شاخه میلادی `resolveJalaliFiscalYear` (businessClock.ts:132-141) نوروز را همیشه ۲۱ مارس فرض می‌کند؛ در سال‌هایی که نوروز ۲۰ مارس است، اسناد آن روز به سال مالی قبل نسبت داده می‌شوند (هم در پارتیشن شمارنده عطف و هم در `checkFiscalPeriodOpen`). تابع SQL `erp_ref_fiscal_year` در مهاجرت 0015 عمداً همین رفتار را آینه کرده تا دامنه یکتایی با شمارنده یکسان بماند | src/lib/businessClock.ts:116، drizzle/0015 | open — جایگزینی با تبدیل دقیق جلالی در هر دو سمت و بازمحاسبه ref_fiscal_year فقط برای ردیف‌های مرزی |
| TD-187 | Targeted Account Lockout (residual) | با قفل تدریجی (TD-186) قفل حساب حداکثر ۳۰ دقیقه است، اما مهاجم بدون احراز هویت همچنان می‌تواند با یک تلاش ناموفق پس از پایان هر قفل، حساب هدف (مثلاً admin) را در قفل نگه دارد؛ قفل در سطح نام کاربری است نه (نام کاربری + IP). وضعیت قفل نام‌های کاربری ناموجود درون‌حافظه‌ای و مخصوص هر Pod است | src/services/auth/loginSecurity.service.ts | open — قفل در سطح (نام کاربری + IP) یا CAPTCHA پس از آستانه (ذخیره مشترک چند Pod با تصمیم v7.0.44 لازم نیست: استقرار تک‌نمونه‌ای) |
| TD-189 | Plaintext Third-Party Credential | ستون `personnel.nobitex_password` رمز حساب صرافی پرسنل را به‌صورت متن ساده در پایگاه‌داده نگه می‌دارد (از v7.0.29 در خروجی داده‌ها حذف می‌شود، اما در دیتابیس و احتمالاً پاسخ‌های API پرسنل باقی است) | src/db/schema/personnel.ts:34 | open — حذف نگهداری رمز شخص ثالث یا رمزنگاری در سطح برنامه با کلید جدا، و حذف از پاسخ‌های API |
| TD-191 | WooCommerce Order Totals (shipping / fees / tax) | فاکتور سفارش ووکامرس فقط از `line_items` ساخته می‌شود؛ هزینه ارسال (`shipping_lines`)، کارمزدها (`fee_lines`) و مالیات سفارش (`total_tax`) در فاکتور و سند حسابداری ثبت نمی‌شوند، پس جمع فاکتور می‌تواند از مبلغ پرداختی مشتری کمتر باشد | src/services/woocommerce/wooOrderSync.service.ts | open — نیازمند تصمیم مالک محصول درباره سرفصل درآمد حمل و نگاشت مالیات ووکامرس به فیلدهای ساختاریافته ارزش افزوده |
| TD-195 | Voucher Number Uniqueness Not Enforced in DB | گزارش ممیزی (P1-8) ایندکس یکتای `journal_vouchers(voucher_number)` را هم پیشنهاد کرده بود؛ اضافه نشد چون داده‌های قدیمی ممکن است شماره تکراری داشته باشند و شکست ساخت ایندکس، راه‌اندازی پروداکشن را متوقف می‌کند. شماره‌های جدید از sequence می‌آیند و تکراری نمی‌شوند | src/db/schema/accounting.ts، drizzle/ | open — گزارش شماره‌های تکراری در بازرس سلامت مالی، اصلاح با تصمیم حسابدار و سپس مهاجرت ایندکس یکتا |
| TD-198 | Exchange Rate Parsed From Notes | `syncSalesInvoiceVoucher` (voucherSync.service.ts) نرخ تسعیر فاکتورهای ارزی را در نبود گزینه صریح با الگوی متنی «نرخ تسعیر» / exchange_rate از متن یادداشت سند استخراج می‌کند — همان کلاس مشکل P1-7؛ یادداشت آزاد می‌تواند نرخ تسعیر سند حسابداری را تغییر دهد | src/services/accounting/voucherSync.service.ts | open — ستون ساختاریافته نرخ تسعیر روی سند |
| TD-199 | Pre-v7.0.32 Proformas Keep VAT Only in Notes | با تصمیم مالک محصول داده قدیمی منتقل نشد؛ پیش‌فاکتورهایی که پیش از v7.0.32 با مالیات ثبت شده‌اند مالیات را فقط در متن یادداشت دارند و اگر بدون ویرایش نهایی شوند، فاکتور و سند حسابداری بدون مالیات صادر می‌شوند | documents (vat_percent / vat_amount) | open — پیش از نهایی‌سازی، پیش‌فاکتور قدیمی را در فرم ویرایش باز و مالیات را دوباره فعال کنید؛ یا گزارش پیش‌فاکتورهای باز دارای برچسب مالیات در یادداشت |
| TD-210 | Money Columns as JS double (P2-6) | ستون‌های مالی `numeric(18,4)` با `mode: 'number'` به double جاوااسکریپت تبدیل می‌شوند (۱۵ تا ۱۷ رقم معنادار) و تجمیع‌های گزارشی در JS انجام می‌شود | src/db/schema/*.ts، گزارش‌های حسابداری | scheduled:فاز ۳ نسخه ۷ — با تصمیم مالک محصول (v7.0.44) به فاز ۳ موکول شد؛ با ابعاد یک کارگاه مبالغ از محدوده دقت double فراتر نمی‌روند |
| TD-223 | Read Endpoints Without Permission Scope (beyond P2-10) | حدود ۴۰ مسیر GET فقط احراز هویت دارند و هیچ `authorize` ندارند؛ از جمله داده حساس: فهرست و خروجی اکسل طرف‌حساب‌ها (`/customers`، `/customers/export-excel`)، فهرست و جزئیات اسناد و فاکتورها (`/documents`، `/documents/:id`)، قیمت‌های کالا (`/items/prices/all`)، پرسنل (`/personnel`) و فیش‌های حقوقی با مبالغ (`/piecework/payrolls`؛ اطلاعات بانکی ماسک می‌شود)، فهرست کاربران (`/users`). برخی برای فهرست‌های انتخابی فرم‌ها لازم‌اند | src/routes/*.routes.ts | open — نیازمند نگاشت مسیر به مجوز با تصمیم مالک محصول (بخش‌های بند P2-10 در v7.0.53 انجام شد) |
| TD-224 | Attachment Storage Residuals | (۱) فایل پیوست پیش از پایان تراکنش ذخیره رکورد روی دیسک نوشته می‌شود؛ اگر تراکنش برگردد فایل بدون ردیف ثبت روی دیسک می‌ماند (از هیچ مسیری قابل دریافت نیست، فقط فضا می‌گیرد)؛ فایل‌های پیوست جداشده از رکورد هم نگه داشته می‌شوند. (۲) در محیط پیش‌نمایشی که مرورگر کوکی را مسدود می‌کند (EXPOSE_TOKEN_IN_BODY)، تصویر پیوست با `<img src>` بدون هدر Bearer بارگذاری نمی‌شود | src/services/attachments/attachmentStorage.service.ts | open — دستور پاکسازی فایل‌های بدون ثبت در صورت نیاز |
| TD-130 | Hard Delete in updateDocument | بررسی ردیف‌های document_items در ویرایش سند جهت هم‌ترازی با soft-delete | document.service.ts:235 | scheduled:فاز ۱ نسخه ۷ |

---

## 📊 آمار رجیستری

- **فعال:** ۱۸ ردیف
- **آرشیو شده (resolved):** ۱۹۳ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`
- مبنای آمار و IDs یکتا: هر دو فایل مجموعاً فضای ID مشترک دارند؛ IDs جدید باید
  از بزرگ‌ترین ID موجود در **هر دو** فایل + ۱ انتخاب شود.

---

> **فاز ۰ ممیزی مستقل (v7.0.18 به بعد):** ردیف‌های TD-171 به بعد که در همان change-set حل شده‌اند مستقیماً در بخش «فاز ۰» فایل `TECH_DEBT_ARCHIVE.md` ثبت شده‌اند.
> ✅ v7.0.44: ردیف‌های `resolved` که در جدول فعال مانده بودند (TD-110، TD-129، TD-132، TD-134، TD-160 تا TD-170) عیناً به بخش «نسخه ۷ — نقشه راه V7» آرشیو منتقل شدند.

*آخرین بازبینی: v7.0.58 — P2-13 حل TD-173 (آرشیو).*
