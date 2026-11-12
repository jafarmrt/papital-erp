import { Form, Link, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/accountSignIn';
import { publicSettings } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import { accountCall, clearProofCookie, crossSite, proofCookie, safeNext, sameSite, sessionCookie, type SessionAnswer } from '../lib/account.server';
import {
  EMAIL_PROOF_COOKIE, clearKeptProofCookie, contactOf, contactWrong, keptProofCookie, sendCode, verifyCode,
} from '../lib/contactCode.server';
import { pageMeta } from '../lib/meta';
import { contactLabel } from '../lib/contactLabel';
import { AccountShell, CodeField, ContactField, Field, FormError, FormNote, SubmitButton } from '../components/AccountForm';

/**
 * v11 phase 8.4b: signing in. While the ERP signs buyers in by SMS (`smsLogin`), the page asks for the phone, sends a
 * code and signs in with the phone proof the code gives; a phone without an account goes on to the sign-up with the proof
 * kept. Signing in with the password stays beside it (and is the only way while SMS is off). Every step is a plain form
 * the server answers, so it works without JavaScript.
 *
 * v12 phase 8e (start plan §5): the field takes a phone or an email. A code goes by SMS to a phone while `smsLogin` is
 * on and by email to an email while `emailLogin` is on («حالت بی پیامک» leads with email); the password signs in by
 * either. «رمز را فراموش کرده‌اید؟» leads to the forgotten-password page.
 */
type Step = 'contact' | 'code';
interface ActionAnswer { step: Step; contact: string; error?: string; password?: boolean }

export async function loader({ request }: Route.LoaderArgs) {
  const settings = await publicSettings();
  return {
    smsLogin: settings.smsLogin === true, emailLogin: settings.emailLogin === true,
    next: safeNext(new URL(request.url).searchParams.get('next')), siteUrl: siteEnv().siteUrl,
  };
}

export function meta({ data }: Route.MetaArgs) {
  return [...pageMeta({ title: 'ورود به حساب', description: 'ورود به حساب خرید در پاپیتال', path: '/account/sign-in', siteUrl: data?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

function signedIn(token: string, next: string) {
  const headers = new Headers();
  headers.append('Set-Cookie', sessionCookie(token));
  headers.append('Set-Cookie', clearProofCookie());
  headers.append('Set-Cookie', clearKeptProofCookie(EMAIL_PROOF_COOKIE, '/account'));
  return redirect(next, { headers });
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
  // the password signs in by a phone or an email, whatever the code ways
  if (!contact) return { step: 'contact', contact: typed, error: contactWrong(ways.sms || intent === 'password', ways.email || intent === 'password'), password: intent === 'password' };

  if (intent === 'password') {
    const by = contact.kind === 'phone' ? { phone: contact.value } : { email: contact.value };
    const answer = await accountCall<SessionAnswer>(request, 'POST', '/auth/login', { ...by, password: String(form.get('password') ?? '').slice(0, 200) });
    if (answer.data) return signedIn(answer.data.sessionToken, next);
    return { step: 'contact', contact: contact.value, error: answer.error, password: true };
  }
  if (intent === 'send-code') {
    const refused = await sendCode(request, contact, ways);
    return refused ? { step: 'contact', contact: contact.value, error: refused } : { step: 'code', contact: contact.value };
  }
  if (intent === 'verify-code') {
    const verified = await verifyCode(request, contact, form.get('code'));
    if (!verified.proof) return { step: 'code', contact: contact.value, error: verified.error };
    const login = contact.kind === 'phone'
      ? await accountCall<SessionAnswer>(request, 'POST', '/auth/sms-login', { phone: contact.value, phoneProof: verified.proof })
      : await accountCall<SessionAnswer>(request, 'POST', '/auth/email-login', { email: contact.value, emailProof: verified.proof });
    if (login.data) return signedIn(login.data.sessionToken, next);
    if (login.code === 'STOREFRONT_ACCOUNT_NOT_FOUND') {
      // the contact is proven but has no account: the sign-up takes the same proof, kept in an httpOnly cookie
      const kept = contact.kind === 'phone' ? proofCookie(contact.value, verified.proof) : keptProofCookie(EMAIL_PROOF_COOKIE, '/account', contact, verified.proof);
      return redirect(`/account/sign-up?next=${encodeURIComponent(next)}`, { headers: { 'Set-Cookie': kept } });
    }
    return { step: 'contact', contact: contact.value, error: login.error };
  }
  return { step: 'contact', contact: contact.value };
}

export default function SignInPage({ loaderData, actionData }: Route.ComponentProps) {
  const { smsLogin, emailLogin, next } = loaderData;
  const codes = smsLogin || emailLogin;
  const answer = actionData as ActionAnswer | undefined;
  const busy = useNavigation().state === 'submitting';
  const step: Step = codes && answer?.step === 'code' ? 'code' : 'contact';
  const signUp = `/account/sign-up${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`;
  const sentBy = answer?.contact.includes('@') ? 'به ایمیل' : 'با پیامک به';

  return (
    <AccountShell
      title="ورود به حساب"
      intro={step === 'code' ? 'کدی را که برایتان فرستاده شد بنویسید.' : codes ? `${contactLabel(smsLogin, emailLogin)} خود را بنویسید تا کد ورود برایتان فرستاده شود.` : 'با شمارهٔ همراه یا ایمیل و رمز حساب خود وارد شوید.'}
    >
      {codes && step === 'contact' && (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="next" value={next} />
          {!answer?.password && <FormError message={answer?.error} />}
          <ContactField label={contactLabel(smsLogin, emailLogin)} defaultValue={answer?.contact} autoFocus />
          <SubmitButton intent="send-code" busy={busy}>فرستادن کد ورود</SubmitButton>
        </Form>
      )}

      {step === 'code' && answer && (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="contact" value={answer.contact} />
          {answer.error ? <FormError message={answer.error} /> : <FormNote>کد ورود {sentBy} <span dir="ltr">{answer.contact}</span> فرستاده شد.</FormNote>}
          <CodeField />
          <SubmitButton intent="verify-code" busy={busy}>ورود</SubmitButton>
          <SubmitButton intent="send-code" busy={busy} secondary>کد نرسید؟ دوباره بفرست</SubmitButton>
        </Form>
      )}

      {step === 'contact' && (
        <details open={!codes || answer?.password} className="rounded-surface border border-border bg-card p-4">
          <summary className="min-h-11 cursor-pointer py-2 text-base font-bold">{codes ? 'ورود با رمز' : 'شمارهٔ همراه یا ایمیل و رمز'}</summary>
          <Form method="post" className="mt-4 space-y-5" replace>
            <input type="hidden" name="next" value={next} />
            {answer?.password && <FormError message={answer.error} />}
            <ContactField label="شمارهٔ همراه یا ایمیل" defaultValue={answer?.contact} />
            <Field label="رمز" name="password" type="password" autoComplete="current-password" dir="ltr" maxLength={200} />
            <SubmitButton intent="password" busy={busy}>ورود با رمز</SubmitButton>
          </Form>
          {codes && <Link to="/account/forgot-password" className="mt-3 inline-block min-h-11 py-2 text-base font-bold text-brand underline-offset-4 hover:underline">رمز را فراموش کرده‌اید؟</Link>}
        </details>
      )}

      <p className="text-base leading-8 text-muted-foreground">
        حساب ندارید؟ <Link to={signUp} className="font-bold text-brand underline-offset-4 hover:underline">ساختن حساب</Link>
      </p>
    </AccountShell>
  );
}
