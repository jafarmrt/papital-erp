import { orm, type DbTransaction } from '../../db/drizzle.js';
import { crmActivities, crmLeads } from '../../db/schema.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { money } from '../../lib/money.js';
import { crmTodayActivityDates } from '../../lib/storageDate.js';
import { toLatinDigits } from '../../lib/numericInput.js';
import { toStorageDate } from '../../utils/calendarDate.js';
import { logger } from '../../middleware/logger.js';
import { cleanText } from '../../lib/storefront/storefrontOrderRules.js';
import { rialAmountText } from '../../lib/storefront/storefrontRules.js';
import {
  GIFT_CONTACT_MAX, GIFT_NOTE_MAX, GIFT_ORGANIZATION_MAX, GIFT_QUANTITY_MAX, type CorporateGiftAnswer, type CorporateGiftRequest,
} from '../../lib/storefront/storefrontInquiryContracts.js';
import { recordLeadStageChange } from '../crm/crmLeadStageHistory.js';
import { createNotifications } from '../notifications/notificationCreator.js';
import { permissionHolderUserIdsWith } from '../notifications/notificationRecipients.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';

/**
 * v11 phase 8.2c (start plan §7): the «هدیهٔ سازمانی» form of the site. It makes a sales lead in the CRM at its first
 * stage with the source «وبسایت», the same rows the CRM's own «پرونده فروش تازه» writes (the lead, its first stage row,
 * its «ایجاد فرصت فروش» note and an audit row, in one transaction). No customer is made from a site form: the lead keeps
 * the organization, contact and phone, and a colleague links or makes the customer when they call back (as for any lead
 * without one). The holders of `crm.manage` learn of it in their bell. From there it is the CRM's own path: follow-ups,
 * a proforma from the lead and the invoice.
 */
export const CRM_MANAGE_PERMISSION = 'crm.manage';
export const SITE_LEAD_SOURCE = 'وبسایت';

const fieldError = (field: string, message: string) => new ValidationError(message, { field }, 'STOREFRONT_INQUIRY_FIELD_INVALID');
const faNumber = (n: number) => n.toLocaleString('fa-IR');

interface CleanGift {
  organization: string;
  contactName: string;
  phone: string;
  quantity: number;
  budget: string;
  neededBy: string;
  note: string;
}

export function cleanCorporateGift(input: CorporateGiftRequest): CleanGift {
  const organization = cleanText(input.organization, GIFT_ORGANIZATION_MAX);
  if (!organization || organization.length < 2) throw fieldError('organization', 'نام سازمان یا شرکت را بنویسید.');
  const contactName = cleanText(input.contactName, GIFT_CONTACT_MAX);
  if (!contactName || contactName.length < 2) throw fieldError('contactName', 'نام رابط را بنویسید.');
  const phone = toLatinDigits(String(input.phone ?? '')).replace(/[\s()-]/g, '');
  if (!/^\+?\d{8,15}$/.test(phone)) throw fieldError('phone', 'شمارهٔ تماس را با پیش‌شماره بنویسید (۸ تا ۱۵ رقم).');
  const quantity = input.quantity === undefined || input.quantity === null ? 0 : Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > GIFT_QUANTITY_MAX) {
    throw fieldError('quantity', `تعداد تقریبی باید عدد درست ۰ تا ${faNumber(GIFT_QUANTITY_MAX)} باشد.`);
  }
  const budget = rialAmountText(String(input.budget ?? '').trim() || '0', { allowZero: true });
  if (budget === null) throw fieldError('budget', 'بودجهٔ تقریبی را فقط با رقم بنویسید.');
  const neededBy = toStorageDate(input.neededBy ?? '');
  if (neededBy === null) throw fieldError('neededBy', 'تاریخ نیاز را مانند ۱۴۰۵/۱۰/۱۵ بنویسید یا خالی بگذارید.');
  const noteText = String(input.note ?? '').trim();
  const note = noteText ? cleanText(noteText, GIFT_NOTE_MAX, { multiline: true }) : '';
  if (note === null) throw fieldError('note', `توضیح حداکثر ${faNumber(GIFT_NOTE_MAX)} نویسه است.`);
  return { organization, contactName, phone, quantity, budget, neededBy, note };
}

export interface SiteLeadInput {
  title: string;
  contactName: string;
  phone: string;
  company: string;
  /** rials, as a whole number in text ('0' = not said) */
  estimatedValue: string;
  /** `YYYY-MM-DD`, or '' */
  expectedCloseDate: string;
  notes: string;
  /** what the audit row keeps of the request (never what a visitor wrote in free text) */
  audit: Record<string, unknown>;
}

