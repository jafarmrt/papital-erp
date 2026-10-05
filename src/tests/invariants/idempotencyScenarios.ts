import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { ValidationError } from '../../errors/customErrors.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { idempotency } from '../../middleware/idempotency.js';
import { errorHandler } from '../../middleware/logger.js';

/**
 * v8.0.59 — سناریوی سخت‌گیرانه «کلید تکرار درخواست» (idempotency) حوزه J برای سوئیت business_invariants: میان‌افزار
 * واقعی روی پایگاه داده واقعی، جلوی یک «دریافت/پرداخت» و «انتقال» آزمایشی که شمار اجرای هر کلید را نگه می‌دارند.
 */

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

interface TestApp {
  app: express.Express;
  runs: (path: string, key: string) => number;
  fund: (funded: boolean) => void;
}

function buildApp(scope: string): TestApp {
  const counts = new Map<string, number>();
  let funded = false;
  const app = express();
  app.use(express.json());
  const guard = idempotency({ scope, lockTimeoutSeconds: 1 });
  const handler = (path: string) => asyncHandler(async (req: Request, res: Response) => {
    const key = `${path}|${String(req.headers['idempotency-key'] ?? '')}`;
    const run = (counts.get(key) ?? 0) + 1;
    counts.set(key, run);
    const body = req.body as { amount?: number; slowMs?: number };
    if (body.slowMs) await sleep(body.slowMs);
    if (path === '/pay' && !funded) throw new ValidationError('موجودی بانک برای این پرداخت کافی نیست');
    res.status(201).json({ success: true, path, run, amount: body.amount });
  });
  app.post('/pay', guard, handler('/pay'));
  app.post('/transfer', guard, handler('/transfer'));
  app.use(errorHandler);
  return { app, runs: (path, key) => counts.get(`${path}|${key}`) ?? 0, fund: (value) => { funded = value; } };
}

/**
 * TD-329: کلید تکرار درخواست فقط پاسخ موفق را نگه می‌دارد، با بدنه یا مسیر دیگر پاسخ کهنه نمی‌دهد و قفلش تا پایان
 * اجرای درخواست طولانی تمدید می‌شود. پیش‌تر پاسخ ۴۲۲ «تکمیل‌شده» ذخیره می‌شد و تکرار پس از واریز همان خطا را می‌گرفت،
 * بدنه یا مسیر دیگر با همان کلید پاسخ اول را می‌گرفت و اجرا نمی‌شد، و درخواستی طولانی‌تر از پنجره قفل دو بار اجرا می‌شد.
 */
export async function checkIdempotencyKeyContract(): Promise<string[]> {
  const problems: string[] = [];
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { app, runs, fund } = buildApp(`inv_td_329_${stamp}`);
  const post = (path: string, key: string, body: object) => request(app).post(path).set('Idempotency-Key', key).send(body);

  // ۱) پاسخ خطا ذخیره نمی‌شود: پرداخت از بانک خالی ۴۲۲، پس از واریز همان درخواست اجرا می‌شود
  const failedKey = `fail-${stamp}`;
  fund(false);
  const refused = await post('/pay', failedKey, { amount: 500 });
  if (refused.status !== 422) problems.push(`پرداخت از بانک خالی ${refused.status} گرفت، نه ۴۲۲`);
  fund(true);
  const retried = await post('/pay', failedKey, { amount: 500 });
  if (retried.status !== 201) problems.push(`تکرار پرداخت پس از واریز ${retried.status} گرفت (${String(retried.body?.error ?? retried.body?.code ?? '')})، نه ۲۰۱`);
  if (runs('/pay', failedKey) !== 2) problems.push(`پرداخت ردشده و تکرارش ${runs('/pay', failedKey)} بار اجرا شد، نه دو بار`);

  // ۲) همان کلید با بدنه یا مسیر دیگر پاسخ کهنه نمی‌گیرد و اجرا هم نمی‌شود؛ همان درخواست پاسخ ذخیره‌شده را می‌گیرد
  const reusedKey = `reuse-${stamp}`;
  const first = await post('/pay', reusedKey, { amount: 1000 });
  if (first.status !== 201) problems.push(`دریافت اول ${first.status} گرفت`);
  const otherBody = await post('/pay', reusedKey, { amount: 2000 });
  if (otherBody.status !== 422 || otherBody.body?.code !== 'IDEMPOTENCY_KEY_REUSED') {
    problems.push(`همان کلید با مبلغ ۲۰۰۰ به‌جای ۱۰۰۰ پاسخ ${otherBody.status} (${JSON.stringify(otherBody.body).slice(0, 120)}) گرفت، نه ۴۲۲ IDEMPOTENCY_KEY_REUSED`);
  }
  const otherPath = await post('/transfer', reusedKey, { amount: 1000 });
  if (otherPath.status !== 422 || otherPath.body?.code !== 'IDEMPOTENCY_KEY_REUSED') {
    problems.push(`همان کلید روی مسیر انتقال پاسخ ${otherPath.status} (${JSON.stringify(otherPath.body).slice(0, 120)}) گرفت، نه ۴۲۲ IDEMPOTENCY_KEY_REUSED`);
  }
  if (runs('/pay', reusedKey) !== 1) problems.push(`دریافت با کلید تکراری ${runs('/pay', reusedKey)} بار اجرا شد، نه یک بار`);
  const same = await post('/pay', reusedKey, { amount: 1000 });
  if (same.status !== 201 || same.headers['x-idempotency-hit'] !== 'true' || same.body?.run !== 1) {
    problems.push(`تکرار همان دریافت پاسخ ذخیره‌شده را نگرفت (${same.status}، اجرای ${String(same.body?.run)})`);
  }

  // ۳) درخواست طولانی‌تر از پنجره قفل (۱ ثانیه): تکرار هم‌زمان در جریان شمرده می‌شود و دوباره اجرا نمی‌شود
  const slowKey = `slow-${stamp}`;
  const slow = post('/pay', slowKey, { amount: 300, slowMs: 2500 }).then(res => res);
  await sleep(1500);
  const duplicate = await post('/pay', slowKey, { amount: 300, slowMs: 2500 });
  const slowRes = await slow;
  if (slowRes.status !== 201) problems.push(`درخواست طولانی ${slowRes.status} گرفت`);
  if (duplicate.status !== 409 || duplicate.body?.code !== 'IDEMPOTENCY_IN_FLIGHT') {
    problems.push(`تکرار درخواست طولانی در میانه اجرا پاسخ ${duplicate.status} (${String(duplicate.body?.code ?? '')}) گرفت، نه ۴۰۹ در جریان`);
  }
  if (runs('/pay', slowKey) !== 1) problems.push(`درخواست طولانی‌تر از پنجره قفل ${runs('/pay', slowKey)} بار اجرا شد، نه یک بار`);

  // ۴) پاسخ پیش از رسیدن به مرورگر ذخیره شده است: تکرار بلافاصله پس از پاسخ، پاسخ ذخیره‌شده را می‌گیرد نه ۴۰۹
  const quickKey = `quick-${stamp}`;
  await post('/pay', quickKey, { amount: 700 });
  const quick = await post('/pay', quickKey, { amount: 700 });
  if (quick.status !== 201 || quick.headers['x-idempotency-hit'] !== 'true') {
    problems.push(`تکرار بلافاصله پس از پاسخ ${quick.status} گرفت، نه پاسخ ذخیره‌شده`);
  }
  return problems;
}
