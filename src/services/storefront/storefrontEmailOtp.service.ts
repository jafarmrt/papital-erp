import crypto from 'crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { storefrontEmailCodes } from '../../db/schema.js';
import { AppError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { derivedSecretKey } from '../../lib/secretBox.js';
import { normalizeOtpCode } from '../../lib/storefront/storefrontSmsRules.js';
import {
  EMAIL_CODES_HOURLY_CAP, EMAIL_CODES_PER_ADDRESS_HOUR_MAX, EMAIL_CODES_PER_EMAIL_DAY_MAX, EMAIL_CODES_PER_EMAIL_HOUR_MAX, EMAIL_CODE_LENGTH,
  EMAIL_CODE_RESEND_SECONDS, EMAIL_CODE_TTL_SECONDS, EMAIL_CODE_VERIFY_ATTEMPTS_MAX, EMAIL_PROOF_MAX, EMAIL_PROOF_PREFIX, EMAIL_PROOF_TTL_SECONDS,
  EMAIL_WRONG_PER_EMAIL_DAY_MAX, emailMatchKey, normalizeEmail,
} from '../../lib/storefront/storefrontEmailRules.js';
import type { EmailCodeRequestResult, EmailCodeVerifyResult } from '../../lib/storefront/storefrontEmailContracts.js';
import { sendEmail } from './storefrontEmailClient.js';
import { emailRuntimeSettings, usableServer } from './storefrontEmailSettings.service.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';

/**
 * v12 phase 8e (start plan §5, owner's decision 7): the one-time code a buyer asks for by email, and the email proof a
 * right code gives, on the same rules as the SMS codes (`storefrontSmsOtp.service.ts`):
 *
 * - A code is `EMAIL_CODE_LENGTH` random digits, valid `EMAIL_CODE_TTL_SECONDS`; only the newest code of an address
 *   counts and it takes `EMAIL_CODE_VERIFY_ATTEMPTS_MAX` tries; an address gets `EMAIL_WRONG_PER_EMAIL_DAY_MAX` wrong tries
 *   a day over all its codes. The database keeps HMACs (keys derived from `ERP_SECRETS_KEY`) of the code and of the
 *   buyer's network address, never either.
 * - Limits, all decided under one advisory lock: one code per address per `EMAIL_CODE_RESEND_SECONDS`, per address per
 *   hour and per day, per buyer network address per hour, and the site's `EMAIL_CODES_HOURLY_CAP`. A code whose mail the
 *   server did not take is closed at once and holds no resend wait, but still counts toward the caps.
 * - A right code answers a random single-use email proof (only its SHA-256 is kept) for that address alone.
 * - A wrong address, an expired or used code and a wrong code all get the same answer.
 * - While the site's email is off (or its settings not whole), the routes do not exist (404).
 * - The mail carries the code and fixed words only: no amount, no name (AGENTS.md §3.11).
 */
const CODE_PURPOSE = 'storefront-email-code';
const ADDRESS_PURPOSE = 'storefront-email-address';
const LOCK = 'storefront-email-otp';

function hashKey(purpose: string): Buffer {
  const key = derivedSecretKey(purpose);
  if (!key) throw new AppError('کلید رمزنگاری سرور تنظیم نشده است؛ کد ایمیلی تا آن زمان کار نمی‌کند.', 503, 'STOREFRONT_SECRETS_KEY_MISSING');
  return key;
}

const hmac = (purpose: string, text: string) => crypto.createHmac('sha256', hashKey(purpose)).update(text, 'utf8').digest('hex');
const sha256 = (text: string) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

class TooManyCodesError extends AppError {
  constructor(message: string, retryAfter: number) {
    super(message, 429, 'STOREFRONT_EMAIL_CODE_TOO_MANY', { retryAfter });
  }
}

const wrongCode = () => new ValidationError('کد درست نیست یا مهلتش گذشته است؛ کد را دوباره بخواهید.', { field: 'code' }, 'STOREFRONT_EMAIL_CODE_INVALID');

/** The mail server while the site and its email are on, else the routes are 404 */
async function liveServer() {
  if (!(await storefrontSettingValues(orm)).enabled) throw new NotFoundError('پیدا نشد');
  const settings = await emailRuntimeSettings(orm);
  const server = settings.enabled ? usableServer(settings) : null;
  if (!server) throw new NotFoundError('پیدا نشد');
  return server;
}

/** Whether the site signs buyers in and proves addresses by email now */
export async function emailCodesOn(executor: DbExecutor): Promise<boolean> {
  const settings = await emailRuntimeSettings(executor);
  return settings.enabled && usableServer(settings) !== null;
}

function addressOf(raw: string): { email: string; emailKey: string } {
  const email = normalizeEmail(raw);
  if (!email) throw new ValidationError('نشانی ایمیل را درست بنویسید (مانند name@example.com).', { field: 'email' }, 'STOREFRONT_EMAIL_INVALID');
  return { email, emailKey: emailMatchKey(email) };
}

const newCode = () => String(crypto.randomInt(0, 10 ** EMAIL_CODE_LENGTH)).padStart(EMAIL_CODE_LENGTH, '0');

async function countSince(tx: DbExecutor, where: ReturnType<typeof eq> | undefined, seconds: number): Promise<number> {
  const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(storefrontEmailCodes)
    .where(and(where, sql`${storefrontEmailCodes.createdAt} > now() - make_interval(secs => ${seconds})`));
  return count;
}

const SUBJECT = 'کد تأیید فروشگاه';
const mailText = (code: string) => [
  `کد تأیید شما: ${code}`,
  '',
  `این کد تا ${Math.round(EMAIL_CODE_TTL_SECONDS / 60).toLocaleString('fa-IR')} دقیقه کار می‌کند. آن را به هیچ‌کس ندهید؛ فروشگاه هرگز کد را از شما نمی‌خواهد.`,
  'اگر شما این کد را نخواسته‌اید، این ایمیل را نادیده بگیرید.',
].join('\n');

/** `POST /auth/email-code/request` */
export async function requestEmailCode(rawEmail: string, address: string): Promise<EmailCodeRequestResult> {
  const server = await liveServer();
  const { email, emailKey } = addressOf(rawEmail);
  const addressKey = hmac(ADDRESS_PURPOSE, address || 'unknown');
  const code = newCode();
  const codeHash = hmac(CODE_PURPOSE, `${emailKey}:${code}`);
  const codeId = await orm.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${LOCK}))`);
    // the resend wait counts only codes whose mail went out
    const [last] = await tx.select({ age: sql<number>`extract(epoch from now() - ${storefrontEmailCodes.createdAt})::int` }).from(storefrontEmailCodes)
      .where(and(eq(storefrontEmailCodes.emailKey, emailKey), eq(storefrontEmailCodes.sent, 1)))
      .orderBy(desc(storefrontEmailCodes.createdAt)).limit(1);
    if (last && last.age < EMAIL_CODE_RESEND_SECONDS) {
      throw new TooManyCodesError('کد پیش‌تر فرستاده شد؛ کمی صبر کنید و دوباره بخواهید.', EMAIL_CODE_RESEND_SECONDS - last.age);
    }
    if (await countSince(tx, eq(storefrontEmailCodes.emailKey, emailKey), 3600) >= EMAIL_CODES_PER_EMAIL_HOUR_MAX
      || await countSince(tx, eq(storefrontEmailCodes.emailKey, emailKey), 86_400) >= EMAIL_CODES_PER_EMAIL_DAY_MAX) {
      throw new TooManyCodesError('برای این ایمیل کد زیادی خواسته شده است؛ ساعتی دیگر دوباره بخواهید.', 3600);
    }
    if (await countSince(tx, eq(storefrontEmailCodes.addressKey, addressKey), 3600) >= EMAIL_CODES_PER_ADDRESS_HOUR_MAX) {
      throw new TooManyCodesError('از این دستگاه کد زیادی خواسته شده است؛ ساعتی دیگر دوباره بخواهید.', 3600);
    }
    if (await countSince(tx, undefined, 3600) >= EMAIL_CODES_HOURLY_CAP) {
      throw new TooManyCodesError('کد ایمیلی اکنون شلوغ است؛ چند دقیقه دیگر دوباره بخواهید.', 300);
    }
    const [row] = await tx.insert(storefrontEmailCodes).values({
      emailKey, codeHash, addressKey, expiresAt: sql`now() + make_interval(secs => ${EMAIL_CODE_TTL_SECONDS})`,
    }).returning({ id: storefrontEmailCodes.id });
    return row.id;
  });
  // sent after the commit: the code row exists before the buyer can type it
  const result = await sendEmail(server, { to: email, subject: SUBJECT, text: mailText(code) });
  if (!result.ok) {
    // a code the buyer never got is closed, so it cannot be guessed
    await orm.update(storefrontEmailCodes).set({ expiresAt: sql`now()` }).where(eq(storefrontEmailCodes.id, codeId));
    throw new AppError('فرستادن ایمیل اکنون ممکن نشد؛ چند دقیقه دیگر دوباره بخواهید.', 503, 'STOREFRONT_EMAIL_CODE_NOT_SENT');
  }
  await orm.update(storefrontEmailCodes).set({ sent: 1 }).where(eq(storefrontEmailCodes.id, codeId));
  return { resendAfter: EMAIL_CODE_RESEND_SECONDS, expiresIn: EMAIL_CODE_TTL_SECONDS };
}

/** `POST /auth/email-code/verify` */
export async function verifyEmailCode(rawEmail: string, rawCode: string): Promise<EmailCodeVerifyResult> {
  await liveServer();
  const email = normalizeEmail(rawEmail);
  const code = normalizeOtpCode(rawCode);
  if (!email || !code) throw wrongCode();
  const emailKey = emailMatchKey(email);
  const presented = Buffer.from(hmac(CODE_PURPOSE, `${emailKey}:${code}`), 'hex');
  const proof = `${EMAIL_PROOF_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  // a wrong try is counted in a committed transaction; the error is thrown after it
  const verified = await orm.transaction(async (tx) => {
    const [row] = await tx.select().from(storefrontEmailCodes).where(eq(storefrontEmailCodes.emailKey, emailKey))
      .orderBy(desc(storefrontEmailCodes.createdAt), desc(storefrontEmailCodes.id)).limit(1).for('update');
    if (!row || row.verifiedAt || row.attempts >= EMAIL_CODE_VERIFY_ATTEMPTS_MAX) return false;
    const [{ wrong }] = await tx.select({
      wrong: sql<number>`coalesce(sum(${storefrontEmailCodes.attempts} - (CASE WHEN ${storefrontEmailCodes.verifiedAt} IS NULL THEN 0 ELSE 1 END)), 0)::int`,
    }).from(storefrontEmailCodes)
      .where(and(eq(storefrontEmailCodes.emailKey, emailKey), sql`${storefrontEmailCodes.createdAt} > now() - interval '1 day'`));
    if (wrong >= EMAIL_WRONG_PER_EMAIL_DAY_MAX) return false;
    const [{ live }] = (await tx.execute(sql`SELECT (${row.expiresAt}::timestamptz > now()) AS live`)).rows as Array<{ live: boolean }>;
    if (!live) return false;
    const stored = Buffer.from(row.codeHash, 'hex');
    const right = stored.length === presented.length && crypto.timingSafeEqual(stored, presented);
    if (!right) {
      await tx.update(storefrontEmailCodes).set({ attempts: sql`${storefrontEmailCodes.attempts} + 1` }).where(eq(storefrontEmailCodes.id, row.id));
      return false;
    }
    await tx.update(storefrontEmailCodes).set({
      attempts: sql`${storefrontEmailCodes.attempts} + 1`, verifiedAt: sql`now()`, proofHash: sha256(proof),
      proofExpiresAt: sql`now() + make_interval(secs => ${EMAIL_PROOF_TTL_SECONDS})`,
    }).where(eq(storefrontEmailCodes.id, row.id));
    return true;
  });
  if (!verified) throw wrongCode();
  return { emailProof: proof, expiresIn: EMAIL_PROOF_TTL_SECONDS };
}

/**
 * Inside the caller's transaction: whether `proof` is a live, unused proof for this email, and if so it is used up. A
 * wrong, used, expired or another address's proof is false.
 */
export async function consumeEmailProof(tx: DbExecutor, rawEmail: string, proof: string): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  if (!email || !proof || proof.length > EMAIL_PROOF_MAX || !proof.startsWith(EMAIL_PROOF_PREFIX)) return false;
  const [row] = await tx.select({ id: storefrontEmailCodes.id }).from(storefrontEmailCodes)
    .where(and(
      eq(storefrontEmailCodes.proofHash, sha256(proof)), eq(storefrontEmailCodes.emailKey, emailMatchKey(email)),
      isNull(storefrontEmailCodes.proofUsedAt), gt(storefrontEmailCodes.proofExpiresAt, sql`now()`),
    )).for('update');
  if (!row) return false;
  const used = await tx.update(storefrontEmailCodes).set({ proofUsedAt: sql`now()` })
    .where(and(eq(storefrontEmailCodes.id, row.id), isNull(storefrontEmailCodes.proofUsedAt))).returning({ id: storefrontEmailCodes.id });
  return used.length === 1;
}
