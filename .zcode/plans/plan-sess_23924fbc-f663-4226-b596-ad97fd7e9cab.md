## هدف
۱) جلوگیری قطعی از آلودگی دیتابیس زنده توسط تست‌های درون‌برنامه‌ای؛ ۲) ساخت پنل «پیکربندی سیستمی» فقط-admin برای مدیریت امن فلگ‌های env با توضیحات کامل فارسی (اعمال زنده بدون ری‌استارت)؛ ۳) حفظ تمام ۱۵ سوئیت تست (اجرا فقط از CLI). داده‌های تستی باقی‌مانده فعلاً دست نمی‌خورند.

## بخش A — فلگ runtime و سرویس خواندن آن
1. **فایل جدید `src/lib/runtimeFlags.ts`** (الگوی `businessClock.ts`):
   - کلید appSettings: `runtime_enable_test_endpoints`
   - `isTestEndpointsEnabled()`: خواندن با کش ۶۰ثانیه‌ای؛ ترتیب اولویت: مقدار appSettings (اگر موجود) → `process.env.ENABLE_TEST_ENDPOINTS` → `false`
   - `invalidateRuntimeFlagsCache()` برای فراخوانی پس از ذخیره تنظیمات
2. **`src/db/seed.ts`** (بخش defaults خط ~321): افزودن مقدار پیش‌فرض `runtime_enable_test_endpoints: 'false'` (insert-if-missing، idempotent) → تست‌ها به‌صورت پیش‌فرض خاموش
3. **`.env` خط 35**: `ENABLE_TEST_ENDPOINTS=true` → `false` (دفاع لایه‌ دوم)
4. **`.env.example`**: افزودن هر دو فلگ `ENABLE_TEST_ENDPOINTS` و `ERP_ALLOW_TEST_CLEANUP` با کامنت فارسی/انگلیسی توضیحی و هشدار آلودگی دیتابیس

## بخش B — انتقال گیت endpoint های تست به زمان درخواست
5. **`src/routes/system.routes.ts`**:
   - حذف شرط ثبتِ یک‌باره‌ی خط 594؛ هر دو مسیر `GET /system/tests/run` و `POST /system/clean-test-data` همیشه ثبت می‌شوند ولی داخل handler ابتدا گارد اجرا می‌شود:
     - `NODE_ENV === 'production'` → ممنوع همیشگی (کلید ایمنی، UI نمی‌تواند override کند) با `UnauthorizedError`
     - `!(await isTestEndpointsEnabled())` → `UnauthorizedError` با پیام فارسی «اندپوینت‌های تست خاموش است — از پیکربندی سیستمی فعال کنید»
   - حفظ `authorize('admin')` و ساختار فعلی (computed import، logActivity)
6. **`POST /settings` (خط 126-165)**: بلوک اعتبارسنجی خاص برای `runtime_enable_test_endpoints` (مقدار فقط 'true'/'false'، فقط admin — manager رد شود)، سپس فراخوانی `invalidateRuntimeFlagsCache()`

## بخش C — توسعه endpoint وضعیت محیط (فقط نمایش)
7. **`GET /system/env` (خط 47-58)**: گسترش خروجی — `{ nodeEnv, nodeVersion, effectiveTestEndpoints, testEndpointsSource: 'db'|'env'|'default', flags: { DATABASE_URL: set/not-set, JWT_SECRET, ERP_SETUP_TOKEN, ERP_ALLOW_TEST_CLEANUP, ALLOW_SEED_IN_PRODUCTION, ENABLE_TEST_ENDPOINTS } }` — هرگز مقدار secret ها برگردانده نمی‌شود، فقط set/not-set. (همچنین برای بار اول یک فراخوانی‌کننده‌ی واقعی پیدا می‌کند.)

## بخش D — رابط کاربری
8. **حذف تب تست از `src/pages/SettingsPage.tsx`**: import خط 7، آیتم tabs خط 43، رندر خط 211 (تب `system` می‌ماند). فایل `SystemTestRunner.tsx` حذف نمی‌شود (ثبت در TECH_DEBT).
9. **کامپوننت جدید `src/components/settings/SystemConfigTab.tsx`** (الگوی GeneralSettingsTab، props از useSettings):
   - کارت «حالت اجرای سامانه» فقط-خواندنی: نشان NODE_ENV + توضیح «در زمان راه‌اندازی قفل می‌شود و از UI قابل تغییر نیست»
   - کارت «فلگ‌های قابل کنترل»: کلید toggle برای endpoint های تست با توضیح کامل (چه می‌کند، خطر نوشتن در دیتابیس زنده و مصرف شماره اسناد، اعمال زنده بدون ری‌استارت، منبع مقدار فعلی db/env)
   - بخش «فلگ‌های فقط-فایل (قفل‌شده)»: ردیف‌های ERP_ALLOW_TEST_CLEANUP و JWT_SECRET و DATABASE_URL با وضعیت set/not-set و دلیل قفل بودن هرکدام
10. **`src/hooks/useSettings.ts`**: state جدید + sync در useEffect خط 92-167 + افزودن به آرایه‌ی handleSaveSettings خط 256-278
11. **`src/pages/SettingsPage.tsx`**: ثبت تب جدید «پیکربندی سیستمی» فقط برای admin (جایگزین تب قبلی)

## بخش E — الزامات حاکمیتی AGENTS.md (§7، §13، §31)
12. **`package.json`**: نسخه `1.1.0` → `1.1.1`
13. **`src/data/changelogs/1.ts`**: ورودی جدید v1.1.1 (تاریخ شمسی معادل 2026-08-27 → ۵ شهریور ۱۴۰۵) بالای آرایه با شرح کامل تغییرات و دلایل
14. **`TECH_DEBT.md`**: دو ردیف TD جدید: (الف) داده‌های تستی باقی‌مانده در DB زنده — نیازمند پاک‌سازی scoped با تأیید کاربر، open؛ (ب) `SystemTestRunner.tsx` بدون اتصال — راه‌حل آینده: اجرا روی `TEST_DATABASE_URL` جدای دیتابیس، open

## راستی‌آزمایی
- `npm run lint` و `npm run build` بدون خطا
- ری‌استارت dev سرور (`stop-local.ps1` / `start-local.ps1`)
- تأیید: `GET /api/system/tests/run` با فلگ خاموش → خطای 403 فارسی؛ فعال‌سازی از UI → اجرای موفق endpoint؛ بازگرداندن به خاموش
- بررسی ورودی audit log (SETTING_CHANGE / AUDIT_APPLY)

## نکته
پرش شماره‌ی اسنادِ گذشته قابل بازگشت نیست؛ این تغییر فقط جلوی تکرار را می‌گیرد. تب اجرای تست در UI حذف می‌ماند (حتی با فعال‌بودن endpoint، اجرا فقط از API/CLI ممکن است).