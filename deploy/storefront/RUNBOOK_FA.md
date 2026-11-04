# راهنمای راه‌اندازی سایت تازهٔ papitalgallery.com (مرحلهٔ ۸.۶)

این راهنما قدم‌به‌قدم سایت تازه را کنار ERP روی سرور بالا می‌آورد، نخست روی یک نشانی آزمایشی و سپس روی خود papitalgallery.com، و راه برگشت به ووکامرس را در هر قدم باز نگه می‌دارد. فهرست کارهای پیش از روشن کردن در [`GO_LIVE_CHECKLIST_FA.md`](GO_LIVE_CHECKLIST_FA.md) است.

> مخزن عمومی است: کلید سایت، نشانی IP سرورها، رمزها و دادهٔ مشتری هرگز در این فایل، در گیت یا در گفت‌وگو نوشته نمی‌شوند. هر جا `<…>` آمده، مقدار واقعی را فقط روی خود سرور بنویسید.

## ۱. سایت چطور کنار ERP کار می‌کند

```
مرورگر ──https──▶ nginx (papitalgallery.com) ──http──▶ papital-storefront (127.0.0.1:3100) ──http──▶ ERP (127.0.0.1:3000/api/storefront/v1)
```

- سایت یک **سرویس دوم** است: واحد systemd جدای `papital-storefront`، تنظیمات جدا در `/etc/papital-storefront/storefront.env` (فقط root) و نسخه‌های جدا در `/opt/papital-storefront`. به سرویس، `.env`، پایگاه‌داده، پشتیبان‌گیری و پایش ERP دست نمی‌زند و `install.sh` و `update.sh` ERP هم عوض نشده‌اند.
- سرویس با یک کاربر موقت سیستم اجرا می‌شود که روی دیسک چیزی نمی‌تواند بنویسد و تنظیمات را خودش نمی‌خواند (systemd پیش از شروع می‌خواند). سقف حافظه‌اش ۱ گیگابایت است تا هرگز حافظهٔ ERP را نگیرد.
- سایت هیچ داده‌ای ذخیره نمی‌کند: همه چیز (محصول، قیمت، موجودی، سفارش، حساب خریدار) در ERP است. پس پشتیبان شبانهٔ ERP همه را دارد و سایت پشتیبان جدا نمی‌خواهد.
- nginx: `www.` و `http` را به `https://papitalgallery.com` می‌برد، عکس محصولات و فایل‌های ساخت را در حافظهٔ خودش نگه می‌دارد، صفحه‌ها را هرگز نگه نمی‌دارد، بدنهٔ درخواست را به ۵ مگابایت محدود می‌کند و درخواست صفحه‌های هر نشانی بازدیدکننده را (۱۰ در ثانیه، با جهش ۶۰) محدود می‌کند تا یک خزندهٔ تند سقف مشترک API را تمام نکند.

| چیز | جا |
|---|---|
| تنظیمات سایت | `/etc/papital-storefront/storefront.env` (قالب: `deploy/storefront/storefront.env.example`) |
| نسخهٔ روشن | `/opt/papital-storefront/current` ← یکی از `/opt/papital-storefront/releases/*` (سه نسخهٔ آخر می‌مانند) |
| سرویس | `systemctl status papital-storefront`، گزارش: `journalctl -u papital-storefront -f` |
| سایت nginx | `/etc/nginx/sites-available/papital-storefront.conf` و `/etc/nginx/snippets/papital-storefront-proxy.conf` |
| اسکریپت‌ها | `deploy/storefront/storefront.sh` (نصب، به‌روزرسانی، برگشت، بسته) و `deploy/storefront/storefront-nginx.sh` (دامنه و https) |

## ۲. ساخت کلید سایت در ERP

