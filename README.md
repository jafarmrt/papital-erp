# سامانه جامع ERP و CRM کارگاه — پاپیتال

سیستم یکپارچه مدیریت کارگاه تولیدی: انبارداری با کاردکس رویدادمحور، فاکتور و پیش‌فاکتور، حسابداری دوبل (کدینگ ۴ سطحی، دفتر روزنامه، تراز آزمایشی)، خزانه‌داری و چک صیادی، CRM و قیف فروش، کنترل پروژه‌های تولید با BOM، منابع انسانی و حقوق و دستمزد، موتور گردش کار (ورکفلو) با کارتابل تاییدات، گذرگاه رویدادها (Outbox/DLQ/Webhook) و گزارش‌های BI.

> **نسخه فعلی:** سری پایدار `v1.x.y` — تاریخچه تغییرات: صفحه «معرفی و به‌روزرسانی‌ها» داخل سامانه + `CHANGELOG.md`

---

## معماری

| لایه | تکنولوژی |
|---|---|
| Frontend | React 18 + Vite + TailwindCSS + TanStack Query + react-multi-date-picker |
| Backend | Node.js + Express + TypeScript (tsx در توسعه / esbuild در بیلد) |
| Database | PostgreSQL 16+ با Drizzle ORM — مهاجرت اتمیک داخلی (`src/db/migrator.ts`) |
| احراز هویت | JWT در کوکی HttpOnly (`auth_token`) |
| رویدادها | Domain Event Bus + Transactional Outbox + DLQ + Webhook با امضای HMAC-SHA256 |

ساختار کلیدی: `src/routes` (API) • `src/services` (منطق کسب‌وکار، شامل `accounting/`) • `src/components` + `src/pages` (UI) • `src/db` (schema + migrator + seed) • `src/tests` (سوییت ۱۵ سناریوی بحرانی)

**قاعده طلایی مهاجرت:** ساختار دیتابیس فقط از migrator اتمیک داخلی اعمال می‌شود. اجرای `npm run db:push` در نصب/آپدیت **ممنوع** است.

---

## پیش‌نیازها

- Node.js 20+ (پیشنهادی 22 LTS)
- PostgreSQL 14+ (پیشنهادی 16/17)
- npm 9+

---

## نصب — مسیر ۱: ویندوز محلی (شخصی)

اسکریپت آماده، PostgreSQL پورتیبل و سرور توسعه را یکجا بالا می‌آورد:

```powershell
# از ریشه پروژه
.\start-local.ps1
# → PostgreSQL روی پورت 5433 + اپلیکیشن روی http://localhost:3000
```

اجرای دستی (بدون اسکریپت):

```powershell
npm install
npm run dev          # سرور توسعه + API روی پورت 3000
```

مهاجرت‌ها و seed اولیه به‌صورت خودکار در startup اجرا می‌شوند.

## نصب — مسیر ۲: سرور / VPS لینوکسی

```bash
git clone <repo-url> && cd <repo>
cp .env.production.example .env    # سپس مقادیر را ویرایش کنید
npm ci
npm run build                       # کلاینت + bundle سرور (dist/server.cjs)
NODE_ENV=production npm start      # مهاجرت‌ها هنگام startup اعمال می‌شوند
```

> نصاب خودکار `install.sh` (systemd + backup) در زیرفاز 7.2 نقشه راه V10 در حال آماده‌سازی است و جایگزین `UBUNTU_INSTALL_GUIDE.md` فعلی خواهد شد.

### تنظیمات اولیه پس از نصب

با مراجعه به `/setup?token=<ERP_SETUP_TOKEN>` حساب مدیر ارشد ایجاد و تنظیمات شرکت ثبت می‌شود. (توکن از `.env`)

---

## به‌روزرسانی

```bash
git pull
npm ci
npm run build
# ری‌استارت سرویس (pm2 یا systemd) — مهاجرت‌های جدید در startup اعمال می‌شوند
```

- قبل از آپدیت، از دیتابیس backup بگیرید (`scripts/backup.sh`).
- **هرگز `npm run db:push` اجرا نکنید** — تغییر اسکیما فقط از مهاجرت اتمیک builtin.

---

## متغیرهای محیطی (.env)

| کلید | شرح | پیش‌فرض |
|---|---|---|
| `DATABASE_URL` | رشته اتصال PostgreSQL | — (الزامی) |
| `JWT_SECRET` | کلید امضای توکن (حداقل ۳۲ کاراکتر) — `openssl rand -hex 48` | — (الزامی) |
| `ERP_SETUP_TOKEN` | توکن امنیتی صفحه راه‌اندازی اولیه `/setup` | — (الزامی) |
| `ALLOWED_ORIGINS` | origins مجاز CORS (با کاما) | `http://localhost:3000` |
| `DB_POOL_MAX` | حداکثر اتصالات Pool | `20` |
| `DB_STATEMENT_TIMEOUT` | سقف زمان کوئری (ms) | `60000` |
| `LOG_LEVEL` | سطح لاگ (error/warn/info) | `info` |
| `ALLOW_SEED_IN_PRODUCTION` | اجازه seed در production (در بولت حداقلی خاموش بماند) | `false` |
| `ERP_ALLOW_TEST_CLEANUP` | گیت پاکسازی فیکسچرهای تست (فقط dev/test) | `false` |
| `ERP_SEED_PERMISSION_CLEANUP` | پاکسازی دسترسی‌های ناشناخته نقش‌ها هنگام seed | `false` |
| `APP_URL` | آدرس عمومی اپ (لینک‌های خودارجاع) | — |
| `GEMINI_API_KEY` | کلید سرویس AI (اختیاری) | — |

