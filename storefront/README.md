# برنامهٔ فروشگاه papitalgallery.com

برنامهٔ جدای سایت فروشگاه (فاز ۸ نسخهٔ ۱۱، مرحلهٔ ۸.۳). صفحه‌ها روی سرور ساخته می‌شوند و همهٔ داده را فقط از Storefront API برنامهٔ ERP می‌خوانند (`/api/storefront/v1`). کلید API فقط روی سرور این برنامه است و به مرورگر نمی‌رسد. برنامه‌های آغاز این کار: `docs/roadmap/V11_STOREFRONT_START_PLAN.md` و `docs/roadmap/V11_STOREFRONT_8_3_PAGES_START_PLAN.md`.

## اجرا روی رایانهٔ توسعه

```bash
cd storefront
npm ci
npm run mock-api          # API نمونه با دادهٔ ساختگی mock/sample روی درگاه 3901
STOREFRONT_API_URL=http://127.0.0.1:3901/api/storefront/v1 STOREFRONT_API_KEY=preview-key npm run dev
```

- برای دادهٔ دیگر، `FIXTURE_DIR` را به پوشه‌ای بدهید که `catalog.json` و پوشهٔ `media/` دارد. `settings.json` و `brand.json` اختیاری‌اند.
- دادهٔ واقعی و عکس‌ها هرگز در این مخزن عمومی گذاشته نمی‌شوند.

## متغیرهای محیط

| نام | کار |
|---|---|
| `STOREFRONT_API_URL` | نشانی Storefront API برنامهٔ ERP |
| `STOREFRONT_API_KEY` | کلیدی که در ERP، در «فروشگاه سایت» → «کلید برنامه سایت» ساخته می‌شود |
| `STOREFRONT_SITE_URL` | نشانی عمومی سایت، برای پیوندهای canonical و کارت شبکه‌های اجتماعی |
| `STOREFRONT_PORT`، `STOREFRONT_HOST` | جایی که `npm start` گوش می‌دهد (پیش‌فرض: `127.0.0.1:3100`) |
| `STOREFRONT_PREVIEW_NOTICE` | نوار بالای صفحه، فقط در پیش‌نمایش |

## بررسی‌ها

```bash
npm run typecheck
npm test        # ساخت برنامه، سپس آزمون صفحه‌ها در برابر API نمونه
```

## بار روی ERP
همهٔ بازدیدکننده‌ها از راه همین برنامه به ERP می‌رسند، پس سقف درخواست Storefront API (۱۲۰۰ در دقیقه برای هر نشانی) میان همهٔ آن‌ها مشترک است. برای همین برنامه عکس محصولات را پس از اولین خواندن در حافظه نگه می‌دارد (تا ۹۶ مگابایت؛ نام هر عکس هش محتوای آن است و کهنه نمی‌شود)، پاسخ کاتالوگ را چند ثانیه نگه می‌دارد و نشانیِ ناموجود را یک دقیقه به خاطر می‌سپارد. در راه‌اندازی روی سرور (مرحلهٔ ۸.۶) یک کش وب‌سرور جلوی `/media` و `/assets` هم گذاشته می‌شود.
