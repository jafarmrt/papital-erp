# راهنمای محیط توسعه لوکال ویندوز و دیتابیس محلی (Windows Local Dev)

این سند برای توسعه‌دهندگانی است که پروژه را مستقیماً روی ویندوز با دیتابیس محلی اجرا می‌کنند.

## چرخه حیات دیتابیس محلی (Local DB Lifecycle)
- **عدم وابستگی به سرویس پیش‌فرض ویندوز:** پایگاه داده PostgreSQL محلی این پروژه به‌صورت پیش‌فرض Windows Service نیست؛ بلکه از یک نمونه پرتابل `.pgdata` روی پورت `5433` استفاده می‌کند.
- **اسکریپت‌های مدیریت اجرا:**
  - شروع پایگاه داده: `.\start-local.ps1`
  - توقف پایگاه داده: `.\stop-local.ps1`
  - وضعیت پایگاه داده: `.\status-local.ps1`
- **تشخیص قطعی:** در صورت مشاهده خطای `ECONNREFUSED` در لاگ سرور یا `[Migrator]` هنگام `npm run dev`، اتصال به پورت 5433 را با دستور زیر بررسی کنید:
  ```powershell
  Test-NetConnection localhost -Port 5433
  ```
- **ثبت دائمی به عنوان سرویس ویندوز (اختیاری جهت سهولت):**
  برای اجرای خودکار پایگاه‌داده با بالا آمدن ویندوز (نیاز به دسترسی Administrator):
  ```powershell
  pg_ctl register -N PapitalPostgreSQL -D "<path_to_pgdata>" -o "-p 5433"
  Set-Service -Name PapitalPostgreSQL -StartupType Automatic
  ```
