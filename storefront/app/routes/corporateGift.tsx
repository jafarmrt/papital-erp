import { Form, Link, useNavigation } from 'react-router';
import type { Route } from './+types/corporateGift';
import type { CorporateGiftAnswer } from '@erp/storefront/storefrontInquiryContracts';
import { GIFT_CONTACT_MAX, GIFT_NOTE_MAX, GIFT_ORGANIZATION_MAX } from '@erp/storefront/storefrontInquiryContracts';
import { accountCall, crossSite, sameSite } from '../lib/account.server';
import { siteEnv } from '../lib/site.server';
import { pageMeta } from '../lib/meta';
import { faNumber } from '../lib/format';
import { formStamp, keptStamp, trapRefusal } from '../lib/botTrap.server';
import { AccountShell, BotTrapFields, Field, FormError, SubmitButton, TextAreaField } from '../components/AccountForm';

/**
 * v11 phase 8.2c (start plan §7): «هدیهٔ سازمانی». An organization writes who to call, about how many gifts, the budget
 * and the day it needs them; the ERP makes a sales lead in its CRM and a colleague calls back. A plain form posted here,
 * so it works without JavaScript; the budget is typed in toman, like every price on the site, and sent in rial.
 * v12 phase 8a (site review 2.12): each send makes a lead and a bell, so the robot trap is checked before the ERP is asked.
 */
const FIELDS = ['organization', 'contactName', 'phone', 'quantity', 'budget', 'neededBy', 'note'] as const;
type Fields = Record<typeof FIELDS[number], string>;

interface ActionAnswer {
  fields?: Fields;
  error?: string;
  field?: string;
  reference?: string;
  /** the form's robot-trap stamp, kept after an error so a quick fix is not «too fast» */
  stamp?: string;
}

export function loader() {
  return { siteUrl: siteEnv().siteUrl, stamp: formStamp() };
}

export function meta({ data }: Route.MetaArgs) {
  return pageMeta({
    title: 'هدیهٔ سازمانی', description: 'هدیهٔ سازمانی پاپیتال برای شرکت‌ها و سازمان‌ها، با فاکتور رسمی', path: '/corporate-gift', siteUrl: data?.siteUrl ?? '',
  });
}

const latin = (value: string) => value.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const digitsOf = (value: string) => latin(value).replace(/[\s,٬،]/g, '');

export async function action({ request }: Route.ActionArgs): Promise<ActionAnswer | Response> {
  if (!sameSite(request)) return crossSite();
  const form = await request.formData();
  const fields = Object.fromEntries(FIELDS.map(f => [f, String(form.get(f) ?? '').slice(0, f === 'note' ? GIFT_NOTE_MAX + 1 : 300)])) as Fields;
  const stamp = keptStamp(form);
  const trapped = trapRefusal(form);
  if (trapped) return { fields, error: trapped, stamp };
  const quantity = digitsOf(fields.quantity);
  if (quantity && !/^\d{1,7}$/.test(quantity)) return { fields, error: 'تعداد تقریبی را فقط با رقم بنویسید.', field: 'quantity', stamp };
  const budgetToman = digitsOf(fields.budget);
  if (budgetToman && !/^\d{1,13}$/.test(budgetToman)) return { fields, error: 'بودجهٔ تقریبی را فقط با رقم و به تومان بنویسید.', field: 'budget', stamp };
  const sent = await accountCall<CorporateGiftAnswer>(request, 'POST', '/inquiries/corporate-gift', {
    organization: fields.organization, contactName: fields.contactName, phone: fields.phone, note: fields.note, neededBy: fields.neededBy,
    ...(quantity ? { quantity: Number(quantity) } : {}), ...(budgetToman ? { budget: `${budgetToman}0` } : {}),
  });
  if (!sent.data) return { fields, error: sent.error, field: sent.field ?? '', stamp };
  return { reference: sent.data.reference };
}

export default function CorporateGiftPage({ loaderData, actionData }: Route.ComponentProps) {
  const answer = actionData as ActionAnswer | undefined;
  const busy = useNavigation().state === 'submitting';
  const value = (f: typeof FIELDS[number]) => answer?.fields?.[f] ?? '';
  const bad = (f: string) => answer?.field === f;

  if (answer?.reference) {
    return (
      <AccountShell title="درخواست شما رسید" intro={`شمارهٔ درخواست: ${faNumber(Number(answer.reference))}`}>
        <p className="text-base leading-8">همکاران ما به‌زودی با شمارهٔ رابط تماس می‌گیرند تا جزئیات، نمونه‌ها و پیش‌فاکتور را با شما هماهنگ کنند.</p>
        <Link to="/products" className="inline-flex min-h-12 items-center font-bold text-brand hover:underline">دیدن محصولات</Link>
      </AccountShell>
    );
  }

  return (
    <AccountShell title="هدیهٔ سازمانی" intro="برای هدیهٔ همکاران، مشتریان یا مناسبت‌های سازمان، چند خط بنویسید تا با شما تماس بگیریم. فاکتور رسمی صادر می‌شود.">
      <Form method="post" className="space-y-5" replace>
        <FormError message={answer?.error} />
        <BotTrapFields stamp={answer?.stamp ?? loaderData.stamp} />
        <Field label="نام سازمان یا شرکت" name="organization" autoComplete="organization" maxLength={GIFT_ORGANIZATION_MAX} defaultValue={value('organization')} invalid={bad('organization')} />
        <Field label="نام رابط" name="contactName" autoComplete="name" maxLength={GIFT_CONTACT_MAX} defaultValue={value('contactName')} invalid={bad('contactName')} />
        <Field label="شمارهٔ تماس" name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" maxLength={20} defaultValue={value('phone')} hint="همراه یا تلفن ثابت با پیش‌شماره" invalid={bad('phone')} />
        <Field label="تعداد تقریبی (اختیاری)" name="quantity" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={10} required={false} defaultValue={value('quantity')} invalid={bad('quantity')} />
        <Field label="بودجهٔ تقریبی به تومان (اختیاری)" name="budget" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={20} required={false} defaultValue={value('budget')} hint="جمع همهٔ هدیه‌ها" invalid={bad('budget')} />
        <Field label="تاریخ نیاز (اختیاری)" name="neededBy" autoComplete="off" dir="ltr" maxLength={12} required={false} defaultValue={value('neededBy')} hint="مانند ۱۴۰۵/۱۰/۱۵" invalid={bad('neededBy')} />
        <TextAreaField label="توضیح (اختیاری)" name="note" autoComplete="off" maxLength={GIFT_NOTE_MAX} required={false} defaultValue={value('note')} hint="مناسبت، سلیقه، بسته‌بندی یا هر چیزی که باید بدانیم" invalid={bad('note')} />
        <SubmitButton busy={busy}>فرستادن درخواست</SubmitButton>
      </Form>
    </AccountShell>
  );
}