/**
 * A sales lead opened by a form of the site, in the caller's transaction: the lead at its first stage with the source
 * «وبسایت», its first stage row, its «ایجاد فرصت فروش» note and an audit row, as the CRM's own «پرونده فروش تازه» writes
 * them. Used by «هدیهٔ سازمانی» and by a form of «فرم‌های سایت» whose «پروندهٔ فروش هم بساز» is on (v12 phase 10f).
 */
export async function openSiteLead(tx: DbTransaction, input: SiteLeadInput): Promise<number> {
  const nowIso = systemNowUtcIso();
  const [lead] = await tx.insert(crmLeads).values({
    title: input.title, customerId: null, customerName: input.contactName, phone: input.phone,
    company: input.company, contacts: [], source: SITE_LEAD_SOURCE, stage: 'lead', estimatedValue: money(input.estimatedValue), currency: 'IRR',
    probability: 50, assignedTo: '', assignedPersonnelId: null, expectedCloseDate: input.expectedCloseDate, notes: input.notes, status: 'active',
    createdAt: nowIso, updatedAt: nowIso, createdBy: STOREFRONT_BOT_USER, isDeleted: 0,
  }).returning({ id: crmLeads.id });
  await recordLeadStageChange(tx, { leadId: lead.id, fromStage: null, toStage: 'lead', assignedPersonnelId: null, lostReason: '', actor: { name: STOREFRONT_BOT_USER } });
  await tx.insert(crmActivities).values({
    leadId: lead.id, customerId: null, type: 'note', title: 'ایجاد فرصت فروش',
    description: `پرونده فروش «${input.title}» از فرم سایت ساخته شد.`, loggedBy: STOREFRONT_BOT_USER,
    ...(await crmTodayActivityDates()), createdAt: nowIso, isDeleted: 0,
  });
  await logActivity({
    tx, username: STOREFRONT_BOT_USER, action: 'CREATE', entity: 'فرصت فروش CRM', entityId: String(lead.id),
    description: `ایجاد فرصت فروش «${input.title}» از فرم سایت`,
    details: { after: { ...input.audit, source: SITE_LEAD_SOURCE } },
  });
  return lead.id;
}

async function notifyLead(tx: DbTransaction, leadId: number, organization: string): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      const recipients = await permissionHolderUserIdsWith(sp, CRM_MANAGE_PERMISSION);
      await createNotifications(sp, recipients.map(userId => ({
        userId, category: 'site_inquiry' as const, type: 'system', senderName: STOREFRONT_BOT_USER,
        title: `درخواست هدیهٔ سازمانی از سایت: ${organization}`, message: 'پرونده فروش تازه‌ای از سایت ساخته شد؛ با رابط تماس بگیرید.',
        link: `/crm?leadId=${leadId}`,
      })));
    });
  } catch (err) {
    logger.error({ message: 'Error notifying colleagues of a corporate gift lead', leadId, error: err });
  }
}

/** `POST /inquiries/corporate-gift` */
export async function submitCorporateGift(input: CorporateGiftRequest): Promise<CorporateGiftAnswer> {
  const settings = await storefrontSettingValues(orm);
  if (!settings.enabled) throw new NotFoundError('پیدا نشد');
  const form = cleanCorporateGift(input);
  const notes = [
    'درخواست هدیهٔ سازمانی از فرم سایت.',
    form.quantity > 0 ? `تعداد تقریبی: ${faNumber(form.quantity)}` : '',
    form.budget !== '0' ? `بودجهٔ تقریبی: ${faNumber(Number(BigInt(form.budget) / 10n))} تومان` : '',
    form.note ? `توضیح خریدار: ${form.note}` : '',
  ].filter(Boolean).join('\n');
  const leadId = await orm.transaction(async (tx) => {
    const id = await openSiteLead(tx, {
      title: `هدیهٔ سازمانی: ${form.organization}`, contactName: form.contactName, phone: form.phone, company: form.organization,
      estimatedValue: form.budget, expectedCloseDate: form.neededBy, notes,
      audit: { organization: form.organization, quantity: form.quantity, budget: form.budget, neededBy: form.neededBy },
    });
    await notifyLead(tx, id, form.organization);
    return id;
  });
  return { reference: String(leadId) };
}