1. در ERP: «تنظیمات» ← زبانهٔ «فروشگاه سایت» ← کارت «کلید برنامه سایت» ← ساخت کلید.
2. کلید **فقط یک بار** نشان داده می‌شود. آن را جایی ننویسید؛ مستقیم در قدم ۳ در فایل تنظیمات سرور بگذارید. اگر گم شد، کلید تازه بسازید (کلید قبلی از کار می‌افتد).
3. تا «روشن بودن سایت» در همان زبانه خاموش است، API به هر درخواستی 404 می‌دهد و سایت «فروشگاه در دسترس نیست» نشان می‌دهد. برای آزمون روی نشانی آزمایشی آن را روشن کنید؛ «ثبت سفارش» را هنوز روشن نکنید.

## ۳. نصب روی سرور ERP با یک نشانی آزمایشی

نشانی آزمایشی پیشنهادی: `new.papitalgallery.com`. سایت تا قدم ۶ فقط روی همین نشانی است و ووکامرس هیچ تغییری نمی‌بیند.

1. **DNS:** در پنل دامنه یک رکورد A بسازید: `new` ← IP سرور ERP. به رکوردهای دیگر (ریشه، `www`، `erp`، `MX`، `TXT`) دست نزنید.
2. **کد تازه روی سرور:**
   ```bash
   cd /opt/papital-erp
   sudo bash update.sh --rehearse
   ```
3. **نصب سرویس:**
   ```bash
   sudo bash /opt/papital-erp/deploy/storefront/storefront.sh install
   ```
   این دستور فایل تنظیمات را از قالب می‌سازد، برنامه را می‌سازد (چند دقیقه، حدود ۱ گیگابایت حافظه) و واحد systemd را می‌نویسد. چون کلید هنوز خالی است، سرویس را روشن نمی‌کند و همین را می‌گوید.
4. **تنظیمات:**
   ```bash
   sudo nano /etc/papital-storefront/storefront.env
   ```
   - `STOREFRONT_API_KEY=` کلید قدم ۲
   - `STOREFRONT_SITE_URL=https://new.papitalgallery.com`
   - `STOREFRONT_NOINDEX=1` (روی نشانی آزمایشی هیچ صفحه‌ای نمایه نمی‌شود)
   - `STOREFRONT_PREVIEW_NOTICE=` اگر نوار «نسخهٔ آزمایشی» بالای صفحه بخواهید، متنش را بنویسید
   - `STOREFRONT_API_URL` همان `http://127.0.0.1:3000/api/storefront/v1` بماند (روی همین سرور)
   ```bash
   sudo systemctl restart papital-storefront
   sudo bash /opt/papital-storefront/current/deploy/storefront.sh status
   ```
   باید `Liveness : 200` و `ERP link : 200` ببینید. اگر `ERP link` 503 است: کلید، «روشن بودن سایت» در ERP، یا `journalctl -u papital-storefront -n 50`.
5. **دامنه و https:**
   ```bash
   sudo DOMAIN=new.papitalgallery.com bash /opt/papital-storefront/current/deploy/storefront-nginx.sh
   ```
   گواهی Let's Encrypt با همان حساب certbot که دامنهٔ ERP گرفته است صادر و خودکار تمدید می‌شود (اگر حسابی نبود، `EMAIL=<ایمیل>` را هم جلوی دستور بگذارید). سایت nginx ERP دست نمی‌خورد.
6. نشانی را روی گوشی باز کنید و بخش «آزمون روی نشانی آزمایشی» چک‌لیست را بروید.

## ۴. چند روز پیش از سوئیچ

