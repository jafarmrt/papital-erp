import crypto from 'crypto';
import { and, desc, eq, gt, isNull, notInArray, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { storefrontSmsCodes, storefrontSmsMessages } from '../../db/schema.js';
import { AppError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { derivedSecretKey } from '../../lib/secretBox.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { normalizeMobile } from '../../lib/storefront/storefrontOrderRules.js';
import {
  OTP_CODE_LENGTH, OTP_PER_ADDRESS_HOUR_MAX, OTP_PER_PHONE_DAY_MAX, OTP_PER_PHONE_HOUR_MAX, OTP_RESEND_SECONDS, OTP_TTL_SECONDS,
  OTP_VERIFY_ATTEMPTS_MAX, OTP_WRONG_PER_PHONE_DAY_MAX, PHONE_PROOF_MAX, PHONE_PROOF_PREFIX, PHONE_PROOF_TTL_SECONDS, normalizeOtpCode,
} from '../../lib/storefront/storefrontSmsRules.js';
import type { OtpRequestResult, OtpVerifyResult } from '../../lib/storefront/storefrontSmsContracts.js';
import { deliverMessage, smsBudgetSpent } from './storefrontSms.service.js';
import { activeTemplate, smsRuntimeSettings } from './storefrontSmsSettings.service.js';

/**
 * v11 phase 8.4a (start plan §4): the login code a buyer asks for on the site, and the phone proof a right code gives.
 *
 * - A code is `OTP_CODE_LENGTH` random digits, valid `OTP_TTL_SECONDS`; only the newest code of a phone counts, and it
 *   takes `OTP_VERIFY_ATTEMPTS_MAX` tries. The database keeps an HMAC of the code under a key derived from
 *   `ERP_SECRETS_KEY` (so a database copy cannot try the million codes offline), and an HMAC of the buyer's address
 *   (an IPv6 address by its /56 subnet), never the address. A phone gets `OTP_WRONG_PER_PHONE_DAY_MAX` wrong tries a day
 *   over all its codes, so asking for fresh codes gives no fresh guesses.
 * - Limits against guessing and against draining the SMS credit («SMS pumping»), all decided under one advisory lock so
 *   concurrent requests cannot pass them together: one code per phone per `OTP_RESEND_SECONDS`, per phone per hour and
 *   per day, per buyer address per hour, and the site's budget of texts (`smsBudgetSpent`, shared with the order texts).
 *   Only Iranian mobiles (09…) are taken. The route adds a per-address request limit in front. A code whose text could
 *   not be sent is closed at once and does not hold the resend wait, but still counts toward the caps.
 * - A right code answers a random single-use phone proof (only its SHA-256 is kept) that the sign-up or sign-in that
 *   follows presents within `PHONE_PROOF_TTL_SECONDS` (`consumePhoneProof`, for stage 8.2b's accounts); the proof alone
 *   opens no session and no order.
 * - A wrong phone, an expired or used code and a wrong code all get the same answer, so the answer says nothing about
 *   which phones asked.
 */
const CODE_PURPOSE = 'storefront-sms-code';
const ADDRESS_PURPOSE = 'storefront-sms-address';
const OTP_LOCK = 'storefront-sms-otp';

function hashKey(purpose: string): Buffer {
  const key = derivedSecretKey(purpose);
  if (!key) throw new AppError('کلید رمزنگاری سرور تنظیم نشده است؛ ورود پیامکی تا آن زمان کار نمی‌کند.', 503, 'STOREFRONT_SECRETS_KEY_MISSING');
  return key;
}

const hmac = (purpose: string, text: string) => crypto.createHmac('sha256', hashKey(purpose)).update(text, 'utf8').digest('hex');
const sha256 = (text: string) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

class TooManyCodesError extends AppError {
  constructor(message: string, retryAfter: number) {
    super(message, 429, 'STOREFRONT_OTP_TOO_MANY', { retryAfter });
  }
}

const wrongCode = () => new ValidationError('کد درست نیست یا مهلتش گذشته است؛ کد را دوباره بخواهید.', { field: 'code' }, 'STOREFRONT_OTP_INVALID');

async function otpTemplateOn() {
  const settings = await smsRuntimeSettings(orm);
  // off (or no login template): the routes do not exist for the site
  if (!activeTemplate(settings, 'otp')) throw new NotFoundError('پیدا نشد');
  return settings;
}

function mobileOf(raw: string): { phone: string; phoneKey: string } {
  const phone = normalizeMobile(raw);
  if (!phone) throw new ValidationError('شمارهٔ همراه را درست بنویسید (مانند ۰۹۱۲۱۲۳۴۵۶۷).', { field: 'phone' }, 'STOREFRONT_OTP_PHONE_INVALID');
  return { phone, phoneKey: phoneMatchKey(phone) };
}

const newCode = () => String(crypto.randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, '0');

async function countSince(tx: DbExecutor, where: ReturnType<typeof eq>, seconds: number): Promise<number> {
  const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(storefrontSmsCodes)
    .where(and(where, sql`${storefrontSmsCodes.createdAt} > now() - make_interval(secs => ${seconds})`));
  return count;
}

export async function requestOtp(rawPhone: string, address: string): Promise<OtpRequestResult> {
  const settings = await otpTemplateOn();
  const { phone, phoneKey } = mobileOf(rawPhone);
  const addressKey = hmac(ADDRESS_PURPOSE, address || 'unknown');
  const code = newCode();
  const codeHash = hmac(CODE_PURPOSE, `${phoneKey}:${code}`);
  const message = await orm.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${OTP_LOCK}))`);
    // the resend wait counts only codes whose text went out (or is going out)
    const [last] = await tx.select({ age: sql<number>`extract(epoch from now() - ${storefrontSmsCodes.createdAt})::int` }).from(storefrontSmsCodes)
      .innerJoin(storefrontSmsMessages, eq(storefrontSmsMessages.id, storefrontSmsCodes.messageId))
      .where(and(eq(storefrontSmsCodes.phoneKey, phoneKey), notInArray(storefrontSmsMessages.status, ['failed', 'skipped'])))
      .orderBy(desc(storefrontSmsCodes.createdAt)).limit(1);
    if (last && last.age < OTP_RESEND_SECONDS) {
      throw new TooManyCodesError('کد پیش‌تر فرستاده شد؛ کمی صبر کنید و دوباره بخواهید.', OTP_RESEND_SECONDS - last.age);
    }
    if (await countSince(tx, eq(storefrontSmsCodes.phoneKey, phoneKey), 3600) >= OTP_PER_PHONE_HOUR_MAX
      || await countSince(tx, eq(storefrontSmsCodes.phoneKey, phoneKey), 86_400) >= OTP_PER_PHONE_DAY_MAX) {
      throw new TooManyCodesError('برای این شماره کد زیادی خواسته شده است؛ ساعتی دیگر دوباره بخواهید.', 3600);
    }
    if (await countSince(tx, eq(storefrontSmsCodes.addressKey, addressKey), 3600) >= OTP_PER_ADDRESS_HOUR_MAX) {
      throw new TooManyCodesError('از این دستگاه کد زیادی خواسته شده است؛ ساعتی دیگر دوباره بخواهید.', 3600);
    }
    if (await smsBudgetSpent(tx, settings.hourlyCap)) {
      throw new TooManyCodesError('ورود پیامکی اکنون شلوغ است؛ چند دقیقه دیگر دوباره بخواهید.', 300);
    }
    const [row] = await tx.insert(storefrontSmsMessages).values({
      kind: 'otp', phone, phoneKey, params: '{}', status: 'sending', attempts: 1, provider: settings.provider,
    }).returning();
    const [codeRow] = await tx.insert(storefrontSmsCodes).values({
      phoneKey, codeHash, addressKey, messageId: row.id, expiresAt: sql`now() + make_interval(secs => ${OTP_TTL_SECONDS})`,
    }).returning({ id: storefrontSmsCodes.id });
    return { row, codeId: codeRow.id };
  });
  // sent after the commit: the code row exists before the buyer can type it
  const result = await deliverMessage(message.row, settings, { CODE: code });
  if (!result.ok) {
    // a code the buyer never got is closed, so it cannot be guessed
    await orm.update(storefrontSmsCodes).set({ expiresAt: sql`now()` }).where(eq(storefrontSmsCodes.id, message.codeId));
    throw new AppError('فرستادن پیامک اکنون ممکن نشد؛ چند دقیقه دیگر دوباره بخواهید.', 503, 'STOREFRONT_OTP_NOT_SENT');
  }
  return { resendAfter: OTP_RESEND_SECONDS, expiresIn: OTP_TTL_SECONDS };
}

export async function verifyOtp(rawPhone: string, rawCode: string): Promise<OtpVerifyResult> {
  await otpTemplateOn();
  const phone = normalizeMobile(rawPhone);
  const code = normalizeOtpCode(rawCode);
  if (!phone || !code) throw wrongCode();
  const phoneKey = phoneMatchKey(phone);
  const presented = Buffer.from(hmac(CODE_PURPOSE, `${phoneKey}:${code}`), 'hex');
  const proof = `${PHONE_PROOF_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  // a wrong try is counted in a committed transaction; the error is thrown after it
  const verified = await orm.transaction(async (tx) => {
    const [row] = await tx.select().from(storefrontSmsCodes).where(eq(storefrontSmsCodes.phoneKey, phoneKey))
      .orderBy(desc(storefrontSmsCodes.createdAt), desc(storefrontSmsCodes.id)).limit(1).for('update');
    if (!row || row.verifiedAt || row.attempts >= OTP_VERIFY_ATTEMPTS_MAX) return false;
    // wrong tries of this phone over all its codes of the last day (a right try is the one counted on a verified code)
    const [{ wrong }] = await tx.select({
      wrong: sql<number>`coalesce(sum(${storefrontSmsCodes.attempts} - (CASE WHEN ${storefrontSmsCodes.verifiedAt} IS NULL THEN 0 ELSE 1 END)), 0)::int`,
    }).from(storefrontSmsCodes)
      .where(and(eq(storefrontSmsCodes.phoneKey, phoneKey), sql`${storefrontSmsCodes.createdAt} > now() - interval '1 day'`));
    if (wrong >= OTP_WRONG_PER_PHONE_DAY_MAX) return false;
    const [{ live }] = (await tx.execute(sql`SELECT (${row.expiresAt}::timestamptz > now()) AS live`)).rows as Array<{ live: boolean }>;
    if (!live) return false;
    const stored = Buffer.from(row.codeHash, 'hex');
    const right = stored.length === presented.length && crypto.timingSafeEqual(stored, presented);
    if (!right) {
      await tx.update(storefrontSmsCodes).set({ attempts: sql`${storefrontSmsCodes.attempts} + 1` }).where(eq(storefrontSmsCodes.id, row.id));
      return false;
    }
    await tx.update(storefrontSmsCodes).set({
      attempts: sql`${storefrontSmsCodes.attempts} + 1`, verifiedAt: sql`now()`, proofHash: sha256(proof),
      proofExpiresAt: sql`now() + make_interval(secs => ${PHONE_PROOF_TTL_SECONDS})`,
    }).where(eq(storefrontSmsCodes.id, row.id));
    return true;
  });
  if (!verified) throw wrongCode();
  return { phoneProof: proof, expiresIn: PHONE_PROOF_TTL_SECONDS };
}

/**
 * For the sign-up and sign-in of stage 8.2b, inside their own transaction: whether `proof` is a live, unused proof for
 * this phone, and if so it is used up. A wrong, used, expired or another phone's proof is false.
 */
export async function consumePhoneProof(tx: DbExecutor, rawPhone: string, proof: string): Promise<boolean> {
  const phone = normalizeMobile(rawPhone);
  if (!phone || !proof || proof.length > PHONE_PROOF_MAX || !proof.startsWith(PHONE_PROOF_PREFIX)) return false;
  const [row] = await tx.select({ id: storefrontSmsCodes.id }).from(storefrontSmsCodes)
    .where(and(
      eq(storefrontSmsCodes.proofHash, sha256(proof)), eq(storefrontSmsCodes.phoneKey, phoneMatchKey(phone)),
      isNull(storefrontSmsCodes.proofUsedAt), gt(storefrontSmsCodes.proofExpiresAt, sql`now()`),
    )).for('update');
  if (!row) return false;
  const used = await tx.update(storefrontSmsCodes).set({ proofUsedAt: sql`now()` })
    .where(and(eq(storefrontSmsCodes.id, row.id), isNull(storefrontSmsCodes.proofUsedAt))).returning({ id: storefrontSmsCodes.id });
  return used.length === 1;
}
