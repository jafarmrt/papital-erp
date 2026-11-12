import { Form, Link, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/accountContact';
import type { StorefrontAccountView } from '@erp/storefront/storefrontBuyerContracts';
import { publicSettings } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import { accountCall, clearSessionCookie, crossSite, sameSite, sessionOf } from '../lib/account.server';
import { contactOf, contactWrong, proofFields, sendCode, verifyCode } from '../lib/contactCode.server';
import { pageMeta } from '../lib/meta';
import { faDigits } from '../lib/format';
import { contactLabel } from '../lib/contactLabel';
import { AccountShell, CodeField, ContactField, Field, FormError, FormNote, SubmitButton } from '../components/AccountForm';

/**
 * v12 phase 8e (start plan §5): an email or a phone added to the signed-in account, or one it has replaced. The buyer
 * writes it, gets its code (an SMS for a phone while `smsLogin` is on, an email while `emailLogin` is on) and writes the
 * code; replacing one the account already has asks the account's password too (the ERP ends the other sessions then).
 */
type Step = 'contact' | 'code';
interface ActionAnswer { step: Step; contact: string; error?: string }

export async function loader({ request }: Route.LoaderArgs) {
  if (!sessionOf(request)) throw redirect('/account/sign-in?next=%2Faccount%2Fcontact');
  const [account, settings] = await Promise.all([accountCall<StorefrontAccountView>(request, 'GET', '/account'), publicSettings()]);
  if (account.status === 401) throw redirect('/account/sign-in?next=%2Faccount%2Fcontact', { headers: { 'Set-Cookie': clearSessionCookie() } });
  if (!account.data) throw new Response('در دسترس نیست', { status: 503 });
  return {
    email: account.data.email, phone: account.data.phone, smsLogin: settings.smsLogin === true, emailLogin: settings.emailLogin === true,
    siteUrl: siteEnv().siteUrl,
  };
}

export const headers = () => ({ 'Cache-Control': 'no-store' });

export function meta({ data }: Route.MetaArgs) {
  return [...pageMeta({ title: 'ایمیل و شمارهٔ حساب', description: 'ایمیل و شمارهٔ همراه حساب خرید در پاپیتال', path: '/account/contact', siteUrl: data?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

export async function action({ request }: Route.ActionArgs): Promise<ActionAnswer | Response> {
  if (!sameSite(request)) return crossSite();
  const settings = await publicSettings();
  const ways = { sms: settings.smsLogin === true, email: settings.emailLogin === true };
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const typed = String(form.get('contact') ?? '').slice(0, 254);
  const contact = contactOf(typed);
  if (!contact) return { step: 'contact', contact: typed, error: contactWrong(ways.sms, ways.email) };
  if (intent === 'send-code') {
    const sent = await sendCode(request, contact, ways);
    return sent.error && !sent.wait ? { step: 'contact', contact: contact.value, error: sent.error } : { step: 'code', contact: contact.value, error: sent.error || undefined };
  }
  if (intent === 'save') {
    const verified = await verifyCode(request, contact, form.get('code'));
    if (!verified.proof) return { step: 'code', contact: contact.value, error: verified.error };
    const password = String(form.get('password') ?? '').slice(0, 200);
    const saved = await accountCall<StorefrontAccountView>(request, 'POST', contact.kind === 'phone' ? '/account/phone' : '/account/email', {
      ...proofFields(contact, verified.proof), ...(password ? { password } : {}),
    });
    if (saved.status === 401) return redirect('/account/sign-in?next=%2Faccount%2Fcontact', { headers: { 'Set-Cookie': clearSessionCookie() } });
    if (saved.data) return redirect('/account');
    // the code was used by the check above (or the refusal kept it): a new try sends a new code
    return { step: 'contact', contact: contact.value, error: saved.error };
  }
  return { step: 'contact', contact: contact.value };
}

export default function AccountContactPage({ loaderData, actionData }: Route.ComponentProps) {
  const { email, phone, smsLogin, emailLogin } = loaderData;
  const answer = actionData as ActionAnswer | undefined;
  const busy = useNavigation().state === 'submitting';
  const step: Step = answer?.step === 'code' ? 'code' : 'contact';
  const typedEmail = answer?.contact?.includes('@') === true;
  const replacing = step === 'code' && (typedEmail ? Boolean(email) : Boolean(phone));

  if (!smsLogin && !emailLogin) {
    return <AccountShell title="ایمیل و شمارهٔ حساب" intro="افزودن ایمیل یا شماره اکنون از سایت ممکن نیست."><Link to="/account" className="font-bold text-brand">بازگشت به حساب من</Link></AccountShell>;
  }
  return (
    <AccountShell title="ایمیل و شمارهٔ حساب" intro="ایمیل یا شمارهٔ تازه با کدی که برایش فرستاده می‌شود تأیید و روی حساب گذاشته می‌شود.">
      <FormNote>
        {phone ? <>{'شمارهٔ همراه: '}<span dir="ltr">{faDigits(phone)}</span></> : 'شمارهٔ همراه ندارد.'}{' '}
        {email ? <>ایمیل: <span dir="ltr">{email}</span></> : 'ایمیل ندارد.'}
      </FormNote>
      {step === 'contact' && (
        <Form method="post" className="space-y-5" replace>
          <FormError message={answer?.error} />
          <ContactField label={contactLabel(smsLogin, emailLogin)} ways={{ sms: smsLogin, email: emailLogin }} defaultValue={answer?.contact} autoFocus />
          <SubmitButton intent="send-code" busy={busy}>فرستادن کد تأیید</SubmitButton>
        </Form>
      )}
      {step === 'code' && answer && (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="contact" value={answer.contact} />
          {answer.error ? <FormError message={answer.error} /> : <FormNote>{`کد تأیید ${typedEmail ? 'به ایمیل' : 'با پیامک به'} `}<span dir="ltr">{answer.contact}</span>{' فرستاده شد.'}</FormNote>}
          <CodeField byEmail={typedEmail} />
          {replacing && <Field label="رمز حساب" name="password" type="password" autoComplete="current-password" dir="ltr" maxLength={200} hint={`برای عوض کردن ${typedEmail ? 'ایمیل' : 'شمارهٔ'} حساب، رمز حساب را هم بنویسید.`} />}
          <SubmitButton intent="save" busy={busy}>تأیید و ذخیره</SubmitButton>
        </Form>
      )}
      <Link to="/account" className="inline-block min-h-11 py-2 text-base font-bold text-brand underline-offset-4 hover:underline">بازگشت به حساب من</Link>
    </AccountShell>
  );
}
