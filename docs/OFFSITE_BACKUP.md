# رونوشت رمزگذاری‌شده پشتیبان در گوگل‌درایو و هشدارهای سرور

> نسخه ۱۰.۰.۱ تا ۱۰.۰.۴ (O-02 و O-03 نقشه راه نسخه ۱۰؛ TD-957، TD-1020، TD-1021). این راهنما کارهای یک‌باره روی سرور را می‌گوید. همه دستورها روی سرور و با کاربری اجرا می‌شوند که سرویس با آن کار می‌کند (روی سرور فعلی `root`).

## آنچه خودکار انجام می‌شود

- **هر شب ساعت ۲:۳۰ (به وقت سرور):** `scripts/backup.sh` پشتیبان کامل می‌گیرد (پایگاه‌داده، فهرست محتوا، پیوست‌ها) و آن را بررسی می‌کند. سپس `scripts/backup-offsite.sh` پشتیبان را همراه فایل `.env` به گوگل‌درایو می‌فرستد.
- **رمزگذاری:** پیش از ارسال، rclone نام و محتوای هر فایل را روی خود سرور رمزگذاری می‌کند. گوگل فقط فایل‌های ناخوانا می‌بیند. اسکریپت به هر مقصدی جز یک remote از نوع `crypt` چیزی نمی‌فرستد.
- **کلید رمز اسرار:** فایل `.env` کلید `ERP_SECRETS_KEY` را دارد. بدون این کلید، رمز نوبیتکس پرسنل و کلیدهای ووکامرس و وب‌هوک روی سرور تازه خوانده نمی‌شوند. این کلید همراه هر رونوشت شبانه، رمزگذاری‌شده، در درایو است.
- **نگه‌داری:** رونوشت‌های درایو ۳۰ روز می‌مانند (`OFFSITE_RETENTION_DAYS`) و پشتیبان‌های روی سرور هم ۳۰ روز.
- **هر پنج دقیقه:** `scripts/monitor.sh` سرور را بررسی می‌کند و در این حالت‌ها پیام می‌فرستد:
  - برنامه پاسخ نمی‌دهد؛
  - دیسک بیش از ۸۵ درصد پر است؛
  - آخرین پشتیبان شبانه یا رونوشت درایو بیش از ۲۶ ساعت پیش بوده است؛
  - رویداد ناموفقی در صف خطا مانده است، یا رویدادی در پردازش گیر کرده است.
- هر مشکل یک بار گزارش می‌شود. اگر برطرف نشود، هر ۶ ساعت یادآوری می‌شود، و وقتی برطرف شد یک پیام «برطرف شد» می‌آید.

## گام ۱: زمان‌بندی (یک بار، روی سرورهای نصب‌شده پیش از نسخه ۱۰.۰.۱)

```bash
cd /opt/papital-erp
sudo bash scripts/install-ops-cron.sh root
```

این دستور فایل `/etc/cron.d/papital-erp` را می‌سازد و فایل قدیمی `/etc/cron.d/papital-erp-backup` را، اگر باشد، برمی‌دارد. خروجی دو کار در `logs/backup.log` و `logs/monitor.log` نوشته می‌شود. نصب تازه با `install.sh` این گام را خودش انجام می‌دهد.

## گام ۲: اتصال یک‌باره به گوگل‌درایو

به rclone روی سرور و یک رایانه با مرورگر نیاز دارید (برای ویندوز، فایل zip را از rclone.org/downloads بگیرید و باز کنید؛ نصب لازم نیست).

```bash
sudo apt-get install -y rclone
rclone config
```

1. `n` (remote تازه)، نام: `gdrive`، نوع: `drive`.
2. `client_id` و `client_secret` را خالی بگذارید.
3. دامنه دسترسی (scope): گزینه `drive.file`. با این گزینه rclone فقط فایل‌هایی را می‌بیند که خودش ساخته است.
4. پرسش‌های بعدی را با پیش‌فرض رد کنید تا به «Use web browser to automatically authenticate» برسید و `n` بزنید.
5. rclone یک دستور `rclone authorize "drive" "…"` چاپ می‌کند. همان را روی رایانه خودتان اجرا کنید. مرورگر باز می‌شود؛ با حساب گوگلی وارد شوید که پشتیبان‌ها باید در آن بمانند و اجازه بدهید. متنی که rclone روی رایانه چاپ می‌کند را در سرور جای‌گذاری کنید.
6. «Configure this as a Shared Drive»: `n`. سپس `y` برای تأیید.

حالا remote رمزگذار را بسازید:

1. دوباره در `rclone config`: `n`، نام: `papital-crypt`، نوع: `crypt`.
2. remote: `gdrive:papital-erp-backup`.
3. filename_encryption: `standard`؛ directory_name_encryption: `true`.
4. رمز (password): `g` برای ساختن رمز تصادفی، طول ۲۵۶، و `y`. **رمز چاپ‌شده را همین حالا نگه دارید** (پایین‌تر را ببینید).
5. رمز دوم (password2، salt): باز هم `g`، ۲۵۶ و `y`. **این را هم نگه دارید.**
6. `y` و سپس `q`.

مقصد را در `.env` بنویسید و یک پشتیبان آزمایشی بگیرید:

```bash
echo 'BACKUP_RCLONE_REMOTE=papital-crypt:' >> /opt/papital-erp/.env
/opt/papital-erp/scripts/backup.sh
rclone ls papital-crypt:
```

