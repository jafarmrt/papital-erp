# سامانه جامع ERP و CRM کارگاه — پاپیتال

سیستم یکپارچه مدیریت کارگاه تولیدی: انبارداری با کاردکس رویدادمحور، فاکتور و پیش‌فاکتور، حسابداری دوبل (کدینگ ۴ سطحی، دفتر روزنامه، تراز آزمایشی)، خزانه‌داری و چک صیادی، CRM و قیف فروش، کنترل پروژه‌های تولید با BOM، منابع انسانی و حقوق و دستمزد، موتور گردش کار (ورکفلو) با کارتابل تاییدات، گذرگاه رویدادها (Outbox/DLQ/Webhook) و گزارش‌های BI.

> **نسخه فعلی:** سری فعال `v8.x.y` (نسخه مستقر: `v8.0.82`) — نقشه راه: `V8_MASTER_ROADMAP.md` (سری ۷ بسته‌شده: `V7_MASTER_ROADMAP.md`) • تاریخچه تغییرات: صفحه «معرفی و به‌روزرسانی‌ها» داخل سامانه + `CHANGELOG.md` + `src/data/changelogs/8.ts`

---

## معماری

| لایه | تکنولوژی |
|---|---|
| Frontend | React 19 + Vite 6 + Tailwind CSS 4 + TanStack Query v5 + React Router 7 + Motion 12 + react-multi-date-picker |
| Backend | Node.js 20+ (پیشنهادی 22 LTS) + Express 4 + TypeScript 5.8 (tsx در توسعه / esbuild در بیلد تولید) |
| Database | PostgreSQL 14+ (پیشنهادی 16/17) با Drizzle ORM 0.45 — مهاجرت اتمیک داخلی (`src/db/migrator.ts`) |
| احراز هویت | JWT در کوکی امن HttpOnly (`auth_token`) |
| رویدادها | Domain Event Bus + Transactional Outbox + DLQ + Webhook با امضای HMAC-SHA256 |
| اعتبارسنجی و لاگینگ | Zod 4 + Winston Logger + prom-client (Prometheus Metrics) |

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

### روش ۱: نصاب خودکار (پیشنهادی)
اسکریپت نصاب خودکار `install.sh` تمام مراحل نصب پیش‌نیازها، تنظیم دیتابیس PostgreSQL، بیلد پروژه، راه‌اندازی سرویس systemd و بکاپ روزانه را انجام می‌دهد:

```bash
git clone <repo-url> && cd <repo>
sudo ./install.sh
```

### روش ۲: راه‌اندازی دستی
```bash
git clone <repo-url> && cd <repo>
cp .env.production.example .env    # سپس مقادیر را ویرایش کنید
npm ci
npm run build                       # کلاینت + bundle سرور (dist/server.cjs)
NODE_ENV=production npm start      # مهاجرت‌ها هنگام startup اعمال می‌شوند
```

برای به‌روزرسانی خودکار سرور و سرویس‌های در حال اجرا در آینده نیز اسکریپت `update.sh` آماده است:

```bash
sudo ./update.sh
```

### تنظیمات اولیه پس از نصب

با مراجعه به `/setup?token=<ERP_SETUP_TOKEN>` حساب مدیر ارشد ایجاد و تنظیمات شرکت ثبت می‌شود. (توکن از `.env`)

---

## به‌روزرسانی

```bash
cd /opt/papital-erp
sudo -v && ./update.sh --rehearse     # با کاربر سرویس، نه root؛ sudo -v برای sudo -u postgres در تمرین
```

