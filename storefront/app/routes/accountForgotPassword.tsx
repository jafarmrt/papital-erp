import { Form, Link, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/accountForgotPassword';
import { publicSettings } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import { accountCall, crossSite, safeNext, sameSite, sessionCookie, type SessionAnswer } from '../lib/account.server';
import { contactOf, contactWrong, proofFields, sendCode, verifyCode } from '../lib/contactCode.server';
import { pageMeta } from '../lib/meta';
import { contactLabel } from '../lib/contactLabel';
import { AccountShell, CodeField, ContactField, Field, FormError, FormNote, SubmitButton } from '../components/AccountForm';

/**
 * v12 phase 8e (start plan §5): a forgotten password. The buyer writes the account's phone or email, gets a code (an SMS
 * or an email, whichever the ERP can send now), and writes the code with the new password in one form; the ERP sets it,
 * ends every other session and signs the buyer in. No account for that phone or email is said only to the one who
 * proved it. With neither way on, the page sends the buyer to the shop.
 */
type Step = 'contact' | 'code';
interface ActionAnswer { step: Step; contact: string; error?: string; field?: string }

export async function loader({ request }: Route.LoaderArgs) {
  const settings = await publicSettings();
  return {
    smsLogin: settings.smsLogin === true, emailLogin: settings.emailLogin === true,
    next: safeNext(new URL(request.url).searchParams.get('next')), siteUrl: siteEnv().siteUrl,
  };
}

export function meta({ data }: Route.MetaArgs) {
  return [...pageMeta({ title: 'فراموشی رمز', description: 'گذاشتن رمز تازه برای حساب خرید در پاپیتال', path: '/account/forgot-password', siteUrl: data?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

export async function action({ request }: Route.ActionArgs): Promise<ActionAnswer | Response> {
  if (!sameSite(request)) return crossSite();
  const settings = await publicSettings();
  const ways = { sms: settings.smsLogin === true, email: settings.emailLogin === true };
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const next = safeNext(String(form.get('next') ?? ''));
  const typed = String(form.get('contact') ?? '').slice(0, 254);
  const contact = contactOf(typed);
  if (!contact) return { step: 'contact', contact: typed, error: contactWrong(ways.sms, ways.email) };
  if (intent === 'send-code') {
    const sent = await sendCode(request, contact, ways);
    return sent.error && !sent.wait ? { step: 'contact', contact: contact.value, error: sent.error } : { step: 'code', contact: contact.value, error: sent.error || undefined };
  }
  if (intent === 'reset') {
    const verified = await verifyCode(request, contact, form.get('code'));
    if (!verified.proof) return { step: 'code', contact: contact.value, error: verified.error, field: 'code' };
    const answer = await accountCall<SessionAnswer>(request, 'POST', '/auth/reset-password', {
      ...proofFields(contact, verified.proof), password: String(form.get('password') ?? '').slice(0, 200),
    });
    if (answer.data) return redirect(next, { headers: { 'Set-Cookie': sessionCookie(answer.data.sessionToken) } });
    // the code was used by the check above: a refused password asks for a new code
    return { step: 'contact', contact: contact.value, error: answer.error, field: answer.field };
  }
  return { step: 'contact', contact: contact.value };
}

export default function ForgotPasswordPage({ loaderData, actionData }: Route.ComponentProps) {
  const { smsLogin, emailLogin, next } = loaderData;
  const answer = actionData as ActionAnswer | undefined;
  const busy = useNavigation().state === 'submitting';
  const step: Step = answer?.step === 'code' ? 'code' : 'contact';
  const sentBy = answer?.contact?.includes('@') ? 'به ایمیل' : 'با پیامک به';

  if (!smsLogin && !emailLogin) {
    return (
      <AccountShell title="فراموشی رمز" intro="گذاشتن رمز تازه اکنون از سایت ممکن نیست؛ با فروشگاه تماس بگیرید.">
        <Link to="/contact" className="inline-block min-h-11 py-2 text-base font-bold text-brand underline-offset-4 hover:underline">تماس با فروشگاه</Link>
      </AccountShell>
    );
  }
  return (
    <AccountShell title="فراموشی رمز" intro={step === 'code' ? 'کدی را که برایتان فرستاده شد و رمز تازه را بنویسید.' : `${contactLabel(smsLogin, emailLogin)} حساب خود را بنویسید تا کد برایتان فرستاده شود.`}>
      {step === 'contact' && (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="next" value={next} />
          <FormError message={answer?.error} />
          <ContactField label={contactLabel(smsLogin, emailLogin)} ways={{ sms: smsLogin, email: emailLogin }} defaultValue={answer?.contact} autoFocus />
          <SubmitButton intent="send-code" busy={busy}>فرستادن کد</SubmitButton>
        </Form>
      )}
      {step === 'code' && answer && (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="contact" value={answer.contact} />
          {answer.error ? <FormError message={answer.error} /> : <FormNote>{`کد ${sentBy} `}<span dir="ltr">{answer.contact}</span>{' فرستاده شد.'}</FormNote>}
          <CodeField byEmail={answer.contact.includes('@')} />
          <Field label="رمز تازه" name="password" type="password" autoComplete="new-password" dir="ltr" maxLength={200} hint="دست‌کم هشت نویسه، و نه خود شمارهٔ همراه." />
          <SubmitButton intent="reset" busy={busy}>گذاشتن رمز تازه</SubmitButton>
          <SubmitButton intent="send-code" busy={busy} secondary>کد نرسید؟ دوباره بفرست</SubmitButton>
        </Form>
      )}
      <p className="text-base leading-8 text-muted-foreground">
        رمز یادتان آمد؟ <Link to="/account/sign-in" className="font-bold text-brand underline-offset-4 hover:underline">ورود</Link>
      </p>
    </AccountShell>
  );
}
