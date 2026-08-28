# راهنمای استقرار Papital ERP روی سرور مجازی لینوکسی (Ubuntu/Debian)

این راهنمای عملیاتی برای بالا آوردن برنامه روی یک VPS از صفر تا دامنه HTTPS است.

---

## ۱) پیش‌نیازها و نکات مهم قبل از شروع

| نکته | توضیح |
|---|---|
| **مشخصات پیشنهادی سرور** | حداقل ۲ هسته CPU، 4GB RAM، 40GB SSD — Ubuntu 22.04/24.04 LTS یا Debian 12 |
| **دسترسی root/sudo** | اسکریپت‌ها با sudo اجرا می‌شوند |
| **پورت‌ها** | 22 (SSH)، 80 و 443 (وب) — پورت 3000 فقط داخلی است و هرگز نباید به اینترنت باز شود |
| **دیتابیس** | PostgreSQL 14+ به‌صورت خودکار نصب می‌شود و فقط روی localhost گوش می‌دهد (امن) |
| **مهاجرت‌ها** | هرگز `db:push` اجرا نکنید — مایگریشن‌ها در استارتاپ سرور به‌صورت اتمیک خودکار اعمال می‌شوند |
| **Secrets** | `.env` با JWT_SECRET تصادفی ساخته می‌شود و هرگز نباید در گیت باشد |
| **بکاپ** | قبل از هر آپدیت، `update.sh` به‌صورت خودکار بکاپ دیتابیس می‌گیرد (`scripts/backup.sh`) |
| **سیستم‌د** | برنامه به‌عنوان سرویس `papital-erp` ثبت می‌شود — ری‌استارت سرور = بالا آمدن خودکار |

---

## ۲) نصب — دو روش

### روش A: نصب از ریپو گیت (سرور به GitHub دسترسی دارد)
```bash
# اگر ریپو خصوصی است یک Personal Access Token بسازید و در URL بگذارید:
git clone https://<TOKEN>@github.com/jafarmrt/papital-erp.git /opt/papital-erp
cd /opt/papital-erp
sudo bash install.sh          # REPO_URL را با Enter رد کنید یا خالی بگذارید
```

### روش B: نصب از فایل زیپ سورس (پیشنهادی — بدون نیاز به دسترسی گیت)
1. روی ویندوز خودتان: `.\package-source.ps1` → خروجی `papital-erp-source-vX.zip`
2. فایل زیپ را به سرور منتقل کنید:
```bash
# از سمت ویندوز (PowerShell) — آی‌پی سرور را جایگزین کنید:
scp papital-erp-source-v1.3.5.zip root@SERVER_IP:/root/
```
3. روی سرور:
```bash
cd /root
apt-get install -y unzip
unzip papital-erp-source-v*.zip -d /opt/papital-erp
cd /opt/papital-erp
sudo bash install.sh
```

اسکریپت نصب خودکار: نصب Node.js 22 + PostgreSQL → ساخت دیتابیس و کاربر با رمز تصادفی → ساخت `.env` (شامل `JWT_SECRET` و `ERP_SETUP_TOKEN`) → `npm ci` + build → ثبت سرویس systemd → health-check.

خروجی موفق:
```
App URL      : http://SERVER_IP:3000
Setup wizard : http://SERVER_IP:3000/setup?token=<ERP_SETUP_TOKEN از .env>
Service      : systemctl status papital-erp
```

⚠️ **نکته:** `ERP_SETUP_TOKEN` در `.env` است — با `cat /opt/papital-erp/.env` ببینید. ویزارد راه‌اندازی اولیه (ساخت شرکت + کاربر ادمین) فقط با این توکن باز می‌شود و بعد از setup قفل می‌شود.

---

## ۳) تنظیم دامنه اینترنتی + HTTPS

### قدم ۱ — DNS
در پنل مدیریت دامنه (مثلاً ایرنیک/کلودفلر)، یک رکورد **A** بسازید:
```
erp.mycompany.ir  →  IP_عمومی_سرور
```
صبر کنید تا propagate شود (معمولاً چند دقیقه). **اگر کلودفلر دارید:** رکورد را ابتدا با ابر خاکستری (DNS only) تنظیم کنید تا Let's Encrypt درست کار کند؛ بعداً می‌توانید پروکسی را فعال کنید.

### قدم ۲ — اسکریپت خودکار
```bash
cd /opt/papital-erp
sudo bash setup-domain.sh
```
اسکریپت از شما دامنه و ایمیل می‌پرسد (یا مستقیم):
```bash
sudo DOMAIN=erp.mycompany.ir EMAIL=me@mycompany.ir bash setup-domain.sh
```
انجام خودکار: چک DNS → نصب Nginx + Certbot → کانفیگ reverse proxy به پورت 3000 → باز کردن پورت‌های 80/443 در فایروال → صدور گواهی رایگان Let's Encrypt و ریدایرکت خودکار HTTP→HTTPS → به‌روزرسانی `ALLOWED_ORIGINS` در `.env` → ری‌استارت سرویس.

نتیجه: `https://erp.mycompany.ir` 🎉

### قدم ۳ — راستی‌آزمایی
```bash
curl -fsS https://erp.mycompany.ir/health        # باید version و status: ok برگرداند
sudo certbot renew --dry-run                     # تست تمدید خودکار گواهی
```

---

## ۴) به‌روزرسانی نسخه‌های بعدی
```bash
cd /opt/papital-erp
sudo bash update.sh        # بکاپ خودکار دیتابیس + git pull + build + restart + health
```
(در حالت نصب با زیپ: زیپ جدید را در همان پوشه extract کنید و سپس `update.sh` — فایل `.env` دست‌نخورده می‌ماند.)

---

## ۵) عملیات و نگهداری

```bash
systemctl status papital-erp      # وضعیت سرویس
journalctl -u papital-erp -f      # لاگ زنده برنامه
journalctl -u papital-erp -n 200  # آخرین ۲۰۰ خط
systemctl restart papital-erp     # ری‌استارت
```
- لاگ‌های فایل روزانه: `/opt/papital-erp/logs/application-*.log` و `error-*.log`
- بکاپ دستی: `bash scripts/backup.sh` — بکاپ‌های اکسپورت‌شده را خارج از سرور هم ذخیره کنید
- هرگز `.env` را در چت/گیت به اشتراک نگذارید

---

## ۶) چک‌لیست امنیتی بعد از نصب

- [ ] بعد از setup اولیه، ویزارد `/setup` قفل می‌شود — چک کنید: `curl -I http://localhost:3000/setup`
- [ ] رمز کاربر ادمین قوی + ساخت کاربر جدا برای هر نفر (لاگ audit به نام هر کاربر می‌خورد)
- [ ] SSH: ورود با رمز را به کلید عمومی محدود کنید (`PasswordAuthentication no`)
- [ ] پورت 3000 روی فایروال عمومی بسته باشد: `ufw deny 3000/tcp` (فقط Nginx به آن وصل است)
- [ ] بکاپ خودکار روزانه (cron: `0 3 * * * bash /opt/papital-erp/scripts/backup.sh`) + انتقال بکاپ به محل دوم
- [ ] `sudo certbot renew --dry-run` یک بار بعد از نصب
- [ ] endpointهای تست سیستم به‌صورت پیش‌فرض در production قفل‌اند (`runtime_enable_test_endpoints`) — روشن نکنید
