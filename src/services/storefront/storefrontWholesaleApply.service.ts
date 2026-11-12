import { eq } from 'drizzle-orm';
import { orm, type DbTransaction } from '../../db/drizzle.js';
import { storefrontBuyerAccounts } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { nextVersion } from '../../lib/occHelper.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { logger } from '../../middleware/logger.js';
import { cleanText, normalizeMobile } from '../../lib/storefront/storefrontOrderRules.js';
import {
  APPLICATION_NOTE_MAX, BUYER_CITY_MAX, BUYER_NAME_MAX, COMPANY_NAME_MAX, normalizeEconomicCode, normalizeNationalId,
} from '../../lib/storefront/storefrontBuyerRules.js';
import type { StorefrontAccountView, WholesaleApplyRequest } from '../../lib/storefront/storefrontBuyerContracts.js';
import { createNotifications } from '../notifications/notificationCreator.js';
import { permissionHolderUserIdsWith } from '../notifications/notificationRecipients.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';
import {
  accountByPhoneKey, accountExists, accountFieldError, accountView, assertAccountsOpen, lockPhone, phoneProofInvalid, provenPhoneAt,
  sessionAccount,
} from './storefrontBuyerAuth.service.js';
import { smsLoginOn } from './storefrontSmsSettings.service.js';

/**
 * v11 phase 8.2b (start plan §6): the «خرید عمده» form of the site. Without a session it makes a new account in
 * «در انتظار بررسی», with no password: the buyer signs in only after a colleague approved them and sent the set-password
 * link. A phone that already has an account must sign in and send the form from that account, so nobody can file a
 * request on another buyer's account. A signed-in retail buyer's request is filed on their own account. The holders of
 * `site_buyers.manage` learn of each new request in their bell (and messenger, as a fixed sentence without the name).
 */
export const SITE_BUYERS_MANAGE_PERMISSION = 'site_buyers.manage';

interface CleanApplication {
  name: string;
  companyName: string;
  city: string;
  phone: string;
  nationalId: string;
  economicCode: string;
  note: string;
}

export function cleanApplication(input: WholesaleApplyRequest): CleanApplication {
  const name = cleanText(input.name, BUYER_NAME_MAX);
  if (!name || name.length < 2) throw accountFieldError('name', 'نام و نام خانوادگی را بنویسید.');
  const companyName = cleanText(input.companyName, COMPANY_NAME_MAX);
  if (!companyName || companyName.length < 2) throw accountFieldError('companyName', 'نام فروشگاه یا شرکت را بنویسید.');
  const city = cleanText(input.city, BUYER_CITY_MAX);
  if (!city) throw accountFieldError('city', 'شهر را بنویسید.');
  const phone = normalizeMobile(input.phone);
  if (!phone) throw accountFieldError('phone', 'شمارهٔ همراه باید ۱۱ رقم و با ۰۹ آغاز شود.');
  const nationalId = normalizeNationalId(input.nationalId);
  if (nationalId === null) throw accountFieldError('nationalId', 'شناسهٔ ملی ۱۱ رقم (یا کد ملی ۱۰ رقم) است؛ اگر ندارید خالی بگذارید.');
  const economicCode = normalizeEconomicCode(input.economicCode);
  if (economicCode === null) throw accountFieldError('economicCode', 'کد اقتصادی ۱۲ رقم است؛ اگر ندارید خالی بگذارید.');
  const noteText = String(input.note ?? '').trim();
  const note = noteText ? cleanText(noteText, APPLICATION_NOTE_MAX, { multiline: true }) : '';
  if (note === null) throw accountFieldError('note', `توضیح حداکثر ${APPLICATION_NOTE_MAX.toLocaleString('fa-IR')} نویسه است.`);
  return { name, companyName, city, phone, nationalId, economicCode, note };
}

