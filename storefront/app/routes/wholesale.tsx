import { Form, Link, data, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/wholesale';
import type { StorefrontAccountView } from '@erp/storefront/storefrontBuyerContracts';
import { APPLICATION_NOTE_MAX, BUYER_CITY_MAX, BUYER_NAME_MAX, COMPANY_NAME_MAX } from '@erp/storefront/storefrontBuyerRules';
import { publicSettings } from '../lib/api.server';
import {
  accountCall, clearWholesaleProofCookie, crossSite, normalizePhone, sameSite, sessionOf, wholesaleProofCookie, wholesaleProofOf,
} from '../lib/account.server';
import { formStamp, keptStamp, trapRefusal } from '../lib/botTrap.server';
import { siteEnv } from '../lib/site.server';
import { pageMeta } from '../lib/meta';
import { AccountShell, BotTrapFields, CodeField, Field, FormError, FormNote, PhoneField, SubmitButton, TextAreaField } from '../components/AccountForm';

/**
 * v12 phase 8a (site review 2.3): «درخواست خرید عمده». The ERP already took the request (`POST /wholesale/apply`) and its
 * colleagues review it under «خریداران سایت»; this is the page that sends it.
 *
 * - A signed-in buyer writes only the business: the account's name and phone go with it, and a request already under
 *   review or approved is said instead of the form.
 * - A guest's request makes a pending account for the phone, so while the ERP signs in by SMS the phone is proven first
 *   (phone, then the code) and the proof waits in an httpOnly cookie for this page only; without SMS it is one form.
 * - The form that sends the request carries the robot trap (site review 2.12), checked before the ERP is asked.
 * Plain forms posted here, so it works without JavaScript; the ERP decides every rule and answers each refusal's field.
 */
type Step = 'phone' | 'code' | 'details';
const FIELDS = ['name', 'phone', 'companyName', 'city', 'nationalId', 'economicCode', 'note'] as const;
type Fields = Record<typeof FIELDS[number], string>;

interface ActionAnswer {
  step: Step;
  fields?: Partial<Fields>;
  error?: string;
  field?: string;
  /** the phone already has an account: the buyer signs in and sends the request from there */
  hasAccount?: boolean;
  sent?: boolean;
  stamp?: string;
}

const PHONE_WRONG = 'شمارهٔ همراه را درست بنویسید (مانند ۰۹۱۲۱۲۳۴۵۶۷).';
const SIGN_IN = '/account/sign-in?next=%2Fwholesale';

async function accountOf(request: Request): Promise<StorefrontAccountView | null> {
  if (!sessionOf(request)) return null;
  return (await accountCall<StorefrontAccountView>(request, 'GET', '/account')).data;
}

export async function loader({ request }: Route.LoaderArgs) {
  const [settings, account] = await Promise.all([publicSettings(), accountOf(request)]);
  return {
    smsLogin: settings.smsLogin === true,
    account: account ? { name: account.name, phone: account.phone, city: account.city, kind: account.kind, application: account.application } : null,
    provenPhone: wholesaleProofOf(request).phone,
    stamp: formStamp(),
    siteUrl: siteEnv().siteUrl,
  };
}

/** the buyer's own details: never kept by a browser or a cache in between */
export const headers = () => ({ 'Cache-Control': 'no-store' });

export function meta({ data }: Route.MetaArgs) {
  return pageMeta({
    title: 'درخواست خرید عمده', description: 'خرید عمدهٔ پاپیتال برای فروشگاه‌ها و گالری‌ها، با قیمت عمده و فاکتور رسمی', path: '/wholesale', siteUrl: data?.siteUrl ?? '',
  });
}

const fieldsOf = (form: FormData) => Object.fromEntries(FIELDS.map(f => [f, String(form.get(f) ?? '').slice(0, f === 'note' ? APPLICATION_NOTE_MAX + 1 : 200)])) as Fields;

export async function action({ request }: Route.ActionArgs) {
  if (!sameSite(request)) return crossSite();
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  if (intent === 'another-phone') return redirect('/wholesale', { headers: { 'Set-Cookie': clearWholesaleProofCookie() } });
  const fields = fieldsOf(form);
  const phone = normalizePhone(fields.phone);

  if (intent === 'send-code') {
    if (!phone) return { step: 'phone', fields, error: PHONE_WRONG, field: 'phone' };
    const sent = await accountCall(request, 'POST', '/auth/otp/request', { phone });
    if (sent.status !== 202) return { step: 'phone', fields, error: sent.error, field: 'phone' };
    return { step: 'code', fields: { phone } };
  }
  if (intent === 'verify-code') {
    const verified = await accountCall<{ phoneProof: string }>(request, 'POST', '/auth/otp/verify', { phone, code: String(form.get('code') ?? '').slice(0, 12) });
    if (!verified.data) return { step: 'code', fields: { phone }, error: verified.error };
    return redirect('/wholesale', { headers: { 'Set-Cookie': wholesaleProofCookie(phone, verified.data.phoneProof) } });
  }
  if (intent !== 'apply') return { step: 'details', fields } satisfies ActionAnswer;

  const stamp = keptStamp(form);
  const trapped = trapRefusal(form);
  if (trapped) return { step: 'details', fields, error: trapped, stamp };
  const account = await accountOf(request);
  const proven = wholesaleProofOf(request);
  // a signed-in buyer applies as the account; a guest's phone is the proven one when there is a proof
  const name = account ? account.name : fields.name;
  const applyPhone = account ? account.phone : proven.phone || phone;
  if (!applyPhone) return { step: 'details', fields, error: PHONE_WRONG, field: 'phone', stamp };
  const answer = await accountCall<StorefrontAccountView>(request, 'POST', '/wholesale/apply', {
    name, phone: applyPhone, companyName: fields.companyName, city: fields.city, nationalId: fields.nationalId, economicCode: fields.economicCode,
    note: fields.note, ...(!account && proven.proof && proven.phone === applyPhone ? { phoneProof: proven.proof } : {}),
  });
  if (answer.data) return data({ step: 'details', sent: true } satisfies ActionAnswer, { headers: { 'Set-Cookie': clearWholesaleProofCookie() } });
  // a proof that ran out (or a session the ERP no longer knows): back to the phone, with the old proof gone
  if (answer.code === 'STOREFRONT_PHONE_PROOF_REQUIRED') {
    return data({ step: 'phone', fields: { phone: applyPhone }, error: answer.error } satisfies ActionAnswer, { headers: { 'Set-Cookie': clearWholesaleProofCookie() } });
  }
  if (answer.code === 'STOREFRONT_ACCOUNT_EXISTS') return { step: 'details', fields, error: answer.error, hasAccount: true, stamp };
  return { step: 'details', fields, error: answer.error, field: answer.field ?? '', stamp };
}

export default function WholesalePage({ loaderData, actionData }: Route.ComponentProps) {
  const { smsLogin, account, provenPhone } = loaderData;
  const answer = actionData as ActionAnswer | undefined;
  const busy = useNavigation().state === 'submitting';
  const value = (f: typeof FIELDS[number]) => answer?.fields?.[f] ?? (f === 'city' ? account?.city ?? '' : '');
  const bad = (f: string) => answer?.field === f;

  if (answer?.sent) {
    return (
      <AccountShell title="درخواست شما رسید">
        <p className="text-base leading-8">
          {account
            ? 'همکاران ما درخواست را بررسی می‌کنند. نتیجه را در «حساب من» می‌بینید و پس از تأیید، قیمت عمده برای حساب شما باز می‌شود.'
            : 'همکاران ما درخواست را بررسی می‌کنند و برای باز شدن حساب عمده با همین شمارهٔ همراه با شما تماس می‌گیرند.'}
        </p>
        <Link to={account ? '/account' : '/products'} className="inline-flex min-h-12 items-center font-bold text-brand hover:underline">{account ? 'حساب من' : 'دیدن محصولات'}</Link>
      </AccountShell>
    );
  }

  const intro = 'برای فروش در فروشگاه یا گالری خودتان با قیمت عمده و فاکتور رسمی، مشخصات کسب‌وکار را بنویسید. همکاران ما درخواست را بررسی می‌کنند.';
  if (account && (account.application === 'pending' || account.application === 'approved' || account.kind === 'wholesale')) {
    return (
      <AccountShell title="درخواست خرید عمده">
        <FormNote>{account.application === 'pending' ? 'درخواست خرید عمدهٔ شما ثبت شده و در دست بررسی است.' : 'حساب شما برای خرید عمده باز است.'}</FormNote>
        <Link to="/account" className="inline-flex min-h-12 items-center font-bold text-brand hover:underline">حساب من</Link>
      </AccountShell>
    );
  }

  // the settings this page read may be a minute old, so the ERP has the last word: a request it refused for a missing
  // proof comes back on the phone step, and a proven phone goes to the form, whatever the settings said
  const step: Step = account ? 'details'
    : answer?.step === 'code' ? 'code'
    : answer?.step === 'phone' ? 'phone'
    : provenPhone ? 'details'
    : smsLogin ? 'phone' : 'details';

  return (
    <AccountShell title="درخواست خرید عمده" intro={intro}>
      {!account ? (
        <p className="text-base leading-8 text-muted-foreground">
          حساب دارید؟ <Link to={SIGN_IN} className="font-bold text-brand hover:underline">ورود به حساب</Link> و فرستادن درخواست از همان‌جا.
        </p>
      ) : null}

      {step === 'phone' && (
        <Form method="post" className="space-y-5" replace>
          <FormError message={answer?.error} />
          <FormNote>نخست شمارهٔ همراه با یک کد پیامکی تأیید می‌شود.</FormNote>
          <PhoneField defaultValue={value('phone')} invalid={bad('phone')} autoFocus />
          <SubmitButton intent="send-code" busy={busy}>فرستادن کد تأیید</SubmitButton>
        </Form>
      )}

      {step === 'code' && (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="phone" value={value('phone')} />
          {answer?.error ? <FormError message={answer.error} /> : <FormNote>کد تأیید به <span dir="ltr">{value('phone')}</span> پیامک شد.</FormNote>}
          <CodeField />
          <SubmitButton intent="verify-code" busy={busy}>تأیید شماره</SubmitButton>
          <SubmitButton intent="send-code" busy={busy} secondary>کد نرسید؟ دوباره بفرست</SubmitButton>
        </Form>
      )}

      {step === 'details' && (
        <Form method="post" className="space-y-5" replace>
          <FormError message={answer?.error} />
          {answer?.hasAccount ? (
            <p className="text-base leading-8"><Link to={SIGN_IN} className="font-bold text-brand hover:underline">ورود به حساب</Link> و فرستادن درخواست از همان‌جا</p>
          ) : null}
          <BotTrapFields stamp={answer?.stamp ?? loaderData.stamp} />
          {account ? (
            <FormNote>{`درخواست به نام ${account.name} و با شمارهٔ `}<span dir="ltr">{account.phone}</span> فرستاده می‌شود.</FormNote>
          ) : (
            <>
              {provenPhone ? (
                <>
                  <input type="hidden" name="phone" value={provenPhone} />
                  <FormNote>شمارهٔ <span dir="ltr">{provenPhone}</span> تأیید شد.</FormNote>
                </>
              ) : (
                <PhoneField defaultValue={value('phone')} invalid={bad('phone')} />
              )}
              <Field label="نام و نام خانوادگی" name="name" autoComplete="name" maxLength={BUYER_NAME_MAX} defaultValue={value('name')} invalid={bad('name')} />
            </>
          )}
          <Field label="نام فروشگاه یا شرکت" name="companyName" autoComplete="organization" maxLength={COMPANY_NAME_MAX} defaultValue={value('companyName')} invalid={bad('companyName')} />
          <Field label="شهر" name="city" autoComplete="address-level2" maxLength={BUYER_CITY_MAX} defaultValue={value('city')} invalid={bad('city')} />
          <Field label="شناسهٔ ملی یا کد ملی (اختیاری)" name="nationalId" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={20} required={false}
            defaultValue={value('nationalId')} hint="شناسهٔ ملی ۱۱ رقم یا کد ملی ۱۰ رقم؛ برای فاکتور رسمی" invalid={bad('nationalId')} />
          <Field label="کد اقتصادی (اختیاری)" name="economicCode" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={20} required={false}
            defaultValue={value('economicCode')} hint="۱۲ رقم" invalid={bad('economicCode')} />
          <TextAreaField label="توضیح (اختیاری)" name="note" autoComplete="off" maxLength={APPLICATION_NOTE_MAX} required={false} defaultValue={value('note')}
            hint="چه کالاهایی و حدود چه تعدادی، و کجا می‌فروشید" invalid={bad('note')} />
          <SubmitButton intent="apply" busy={busy}>فرستادن درخواست</SubmitButton>
          {!account && provenPhone ? <SubmitButton intent="another-phone" busy={busy} secondary>شمارهٔ دیگری دارم</SubmitButton> : null}
        </Form>
      )}
    </AccountShell>
  );
}