- `update.sh` پیش از هر کار پشتیبان می‌گیرد (`pre-deployment`)، کد را می‌گیرد و می‌سازد، و فقط وقتی «موفق» اعلام می‌کند که `/health/startup` (پایان مهاجرت‌ها) پاسخ دهد و نسخه در حال اجرا همان نسخه ساخته‌شده باشد؛ در شکست راه بازگشت را چاپ می‌کند (v8.0.83).
- **`--rehearse` (v8.0.88، توصیه‌شده):** پیش از راه‌اندازی دوباره، پشتیبان همین لحظه در پایگاه‌داده تمرین بازیابی و مهاجرت‌های کد تازه روی آن اجرا می‌شود؛ اگر مهاجرتی شکست بخورد یا جمع بدهکار و بستانکار حساب‌ها، موجودی کالاها، مانده بانک‌ها یا سلامت مالی را عوض کند، به‌روزرسانی پیش از راه‌اندازی می‌ایستد و سرویس قبلی دست نمی‌خورد. بدون به‌روزرسانی هم می‌توان آخرین پشتیبان را با کد فعلی تمرین کرد: `./scripts/upgrade-rehearsal.sh [dump]`.
- **ارتقا از v8.0.82 یا قدیمی‌تر:** `update.sh` نسخه قدیمی تا پایان مهاجرت‌ها صبر نمی‌کند؛ ابتدا فقط کد را بگیرید (`git pull --ff-only`) و سپس `sudo -v && ./update.sh --rehearse` را اجرا کنید تا اسکریپت تازه به کار رود.
- دکمه «خروجی داده‌های کسب‌وکاری» در تنظیمات (`GET /api/export-backup`، فقط admin) یک فایل JSON برای گزارش و بایگانی است و **قابل بازگردانی نیست**؛ رمزهای عبور و کلیدهای محرمانه در آن نیست. پشتیبان واقعی فقط با `scripts/backup.sh` و بازگردانی با `scripts/restore.sh`.
- **هرگز `npm run db:push` اجرا نکنید** — تغییر اسکیما فقط از مهاجرت اتمیک builtin.
- **ارتقا به v7.0.56 و بالاتر (یک‌بار، پیوست‌ها):** از این نسخه فایل پیوست‌ها روی دیسک (`public/uploads/.attachments`، داخل همان پوشه‌ای که به‌روزرسانی و پشتیبان‌گیری نگه می‌دارند) ذخیره می‌شوند و پایگاه‌داده فقط مشخصات آن‌ها را دارد. پیوست‌های قدیمی تا انتقال، مثل قبل نمایش داده می‌شوند. پس از ارتقا و یک‌بار راه‌اندازی سرور: `npm run attachments:migrate` (اجرای آزمایشی، فقط شمارش) و سپس `npm run attachments:migrate -- --apply`. در استقرار Docker همان کار با `POST /api/attachments/migrate-inline` و بدنه `{"apply": true}` توسط مدیر سیستم انجام می‌شود.
- **ارتقا به v7.0.45 و بالاتر (یک‌بار):** از این نسخه موجودی هر انبار فقط از جدول موجودی انبارها خوانده می‌شود. مهاجرت 0020 ردیف‌های جاافتاده را از موجودی نمایشی قبلی می‌سازد و موجودی نمایشی همه کالاها را از روی جدول بازسازی می‌کند؛ هر تغییر با مقدار قبل و بعد در جدول `inventory_reconciliation_anomalies` (شناسه اجرا `migration-0020`) ثبت می‌شود. کالاهایی که پیش از این نسخه با دکمه «انتقال بین انبارها» جابه‌جا شده‌اند ممکن است موجودی نادرست داشته باشند. **بلافاصله پس از ارتقا** در «بررسی سلامت و تطبیق موجودی ← تطبیق موجودی انبارها با کاردکس» گزارش را بگیرید، ترمیم را ابتدا به‌صورت آزمایشی و سپس واقعی اجرا کنید تا موجودی از روی کاردکس اصلاح شود.

---

## متغیرهای محیطی (.env)

| کلید | شرح | پیش‌فرض |
|---|---|---|
| `DATABASE_URL` | رشته اتصال PostgreSQL | — (الزامی) |
| `JWT_SECRET` | کلید امضای توکن (حداقل ۳۲ کاراکتر) — `openssl rand -hex 48` | — (الزامی) |
| `ERP_SETUP_TOKEN` | توکن امنیتی صفحه راه‌اندازی اولیه `/setup` | — (الزامی) |
| `ALLOWED_ORIGINS` | origins مجاز CORS (با کاما) | `http://localhost:3000` |
| `EXPOSE_TOKEN_IN_BODY` | برگرداندن توکن JWT در بدنه پاسخ ورود — فقط برای پیش‌نمایش‌هایی که مرورگر کوکی iframe را مسدود می‌کند؛ در محیط عملیاتی تنظیم نشود | خاموش |
| `TRUST_PROXY` | پراکسی‌های معکوس قابل‌اعتماد برای استخراج IP واقعی کاربر (محدودیت تلاش ورود، لاگ ممیزی)؛ کوبرنتیز: `loopback, linklocal, uniquelocal`؛ بدون پراکسی: `false`؛ مقدار `true` پذیرفته نمی‌شود | `loopback, linklocal` (Nginx روی همان سرور) |
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
| مهاجرت شکست خورد | تراکنش اتمیک rollback شده؛ لاگ: `[Migrator]` در لاگ سرور + جدول `drizzle.__drizzle_migrations` |
| نمایش تاریخ/ساعت ناهماهنگ | تنظیمات سامانه ← منطقه زمانی (`display_timezone`) |

سناریوهای عملیاتی کامل‌تر در تاریخچه Git (`docs/runbook.md` تا قبل از v1.1.0) موجود است؛ خلاصه ضروری در بخش بعد.

---

## عملیات (Runbook)

### Backup روزانه

```cron
# /etc/cron.d/papital-erp-backup — کاربر همان کاربر سرویس است؛ پوشه پشتیبان یک‌بار: sudo install -d -o <user> /var/backups/erp
0 2 * * * <user> /opt/papital-erp/scripts/backup.sh >> /var/log/papital-backup.log 2>&1
```

- اسکریپت پوشه برنامه را از جای خودش پیدا می‌کند و `DATABASE_URL` (و `ATTACHMENTS_DIR`) را از `.env` همان پوشه می‌خواند، پس از cron و هر پوشه‌ای کار می‌کند (v8.0.84).
- هر پشتیبان سه فایل دارد: `erp_<نوع>_<زمان>.dump.gz` (پایگاه‌داده)، `.manifest` (فهرست محتوا: شمار و درهم‌سازی سطرهای هر جدول و همه قیدها، از همان snapshot پشتیبان، v8.0.85) و `_uploads.tar.gz` (فایل‌های پیوست). اگر رکورد پیوست هست ولی پوشه پیوست نیست، پشتیبان شکست می‌خورد.
- انواع: `daily` (نگه‌داری ۳۰ روز) • `pre-deployment` (۹۰ روز — `update.sh` خودکار می‌سازد) • `pre-migration` (۱۸۰ روز)

