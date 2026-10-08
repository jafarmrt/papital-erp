# Technical Debt Registry — رجیستری بدهی‌های فنی

> **قاعده الزامی:** هر بدهی/میان‌بر شناسایی‌شده در توسعه باید به این فایل اضافه شود
> (ردیف جدید با ID یکتا). این فایل مرجع برنامه‌ریزی دورهای نگهداری است و بخشی از
> قرارداد مستندسازی پروژه محسوب می‌شود (بخش ۲۳ `AGENTS.md`).
>
> وضعیت‌ها: `open` | `scheduled:فاز ۳ ممیزی` | `in_progress` | `resolved` — فازهای گذشته برچسب زمان‌بندی ندارند (بررسی خودکار در تست واحد unit_governance_docs_consistency_p3_12)
>
> 📦 **آرشیو:** ردیف‌های `resolved` به‌محض حل، به `TECH_DEBT_ARCHIVE.md` منتقل
> می‌شوند تا این فایل فقط اقلام فعال (open / scheduled / in_progress) را نگه دارد.
> تاریخچه کامل با متن و شواهد عیناً در آرشیو حفظ می‌شود.

---

## 🔵 اقلام فعال نسخه ۹ (open / scheduled / in_progress)

| ID | حوزه | شرح | منبع (فایل) | وضعیت |
|----|------|-----|--------------|-------|
| TD-589 | زیرساخت (بسته ۱) | P2 (B01-09) — قید FK و ایندکس یکتای شرطی مهاجرت‌ها روی داده ناپاک فقط notice `SKIPPED` می‌دهند که کسی نمی‌شنود: پایگاه‌داده دوره v3 پس از ارتقا `success:true, warnings:[]` و بی `fk_transactions_item_id`، `fk_document_items_*` و `uq_cheques_sayad_number_active`، حتی پس از پاک شدن داده | db/migrator.ts، drizzle/0001، 0012، 0015 | open (P2، تصمیم ت۵ الف) |
| TD-590 | زیرساخت (بسته ۱) | P2 (B01-10) — `0007` ایندکس را بی نام اسکیما حذف می‌کند و اسکیمای ایزوله آزمون با مسیر جست‌وجوی `"<schema>", public` ساخته می‌شود: `public.idx_idemp_user_scope_key` حذف شد و هر POST با کلید idempotency با خطای `ON CONFLICT` شکست | drizzle/0007_idempotency_triple_key.sql، src/tests/setup/testDb.ts | open (P2) |
| TD-610 | زیرساخت (بسته ۱) | P3 (B01-30) — ۱۰۹ بررسی وجود بی نام اسکیما در ۱۹ مهاجرت: وقتی `public` مهاجرت‌شده است اسکیمای ایزوله آزمون ۳۰ قید و ایندکس را ندارد، از جمله `chk_iws_current_stock_non_negative`، `uq_jv_voucher_number` و ۱۰ قید `fk_*`؛ اسکیمای آزمونی که اجرای قطع‌شده جا گذاشته همین اثر را دارد (۶ آزمون پایگاه‌داده و ناوردایی قرمز شدند) | drizzle/*.sql، src/tests/setup/testDb.ts | open (P3) |
| TD-611 | زیرساخت (بسته ۱)؛ اثر روی ۱۵ | P3 (B01-31) — ۷ `onDelete` اعلام‌شده در Drizzle قید ندارند و سرویس‌ها والد را فیزیکی حذف می‌کنند: پس از حذف اشتراک وب‌هوک و قاعده رویداد، یک تحویل و یک لاگ به شناسه حذف‌شده اشاره ماندند | webhookSubscriptionService.ts، eventActionEngineService.ts، db/schema | open (P3، تصمیم ت۶ الف) |
| TD-612 | زیرساخت (بسته ۱)؛ اثر روی ۱۴ و ۳ | P3 (B01-32) — ذخیره دوباره بی تغییر طرح گردش کار شناسه گام‌ها را از ۶ تا ۹ به ۱۴ تا ۱۷ برد و ۵ ستون مرجع نمونه‌های در جریان یتیم شدند؛ امضای چاپ سند قدیمی عنوان گام را از جدول زنده می‌خواند؛ استثنای FK مستند نیست | workflowDefinitionService.ts، reports.routes.ts | open (P3، تصمیم ت۶ الف) |
| TD-613 | زیرساخت (بسته ۱) | P3 (B01-33) — اسکیمای Drizzle با پایگاه‌داده نمی‌خواند: ۵ FK `SET NULL` در پایگاه‌داده و `no action` در Drizzle، ۴ ستون nullable در برابر NOT NULL، ۲ ایندکس فقط در Drizzle و ۸ ایندکس یکتای جزئی فقط در پایگاه‌داده؛ `drizzle-kit generate` یا `push` آن‌ها را جابه‌جا می‌کند | src/db/schema/** | open (P3) |
| TD-614 | زیرساخت (بسته ۱) | P3 (B01-34) — ۵۶ از ۱۰۴ ستون FK بی ایندکس، ۳۳ روی جدول پرکاربرد (`workflow_instances (entity_type, entity_id)`، `workflow_history_logs.instance_id`، ستون‌های سند و فیش `treasury_transactions`): با حجم ساختگی ۵ ساله جزئیات فاکتور ۲۲٫۳ ms، با ایندکس ۰٫۰۷ ms | drizzle/*.sql | open (P3) |
| TD-616 | زیرساخت (بسته ۱) | P3 (B01-36) — شاخه `SQL_HOST` هرگز اجرا نمی‌شود و بی `NODE_ENV` و `DATABASE_URL` یک ERP ساختگی در حافظه با `admin`/`admin` بالا می‌آید (`isMockDatabase: true`)؛ `/health/ready` حالت mock را نمی‌گوید | db/drizzle.ts، db/mockPool.ts، server.ts | open (P3، تصمیم ت۴ الف) |
| TD-617 | زیرساخت (بسته ۱) | P3 (B01-37) — `migratePlainPasswords` هر بوت، حتی در تولید، هر رشته غیر bcrypt (کاربر حذف‌شده، `!locked`، hash `$argon2id$`) را رمز کارا می‌کند و `mustResetPassword` و ردیف ممیزی نمی‌نویسد | db/migratePlainPasswords.ts، server.ts | open (P3، تصمیم ت۴ الف) |
| TD-625 | زیرساخت (بسته ۱)؛ اثر روی همه بسته‌ها | P3 (B01-45) — خروجی ترمینال فارسی است: ۵ پیام hook آغاز جلسه، ۱۱۷ خط در ۱۲ اسکریپت CLI و ۱۳ پیام `check:version`، لاگ پیام فارسی هر خطای کسب‌وکار در `errorHandler`، حدود ۸۰۱ خط نام آزمون در ۶۸ فایل و ۱۲ نام آزمون Vitest | .claude/hooks/session-start.sh، scripts/*.ts، middleware/logger.ts، src/tests/** | open (P3، قاعده ت۹؛ قاعده در AGENTS.md §6 و ratchet فقط کاهشی `ratchet:terminal-english` از v9.0.211؛ ترجمه باز) |
| TD-708 | رویدادها و وب‌هوک (بسته ۱۵) | P2 (B15-06) — «آزمایش» قانون و «شبیه‌سازی رویداد» اعلان، سطر ممیزی و وب‌هوک امضاشده واقعی با داده ساختگی می‌سازند: آزمایش چهار قانون seed اعلانی با جاهای خالی و ممیزی «تراکنش خزانه‌داری با ارزش کلان ۶۰۰٬۰۰۰٬۰۰۰ IRR به ثبت رسید» ساخت؛ `simulate` با `InvoiceApproved` و `FAKE-1405-001` وب‌هوکی با امضای HMAC معتبر و مبلغ ۹۸۷٬۶۵۴٬۳۲۱ به شریک بیرونی فرستاد؛ «بازپخش زنده رویداد» در خط زمانی با `dryRun: false` بی تأیید اجرا می‌شود و دکمه پس از موفقیت فعال می‌ماند | eventActionEngineService.ts، events.routes.ts، eventSourcingReplayService.ts، EventSourcingReplaySubTab.tsx | open (P2، تصمیم ت۵ الف) |
| TD-709 | اعلان (بسته ۱۵)؛ اثر روی ۹ | P2 (B15-07) — زنگ اعلان یادآوری پیگیری دیگران را با تطبیق «بخشی از نام» نشان می‌دهد (`assignee.includes(userFullName) || assignee.includes(username)`): کاربر «علی» (`ali`) یادآوری «سررسید پیگیری: "تماس با شرکت نمونه درباره تخفیف ویژه ۲۰٪"» پیگیری کاربر `alireza` را گرفت | notifications.routes.ts | open (P2) |
| TD-711 | رویدادها (بسته ۱۵)؛ اثر روی ۲ | P2 (B15-09) — خط زمانی رویدادها هیچ رویداد outbox نمی‌یابد و سطرهای ممیزی موجودیت‌های دیگر را نشان می‌دهد، حتی به نقش بی مجوز سجل: نوع تجمیع `'document'` در برابر `'Document'` outbox، انتخابگر شماره سند به‌جای شناسه و ممیزی با `entityId = X OR description ILIKE '%X%'` بی شرط نوع؛ فاکتور شناسه ۱ و شماره ۱۰۰۰ ← انتخابگر `id: "1000"` و خط زمانی خالی؛ با `id=1` صفر رویداد outbox و ۱۳ سطر ممیزی دیگر («اشتراک وب‌هوک: P15 shop»، «قانون واکنش خودکار»)؛ نقش فقط `events.view` با ۴۰۳ از `/activity-logs` از خط زمانی ۱۴ سطر ممیزی گرفت، از جمله «ورود موفق کاربر …» با `userAgent` | eventSourcingReplayService.ts | open (P2) |
| TD-716 | صف خطا (بسته ۱۵) | P3 (B15-14) — ویرایش داده رویداد بازپخش‌شده ردیف تکمیل‌شده outbox را بی قفل، بی بررسی وضعیت و بی ممیزی بازنویسی می‌کند و «تلاش دوباره همه» ردیف صف خطا را باز می‌گذارد: `PUT /dlq/:id/payload` با `{"amount":1}` پس از بازپخش ۲۰۰ داد و ردیف «replayed» و outbox «completed» هر دو `{"amount":1}` گرفتند، ممیزی ۰؛ `POST /outbox/retry-failed` رویداد را تکمیل کرد ولی ردیف صف خطا «quarantined» ماند؛ رابط «اصلاح داده و بازپخش» را برای `replayed` و `dismissed` هم پیشنهاد می‌کند | deadLetterQueueService.ts، outboxService.ts، DeadLetterQueueSubTab.tsx | open (P3) |
| TD-717 | اعلان (بسته ۱۵) | P3 (B15-15) — یادآوری پیگیری با درخواست‌های هم‌زمان دو بار ساخته می‌شود و پس از حذف دوباره می‌آید (بررسی و درج بی قید یکتا در هر `GET /notifications` و `/unread-count`؛ حذف فیزیکی): ۴ درخواست هم‌زمان ۲ ردیف ساختند و پس از حذف همه، درخواست بعدی دوباره ۱ ردیف ساخت | notifications.routes.ts | open (P3، تصمیم ت۸ الف) |
| TD-722 | رابط رویدادها (بسته ۱۵)؛ اثر روی ۲ | P2 (B15-20) — صفحه رویدادها با کد نقش (`admin` و `manager`) گارد شده، ولی فهرست و مسیر با `events.view`: دارنده `events.view` (`cfo_accountant` در seed و هر نقش سفارشی) فهرست را می‌بیند، از مسیر رد می‌شود و «عدم دسترسی» می‌گیرد؛ هیچ دکمه‌ای بر پایه `events.manage` پنهان نمی‌شود | DomainEventsPage.tsx، menuConfig.ts، AppRoutes.tsx | open (P2) |
| TD-725 | رابط رویدادها (بسته ۱۵) | P2 (B15-23) — زمان‌های سرور در صفحه‌های بسته ۱۵ بی تبدیل UTC نمایش داده می‌شوند (۱۳ محل؛ `serverTimestampToUtcIso` در routeهای بسته ۰ بار): با `TZ=Asia/Tehran`، `2026-10-06 21:00:00` (UTC) ۱۴۰۵/۰۷/۱۴ نمایش داده می‌شود به‌جای ۱۴۰۵/۰۷/۱۵ ساعت ۰۰:۳۰ و اعلان ۳۰ ثانیه پیش «3 ساعت پیش» | DomainEventsTab.tsx، AutoActionsSubTab.tsx، DeadLetterQueueSubTab.tsx، EventSourcingReplaySubTab.tsx، WebhookManagementSubTab.tsx، WooCommerceTab.tsx، NotificationBell.tsx | open (P2) |
| TD-728 | رابط رویدادها (بسته ۱۵) | P2 (B15-26) — دکمه ثبت فرم وب‌هوک هرگز غیرفعال نمی‌شود (بی `isSaving`؛ routeهای رویداد بی idempotency): دو کلیک دو POST و دو اشتراک، و هر رویداد دو بار فرستاده می‌شود | WebhookManagementSubTab.tsx | open (P2) |
| TD-729 | رابط رویدادها (بسته ۱۵) | P3 (B15-27) — کلید فعال‌سازی و «تست» قانون نگهبان ارسال ندارند: دو کلیک روی toggle وضعیت قانون را دو بار برمی‌گرداند با دو پیام موفق؛ هر کلیک «تست» اقدام واقعی را اجرا می‌کند | AutoActionsSubTab.tsx | open (P3) |
| TD-730 | رابط رویدادها و ووکامرس (بسته ۱۵) | P3 (B15-28) — پیام سرور در خطاها دور ریخته یا بلعیده می‌شود: ۱۰ catch با متن ثابت («خطای شبکه …») پیام فارسی سرور، از جمله دلیل SSRF و ۴۰۹ «در حال بازپخش»، را حذف می‌کنند؛ هر رد ذخیره داده صف خطا «فرمت JSON نامعتبر است» نشان داده می‌شود؛ بار کردن گزارش سفارش‌های ووکامرس ۴۰۳ و ۵۰۰ را می‌بلعد و «هنوز هیچ سفارشی ثبت نشده است» نشان می‌دهد (این نیمه ووکامرس در v9.0.334 رفع شد: `WcListEmptyRow`، آزمون Vitest `wooSettingsTab.test.tsx`؛ بقیه در PR و بسته ۱۵) | WebhookManagementSubTab.tsx، DeadLetterQueueSubTab.tsx | open (P3) |
| TD-731 | رابط رویدادها (بسته ۱۵) | P3 (B15-29) — جست‌وجوی تجمیع در خط زمانی برای هر کلید یک درخواست می‌فرستد و پاسخ دیرتر نتیجه تازه‌تر را بازنویسی می‌کند: نتیجه «ف» روی نتیجه «فا» نوشته شد | EventSourcingReplaySubTab.tsx | open (P3) |
| TD-732 | رابط رویدادها و ووکامرس (بسته ۱۵) | P3 (B15-30) — رقم لاتین در متن فارسی، حدود ۲۰ محل: «3 ساعت پیش»، «86%»، «…ms»، «بازپخش 1 مورد» و `{retryCount}/۵` که رقم‌های دو خط را قاطی می‌کند | components/settings/** (رویدادها و ووکامرس)، NotificationBell.tsx | open (P3) |
| TD-733 | رابط رویدادها و ووکامرس (بسته ۱۵) | P3 (B15-31) — وضعیت و متن گمراه‌کننده: پردازشگر متوقف outbox نقطه سبز تپنده نشان می‌دهد؛ هر عمل outbox دو بار اعلام می‌شود (toast و بنر)؛ برچسب «هر ۸ ثانیه» ولی به‌روزرسانی هر ۱۰ ثانیه است؛ سرستون «نام خریدار / مبالغ» مبلغی ندارد | DomainEventsTab.tsx، WooCommerceTab.tsx | open (P3) |
| TD-734 | رابط رویدادها و ووکامرس (بسته ۱۵) | P3 (B15-32) — قاعده ۱۰: ۲۰۹ واژه انگلیسی یا آوانویسی در ۱۵ فایل بسته (۱۰۰ لاتین و ۱۰۹ آوانویسی؛ وب‌هوک ۳۹، تست ۱۶، اکشن ۱۲، آنلاین ۷، لاگ ۶، Outbox ۵، Payload ۵، پینگ ۴، منشن ۳، ورکر ۳، هدر ۳؛ `WooCommerceTab` ۵۰، `WebhookManagementSubTab` ۴۶، `RuleEditorModal` ۳۶) و برچسب فهرست «رویدادها و اتوماسیون سازمانی» | WooCommerceTab.tsx، WebhookManagementSubTab.tsx، RuleEditorModal.tsx، menuConfig.ts | open (P3، تصمیم ت۹ الف) |

---

## 📊 آمار رجیستری

- **فعال:** ۲۴ ردیف
- **آرشیو شده (resolved):** ۷۷۶ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`
- مبنای آمار و IDs یکتا: هر دو فایل مجموعاً فضای ID مشترک دارند؛ IDs جدید باید
  از بزرگ‌ترین ID موجود در **هر دو** فایل + ۱ انتخاب شود.

---

> **فاز ۰ ممیزی مستقل (v7.0.18 به بعد):** ردیف‌های TD-171 به بعد که در همان change-set حل شده‌اند مستقیماً در بخش «فاز ۰» فایل `TECH_DEBT_ARCHIVE.md` ثبت شده‌اند.
> ✅ v7.0.44: ردیف‌های `resolved` که در جدول فعال مانده بودند (TD-110، TD-129، TD-132، TD-134، TD-160 تا TD-170) عیناً به بخش «نسخه ۷ — نقشه راه V7» آرشیو منتقل شدند.

*آخرین بازبینی: v9.0.424 — TD-769 بسته شد (واژه‌نامه صفحه‌های پروژه، تصمیم ت۱۰). شناسه‌های رزروشده: `v9/PHASE4_LANES.md` §۷.۲.*
*v9.0.313 — نسخه مستند بسته ۱۰ (خرید و تدارکات): TD-688 تا TD-702 و TD-901 (تصمیم ت۵) باز شد. شناسه‌های رزروشده: `v9/PHASE4_LANES.md` §۷.۲.*