---

## سلامت و عیب‌یابی

| endpoint / راهکار | کاربرد |
|---|---|
| `GET /health` | وضعیت کلی + نسخه |
| `GET /health/live` `GET /health/ready` `GET /health/startup` | پروب‌های چرخه حیات |
| `GET /metrics` | متریک‌های Prometheus |
| سرور بالا نمی‌آید: پورت 3000 یا 5433 اشغال/خاموش | ویندوز: `start-local.ps1` دوباره؛ بررسی `dev-server.log` |
| «داده‌ها پاک شد» بعد از تست | فقط با `ERP_ALLOW_TEST_CLEANUP=1` در dev رخ می‌دهد — این پرچم را روی production هرگز ست نکنید |
| مهاجرت شکست خورد | تراکنش اتمیک rollback شده؛ لاگ: `[Migrator]` در لاگ سرور + جدول `migrations_log` |
| نمایش تاریخ/ساعت ناهماهنگ | تنظیمات سامانه ← منطقه زمانی (`display_timezone`) |

سناریوهای عملیاتی کامل‌تر در تاریخچه Git (`docs/runbook.md` تا قبل از v1.1.0) موجود است؛ خلاصه ضروری در بخش بعد.

---

## عملیات (Runbook)

### Backup روزانه

```cron
# /etc/cron.d/papital-erp-backup
0 2 * * * erp cd /opt/papital-erp && DATABASE_URL=... ./scripts/backup.sh >> /var/log/papital-backup.log 2>&1
```

انواع backup در `scripts/backup.sh`: `daily` (نگه‌داری ۳۰ روز) • `pre-deployment` (۹۰ روز — `update.sh` خودکار می‌سازد) • `pre-migration` (۱۸۰ روز)

### بازیابی از Backup

```bash
ls -lt /var/backups/erp/*.dump.gz | head -3
# تست صحت روی staging:
gunzip -c <dump>.dump.gz | pg_restore --clean --if-exists -d papital_staging
# restore واقعی (با downtime):
systemctl stop papital-erp
gunzip -c <dump>.dump.gz | pg_restore --clean --if-exists -d papital_erp
systemctl start papital-erp
curl -fsS http://localhost:3000/health/ready
```

### Rollback نسخه اپلیکیشن

```bash
git log --oneline -10
git revert <commit-hash> --no-edit
npm run build && systemctl restart papital-erp
curl -fsS http://localhost:3000/health/ready
```

### Out-of-Memory و Connection Pool

```bash
journalctl -u papital-erp --since "1 hour ago" | grep -i memory
curl -fsS http://localhost:3000/health/ready     # وضعیت pool
psql -c "SELECT pid, query, state FROM pg_stat_activity WHERE state='active'"
# افزایش MemoryLimit در unit یا DB_POOL_MAX در .env → daemon-reload → restart
```

### Migration شکست‌خورده

```bash
psql -c "SELECT * FROM migrations_log ORDER BY applied_at DESC LIMIT 10"
# مهاجرت اتمیک است: یا کامل اجرا شده یا کامل rollback — گام موفق دوباره اجرا نمی‌شود
systemctl restart papital-erp && curl -fsS http://localhost:3000/health/startup
```

### چرخش Secretها

| Secret | دوره | روش |
|---|---|---|
| `JWT_SECRET` | هر ۳ ماه | `openssl rand -hex 48` → `.env` → restart (نشست‌ها باطل می‌شوند) |
| `ERP_SETUP_TOKEN` | یکبار پس از setup | generate → `.env` → restart |
| `DATABASE_URL` password | هر ۶ ماه | `ALTER USER` در PostgreSQL → `.env` → restart |
| `wc_webhook_secret` | هر ۶ ماه | regenerate در WooCommerce + تنظیمات سامانه (بدون restart) |

پس از هر rotation: `./scripts/smoke-test.sh http://localhost:3000`

---

## قواعد توسعه (خلاصه)

قواعد کامل و حاکمیت نسخه‌ها: **`AGENTS.md`** (مرجع یگانه) • نقشه راه: `docs/V10_MASTER_BLUEPRINT.md` • دفتر بدهی: `TECH_DEBT.md`

- مهاجرت فقط از migrator اتمیک؛ شماره‌گذاری‌ها فقط با SEQUENCE/counter اتمیک
- خواندن‌ها با `is_deleted = 0` (soft delete)؛ حذف‌ها فقط نرم
- فرانت: همه فراخوانی‌ها با `fetchJson`، آرایه‌ها با گارد `Array.isArray`
- هر تغییر کارکردی: bump نسخه + مدخل چنجلاگ در `src/data/changelogs/1.ts`