باید چهار فایل `erp_daily_…` (dump، manifest، uploads و env) را ببینید. در خود گوگل‌درایو، پوشه `papital-erp-backup` فقط نام‌های درهم دارد.

### کجا نگه دارید

دو رمز crypt و یک نسخه از `ERP_SECRETS_KEY` (از `.env`) را **بیرون از سرور** نگه دارید:

- در یک مدیر رمز (مثل Bitwarden)؛
- و روی یک برگه چاپی، جایی امن و جدا از رایانه.

بدون دو رمز crypt هیچ رونوشتی در درایو باز نمی‌شود، و کسی هم نمی‌تواند آن‌ها را از روی درایو بازیابی کند. فایل پیکربندی rclone (`~/.config/rclone/rclone.conf`) رمزها را فقط مبهم (obscured) نگه می‌دارد، نه رمزگذاری‌شده. پس این فایل را هم مثل `.env` خصوصی نگه دارید.

## گام ۳: کانال هشدار

یکی از این دو، یا هر دو، را در `.env` بنویسید.

**ربات بله** (پیش‌فرض؛ برای ربات تلگرام همین گام‌ها را انجام دهید و `ALERT_BOT_API=https://api.telegram.org` را هم بیفزایید):

1. در بله با `@botfather` گفت‌وگو کنید، `/newbot` بفرستید و نشانه (توکن) ربات را بگیرید.
2. به ربات تازه یک پیام بدهید و سپس روی سرور این را اجرا کنید:
   ```bash
   curl -s "https://tapi.bale.ai/bot<TOKEN>/getUpdates"
   ```
   عدد `chat` → `id` را بردارید.
3. در `.env`:
   ```
   ALERT_BOT_TOKEN=<TOKEN>
   ALERT_CHAT_ID=<id>
   ```

**ایمیل از راه Gmail:** در حساب گوگل، تأیید دومرحله‌ای را روشن کنید و یک «App password» بسازید. سپس:

```
ALERT_SMTP_URL=smtps://smtp.gmail.com:465
ALERT_SMTP_USER=<you>@gmail.com
ALERT_SMTP_PASSWORD=<app password>
ALERT_EMAIL_TO=<you>@gmail.com
```

`METRICS_TOKEN` را `bash scripts/ensure-env-secrets.sh .env` می‌سازد. پس از افزودن آن، سرویس را یک بار دوباره راه بیندازید (`sudo systemctl restart papital-erp`) تا آن را بخواند. سپس آزمایش کنید:

```bash
sudo systemctl stop papital-erp; /opt/papital-erp/scripts/monitor.sh; sudo systemctl start papital-erp
sleep 60; /opt/papital-erp/scripts/monitor.sh
```

باید یک پیام «برنامه پاسخ نمی‌دهد» و سپس «برطرف شد» برسد. `sudo bash scripts/go-live-verify.sh` هم وجود رونوشت بیرونی، کانال هشدار و زمان‌بندی را بررسی می‌کند.

## بازیابی روی سرور تازه

1. برنامه را با `install.sh` نصب کنید و rclone را مثل گام ۲ پیکربندی کنید، با **همان دو رمز crypt** (در گام ۴ و ۵ به جای `g`، `y` بزنید و رمز نگه‌داشته را وارد کنید).
2. آخرین رونوشت را بیاورید:
   ```bash
   rclone lsf papital-crypt: | sort | tail -4
   mkdir -p /root/restore && rclone copy papital-crypt: /root/restore --include "erp_daily_<تاریخ_ساعت>*"
   ```
3. فایل `.env` قدیمی را جای `.env` تازه بگذارید (`cp /root/restore/erp_daily_….env /opt/papital-erp/.env`). اگر نشانی پایگاه‌داده تغییر کرده، فقط `DATABASE_URL` را درست کنید و `ERP_SECRETS_KEY` و `JWT_SECRET` را دست نزنید.
4. فایل‌های پشتیبان را در `/var/backups/erp` بگذارید و بازیابی را طبق README («بازیابی از Backup») با `scripts/restore.sh` انجام دهید: نخست آزمایشی (drill) و سپس `apply`.

## تنظیم‌های اختیاری `.env`

| کلید | پیش‌فرض | کار |
|---|---|---|
| `OFFSITE_RETENTION_DAYS` | ۳۰ | روزهای نگه‌داری رونوشت در درایو |
| `BACKUP_OFFSITE_KINDS` | `daily` | گونه‌های پشتیبانی که به درایو می‌روند (`daily,pre-deployment`) |
| `RCLONE_CONFIG` | پیکربندی کاربر | مسیر دیگر برای پیکربندی rclone |
| `MONITOR_DISK_PERCENT` | ۸۵ | آستانه پر شدن دیسک |
| `MONITOR_BACKUP_MAX_AGE_HOURS` | ۲۶ | بیشترین سن پشتیبان و رونوشت |
| `MONITOR_REPEAT_HOURS` | ۶ | فاصله یادآوری مشکلی که برطرف نشده |
| `BACKUP_HOUR` / `BACKUP_MINUTE` | ۲ / ۳۰ | ساعت پشتیبان شبانه؛ با اجرای دوباره `install-ops-cron.sh` اعمال می‌شود |