async function notifyApplication(tx: DbTransaction, accountId: number, companyName: string): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      const recipients = await permissionHolderUserIdsWith(sp, SITE_BUYERS_MANAGE_PERMISSION);
      await createNotifications(sp, recipients.map(userId => ({
        userId, category: 'site_buyer' as const, type: 'system', senderName: STOREFRONT_BOT_USER,
        title: `درخواست خرید عمده از سایت: ${companyName}`, message: 'درخواست را بررسی کنید و اگر پذیرفتید، گروه خریدارش را انتخاب کنید.',
        link: `/site-buyers?id=${accountId}`,
      })));
    });
  } catch (err) {
    logger.error({ message: 'Error notifying colleagues of a wholesale application', accountId, error: err });
  }
}

/** `POST /wholesale/apply` */
export async function applyForWholesale(input: WholesaleApplyRequest, rawSession: unknown): Promise<StorefrontAccountView> {
  await assertAccountsOpen(orm);
  const form = cleanApplication(input);
  const signedIn = await sessionAccount(orm, rawSession);
  // v12 phase 8e: a wholesale account is known by its phone (a colleague links it to its customer by it)
  if (signedIn && !signedIn.phone) {
    throw new ValidationError('برای درخواست خرید عمده، اول شمارهٔ همراه را در «حساب من» به حساب بیفزایید.', { field: 'phone' }, 'STOREFRONT_ACCOUNT_PHONE_NEEDED');
  }
  // 8.4b: a form without a session makes an account for its phone, so the phone is proven first while SMS is on
  const proofNeeded = !signedIn && await smsLoginOn(orm);
  if (proofNeeded && !input.phoneProof) throw phoneProofInvalid();
  const phoneKey = phoneMatchKey(signedIn ? signedIn.phone : form.phone);
  const fields = {
    companyName: form.companyName, nationalId: form.nationalId, economicCode: form.economicCode, applicationNote: form.note,
    applicationStatus: 'pending', appliedAt: systemNowUtcIso(), reviewedBy: '', reviewedAt: null, updatedBy: STOREFRONT_BOT_USER,
  };
  return orm.transaction(async (tx) => {
    await lockPhone(tx, phoneKey);
    // 8.4b: the proof first, so without one the answer does not say whether the phone has an account
    const phoneVerifiedAt = signedIn ? null : await provenPhoneAt(tx, form.phone, input.phoneProof, proofNeeded);
    const existing = await accountByPhoneKey(tx, phoneKey, { lock: true });
    let accountId: number;
    if (signedIn) {
      if (!existing || existing.id !== signedIn.id) throw accountExists();
      if (existing.applicationStatus === 'pending' || existing.applicationStatus === 'approved') {
        throw new ConflictError(existing.applicationStatus === 'pending'
          ? 'درخواست خرید عمدهٔ شما ثبت شده و در دست بررسی است.'
          : 'حساب شما پیش‌تر برای خرید عمده تأیید شده است.', undefined, 'STOREFRONT_APPLICATION_EXISTS');
      }
      await tx.update(storefrontBuyerAccounts).set({
        ...fields, city: form.city, updatedAt: systemNowUtcIso(), version: nextVersion(existing.version),
      }).where(eq(storefrontBuyerAccounts.id, existing.id));
      accountId = existing.id;
    } else {
      if (existing) throw accountExists();
      const [created] = await tx.insert(storefrontBuyerAccounts).values({
        ...fields, name: form.name, phone: form.phone, phoneKey, city: form.city, status: 'pending', phoneVerifiedAt,
      }).returning({ id: storefrontBuyerAccounts.id });
      accountId = created.id;
    }
    await logActivity({
      tx, username: STOREFRONT_BOT_USER, action: signedIn ? 'UPDATE' : 'CREATE', entity: 'حساب خریدار سایت', entityId: accountId,
      description: `درخواست خرید عمدهٔ «${form.companyName}» از سایت رسید`,
      details: { after: { companyName: form.companyName, city: form.city, hasNationalId: Boolean(form.nationalId), signedIn: Boolean(signedIn) } },
    });
    await notifyApplication(tx, accountId, form.companyName);
    const [account] = await tx.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.id, accountId));
    return accountView(tx, account);
  });
}
