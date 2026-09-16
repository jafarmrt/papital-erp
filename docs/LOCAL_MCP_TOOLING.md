# راهنمای ابزارهای محلی MCP و بازرسی دیتابیس (Local MCP Tooling)

این سند راهنمای راه‌اندازی و استفاده از ابزار DBHub MCP جهت بازرسی Read-Only دیتابیس در محیط توسعه محلی کاربر است.

## پیکربندی DBHub MCP
- **محل پیکربندی:** در سطح User کلاینت OpenCode / VSCode:
  - `%USERPROFILE%\.config\opencode\opencode.jsonc`
  - `%USERPROFILE%\.config\opencode\dbhub.toml`
- **امنیت دسترسی:** این فایل‌ها نباید وارد ریپازیتوری گیت شوند چون حاوی اطلاعات دسترسی هستند.

## مشخصات کاربر خواندنی (`erp_readonly`)
- دسترسی‌ها: فقط `CONNECT` + `USAGE` روی اسکیمای `public` و `SELECT` روی جداول.
- دسترسی `CREATE TABLE` و تغییر داده کاملاً محدود و غیرفعال است (هرگونه جهش داده صرفاً از طریق Drizzle ORM و بیزنس لاژیک سامانه انجام می‌شود).

## نکات مهم در ویندوز
- **کدگذاری بدون BOM:** فایل `dbhub.toml` باید الزاماً با کدگذاری **UTF-8 without BOM** ذخیره شود، زیرا پارسر TOML در صورت وجود کاراکتر BOM خطای `Unknown character 65279` می‌دهد.
  ```powershell
  [System.IO.File]::WriteAllText($filePath, $content, [System.Text.UTF8Encoding]::new($false))
  ```
- **تنظیم Readonly در TOML:** در نسخه‌های `@bytebase/dbhub@1.x` فلگ CLI `--readonly` حذف شده و تنظیم فقط‌خواندنی درون فایل TOML به صورت `[[tools]] readonly = true` انجام می‌شود.