1. **TTL:** در پنل دامنه، TTL رکوردهای A (و AAAA اگر هست) ریشه و `www` را به ۳۰۰ ثانیه برسانید. این کار را دست‌کم یک روز پیش انجام دهید تا TTL قبلی تمام شود. مقدار فعلی همهٔ این رکوردها را روی کاغذ یا در یادداشت خصوصی نگه دارید: راه برگشت همین‌هاست.
2. **ایمیل و رکوردهای دیگر:** اگر ایمیل دامنه روی میزبان فعلی است، رکوردهای `MX`، `TXT` (SPF و DKIM) و `mail` همان‌طور بمانند. فقط A و AAAA ریشه و `www` عوض می‌شوند. اگر سرور ERP نشانی IPv6 ندارد و دامنه رکورد AAAA دارد، روز سوئیچ AAAA را حذف کنید (وگرنه گوشی‌های IPv6 هنوز به ووکامرس می‌روند).
3. **نشانی‌های قدیمی:** در ERP، «فروشگاه سایت» ← «نشانی‌های سایت قبلی» ← «خواندن از ووکامرس». این کار نیاز دارد ERP هنوز به ووکامرس برسد، پس پیش از سوئیچ است. گزارش آن باید صفر «بی‌همتا» داشته باشد یا هر بی‌همتا دستی تعیین شود.
4. **گواهی پیش از سوئیچ (پیشنهادی، بی هیچ لحظهٔ بی https):** روی سرور ERP:
   ```bash
   sudo certbot certonly --manual --preferred-challenges dns -d papitalgallery.com -d www.papitalgallery.com --cert-name papitalgallery.com
   ```
   certbot دو رکورد `TXT` با نام `_acme-challenge` نشان می‌دهد؛ آن‌ها را در پنل دامنه بسازید، یکی دو دقیقه صبر کنید و Enter بزنید. گواهی در `/etc/letsencrypt/live/papitalgallery.com` می‌نشیند و `storefront-nginx.sh` روز سوئیچ همان را برمی‌دارد. این گواهی خودکار تمدید نمی‌شود؛ قدم ۷ آن را به تمدید خودکار می‌برد. پس از گرفتن گواهی رکوردهای `_acme-challenge` را پاک کنید.
   اگر این قدم را نکنید، گواهی روز سوئیچ پس از رسیدن DNS گرفته می‌شود و چند دقیقه سایت فقط با http در دسترس است.
5. **ERP همچنان ووکامرس را ببیند:** پس از سوئیچ، papitalgallery.com روی خود سرور ERP به سایت تازه می‌رسد و ارسال موجودی ERP به ووکامرس می‌شکند. برای دورهٔ گذار (۴۸ ساعت) روی سرور ERP نشانی قدیم را ثابت کنید:
   ```bash
   echo "<IP میزبان ووکامرس> papitalgallery.com www.papitalgallery.com # papital-storefront cutover" | sudo tee -a /etc/hosts
   ```
   این سطر فقط روی همین سرور اثر دارد؛ بازدیدکننده‌ها و Let's Encrypt از DNS واقعی می‌خوانند. روز سوئیچ هر بررسی روی خود سرور را با `curl --resolve papitalgallery.com:443:127.0.0.1 …` یا از گوشی انجام دهید.
6. **تاریخ:** سوئیچ در اوج یلدا (۱۰ تا ۲۵ آذر) انجام نمی‌شود (برنامهٔ آغاز فاز ۸). ساعت کم‌بازدید (صبح زود) را انتخاب کنید.

## ۵. پیش از سوئیچ، روی نشانی آزمایشی

همهٔ بخش‌های «تنظیمات ERP»، «محتوا» و «آزمون روی نشانی آزمایشی» چک‌لیست تیک خورده باشند، به‌جز روشن کردن «ثبت سفارش» برای همه که روز سوئیچ است. یک خرید واقعی با کارت‌به‌کارت روی نشانی آزمایشی تا فاکتور قطعی رفته باشد.

## ۶. روز سوئیچ

1. **تنظیمات سایت برای دامنهٔ اصلی:**
   ```bash
   sudo nano /etc/papital-storefront/storefront.env
   ```
   - `STOREFRONT_SITE_URL=https://papitalgallery.com`
   - `STOREFRONT_NOINDEX=0`
   - `STOREFRONT_PREVIEW_NOTICE=` (خالی)
   ```bash
   sudo systemctl restart papital-storefront
   ```
   از این لحظه فرم‌های نشانی آزمایشی رد می‌شوند (درست است: فرم فقط از میزبان `STOREFRONT_SITE_URL` پذیرفته می‌شود).