### تمرین بازیابی و بازیابی واقعی

```bash
ls -lt /var/backups/erp/*.dump.gz | head -3
# تمرین (بی اثر روی داده زنده): بازیابی در پایگاه‌داده موقت، مقایسه سطر به سطر با فهرست محتوای پشتیبان،
# سنجش sequenceها و فایل‌های پیوست، سپس حذف پایگاه‌داده موقت (نگه‌داشتن: RESTORE_KEEP=1)
sudo -v && ./scripts/restore.sh [dump-file.dump.gz]

# بازیابی واقعی: سرویس را متوقف کنید؛ نسخه بازیابی‌شده در پایگاه‌داده تازه ساخته و سنجیده می‌شود و فقط بعد
# جایگزین می‌شود. پایگاه‌داده قبلی با نام <db>_before_restore_<زمان> و پوشه پیوست قبلی با پسوند
# .before_restore_<زمان> نگه داشته می‌شوند (v8.0.87).
sudo systemctl stop papital-erp
RESTORE_MODE=apply RESTORE_CONFIRM=yes ./scripts/restore.sh <dump>.dump.gz
sudo systemctl start papital-erp
bash scripts/verify-startup.sh 3000
```

- ساختن و جابه‌جا کردن پایگاه‌داده دسترسی CREATEDB می‌خواهد که نقش برنامه (ساخته `install.sh`) ندارد: اسکریپت با `sudo -u postgres` کار می‌کند (با کاربر سرویس اجرا کنید و پیش از آن `sudo -v`)، یا `RESTORE_ADMIN_URL=postgresql://postgres:...@localhost:5432/postgres` را بدهید (v8.0.86). بی هیچ‌کدام پیش از هر تغییری می‌ایستد.
- پشتیبان‌های پیش از v8.0.85 فهرست محتوا ندارند و تمرین فقط بررسی پایه را انجام می‌دهد (این را چاپ می‌کند).

> اصل: «backup موجود است» ≠ «قابل بازیابی است». تمرین را پس از هر ارتقا و به‌صورت دوره‌ای (مثلاً ماهانه) اجرا کنید.

### Rollback نسخه اپلیکیشن

اگر نسخه تازه مهاجرت اجرا کرده باشد، کد قبلی با پایگاه‌داده تازه‌تر راه نمی‌افتد («the database has … applied migration(s) newer than this build», v8.0.81)؛ پایگاه‌داده را هم از پشتیبان پیش از به‌روزرسانی برگردانید. `update.sh` در شکست همین گام‌ها را با نام commit و پشتیبان چاپ می‌کند:

```bash
sudo systemctl stop papital-erp
git checkout <commit قبلی> && NODE_ENV=development npm ci --include=dev && npm run build
RESTORE_MODE=apply RESTORE_CONFIRM=yes ./scripts/restore.sh /var/backups/erp/erp_pre-deployment_<زمان>.dump.gz
sudo systemctl start papital-erp && bash scripts/verify-startup.sh 3000
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
journalctl -u papital-erp -n 200 | grep Migrator
psql -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 10"
# همه مهاجرت‌های یک ارتقا در یک تراکنش اجرا می‌شوند: یا همه یا هیچ
systemctl restart papital-erp && bash scripts/verify-startup.sh 3000
```

- مهاجرت‌ها روی اتصال جدا و بی مهلت ۶۰ ثانیه‌ای درخواست‌ها اجرا می‌شوند (`MIGRATION_STATEMENT_TIMEOUT`، پیش‌فرض ۰ = بی‌مهلت) و دو اجرای هم‌زمان پشت هم می‌روند (v8.0.82).
- «was never applied to this database but is older than its last applied migration»: فایل مهاجرتی با `when` کوچک‌تر از آخرین مهاجرت اجراشده اضافه شده است و Drizzle آن را بی‌صدا رد می‌کرد؛ این خطای ساخت نسخه است، نه داده (v8.0.81).

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

قواعد کامل و حاکمیت نسخه‌ها: **`AGENTS.md`** (مرجع یگانه) • آرشیو و تاریخچه: `CHANGELOG.md` • دفتر بدهی: `TECH_DEBT.md`

- مهاجرت فقط از migrator اتمیک؛ شماره‌گذاری‌ها فقط با SEQUENCE/counter اتمیک
- خواندن‌ها با `is_deleted = 0` (soft delete)؛ حذف‌ها فقط نرم
- فرانت: همه فراخوانی‌ها با `fetchJson`، آرایه‌ها با گارد `Array.isArray`
- هر تغییر کارکردی: bump نسخه + مدخل چنجلاگ در `src/data/changelogs/3.ts` (سری 3.x) یا فایل فعال مربوطه
