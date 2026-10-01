# گزارش ارزیابی فنی جامع — Papital ERP (نسخه 7.0.17)

> **نوع سند:** ارزیابی فنی مستقل (Read-only Audit) — هیچ تغییری در کد برنامه داده نشده است.
> **تاریخ ارزیابی:** 2026-10-01
> **شاخه / کامیت مبنا:** `fa1be5a` (feat: refactor document services and standardize APIs)
> **دامنه:** Backend (Express + Drizzle + PostgreSQL)، Frontend (React 19 + React Query)، Migrationها، استقرار (Docker / K8s / CI)، تست‌ها و مستندات حاکمیتی.

---

## فهرست

1. [خلاصه مدیریتی و کارنامه امتیازها](#۱-خلاصه-مدیریتی-و-کارنامه-امتیازها)
2. [روش ارزیابی و شواهد اجرایی](#۲-روش-ارزیابی-و-شواهد-اجرایی)
3. [نقاط قوت قابل توجه](#۳-نقاط-قوت-قابل-توجه)
4. [یافته‌های بحرانی — P0](#۴-یافتههای-بحرانی--p0)
5. [یافته‌های با اولویت بالا — P1](#۵-یافتههای-با-اولویت-بالا--p1)
6. [یافته‌های با اولویت متوسط — P2](#۶-یافتههای-با-اولویت-متوسط--p2)
7. [کیفیت کد و نگهداشت‌پذیری — P3](#۷-کیفیت-کد-و-نگهداشتپذیری--p3)
8. [ارزیابی به تفکیک محور](#۸-ارزیابی-به-تفکیک-محور)
9. [نقشه راه پیشنهادی اصلاح](#۹-نقشه-راه-پیشنهادی-اصلاح)
10. [پیوست الف — اسکریپت اثبات باگ‌ها و خروجی اجرا](#پیوست-الف--اسکریپت-اثبات-باگها-و-خروجی-اجرا)

---

## ۱. خلاصه مدیریتی و کارنامه امتیازها

Papital ERP یک سامانه بزرگ (حدود **۱۵۹ هزار خط** TypeScript در ۴۹۸ فایل) با دامنه وسیع (انبار، کاردکس، حسابداری دوبل، خزانه، تولید، کارمزدی، CRM، گردش‌کار، Event Bus و ووکامرس) است. زیرساخت امنیتی و الگوهای همزمانی در بسیاری از نقاط **آگاهانه و پخته** طراحی شده‌اند (کوکی HttpOnly، CSRF، `tokenVersion`، قفل سطری، شمارنده‌های اتمیک، Decimal.js، Outbox، Idempotency).

با این حال ارزیابی نشان داد که **فاصله قابل‌توجهی بین ادعای مستندات/چنج‌لاگ و رفتار واقعی کد** وجود دارد. چند باگ با اثر مستقیم بر عملیات روزانه و صحت داده‌های مالی/انباری کشف شد که **۵ مورد از آن‌ها روی PostgreSQL 16 واقعی بازتولید و اثبات شد** (پیوست الف):

| # | یافته کلیدی | وضعیت |
|---|---|---|
| 1 | ایمیج Docker تولیدی هنگام بوت با `Cannot find module 'express'` کرش می‌کند | ✅ اثبات شد |
| 2 | در اولین روز سال مالی جدید، صدور فاکتور با خطای `23505 unique violation` شکست می‌خورد | ✅ اثبات شد |
| 3 | سیاست موجودی منفی `allowed`/`warning` عملاً کار نمی‌کند (نقض CHECK دیتابیس → خطای ۵۰۰) | ✅ اثبات شد |
| 4 | Outbox رویداد را حتی در صورت شکست هندلر «completed» علامت می‌زند؛ Retry/DLQ هرگز اجرا نمی‌شود | ✅ اثبات شد |
| 5 | سفارش ووکامرس `#12` به‌خاطر وجود `#123` «تکراری» تشخیص داده شده و بی‌صدا نادیده گرفته می‌شود | ✅ اثبات شد |
| 6 | Pipeline CI در اولین گام به‌دلیل نبود `package-lock.json` همیشه شکست می‌خورد | ✅ با بررسی کد |
| 7 | محدودکننده نرخ ورود پشت Nginx/Ingress برای **همه کاربران** یک سطل مشترک دارد (۱۰ ورود در ۱۵ دقیقه برای کل سازمان) | ✅ با بررسی کد |

### کارنامه امتیاز (از ۱۰)

| محور | امتیاز | خلاصه |
|---|:---:|---|
| معماری و ماژولار بودن | **6.5** | لایه سرویس/Facade خوب؛ اما ۳ تا ۴ منبع حقیقت برای موجودی و منطق تکراری |
| صحت منطق کسب‌وکار و یکپارچگی داده | **4.5** | چند باگ اثبات‌شده در شماره‌گذاری، موجودی، ووکامرس و مالیات |
| امنیت | **6.5** | پایه‌های قوی؛ ولی افشای توکن، قفل حساب قابل‌سوءاستفاده، بکاپ حاوی هش رمز و اسرار |
| پایداری و تاب‌آوری (Reliability) | **5.0** | Outbox ناکارآمد، همگام‌سازی سنگین در هر بوت، catch داخل تراکنش |
| کارایی و مقیاس‌پذیری | **5.5** | احراز هویت تکراری در هر درخواست، کش‌های درون‌حافظه‌ای در محیط چند Replica، N+1 |
| Type Safety | **6.0** | `tsc` بدون خطا؛ ولی ۹۷۸ مورد `any` و ۲۵۵ مورد `as any` |
| کیفیت و نگهداشت‌پذیری کد | **5.0** | ۹۴ فایل بالای ۵۰۰ خط، فایل‌های تا ۱۵۰۰ خط، نقض قاعده FE-003 |
| تست | **4.5** | ۳۴۵ سناریو، ولی فریمورک دست‌ساز، بدون تست فرانت، fallback بی‌صدا به Mock DB |
| DevOps / CI / استقرار | **3.0** | CI و Docker هر دو در وضعیت فعلی غیرقابل‌اجرا |
| مستندات و حاکمیت | **7.0** | بسیار مفصل؛ ولی تناقض داخلی و ادعاهای غیرمنطبق با کد |
| **میانگین وزنی کل** | **≈ 5.2** | «سامانه‌ای با پایه مهندسی خوب که برای تولید پایدار، به یک دور اصلاح متمرکز نیاز دارد» |

---

## ۲. روش ارزیابی و شواهد اجرایی

1. **بازبینی ایستا (Static Review)** دستی روی مسیرهای حیاتی: احراز هویت، مجوزدهی، موتور موجودی، اسناد، حسابداری، Outbox، ووکامرس، Migrationها، استقرار.
2. **Type-check کامل** (`tsc --noEmit`) روی یک کپی ایزوله: **۰ خطا** ✅
3. **ممیزی وابستگی‌ها** (`npm audit --omit=dev`): **۱ آسیب‌پذیری High** در `xlsx` (Prototype Pollution + ReDoS، بدون اصلاحیه در npm).
4. **اجرای واقعی Migrationها** روی یک PostgreSQL 16 موقت (۱۵ مایگریشن، موفق) و **اجرای اسکریپت اثبات باگ** (Proof-of-Concept) — پیوست الف.
5. **بازسازی باندل سرور** با همان دستور `npm run build` و اجرای آن در محیطی مشابه ایمیج Runtime داکر.
6. **سنجه‌های کمی کد:**

| سنجه | مقدار |
|---|---|
| کل خطوط TS/TSX | 159,321 |
| فایل‌های بالای ۵۰۰ خط (غیرتست) | 94 |
| کامپوننت‌های TSX بالای ۳۰۰ خط (نقض FE-003) | 104 |
| `any` (`: any` / `as any` / `<any>`) خارج از تست | 978 |
| `as any` | 255 |
| `console.*` خارج از تست | 146 |
| حلقه‌های `for…of` در services/routes (غالباً با `await` داخلی) | 248 |
| تعداد `router.use(authenticateToken)` در روترهای mount شده روی `/api` | 23 |
| سناریوهای تست (`makeTestCase`) | 345 |
| تست‌های فرانت‌اند | 0 |

---

## ۳. نقاط قوت قابل توجه

پیش از فهرست مشکلات، لازم است نقاط قوت واقعی پروژه ثبت شود؛ بسیاری از این‌ها در پروژه‌های هم‌اندازه دیده نمی‌شوند:

- **احراز هویت مبتنی بر کوکی HttpOnly + CSRF Token در JWT** و ابطال نشست با `tokenVersion` (`src/middleware/auth.ts`).
- **رد کلیدهای JWT پیش‌فرض/ضعیف** در غیر dev/test و fail-fast در نبود `JWT_SECRET`.
- **امضای HMAC وب‌هوک با `timingSafeEqual`** و حالت Fail-Closed در نبود کلید (`woocommerce.routes.ts:463-519`).
- **گارد SSRF** (`src/lib/ssrfGuard.ts`) و TLS سخت‌گیرانه برای ارتباطات خارجی.
- **شماره‌گذاری اتمیک** با `nextval` و جدول `document_ref_counters` (عدم استفاده از `MAX()+1`).
- **قفل سطری `FOR UPDATE`** در مسیرهای حساس موجودی و اسناد حسابداری.
- **محاسبات مالی با `decimal.js`** (`src/lib/financialDecimal.ts`).
- **Transactional Outbox، Idempotency Service، DLQ، Health Probeها، Prometheus، Graceful Shutdown**.
- **اعتبارسنجی Zod** در اکثر روت‌ها و سلسله‌مراتب خطای تایپ‌شده (`AppError`).
- **عدم سقوط به Mock DB در Production** و **Fail-fast مایگریشن در Production**.
- **مستندسازی حاکمیتی بسیار مفصل** (AGENTS.md، ARCHITECTURE_RULES، TECH_DEBT، Roadmapها).

---

## ۴. یافته‌های بحرانی — P0

> P0 = سامانه را از کار می‌اندازد یا مستقیماً داده مالی/انباری را خراب می‌کند. باید فوراً اصلاح شود.

### P0-1 — ایمیج Docker تولیدی هنگام بوت کرش می‌کند

**شواهد:** دستور build سرور با `--packages=external` اجرا می‌شود؛ یعنی همه پکیج‌های npm در باندل `require` باقی می‌مانند:

```jsonc
// package.json → scripts.build
"esbuild server.ts --bundle --platform=node --format=cjs --packages=external ..."
```

اما مرحله Runtime داکر فقط `dist` و `package.json` را کپی می‌کند و **`node_modules` ندارد**:

```dockerfile
# Dockerfile (Stage 2: runtime)
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
...
CMD ["node", "dist/server.cjs"]
```

**بازتولید:** باندل با همان دستور ساخته و در پوشه‌ای بدون `node_modules` اجرا شد:

```text
$ node server.cjs
Error: Cannot find module 'express'
```

باندل به ۳۰ پکیج خارجی نیاز دارد (`express`, `pg`, `drizzle-orm`, `helmet`, `jsonwebtoken`, …). در نتیجه **هر Pod در K8s در CrashLoopBackOff می‌ماند.**

**اصلاح پیشنهادی:**

```dockerfile
# ---------- Stage 1: production deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- Stage 2: build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- Stage 3: runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
RUN mkdir -p public/uploads logs && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
```

> و در CI یک گام «Smoke Boot» اضافه شود: `docker run --rm -e ... image node -e "require('./dist/server.cjs')"` یا فراخوانی `/health/live` پس از بالا آمدن کانتینر.

---

### P0-2 — شکست صدور فاکتور در سال مالی جدید (برخورد شماره عطف بین سال‌ها)

**شواهد:** شمارنده اسناد **به تفکیک سال مالی** ریست می‌شود (`document_ref_counters` با کلید `(doc_type, fiscal_year)`) و شماره خروجی یک عدد ساده است:

```ts
// src/services/documents/documentRefNumber.service.ts:174
return String(nextNum);   // مثلاً "1"
```

اما ایندکس یکتای دیتابیس **سال مالی را در نظر نمی‌گیرد**:

```sql
-- drizzle/0001_integrity_constraints.sql:21
CREATE UNIQUE INDEX uq_documents_type_ref_number_active
  ON documents (type, ref_number) WHERE is_deleted = 0 AND length(ref_number) > 0;
```

بنابراین در سال ۱۴۰۵، فاکتور شماره `1` با فاکتور شماره `1` سال ۱۴۰۴ برخورد می‌کند. این وضعیت **تا زمانی که شمارنده سال جدید از بیشینه سال قبل عبور کند** برای هر فاکتور تکرار می‌شود.

**بازتولید (پیوست الف):**

```text
### BUG1 next ref for new fiscal year: 1
### BUG1 insert FAILED:  23505 Failed query: insert into "documents" ...
```

تست رگرسیون `reg_fiscal_year_ref_isolation_td_152_153` این مورد را پوشش نمی‌دهد چون در سال قبل شماره `888` درج می‌کند نه `1`.

**اصلاح پیشنهادی (Migration جدید + Backfill):**

```sql
-- drizzle/0015_documents_fiscal_year_ref_unique.sql
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fiscal_year integer;
-- مقداردهی fiscal_year با اسکریپت TS (resolveJalaliFiscalYear) پیش از ایجاد ایندکس
DROP INDEX IF EXISTS uq_documents_type_ref_number_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_type_fy_ref_active
  ON documents (type, fiscal_year, ref_number)
  WHERE is_deleted = 0 AND length(ref_number) > 0;
```

```ts
// هنگام درج سند (documentCreation.service.ts)
const fiscalYear = resolveJalaliFiscalYear(normalizedDate);
await tx.insert(documents).values({ ...docValues, fiscalYear });
```

راه‌حل جایگزین: شماره عطف همراه با پیشوند سال (`1405-000001`) ذخیره شود. همچنین یک تست رگرسیون که **شماره یکسان در دو سال متوالی** درج می‌کند اضافه شود.

---

### P0-3 — سیاست موجودی منفی `allowed` / `warning` عملاً غیرقابل استفاده است

**شواهد:** سرویس انبار در سیاست `warning`/`allowed` اجازه منفی شدن موجودی را می‌دهد:

```ts
// src/services/inventory/itemWarehouseStock.service.ts:115-121
case 'warning':
  logger.warn(...);
  break;
case 'allowed':
  break;
...
newLocationStock = fin(previousLocationStock).subtract(qty).round(4).toNumber(); // منفی
```

اما Migration 0014 روی همین جدول قید زیر را گذاشته است:

```sql
-- drizzle/0014_item_warehouse_stocks.sql:64
ALTER TABLE item_warehouse_stocks ADD CONSTRAINT chk_iws_current_stock_non_negative CHECK (current_stock >= 0);
```

**بازتولید:**

```text
### BUG2 out-movement under allowed policy FAILED:  23514 Failed query: insert into "item_warehouse_stocks" ...
```

نتیجه: کاربری که در تنظیمات «اجازه موجودی منفی» را فعال کرده، با خطای ۵۰۰ مبهم مواجه می‌شود. منطق کسب‌وکار و قید دیتابیس با هم در تضادند.

**اصلاح پیشنهادی** — یکی از دو مسیر باید **آگاهانه** انتخاب شود:

```ts
// گزینه الف (توصیه‌شده اگر موجودی منفی کسب‌وکاری لازم نیست): حذف گزینه‌ها از سرویس و UI
static async setPolicy(policy: NegativeStockPolicyType, externalTx?: DbExecutor): Promise<void> {
  if (policy !== 'forbidden') {
    throw new ValidationError('با قید دیتابیسی chk_iws_current_stock_non_negative فقط سیاست forbidden پشتیبانی می‌شود.');
  }
  ...
}
```

```sql
-- گزینه ب (اگر موجودی منفی لازم است): حذف قید و اتکا به لایه سرویس
ALTER TABLE item_warehouse_stocks DROP CONSTRAINT IF EXISTS chk_iws_current_stock_non_negative;
```

همچنین خطای `23514` باید در `errorHandler` به یک `BusinessLogicError` خوانا نگاشت شود.

---

### P0-4 — Pipeline CI همیشه در گام اول شکست می‌خورد

**شواهد:**

```yaml
# .github/workflows/ci.yml
- name: Verify package-lock.json Presence (TD-129)
  run: |
    if [ ! -f package-lock.json ]; then
      echo "::error::package-lock.json is required ..."
      exit 1
```

و `package-lock.json` در مخزن وجود ندارد (Dockerfile هم صراحتاً به این موضوع اشاره کرده است). یعنی **هیچ‌یک از گیت‌های تست، Coverage و Docker Build هرگز اجرا نشده‌اند**؛ که توضیح می‌دهد چرا باگ P0-1 کشف نشده است.

مشکلات تکمیلی CI:
- `npm audit --audit-level=high || true` ← گیت امنیتی بی‌اثر است.
- CI از **Node 20** و Docker از **Node 22** استفاده می‌کند.

**اصلاح پیشنهادی:**

```bash
npm install            # یک‌بار، روی Node 22
git add package-lock.json && git commit -m "build: track package-lock.json for reproducible builds"
```

```yaml
- uses: actions/setup-node@v4
  with: { node-version: '22', cache: 'npm' }
- run: npm ci
- run: npm audit --omit=dev --audit-level=high   # بدون || true
```

---

### P0-5 — محدودکننده نرخ ورود پشت پراکسی، کل سازمان را قفل می‌کند

**شواهد:** کلید محدودکننده ورود عمداً از آدرس سوکت گرفته می‌شود:

```ts
// src/app.ts:223-246
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  ...
  keyGenerator: (req: any) => {
    const raw = req.socket?.remoteAddress || req.ip || 'unknown';
    ...
```

اسکریپت `setup-domain.sh` برنامه را پشت Nginx (`proxy_pass http://127.0.0.1:...`) و مانیفست K8s پشت Ingress قرار می‌دهد. در این حالت `remoteAddress` برای **همه کاربران** آدرس پراکسی است. همچنین `skipSuccessfulRequests` فعال نیست، پس **ورودهای موفق هم شمرده می‌شوند**. نتیجه: پس از ۱۰ ورود (موفق یا ناموفق) در کل سازمان، همه کاربران به‌مدت ۱۵ دقیقه خطای 429 می‌گیرند. علاوه بر این، محدودکننده درون‌حافظه‌ای است و در K8s با ۲ تا ۱۰ Replica، سقف واقعی ضرب در تعداد Podها می‌شود.

**اصلاح پیشنهادی:**

```ts
// src/app.ts
// فقط به پراکسی‌های شناخته‌شده اعتماد شود (Nginx محلی یا CIDR اینگرس)
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  // req.ip با trust proxy صحیح، IP واقعی کلاینت است و از XFF جعلی محافظت می‌شود
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? 'unknown')}:${String(req.body?.username ?? '').toLowerCase()}`,
  // در چند Replica: store: new RedisStore({ ... })
});
```

---

## ۵. یافته‌های با اولویت بالا — P1

### P1-1 — Outbox تضمین «حداقل یک‌بار تحویل» را ندارد؛ Retry و DLQ کد مرده‌اند

**شواهد:** `publish` همه خطاها را می‌بلعد و `EventEmitter.emit` هندلرهای async را await نمی‌کند:

```ts
// src/services/events/domainEventBus.ts:45-71
async publish(event) {
  try {
    ...
    this.emit(event.eventType, event);   // await نمی‌شود
    this.emit('*', event);
  } catch (err) {
    logger.error(...);                   // پرتاب مجدد نمی‌شود
  }
}
```

و `subscribe` نیز خطای هندلر را catch می‌کند (خط 92-103). در نتیجه `OutboxService.processPendingBatch` همیشه رویداد را `completed` می‌کند.

**بازتولید:**

```text
[DomainEventBus Handler Error] Error in handler for AuditProbeEvent: handler boom
[Transactional Outbox] Successfully dispatched outbox event #1 (AuditProbeEvent)
### BUG4 outbox status after failing handler: completed retryCount=0
```

**باگ دوم در همین بخش — Backoff نادیده گرفته می‌شود:** در خطای غیرنهایی وضعیت به `'pending'` برمی‌گردد (خط 180) ولی شرط انتخاب برای `pending` اصلاً `nextRetryAt` را بررسی نمی‌کند (خط 89)؛ پس رویداد بدون تأخیر در تیک بعدی (۳ ثانیه) دوباره اجرا می‌شود.

**اصلاح پیشنهادی:**

```ts
// domainEventBus.ts — دیسپچ قابل‌ردیابی برای Outbox
private handlers = new Map<string, DomainEventHandler[]>();

subscribe<T>(eventType: string, handler: DomainEventHandler<T>): void {
  const list = this.handlers.get(eventType) ?? [];
  list.push(handler as DomainEventHandler);
  this.handlers.set(eventType, list);
}

/** برای Outbox: همه هندلرها await می‌شوند و هر شکست به بالا پرتاب می‌شود */
async dispatchOrThrow(event: BaseDomainEvent): Promise<void> {
  const validation = validateDomainEvent(event);
  if (!validation.valid) throw new Error(validation.errors.join(' | '));
  const targets = [...(this.handlers.get(event.eventType) ?? []), ...(this.handlers.get('*') ?? [])];
  const results = await Promise.allSettled(targets.map(h => h(event)));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failures.length > 0) {
    throw new AggregateError(failures.map(f => f.reason), `${failures.length} handler(s) failed for ${event.eventType}`);
  }
}
```

```ts
// outboxService.ts — احترام به backoff برای رکوردهای pending
.where(and(
  or(eq(outboxEvents.status, 'pending'), eq(outboxEvents.status, 'failed')),
  or(isNull(outboxEvents.nextRetryAt), lte(outboxEvents.nextRetryAt, nowIso)),
  sql`${outboxEvents.retryCount} < ${this.MAX_RETRIES}`
))
// و در processPendingBatch:
await domainEventBus.dispatchOrThrow(domainEvent);
```

> نکته: هندلرها باید Idempotent باشند (که با `IdempotencyService` در ActionHandlerها تا حدی رعایت شده است).

---

### P1-2 — ووکامرس: چند باگ هم‌زمان در پردازش سفارش

**(الف) تشخیص تکراری با `LIKE` → نادیده گرفتن سفارش‌های واقعی**

```ts
// src/routes/woocommerce.routes.ts:228-234
const notesTag = `سفارش ووکامرس #${wcOrderId}`;
like(documents.notes, `%${notesTag}%`)   // "#12" با "#123" هم تطبیق دارد
```

```text
### BUG5 docs matched for order #12: [ { id: 3, notes: 'سفارش ووکامرس #123' } ]
```

**(ب) لاگ سفارش ناموفق هرگز ذخیره نمی‌شود:** درج رکورد `failed` در `woocommerce_order_logs` داخل همان تراکنشی است که بلافاصله با `throw new Error(errMessage)` (خط 362) Rollback می‌شود.

**(ج) `try/catch` داخل تراکنش بدون Savepoint:** (خطوط 240-250، 282-294 و 347-360). در PostgreSQL پس از هر خطا تراکنش در وضعیت aborted قرار می‌گیرد و همه کوئری‌های بعدی با `25P02 current transaction is aborted` شکست می‌خورند؛ catch کردن خطا بدون Savepoint عملاً بی‌اثر است.

**(د) صدور فاکتور قطعی برای سفارش پرداخت‌نشده:** وضعیت‌های `pending` و `on-hold` نیز فاکتور `final` صادر و موجودی کسر می‌کنند (خط 537)، و هیچ مسیری برای `cancelled`/`refunded`/`failed` (ابطال فاکتور و برگشت موجودی) وجود ندارد.

**(هـ) پاسخ 200 در خطا:** (خط 549) ووکامرس Retry نمی‌کند؛ همراه با (ب) سفارش‌های ناموفق فقط در لاگ فایل باقی می‌مانند.

**(و) انبار پیش‌فرض غیرقطعی:** `select ... where isActive = 1 limit(1)` بدون `ORDER BY` (خط 299).

**(ز) مشتری ساخته می‌شود ولی به فاکتور لینک نمی‌شود.**

**اصلاح پیشنهادی:**

```ts
// (الف) جستجوی دقیق از جدول لاگ (wc_order_id UNIQUE است) — حذف fallback مبتنی بر LIKE
const [log] = await tx.select().from(woocommerceOrderLogs)
  .where(eq(woocommerceOrderLogs.wcOrderId, wcOrderId))
  .for('update');
// اگر fallback لازم است، با regex مرزدار:
// sql`${documents.notes} ~ ${`سفارش ووکامرس #${wcOrderId}(\\D|$)`}`

// (ب) ثبت لاگ شکست خارج از تراکنش اصلی
let failure: Error | null = null;
const result = await orm.transaction(async (tx) => { ... if (noMatch) { failure = new Error(msg); return null; } ... });
if (failure) {
  await orm.insert(woocommerceOrderLogs).values({ wcOrderId, status: 'failed', errorMessage: failure.message, payload: wcOrder })
    .onConflictDoUpdate({ target: woocommerceOrderLogs.wcOrderId, set: { status: 'failed', errorMessage: failure.message, updatedAt: systemNowUtcIso() } });
  throw failure;
}

// (ج) عملیات اختیاری داخل تراکنش با Savepoint (تراکنش تودرتو در Drizzle)
await tx.transaction(async (sp) => {
  await sp.insert(customers).values({ ... });
}).catch((custErr) => logger.warn({ message: 'auto-create customer failed', error: custErr }));

// (د) فقط سفارش‌های پرداخت‌شده؛ و هندل ابطال
const INVOICEABLE = new Set(['processing', 'completed']);
const REVERSIBLE  = new Set(['cancelled', 'refunded', 'failed']);

// (هـ) در خطای موقت (DB/Timeout) کد 5xx برگردد تا ووکامرس Retry کند؛ فقط خطای داده‌ای 200 + success:false

// (و) انبار پیش‌فرض قطعی
const [defLoc] = await tx.select().from(warehouses)
  .where(eq(warehouses.isActive, 1)).orderBy(asc(warehouses.id)).limit(1);
```

---

### P1-3 — ذخیره تنظیمات برای نقش «مدیر» همیشه با 403 شکست می‌خورد؛ و خطر بازنویسی اسرار با `********`

**شواهد:** فرانت در هر ذخیره، کلید `runtime_enable_test_endpoints` را ارسال می‌کند:

```ts
// src/hooks/useSettings.ts:293
{ key: 'runtime_enable_test_endpoints', value: enableTestEndpoints },
```

و سرور برای غیرادمین روی همین کلید `ForbiddenError` پرتاب می‌کند (فارغ از اینکه مقدار تغییر کرده یا نه):

```ts
// src/routes/system.routes.ts:161-168
if (item.key === 'runtime_enable_test_endpoints') {
  ...
  if (req.user?.role !== 'admin') {
    throw new ForbiddenError('تغییر فلگ‌های سیستمی فقط برای مدیر سیستم مجاز است.');
  }
```

نتیجه: نقش `manager` که منوی تنظیمات را می‌بیند و روت را مجاز دارد، **هرگز نمی‌تواند تنظیمات را ذخیره کند**.

**خطر نهفته:** همین فرم برای غیرادمین مقادیر ماسک‌شده `********` را برای `wc_consumer_secret` و `wc_webhook_secret` دریافت می‌کند (`system.routes.ts:113-116`) و در ذخیره، همان را برمی‌گرداند (`useSettings.ts:298-299`). به محض رفع مشکل بالا، **اسرار واقعی با `********` بازنویسی می‌شوند** و همگام‌سازی و امضای وب‌هوک ووکامرس می‌شکند. علاوه بر این، `manager` می‌تواند هر کلید دلخواهی (از جمله `negative_stock_policy` و `menu_visibility`) را بنویسد و این تغییرات **بدون snapshot قبل/بعد** لاگ می‌شوند (نقض قاعده Audit در AGENTS.md).

**اصلاح پیشنهادی:**

```ts
// system.routes.ts — سرور
const ADMIN_ONLY_KEYS = new Set(['runtime_enable_test_endpoints', 'wc_consumer_secret', 'wc_webhook_secret', 'erp_webhook_secret_token']);
const ALLOWED_KEYS = new Set([/* لیست سفید کلیدهای قابل ویرایش */]);

const before = await tx.select().from(appSettings);
for (const item of settings) {
  if (!ALLOWED_KEYS.has(item.key)) throw new ValidationError(`کلید ناشناخته: ${item.key}`);
  if (item.value === MASKED_SETTING_VALUE) continue;              // هرگز مقدار ماسک را ذخیره نکن
  const current = before.find(s => s.key === item.key)?.value;
  if (current === item.value) continue;                            // بدون تغییر → بدون بررسی مجوز
  if (ADMIN_ONLY_KEYS.has(item.key) && req.user?.role !== 'admin') {
    throw new ForbiddenError('...');
  }
  ...
}
await logActivity({ ..., details: { before: redact(beforeMap), after: redact(afterMap) } });
```

```ts
// useSettings.ts — کلاینت: فقط کلیدهای تغییرکرده ارسال شوند
const changed = nextSettings.filter(s => initialMap.get(s.key) !== s.value);
await saveSettingsMutation.mutateAsync({ settings: changed });
```

---

### P1-4 — افشای JWT در بدنه پاسخ ورود (نقض قاعده HttpOnly پروژه)

**شواهد:**

```ts
// src/routes/auth.routes.ts:395-402 (login) و 274-281 (setup)
res.json({ success: true, user: {...}, token, csrfToken });
```

و فرانت توکن را نگه داشته و به‌صورت `Authorization: Bearer` ارسال می‌کند (`src/api.ts:43, 103-109, 138`). این کار حفاظت HttpOnly را بی‌اثر می‌کند: هر XSS (حتی در یک وابستگی) می‌تواند توکن ۲۴ ساعته را بدزدد. AGENTS.md §5 صراحتاً می‌گوید «Browser JS MUST NOT store or read raw tokens».

**اصلاح پیشنهادی:**

```ts
// auth.routes.ts
res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(req));
res.json({ success: true, user: safeUser, csrfToken });   // بدون token
```

```ts
// api.ts — حذف inMemoryAuthToken و هدر Authorization در مرورگر
// برای کلاینت‌های ماشینی (API) از API Key یا Personal Access Token جداگانه استفاده شود.
```

---

### P1-5 — قفل حساب کاربری قابل سوءاستفاده (DoS) + شمارش کاربران + bcrypt همگام

**شواهد:**
1. **DoS:** قفل ۳۰ دقیقه‌ای پس از ۵ تلاش ناموفق **فقط بر اساس نام کاربری** است (`auth.routes.ts:18-19, 43-78`). مهاجم بدون احراز هویت می‌تواند حساب `admin` را با ۵ درخواست به‌طور مداوم قفل نگه دارد.
2. **User Enumeration:** پیام خطا برای کاربر موجود شامل «(n تلاش باقی‌مانده)» است و برای کاربر ناموجود نیست (خط 438 در مقابل 459 برای کاربر ناموجود)؛ همچنین قفل (429) فقط برای کاربر موجود رخ می‌دهد. اختلاف زمانی (عدم اجرای bcrypt برای کاربر ناموجود) نیز نشت اطلاعات دارد.
3. **Race در شمارنده تلاش:** `recordFailedAttempt` الگوی خواندن-سپس-نوشتن بدون قفل دارد؛ تلاش‌های موازی کمتر از واقع شمرده می‌شوند.
4. **Event-loop blocking:** `bcrypt.compareSync` و `bcrypt.hashSync` (خطوط 356 و 232) در مسیر درخواست، کل سرور را برای هر ورود ~۱۰۰ms مسدود می‌کنند.

**اصلاح پیشنهادی:**

```ts
// یک‌بار در زمان بارگذاری ماژول؛ برای یکسان‌سازی زمان پاسخ کاربر موجود/ناموجود
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

const isMatch = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);  // async
if (!user || user.isDeleted === 1 || !isMatch) {
  if (user) await recordFailedAttemptAtomic(user.id);
  return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });  // پیام یکسان
}

// افزایش اتمیک بدون الگوی Read-then-Write
async function recordFailedAttemptAtomic(userId: number) {
  const [row] = await orm.update(users)
    .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
    .where(eq(users.id, userId))
    .returning({ count: users.failedLoginCount });
  if (row.count >= LOCKOUT_THRESHOLD) { /* قفل کوتاه + backoff تصاعدی، نه ۳۰ دقیقه ثابت */ }
}
```

> توصیه: به‌جای قفل سخت، **تأخیر تصاعدی (progressive delay) + CAPTCHA** و محدودیت بر اساس **IP + username** (یافته P0-5).

---

### P1-6 — «نسخه پشتیبان» حاوی هش رمزها و اسرار، ناقص و پرمصرف

**شواهد:** `GET /api/export-backup` (`system.routes.ts:874-960`):
- `orm.select().from(users)` ← **هش رمز عبور همه کاربران** در فایل JSON.
- `orm.select().from(appSettings)` ← **`wc_consumer_secret`، `wc_webhook_secret`، `erp_webhook_secret_token` به‌صورت متن ساده**.
- جداول حسابداری (`accounts`, `journal_vouchers`, `journal_voucher_items`, `cheques`, `treasury_transactions`, `bank_accounts`)، کارمزدی، گردش‌کار و `item_warehouse_stocks` **اصلاً در خروجی نیستند** ← این فایل «بکاپ» نیست و ابزار Restore هم ندارد؛ اما کاربر به آن اعتماد می‌کند.
- ۱۸ کوئری `SELECT *` موازی، همه در حافظه → خطر OOM و اشغال ۱۸ اتصال از Pool (۲۰ تایی).

**اصلاح پیشنهادی:**

```ts
// حداقل: حذف داده حساس
orm.select({ id: users.id, username: users.username, fullName: users.fullName, role: users.role }).from(users),
orm.select().from(appSettings).then(rows => rows.filter(r => !SENSITIVE_SETTING_PATTERN.test(r.key))),
```

> توصیه اصلی: این endpoint به «Export داده‌های گزارشی» تغییر نام یابد و بکاپ واقعی با `pg_dump --format=custom` زمان‌بندی‌شده (CronJob در K8s) + تست Restore دوره‌ای انجام شود. برای خروجی‌های بزرگ از **Streaming** (`res.write` / cursor) استفاده شود.

---

### P1-7 — استخراج مالیات بر ارزش افزوده از متن آزاد «یادداشت» سند

**شواهد:**

```ts
// src/services/accounting/voucherSync.service.ts:97-117
} else if (doc.notes && (doc.notes.includes('ارزش افزوده') || doc.notes.includes('مالیات') || /vat/i.test(doc.notes))) {
  const percentMatch = normalizedNotes.match(/(?:ارزش\s*(?:بر\s*)?افزوده|مالیات...)\s*[:=]?\s*([\d.]+)\s*(?:%|٪|درصد)/i) || ...
  ...
  const match = normalizedNotes.match(/(?:ارزش\s*(?:بر\s*)?افزوده|مالیات...|vat)\s*[:=]?\s*([\d,.]+)/i);
  if (match && match[1]) vatAmount = Number(match[1].replace(/,/g, '')) || 0;
```

یادداشتی مانند «مالیات ۲ قلم آخر محاسبه نشود» یا «vat 1403 پرداخت شد» به مبلغ مالیات **۲ ریال** یا **۱۴۰۳ ریال** تبدیل می‌شود و در سند حسابداری (بدهکار مشتری / بستانکار مالیات پرداختنی) ثبت می‌شود. هیچ اثری از این مبلغ در خود فاکتور (فیلد ساختاریافته) وجود ندارد؛ پس فاکتور و سند حسابداری با هم مغایرت پیدا می‌کنند.

**اصلاح پیشنهادی:**

```ts
// schema/documents.ts — فیلدهای ساختاریافته
vatPercent: numeric('vat_percent', { precision: 5, scale: 2, mode: 'string' }).default('0'),
vatAmount:  numeric('vat_amount',  { precision: 18, scale: 4, mode: 'string' }).default('0'),
```

```ts
// voucherSync.service.ts — فقط از فیلد ساختاریافته
const vatAmount = fin(doc.vatAmount ?? 0).toNumber();
// منطق Regex روی notes فقط در یک اسکریپت مهاجرت یک‌باره (با گزارش برای بازبینی انسانی) استفاده شود.
```

---

### P1-8 — همگام‌سازی کامل اسناد حسابداری در **هر بوت** و **هر Pod**، بدون قید یکتایی

**شواهد:**

```ts
// server.ts:67-68
await AccountingService.syncAllInvoiceVouchers()...
await KardexBackfillService.syncMissingInitialTransactions()...
```

`syncAllInvoiceVouchers` (`voucherSync.service.ts:1340-1371`) روی **همه اسناد قطعی تاریخ سازمان** حلقه می‌زند و برای هر کدام چندین کوئری اجرا می‌کند. `markStartupComplete()` بعد از این مرحله صدا زده می‌شود؛ یعنی **زمان آماده‌شدن Pod با رشد داده‌ها خطی افزایش می‌یابد** و دیر یا زود از `startupProbe` عبور می‌کند.

مهم‌تر اینکه بررسی وجود سند (`existingVoucher`، خط 355) **بدون قفل** است و روی `journal_vouchers(reference_module, reference_id)` **هیچ ایندکس یکتا (و حتی ایندکس معمولی روی `reference_id`)** وجود ندارد. با ۲+ Replica که هم‌زمان بالا می‌آیند، برای یک فاکتور ممکن است **دو سند حسابداری** ساخته شود (دوبار ثبت درآمد).

**اصلاح پیشنهادی:**

```sql
-- Migration
CREATE UNIQUE INDEX IF NOT EXISTS uq_jv_reference_active
  ON journal_vouchers (reference_module, reference_id)
  WHERE is_deleted = 0 AND reference_id IS NOT NULL AND reference_module IN ('invoice','purchase','inventory');
CREATE UNIQUE INDEX IF NOT EXISTS uq_jv_voucher_number ON journal_vouchers (voucher_number);
```

```ts
// server.ts — حذف از مسیر بوت؛ تبدیل به Job دستی/زمان‌بندی‌شده با قفل مشورتی و پردازش دسته‌ای
const [{ locked }] = (await orm.execute(sql`SELECT pg_try_advisory_lock(91001) AS locked`)).rows as any[];
if (locked) {
  try { await VoucherSyncService.syncMissingVouchersOnly({ batchSize: 200 }); }  // فقط اسناد فاقد سند
  finally { await orm.execute(sql`SELECT pg_advisory_unlock(91001)`); }
}
```

---

### P1-9 — Migration 0014 داده موجودی را بی‌صدا تغییر می‌دهد

**شواهد:**

```sql
-- drizzle/0014_item_warehouse_stocks.sql:46-58
SELECT id INTO wh_id FROM warehouses WHERE lower(code) = lower(wh_code) OR lower(name) = lower(wh_code) LIMIT 1;
IF wh_id IS NULL THEN SELECT id INTO wh_id FROM warehouses WHERE code = 'main' LIMIT 1; END IF;
...
VALUES (r.item_id, wh_id, wh_code, GREATEST(COALESCE(stk_val, 0), 0), 1)
ON CONFLICT (item_id, warehouse_id) DO UPDATE SET current_stock = EXCLUDED.current_stock
```

1. موجودی‌های منفی تاریخی **بدون گزارش به صفر تبدیل** می‌شوند ← مغایرت با کاردکس.
2. اگر در JSONB یک کالا دو کلید به یک انبار نگاشت شوند (مثلاً کلید با `code` و کلید قدیمی با `name`، یا چند کلید ناشناخته که همه به `main` می‌افتند)، **مقدار دوم مقدار اول را بازنویسی می‌کند** به‌جای جمع شدن ← از دست رفتن موجودی.
3. `warehouse_code` با کلید خام JSON (که ممکن است نام انبار باشد) پر می‌شود نه `code` واقعی.

چنج‌لاگ 7.0.8 این مهاجرت را «انتقال کامل و بدون هدررفت» توصیف کرده است.

**اصلاح پیشنهادی:** چون Migration اعمال‌شده نباید ویرایش شود، یک Migration/اسکریپت ترمیمی:

```sql
-- 0015_iws_reconcile_from_kardex.sql (یا اسکریپت TS با گزارش)
-- بازسازی item_warehouse_stocks از دفتر کاردکس به‌عنوان منبع حقیقت
WITH ledger AS (
  SELECT t.item_id, w.id AS warehouse_id, w.code,
         SUM(CASE WHEN t.type = 'in' THEN t.quantity ELSE -t.quantity END) AS qty
  FROM transactions t JOIN warehouses w ON w.code = t.location
  WHERE t.is_deleted = 0
  GROUP BY t.item_id, w.id, w.code
)
SELECT l.item_id, l.code, l.qty AS ledger_qty, s.current_stock AS table_qty
FROM ledger l LEFT JOIN item_warehouse_stocks s ON s.item_id = l.item_id AND s.warehouse_id = l.warehouse_id
WHERE COALESCE(s.current_stock, 0) <> l.qty;   -- ابتدا گزارش مغایرت، سپس اصلاح کنترل‌شده
```

برای الگوی آینده: در Migrationهای داده‌ای، `DO UPDATE SET current_stock = item_warehouse_stocks.current_stock + EXCLUDED.current_stock` و ثبت هر Clamp در یک جدول `migration_anomalies`.

---

## ۶. یافته‌های با اولویت متوسط — P2

### P2-1 — چند منبع حقیقت برای موجودی؛ موتور اصلی از JSONB جمع می‌زند

اکنون موجودی در **چهار** جا نگهداری می‌شود: `items.current_stock`، `items.stocks` (JSONB)، `item_warehouse_stocks` و دفتر `transactions` (کاردکس). موتور اصلی، جمع کل را **از JSONB** محاسبه می‌کند نه از جدول نرمال:

```ts
// src/services/documents/documentStockEngine.service.ts:110-122
currentStocks[finalTargetLoc] = newLocationStock;
// Single source of truth: total currentStock is strictly the sum of all location stocks
const newTotalStock = Object.values(currentStocks).reduce(...)
```

اگر JSONB کلیدهای قدیمی (نام انبار به‌جای کد) داشته باشد، کل موجودی **دوبار شمرده** می‌شود، در حالی که `syncJsonbReadCache` همان مقدار را از جدول نرمال حساب می‌کند. دو مسیر، دو نتیجه.

**اصلاح:**

```ts
// پس از applyMovement، کل موجودی و JSONB فقط از جدول نرمال بازسازی شود
const { newLocationStock } = await ItemWarehouseStockService.applyMovement(tx, {...});
const { stocksJson, totalStock } = await ItemWarehouseStockService.syncJsonbReadCache(tx, itemId);
// و محاسبه WAC با oldTotalStock = مجموع جدول نرمال قبل از حرکت
```

> هدف میان‌مدت: حذف ستون JSONB `stocks` و `current_stock` از `items` و جایگزینی با یک **View** یا ستون Generated/Materialized.

### P2-2 — Race نهفته در اولین حرکت انبار (کالا × انبار جدید)

`ItemWarehouseStockService.applyMovement` در نبود سطر، ابتدا `SELECT ... FOR UPDATE` (روی سطر ناموجود → قفلی گرفته نمی‌شود) و سپس `INSERT` ساده انجام می‌دهد. در حال حاضر فراخواننده‌ها (`DocumentStockEngine`) پیش‌تر سطر `items` را قفل می‌کنند و این Race پنهان است، اما سرویس **به‌تنهایی** ایمن نیست:

```text
### RACE trials with failures: 29 /30, failed tx: 87 /120 [ '23505 Key (item_id, warehouse_id)=(34, 1) already exists.' ]
```

**اصلاح:**

```ts
await tx.insert(itemWarehouseStocks)
  .values({ itemId, warehouseId: warehouse.id, warehouseCode: warehouse.code, currentStock: 0, reservedStock: 0 })
  .onConflictDoNothing({ target: [itemWarehouseStocks.itemId, itemWarehouseStocks.warehouseId] });
const [row] = await tx.select().from(itemWarehouseStocks)
  .where(and(eq(itemWarehouseStocks.itemId, itemId), eq(itemWarehouseStocks.warehouseId, warehouse.id)))
  .for('update');   // اکنون سطر حتماً وجود دارد و قفل واقعی گرفته می‌شود
```

### P2-3 — انبار پیش‌فرض غیرقطعی

```ts
// src/services/inventory/itemWarehouseStock.service.ts:22-34
const allWarehouses = await tx.select(...).from(warehouses).where(eq(warehouses.isActive, 1));  // بدون ORDER BY
if (!input) return allWarehouses[0];
```

PostgreSQL ترتیب را بدون `ORDER BY` تضمین نمی‌کند (پس از VACUUM/UPDATE ممکن است تغییر کند). حرکات بدون انبار مشخص ممکن است به انبارهای متفاوت بروند. **اصلاح:** `.orderBy(asc(warehouses.id))` یا یک تنظیم صریح `default_warehouse_code`.

### P2-4 — ثبت قیمت فروش به‌عنوان بهای تمام‌شده در صورت WAC صفر

```ts
// documentStockEngine.service.ts:89
const txUnitPrice = inOut === 'out' ? (currentItemWac > 0 ? currentItemWac : price) : price;
```

برای کالایی که هنوز ورودی نداشته (WAC=0)، قیمت **فروش** به‌عنوان بهای تمام‌شده خروج در کاردکس ثبت می‌شود و سپس از همین مقدار در سند COGS استفاده می‌شود (`voucherSync.service.ts:270-285`) ← سود ناخالص صفر نمایش داده می‌شود. **اصلاح:** در این حالت `txUnitPrice = 0` + پرچم `costPending` و هشدار؛ یا جلوگیری از خروج کالای بدون بهای تمام‌شده.

### P2-5 — تشخیص بسته‌بودن سال مالی با `LIKE` روی شماره مرجع + تلورانس‌های ناسازگار

```ts
// voucher.service.ts:29-38
eq(journalVouchers.voucherType, 'closing'),
or(like(journalVouchers.referenceNumber, `%CLOSING-${year}%`), like(journalVouchers.referenceNumber, `%CLOSE-%${year}%`))
```

وضعیت حیاتی «بسته بودن دوره» به یک قرارداد متنی وابسته است و قفلی بین «بستن سال» و «ثبت سند هم‌زمان» وجود ندارد. همچنین تراز سند در ایجاد با تلورانس `0.0001` (خط 277) و در قطعی‌سازی با `0.01` (خط 951، 1033) سنجیده می‌شود.

**اصلاح:**

```ts
export const fiscalPeriods = pgTable('fiscal_periods', {
  fiscalYear: integer('fiscal_year').primaryKey(),
  status: text('status').notNull().default('open'),   // open | closing | closed
  closedAt: timestamp('closed_at', { mode: 'string' }),
  closingVoucherId: integer('closing_voucher_id'),
});
// در هر ثبت سند: SELECT ... FROM fiscal_periods WHERE fiscal_year = $1 FOR SHARE
// در بستن سال:   SELECT ... FOR UPDATE  → ممانعت قطعی از Race
export const VOUCHER_BALANCE_TOLERANCE = 0.0001; // یک ثابت مشترک
```

### P2-6 — نوع `numeric(..., { mode: 'number' })` برای مبالغ

تمام ستون‌های مالی `numeric(18,4)` با `mode: 'number'` به `double` جاوااسکریپت تبدیل می‌شوند. `double` حدود ۱۵-۱۷ رقم معنادار دارد؛ مقدار `numeric(18,4)` تا ۱۸ رقم. برای مبالغ ریالی بالای ~۱۰^۱۱ با بخش اعشاری، دقت از دست می‌رود و جمع‌های گزارش (که در JS انجام می‌شوند) خطای شناور جمع می‌کنند — هرچند Decimal.js در محاسبات استفاده شده، ورودی آن از قبل `number` است. **توصیه:** برای ستون‌های پولی `mode: 'string'` و تبدیل مستقیم به `Decimal` (`fin(row.amount)`) و انجام تجمیع‌های گزارشی در SQL (`SUM`).

### P2-7 — اجرای ۲۳ باره میدل‌ور احراز هویت در هر درخواست

هر روتر mount شده روی `/api` خودش `router.use(authenticateToken)` دارد. چون Express روترها را ترتیبی پیمایش می‌کند، درخواستی مثل `GET /api/procurement/...` قبل از رسیدن به روتر مقصد از ~۲۰ روتر عبور کرده و **هر بار `jwt.verify` + جستجوی کش + `updateRequestContext`** اجرا می‌شود.

```ts
// اصلاح در app.ts: یک‌بار و متمرکز
app.use('/api/woocommerce/webhook', woocommerceWebhookRouter);  // عمومی
app.use('/api', authRoutes);                                       // login/setup/...
app.use('/api', authenticateToken);                                // یک‌بار برای همه
app.use('/api', usersRoutes); app.use('/api', systemRoutes); ...
// و حذف router.use(authenticateToken) از روترها
```

### P2-8 — کش‌های درون‌حافظه‌ای در استقرار چند Replica

با `replicas: 2` و HPA تا ۱۰ (`deploy/k8s/erp-deployment.yaml`):
- **کش احراز هویت ۳۰ ثانیه‌ای** (`auth.ts`): پس از Logout/تغییر نقش (افزایش `tokenVersion`)، توکن قدیمی تا ۳۰ ثانیه روی Podهای دیگر معتبر می‌ماند.
- کش نقش/مجوز ۶۰ ثانیه، کش تنظیمات ۶۰ ثانیه، کش داشبورد، و Rate Limiterها همه per-Pod هستند.
- Migrationها در هر Pod هم‌زمان اجرا می‌شوند و `runMigrations` قفل مشورتی ندارد (برخلاف seed).

**اصلاح:** Redis (یا `LISTEN/NOTIFY` در PostgreSQL) برای ابطال کش؛ اجرای Migration در یک `Job`/initContainer یا با `pg_advisory_lock`:

```ts
export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(70001)');
    await migrate(orm, { migrationsFolder });
  } finally {
    await client.query('SELECT pg_advisory_unlock(70001)').catch(() => {});
    client.release();
  }
}
```

### P2-9 — پیوست‌ها به‌صورت Base64 داخل JSONB

`FinancialAttachment.url` («Base64 compressed image data or link») در ستون‌های `attachments` اسناد، اسناد حسابداری و چک‌ها ذخیره می‌شود. هر `select()` بدون انتخاب ستون، این داده سنگین را می‌خواند؛ حجم جدول، بکاپ و WAL به‌شدت رشد می‌کند و سقف `5mb` بدنه JSON هم به همین دلیل بالا رفته است. **اصلاح:** ذخیره فایل در Object Storage/دیسک (مثل تصاویر کالا) و نگهداری فقط متادیتا در JSONB؛ در کوئری‌های لیستی، ستون `attachments` انتخاب نشود.

### P2-10 — مجوزدهی: اختلاط نقش و مجوز، و endpointهای بدون محدوده دسترسی

```ts
// src/middleware/authorize.ts:25
if (user.role === 'admin' || allowedRolesOrPermissions.includes(user.role)) return next();
```

نام نقش و نام مجوز در یک فضا مقایسه می‌شوند (نقشی با کد `woocommerce.manage` همه مجوزهای هم‌نام را می‌گیرد). منوی تنظیمات برای `hasPerm('settings.manage')` نمایش داده می‌شود (`menuConfig.ts:166`) ولی روت فقط `authorize('admin','manager')` است. همچنین `GET /api/global-search`، `/api/dashboard-bi-stats` و `/api/transactions` بدون هیچ `authorize` به همه کاربران احراز هویت‌شده (مثلاً اپراتور تولید) داده مشتریان، اسناد و گردش مالی را برمی‌گردانند. در `global-search` کاراکترهای `%` و `_` ورودی هم escape نمی‌شوند.

```ts
export const requireRole = (...roles: string[]) => ...;          // فقط نقش
export const requirePermission = (...perms: string[]) => ...;    // فقط مجوز
router.get('/global-search', requirePermission('search.global'), ...);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
```

### P2-11 — بلعیدن خطاهای پردازه و مسیرهای دیگر

- `server.ts:170-205`: در غیرپروداکشن، هر `uncaughtException` فقط لاگ می‌شود و پردازه در وضعیت نامعلوم ادامه می‌دهد؛ الگوی `'FATAL'` در پیام تصادفی هم باعث خاموشی می‌شود.
- در صورت شکست Migration در غیرپروداکشن، سرور بدون اسکیما به کار ادامه می‌دهد.
- `drizzle.ts:63`: دستور `SET statement_timeout` در رویداد `connect` به‌صورت fire-and-forget است؛ اولین کوئری ممکن است قبل از آن اجرا شود. **اصلاح:** استفاده از `options: '-c statement_timeout=60000 -c idle_in_transaction_session_timeout=60000'` در کانفیگ Pool.
- `jwt.verify` بدون `algorithms: ['HS256']` (دفاع در عمق).
- مقایسه CSRF با `!==` به‌جای `safeCompareTokens` موجود در پروژه.

### P2-12 — Test Runner بی‌صدا روی Mock DB اجرا می‌شود

در نبود `DATABASE_URL`، اجرای `--suite unit` به‌جای fail-fast، Migrationها را روی `mockPool` «۰ → ۰» اجرا کرد و گزارش داد:

```text
✅ Passed Tests    : 20 / 22 (90.9%)
🛡️  Real Code Ratio : 0 / 22 (0.0% real execution)
```

ادعای TD-063 («تست‌رانر fail-fast می‌کند») در این مسیر برقرار نیست. **اصلاح:** در `scripts/run-tests.ts` اگر `isMockDatabase()` و Suite نیازمند DB است، با کد خروج ۱ خاتمه یابد.

### P2-13 — آسیب‌پذیری `xlsx@0.18.5`

`npm audit`: Prototype Pollution (GHSA-4r6h-8v6p-xvw6) و ReDoS (GHSA-5pgg-2g8v-p4x9)، بدون اصلاحیه در npm. فایل‌های Excel ورودی کاربر در مرورگر پارس می‌شوند (۱۰+ کامپوننت). **اصلاح:** مهاجرت به `exceljs` یا نصب نسخه رسمی SheetJS از CDN خودشان (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`).

---

## ۷. کیفیت کد و نگهداشت‌پذیری — P3

| # | مشاهده | شواهد | پیشنهاد |
|---|---|---|---|
| 1 | فایل‌های غول‌آسا | `accounting.routes.ts` (1545)، `accountingReport.service.ts` (1573)، `piecework.routes.ts` (1402)، `voucherSync.service.ts` (1372)، `DocumentsPage.tsx` (1270) | تقسیم روت‌ها به Controller + Service؛ هر فایل < ۴۰۰ خط |
| 2 | نقض قاعده FE-003 (کامپوننت < ۳۰۰ خط) | ۱۰۴ فایل TSX بالای ۳۰۰ خط | استخراج hookها و زیرکامپوننت‌ها؛ گیت ESLint `max-lines` |
| 3 | `any` گسترده | ۹۷۸ مورد (۲۵۵ `as any`) | فعال‌سازی تدریجی `strict: true` + `@typescript-eslint/no-explicit-any` به‌صورت warn و کاهش ماهانه |
| 4 | نبود ESLint/Prettier | `npm run lint` فقط `tsc` است | افزودن ESLint (react-hooks، no-floating-promises، no-misused-promises) |
| 5 | N+1 و درج تک‌به‌تک | ۲۴۸ حلقه `for…of` در سرویس/روت؛ مثلاً درج ردیف‌های سند حسابداری تک‌به‌تک (`voucher.service.ts:309-324`) | `tx.insert(journalVoucherItems).values(rows)` به‌صورت دسته‌ای |
| 6 | فریم‌ورک تست دست‌ساز | `Phase21TestRunner` + ۱۳٬۲۶۲ خط Suite | مهاجرت به Vitest (موازی‌سازی، watch، coverage استاندارد، گزارش JUnit) |
| 7 | بدون تست فرانت‌اند | ۰ فایل تست | Vitest + Testing Library برای فرم‌های مالی، Playwright برای مسیرهای حیاتی |
| 8 | `fetchJson` بدون `AbortSignal` | ~۱۲۰ فراخوانی در components/pages؛ فقط ۲۰ فایل از React Query استفاده می‌کنند | مهاجرت باقی fetchها به `useQuery`/`useMutation` (قاعده FE-005/FE-008) |
| 9 | تشخیص endpoint عمومی با `includes` | `src/api.ts:122` — `cleanEndpoint.includes('/me')` با `/menu-visibility` نیز تطبیق دارد | مقایسه دقیق مسیر با `Set` |
| 10 | استخراج شماره از ref با حذف همه غیرارقام | `documentRefNumber.service.ts` — `"INV-1403-0005"` → `14030005` | `/(\d+)$/` برای پسوند عددی |
| 11 | `/api/*` ناموجود در پروداکشن `index.html` با 200 برمی‌گرداند | `server.ts:107-116` | `app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))` قبل از catch-all SPA |
| 12 | تناقض مستندات حاکمیتی | AGENTS.md §7 و §13: «چنج‌لاگ در `5.ts`»؛ §23: «`7.ts`» | یکسان‌سازی و حذف بخش‌های منسوخ |
| 13 | ادعاهای چنج‌لاگ بدون پشتوانه | 7.0.8: «انتقال بدون هدررفت» (رد شد: P1-9)؛ «CI hard gate» (CI اجرا نمی‌شود: P0-4) | گیت «Definition of Done»: هر ادعا = یک تست خودکار |
| 14 | `isDeleted`/`isActive` به‌صورت `integer` | تمام اسکیما | `boolean` در مهاجرت‌های آینده (خوانایی و جلوگیری از مقادیر ۲، ۳، …) |
| 15 | تاریخ‌ها به‌صورت `text` در جداول حسابداری و پرسنلی | `journal_vouchers.date`، `cheques.due_date`، … | `date` بومی PostgreSQL + قید CHECK فرمت |

---

## ۸. ارزیابی به تفکیک محور

### ۸.۱ معماری (6.5/10)
- ✅ لایه‌بندی Route → Service → Drizzle، Facade حسابداری، Event Bus، Outbox.
- ⚠️ «منبع حقیقت واحد» برای موجودی وجود ندارد (P2-1)؛ منطق موجودی بین `DocumentStockEngine`، `ItemWarehouseStockService`، `KardexWacRecalculator` و `inventoryStockRepair` پخش است.
- ⚠️ کارهای سنگین داده‌ای در مسیر بوت (P1-8) و ترکیب API و Worker در یک پردازه.
- 💡 پیشنهاد: جداسازی **Worker** (Outbox، همگام‌سازی‌ها، SLA) از **API** به‌صورت دو Deployment با یک ایمیج و دو `CMD`.

### ۸.۲ صحت منطق و یکپارچگی داده (4.5/10)
- ✅ قفل‌های سطری، شمارنده‌های اتمیک، Decimal.js، معکوس‌سازی سند به‌جای حذف.
- ❌ P0-2، P0-3، P1-2، P1-7، P1-8، P1-9، P2-4، P2-5.
- 💡 «Invariant Test»های شبانه: `SUM(item_warehouse_stocks) == items.current_stock == SUM(kardex)` و `SUM(debit) == SUM(credit)` به ازای هر سند و کل دفتر.

### ۸.۳ امنیت (6.5/10)
- ✅ HttpOnly + CSRF، `tokenVersion`، HMAC، SSRF Guard، ماسک تنظیمات حساس، Helmet/CSP، بررسی زنده وضعیت کاربر.
- ❌ P0-5، P1-3، P1-4، P1-5، P1-6، P2-10، P2-13.
- 💡 افزودن تست امنیتی برای «هیچ پاسخی شامل فیلد `token`/`password` نباشد» در Penetration Suite.

### ۸.۴ پایداری (5.0/10)
- ✅ Health Probeها، Graceful Shutdown، Retry در بوت، Idempotency.
- ❌ P1-1 (Outbox)، P1-2(ج) (catch بدون Savepoint)، P1-8، P2-11.

### ۸.۵ کارایی (5.5/10)
- ✅ ایندکس‌های ترکیبی مناسب روی `transactions`، ایندکس trigram برای جستجو، کش کاربر.
- ❌ P2-7، P2-9، N+1 در حلقه‌ها، `SELECT *` روی جداول دارای JSONB سنگین، تجمیع‌های گزارشی در JS.
- 💡 فعال‌سازی `pg_stat_statements` و بررسی ۲۰ کوئری پرهزینه؛ Pagination اجباری در همه لیست‌ها.

### ۸.۶ تست (4.5/10)
- ✅ ۳۴۵ سناریو شامل همزمانی، امنیت و رگرسیون — حجم قابل‌توجه.
- ❌ CI اجرا نمی‌شود (P0-4)؛ تست‌ها باگ‌های P0-2/P0-3/P1-1 را پیدا نکرده‌اند؛ fallback به Mock (P2-12)؛ بدون تست فرانت.

### ۸.۷ DevOps (3.0/10)
- ❌ P0-1، P0-4، نبود lockfile، ناهمخوانی نسخه Node، Migration هم‌زمان در Podها، گیت امنیتی بی‌اثر.

### ۸.۸ مستندات (7.0/10)
- ✅ بسیار مفصل و دوزبانه؛ رجیستری بدهی فنی؛ Runbookهای استقرار.
- ⚠️ تناقض داخلی و ادعاهای «۱۰۰٪» که با کد منطبق نیستند؛ این موضوع اعتماد به مستندات را کاهش می‌دهد.

---

## ۹. نقشه راه پیشنهادی اصلاح

### فاز ۰ — اضطراری (۱ تا ۳ روز)
1. P0-1: اصلاح Dockerfile + Smoke Test بوت.
2. P0-4: commit کردن `package-lock.json`، یکسان‌سازی Node 22، حذف `|| true`.
3. P0-2: Migration ایندکس یکتای سال‌محور (پیش از پایان سال مالی جاری حیاتی است).
4. P0-3: تصمیم کسب‌وکاری درباره موجودی منفی و هم‌راستاسازی قید/سرویس/UI.
5. P0-5: اصلاح `trust proxy` و کلید Rate Limiter ورود.

### فاز ۱ — پایداری و امنیت (۱ تا ۲ هفته)
6. P1-1: Outbox با تحویل تضمینی و Backoff واقعی.
7. P1-2: بازنویسی پردازش ووکامرس (تطبیق دقیق، لاگ شکست، Savepoint، وضعیت‌ها، ابطال).
8. P1-3، P1-4، P1-5، P1-6: تنظیمات، توکن، قفل حساب، بکاپ.
9. P1-7، P1-8، P1-9: فیلد ساختاریافته VAT، ایندکس یکتای سند حسابداری و خارج‌کردن همگام‌سازی از بوت، گزارش و ترمیم مغایرت موجودی.

### فاز ۲ — استحکام معماری (۳ تا ۶ هفته)
10. P2-1: یک منبع حقیقت برای موجودی + Invariant Testهای شبانه.
11. P2-5، P2-6: جدول `fiscal_periods`، مبالغ `mode: 'string'`.
12. P2-7، P2-8: احراز هویت متمرکز، Redis برای کش/Rate Limit، Migration Job.
13. P2-9: انتقال پیوست‌ها به Object Storage.

### فاز ۳ — کیفیت مستمر (پیوسته)
14. ESLint + `max-lines` + کاهش `any`؛ مهاجرت تدریجی به Vitest؛ تست‌های فرانت؛ تقسیم فایل‌های بزرگ.
15. قاعده حاکمیتی: «هر ادعای چنج‌لاگ ↔ حداقل یک تست خودکار در CI».

---

## پیوست الف — اسکریپت اثبات باگ‌ها و خروجی اجرا

**محیط:** PostgreSQL 16 موقت، اعمال کامل ۱۵ Migration پروژه (`0 → 15 applied`)، `NODE_ENV=test`. اسکریپت فقط از سرویس‌های خود پروژه استفاده می‌کند.

```ts
// verify-bugs.ts — اجرا: DATABASE_URL=... npx tsx verify-bugs.ts
import { orm, pool } from './src/db/drizzle.js';
import { documents, items, warehouses, appSettings, outboxEvents } from './src/db/schema.js';
import { DocumentService } from './src/services/document.service.js';
import { OutboxService } from './src/services/events/outboxService.js';
import { domainEventBus } from './src/services/events/domainEventBus.js';
import { eq, and, like } from 'drizzle-orm';

await orm.insert(warehouses).values({ name: 'انبار مرکزی', code: 'main', isActive: 1 }).onConflictDoNothing();

// BUG1 — برخورد شماره عطف بین سال‌های مالی
await orm.insert(documents).values({ type: 'invoice', refNumber: '1', date: '2025-08-01 10:00:00', user: 't', status: 'final' }); // 1404
const ref = await DocumentService.getNextRef('invoice', '2026-08-01');                                                             // 1405
await orm.insert(documents).values({ type: 'invoice', refNumber: ref, date: '2026-08-01 10:00:00', user: 't', status: 'final' });

// BUG2 — سیاست allowed در برابر CHECK دیتابیس
await orm.insert(appSettings).values({ key: 'negative_stock_policy', value: 'allowed' }).onConflictDoUpdate({ target: appSettings.key, set: { value: 'allowed' } });
const [it] = await orm.insert(items).values({ type: 'raw_material', name: 'x', code: 'X-1', unit: 'عدد' }).returning();
await orm.transaction(tx => DocumentService.applyStockMovement(tx, { itemId: it.id, inOut: 'out', quantity: 5, price: 10,
  date: '2026-08-01', documentType: 'test', documentRef: 't', user: 't', targetLoc: 'main' }));

// BUG4 — Outbox با هندلر خطادار
domainEventBus.subscribe('AuditProbeEvent', async () => { throw new Error('handler boom'); });
const ev = domainEventBus.createEvent('AuditProbeEvent', 'Item', '1', { a: 1 }, {});
await OutboxService.saveToOutbox(orm, ev);
await OutboxService.processPendingBatch(10);

// BUG5 — LIKE در تشخیص سفارش تکراری ووکامرس
await orm.insert(documents).values({ type: 'invoice', refNumber: '900', date: '2026-08-01 10:00:00', user: 't', status: 'final', notes: 'سفارش ووکامرس #123' });
await orm.select().from(documents).where(and(eq(documents.type, 'invoice'), like(documents.notes, '%سفارش ووکامرس #12%')));
```

**خروجی:**

```text
### BUG1 next ref for new fiscal year: 1
### BUG1 insert FAILED:  23505 Failed query: insert into "documents" ...            ← unique violation
### BUG2 out-movement under allowed policy FAILED:  23514 Failed query: insert into "item_warehouse_stocks" ...  ← check violation
[DomainEventBus Handler Error] Error in handler for AuditProbeEvent: handler boom
[Transactional Outbox] Successfully dispatched outbox event #1 (AuditProbeEvent)
### BUG4 outbox status after failing handler: completed retryCount=0
### BUG5 docs matched for order #12: [ { id: 3, notes: 'سفارش ووکامرس #123' } ]
```

**Race نهفته P2-2** (۳۰ دور، ۴ تراکنش هم‌زمان در هر دور، فراخوانی مستقیم `ItemWarehouseStockService.applyMovement`):

```text
### RACE trials with failures: 29 /30, failed tx: 87 /120 [ '23505 Key (item_id, warehouse_id)=(34, 1) already exists.' ]
```

**P0-1 — بوت باندل سرور بدون `node_modules`** (شبیه‌سازی Stage Runtime داکر):

```text
$ npx esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile=server.cjs
$ node server.cjs
Error: Cannot find module 'express'
```

---

*پایان گزارش.* هیچ فایلی از کد برنامه در این ارزیابی تغییر داده نشده است؛ همه آزمایش‌ها روی یک کپی ایزوله و یک پایگاه‌داده موقت انجام و سپس پاک‌سازی شد.