2. **nginx برای دامنهٔ اصلی** (جای سایت آزمایشی را می‌گیرد):
   - اگر گواهی قدم ۴.۴ را گرفته‌اید، همین حالا:
     ```bash
     sudo DOMAIN=papitalgallery.com bash /opt/papital-storefront/current/deploy/storefront-nginx.sh
     ```
   - اگر نه، این دستور را پس از قدم ۳ و رسیدن DNS بزنید.
3. **DNS:** رکورد A ریشه و `www` ← IP سرور ERP (و AAAA مطابق قدم ۴.۲). رسیدن را بسنجید:
   ```bash
   dig +short papitalgallery.com @1.1.1.1
   dig +short www.papitalgallery.com @8.8.8.8
   ```
4. **ERP:** «ثبت سفارش» را روشن کنید (اگر هنوز نکرده‌اید). ووکامرس فعلاً همان‌طور باز می‌ماند: بازدیدکننده‌ای که DNS قدیم را دارد هنوز آنجا سفارش می‌دهد و سفارشش مثل امروز با وبهوک به ERP می‌رسد.
5. **بررسی از گوشی** (با اینترنت همراه، نه وای‌فای خانه): صفحهٔ اصلی، یک محصول، سبد، یک نشانی قدیمی ووکامرس (باید با 301 به صفحهٔ تازه برود)، `https://www.papitalgallery.com` (به نشانی بی www برود)، `https://papitalgallery.com/sitemap.xml` و `/robots.txt` (این‌بار نباید همهٔ سایت را ببندد).
6. **یک خرید واقعی** روی دامنهٔ اصلی تا فاکتور قطعی، با پیامک‌های هر وضعیت.
7. **موتورهای جست‌وجو:** در کنسول جست‌وجوی گوگل و بینگ نقشهٔ سایت `https://papitalgallery.com/sitemap.xml` را بدهید (کدهای تأیید از تنظیمات «جست‌وجو و آمار بازدید» ERP روی صفحه‌ها هستند).

## ۷. ۴۸ ساعت پس از سوئیچ

1. **بستن ووکامرس:** وردپرس را در حالت «در دست تعمیر» یا فقط‌نمایش بگذارید (سفارش نگیرد) و نگهش دارید؛ برنامهٔ فاز ۸ می‌گوید یک دوره فقط‌خواندنی بماند.
2. **ERP:** در «تنظیمات» ← «اتصال به ووکامرس»، ارسال‌های خودکار (موجودی، قیمت، کد، تصویر شاخص، کالکشن‌ها) را خاموش کنید. سپس سطر `# papital-storefront cutover` را از `/etc/hosts` سرور ERP پاک کنید:
   ```bash
   sudo sed -i '/# papital-storefront cutover$/d' /etc/hosts
   ```
3. **تمدید خودکار گواهی** (فقط اگر گواهی را در قدم ۴.۴ با DNS گرفتید):
   ```bash
   sudo FORCE_RENEW=1 DOMAIN=papitalgallery.com bash /opt/papital-storefront/current/deploy/storefront-nginx.sh
   sudo certbot renew --dry-run
   ```
4. **TTL** را به مقدار عادی (مثلاً ۳۶۰۰) برگردانید.
5. **یک هفته پس از پایداری:** مرورگرها را برای همیشه به https ببندید (HSTS یک‌ساله؛ زیردامنه‌ها مثل `erp` شامل نمی‌شوند):
   ```bash
   sudo HSTS_MAX_AGE=31536000 DOMAIN=papitalgallery.com bash /opt/papital-storefront/current/deploy/storefront-nginx.sh
   ```

## ۸. برگشت

