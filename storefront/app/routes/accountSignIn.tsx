import { Form, Link, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/accountSignIn';
import { publicSettings } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import {
  accountCall, clearProofCookie, crossSite, normalizePhone, proofCookie, safeNext, sameSite, sessionCookie, type SessionAnswer,
} from '../lib/account.server';
import { pageMeta } from '../lib/meta';
import { AccountShell, CodeField, Field, FormError, FormNote, PhoneField, SubmitButton } from '../components/AccountForm';

/**
 * v11 phase 8.4b: signing in. While the ERP signs buyers in by SMS (`smsLogin`), the page asks for the phone, sends a
 * code and signs in with the phone proof the code gives; a phone without an account goes on to the sign-up with the proof
 * kept. Signing in with the password stays beside it (and is the only way while SMS is off). Every step is a plain form
 * the server answers, so it works without JavaScript.
 */
type Step = 'phone' | 'code';
interface ActionAnswer { step: Step; phone: string; error?: string; password?: boolean }

export async function loader({ request }: Route.LoaderArgs) {
  const settings = await publicSettings();
  return { smsLogin: settings.smsLogin === true, next: safeNext(new URL(request.url).searchParams.get('next')), siteUrl: siteEnv().siteUrl };
}

export function meta({ data }: Route.MetaArgs) {
  return [...pageMeta({ title: 'ورود به حساب', description: 'ورود به حساب خرید در پاپیتال', path: '/account/sign-in', siteUrl: data?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

function signedIn(token: string, next: string) {
  const headers = new Headers();
  headers.append('Set-Cookie', sessionCookie(token));
  headers.append('Set-Cookie', clearProofCookie());
  return redirect(next, { headers });
}

const PHONE_WRONG = 'شمارهٔ همراه را درست بنویسید (مانند ۰۹۱۲۱۲۳۴۵۶۷).';

export async function action({ request }: Route.ActionArgs): Promise<ActionAnswer | Response> {
  if (!sameSite(request)) return crossSite();
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const next = safeNext(String(form.get('next') ?? ''));
  const typed = String(form.get('phone') ?? '').slice(0, 20);
  const phone = normalizePhone(typed);
  if (!phone) return { step: 'phone', phone: typed, error: PHONE_WRONG, password: intent === 'password' };

  if (intent === 'password') {
    const answer = await accountCall<SessionAnswer>(request, 'POST', '/auth/login', { phone, password: String(form.get('password') ?? '').slice(0, 200) });
    if (answer.data) return signedIn(answer.data.sessionToken, next);
    return { step: 'phone', phone, error: answer.error, password: true };
  }
  if (intent === 'send-code') {
    const answer = await accountCall(request, 'POST', '/auth/otp/request', { phone });
    if (answer.status !== 202) return { step: 'phone', phone, error: answer.error };
    return { step: 'code', phone };
  }
  if (intent === 'verify-code') {
    const verified = await accountCall<{ phoneProof: string }>(request, 'POST', '/auth/otp/verify', { phone, code: String(form.get('code') ?? '').slice(0, 12) });
    if (!verified.data) return { step: 'code', phone, error: verified.error };
    const proof = verified.data.phoneProof;
    const login = await accountCall<SessionAnswer>(request, 'POST', '/auth/sms-login', { phone, phoneProof: proof });
    if (login.data) return signedIn(login.data.sessionToken, next);
    if (login.code === 'STOREFRONT_ACCOUNT_NOT_FOUND') {
      // the phone is proven but has no account: the sign-up takes the same proof, kept in an httpOnly cookie
      return redirect(`/account/sign-up?next=${encodeURIComponent(next)}`, { headers: { 'Set-Cookie': proofCookie(phone, proof) } });
    }
    return { step: 'phone', phone, error: login.error };
  }
  return { step: 'phone', phone };
}

export default function SignInPage({ loaderData, actionData }: Route.ComponentProps) {
  const { smsLogin, next } = loaderData;
  const answer = actionData as ActionAnswer | undefined;
  const busy = useNavigation().state === 'submitting';
  const step: Step = smsLogin && answer?.step === 'code' ? 'code' : 'phone';
  const signUp = `/account/sign-up${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <AccountShell
      title="ورود به حساب"
      intro={step === 'code' ? 'کدی را که پیامک شد بنویسید.' : smsLogin ? 'شمارهٔ همراه خود را بنویسید تا کد ورود برایتان پیامک شود.' : 'با شمارهٔ همراه و رمز حساب خود وارد شوید.'}
    >
      {smsLogin && step === 'phone' && (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="next" value={next} />
          {!answer?.password && <FormError message={answer?.error} />}
          <PhoneField defaultValue={answer?.phone} autoFocus />
          <SubmitButton intent="send-code" busy={busy}>فرستادن کد ورود</SubmitButton>
        </Form>
      )}

      {step === 'code' && answer && (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="phone" value={answer.phone} />
          {answer.error ? <FormError message={answer.error} /> : <FormNote>کد ورود به <span dir="ltr">{answer.phone}</span> پیامک شد.</FormNote>}
          <CodeField />
          <SubmitButton intent="verify-code" busy={busy}>ورود</SubmitButton>
          <SubmitButton intent="send-code" busy={busy} secondary>کد نرسید؟ دوباره بفرست</SubmitButton>
        </Form>
      )}

      {step === 'phone' && (
        <details open={!smsLogin || answer?.password} className="rounded-surface border border-border bg-card p-4">
          <summary className="min-h-11 cursor-pointer py-2 text-base font-bold">{smsLogin ? 'ورود با رمز' : 'شمارهٔ همراه و رمز'}</summary>
          <Form method="post" className="mt-4 space-y-5" replace>
            <input type="hidden" name="next" value={next} />
            {answer?.password && <FormError message={answer.error} />}
            <PhoneField defaultValue={answer?.phone} />
            <Field label="رمز" name="password" type="password" autoComplete="current-password" dir="ltr" maxLength={200} />
            <SubmitButton intent="password" busy={busy}>ورود با رمز</SubmitButton>
          </Form>
        </details>
      )}

      <p className="text-base leading-8 text-muted-foreground">
        حساب ندارید؟ <Link to={signUp} className="font-bold text-brand underline-offset-4 hover:underline">ساختن حساب</Link>
      </p>
    </AccountShell>
  );
}