| چه شده | چه کنید |
|---|---|
| مشکل بزرگ پس از سوئیچ (سایت تازه نباید بماند) | رکوردهای A (و AAAA) ریشه و `www` را به مقدار قبلی (قدم ۴.۱) برگردانید. با TTL ۳۰۰ ثانیه بیشتر بازدیدکننده‌ها در چند دقیقه به ووکامرس برمی‌گردند. ووکامرس و ارسال موجودی ERP به آن دست نخورده‌اند (تا وقتی قدم ۷ را نکرده‌اید). سفارش‌هایی که در این فاصله روی سایت تازه ثبت شده‌اند در ERP، صفحهٔ «سفارش‌های سایت»، می‌مانند و دستی پیگیری می‌شوند. HSTS کوتاه (۵ دقیقه) راه برگشت را نمی‌بندد. |
| برگشت پس از قدم ۷ | همان DNS، به‌علاوه: ووکامرس را از حالت تعمیر بیرون بیاورید، سطر `/etc/hosts` قدم ۴.۵ را دوباره بگذارید تا وقتی DNS برگشته است، و ارسال‌های خودکار ووکامرس را در ERP روشن کنید. |
| به‌روزرسانی سایت خراب شد | `storefront.sh update` اگر نسخهٔ تازه بالا نیاید خودش به نسخهٔ قبلی برمی‌گردد. برای برگشت دستی: `sudo bash /opt/papital-storefront/current/deploy/storefront.sh rollback` |
| سایت باید موقتاً بسته شود ولی DNS بماند | در ERP «ثبت سفارش» یا «روشن بودن سایت» را خاموش کنید (بی دسترسی به سرور). |
| کلید سایت لو رفت | در ERP کلید تازه بسازید (قبلی از کار می‌افتد)، در `storefront.env` بگذارید و `sudo systemctl restart papital-storefront`. |

## ۹. به‌روزرسانی‌های بعدی

پس از هر `update.sh` ERP، سایت را هم به‌روز کنید (سایت و ERP از یک مخزن‌اند و قرارداد API با هم عوض می‌شود):
```bash
cd /opt/papital-erp
sudo bash update.sh --rehearse
sudo bash deploy/storefront/storefront.sh update
```
`update` نسخهٔ تازه را کنار نسخهٔ روشن می‌سازد، جابه‌جا می‌کند، `/healthz` را می‌سنجد و اگر پاسخ نداد به نسخهٔ قبلی برمی‌گردد. سه نسخهٔ آخر نگه داشته می‌شوند. nginx فایل‌های ساخت نسخهٔ قبلی را تا ۳۰ روز نگه می‌دارد، پس صفحه‌ای که پیش از به‌روزرسانی باز شده بود هم کار می‌کند.

## ۱۰. سایت روی سرور ایران

سایت طوری ساخته شده که روی سرور دیگری هم بالا بیاید و ERP را از راه اینترنت بخواند.

**چه چیزی عوض می‌شود:** فقط `STOREFRONT_API_URL` که نشانی https عمومی ERP می‌شود (`https://<دامنهٔ ERP>/api/storefront/v1`). ERP، پیامک‌ها، پایگاه‌داده و پشتیبان همان‌جا که هستند می‌مانند. همهٔ درخواست‌های سایت از یک نشانی به ERP می‌رسند، همان‌طور که امروز.

**یک نکتهٔ مهم:** اگر ارتباط بین‌الملل ایران قطع یا کند شود، سایتِ روی سرور ایران هم به ERP در آلمان نمی‌رسد و «فروشگاه در دسترس نیست» نشان می‌دهد. سرور ایران سرعت بازدیدکنندهٔ داخلی را بهتر می‌کند ولی سایت را از قطعی بین‌الملل نجات نمی‌دهد، مگر ERP هم به ایران برود (کار جدا).

**نصب بی گیت و بی npm** (چون دسترسی به مخزن و بسته‌های npm از ایران ممکن است بسته باشد):
1. روی سرور ERP (یا هر لینوکس دیگری با مخزن)، یک بسته بسازید. `--with-node` خود Node.js را هم در بسته می‌گذارد تا روی سرور ایران نصب Node لازم نباشد (هر دو سرور اوبونتو یا دبیان باشند):
   ```bash
   sudo bash /opt/papital-erp/deploy/storefront/storefront.sh package --with-node --out /root
   ```
2. بسته را به سرور ایران ببرید (`scp /root/papital-storefront-*.tar.gz <کاربر>@<سرور ایران>:/root/`).
3. روی سرور ایران:
   ```bash
   cd /root
   mkdir -p /tmp/sf && tar -xzf papital-storefront-*.tar.gz -C /tmp/sf
   sudo bash /tmp/sf/deploy/storefront.sh install --bundle papital-storefront-*.tar.gz
   sudo nano /etc/papital-storefront/storefront.env     # STOREFRONT_API_URL، کلید، نشانی سایت
   sudo systemctl restart papital-storefront
   sudo DOMAIN=papitalgallery.com bash /opt/papital-storefront/current/deploy/storefront-nginx.sh
   ```
   اگر Let's Encrypt از آن سرور در دسترس نبود، گواهی خریداری‌شده را با `TLS=existing CERT_FILE=<…> KEY_FILE=<…>` بدهید.
4. به‌روزرسانی: بستهٔ تازه بسازید و ببرید، سپس `sudo bash /opt/papital-storefront/current/deploy/storefront.sh update --bundle <بسته>`.

**Node بی بسته:** اگر بسته را بی `--with-node` ساختید، Node.js ۲۲ یا تازه‌تر روی سرور ایران لازم است. ساده‌ترین راه: فایل `node-v24.*-linux-x64.tar.xz` را روی رایانه‌ای بیرون از ایران از nodejs.org بگیرید، به سرور ببرید و در `/usr/local` باز کنید (`sudo tar -xJf node-v24.*-linux-x64.tar.xz -C /usr/local --strip-components=1`).

**جابه‌جایی سایت از سرور ERP به سرور ایران پس از راه‌اندازی:** همان قدم‌های سوئیچ: نصب و آزمون روی نشانی آزمایشی در سرور ایران، گواهی با DNS، سپس عوض کردن رکورد A. برگشت هم عوض کردن دوبارهٔ همان رکورد است.

## ۱۱. عیب‌یابی

| نشانه | علت معمول |
|---|---|
| فرم‌ها (ورود، سبد، تسویه) خطای 400 می‌دهند | `STOREFRONT_SITE_URL` با نشانی‌ای که در مرورگر است یکی نیست، یا وب‌سرور دیگری جلوی nginx سرآیند `Host` را عوض می‌کند |
| همهٔ صفحه‌ها «فروشگاه در دسترس نیست» | کلید یا `STOREFRONT_API_URL` نادرست، «روشن بودن سایت» خاموش، یا ERP در حال به‌روزرسانی است (`storefront.sh status`) |
| 502 از nginx | سرویس سایت پایین است: `systemctl status papital-storefront` و `journalctl -u papital-storefront -n 50` |
| 413 هنگام فرستادن رسید | عکس بزرگ‌تر از ۵ مگابایت (سایت عکس را پیش از فرستادن روی گوشی کوچک می‌کند؛ اگر جاوااسکریپت خاموش باشد کوچک نمی‌شود) |
| 429 | یک نشانی بیش از ۱۰ صفحه در ثانیه خواسته است؛ اگر کاربران واقعی آن را می‌بینند `RATE` و `BURST` را با اجرای دوبارهٔ `storefront-nginx.sh` بالا ببرید |
| پیامک کد ورود برای همه با هم محدود می‌شود | `STOREFRONT_TRUST_PROXY=1` نیست، پس سایت نشانی هر بازدیدکننده را نمی‌بیند |
