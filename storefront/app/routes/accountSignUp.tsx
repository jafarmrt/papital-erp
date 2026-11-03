import { Form, Link, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/accountSignUp';
import { publicSettings } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import {
  accountCall, clearProofCookie, normalizePhone, proofCookie, proofOf, provenPhoneOf, safeNext, sessionCookie, type SessionAnswer,
} from '../lib/account.server';
import { pageMeta } from '../lib/meta';
import { AccountShell, CodeField, Field, FormError, FormNote, PhoneField, SubmitButton } from '../components/AccountForm';

/**
 * v11 phase 8.4b: making a retail account. While the ERP signs in by SMS the phone is proven first (phone, then the
 * code), and the proof waits in an httpOnly cookie while the buyer writes the name and password; the sign-up presents it.
 * While SMS is off it is one form, as in 8.2b. The ERP decides every rule (a phone with an account, a weak password).
 */
type Step = 'phone' | 'code' | 'details';
interface ActionAnswer { step: Step; phone: string; error?: string; name?: string }

export async function loader({ request }: Route.LoaderArgs) {
  const settings = await publicSettings();
  return {
    smsLogin: settings.smsLogin === true,
    provenPhone: provenPhoneOf(request),
    next: safeNext(new URL(request.url).searchParams.get('next')),
    siteUrl: siteEnv().siteUrl,
  };
}

export function meta({ data }: Route.MetaArgs) {
  return [...pageMeta({ title: 'ساختن حساب', description: 'ساختن حساب خرید در پاپیتال', path: '/account/sign-up', siteUrl: data?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

const PHONE_WRONG = 'شمارهٔ همراه را درست بنویسید (مانند ۰۹۱۲۱۲۳۴۵۶۷).';

export async function action({ request }: Route.ActionArgs): Promise<ActionAnswer | Response> {
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const next = safeNext(String(form.get('next') ?? ''));
  const typed = String(form.get('phone') ?? '').slice(0, 20);
  const phone = normalizePhone(typed);
  const here = `/account/sign-up${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`;
  if (intent === 'another-phone') return redirect(here, { headers: { 'Set-Cookie': clearProofCookie() } });
  if (!phone) return { step: intent === 'register' ? 'details' : 'phone', phone: typed, error: PHONE_WRONG };

  if (intent === 'send-code') {
    const answer = await accountCall(request, 'POST', '/auth/otp/request', { phone });
    if (answer.status !== 202) return { step: 'phone', phone, error: answer.error };
    return { step: 'code', phone };
  }
  if (intent === 'verify-code') {
    const verified = await accountCall<{ phoneProof: string }>(request, 'POST', '/auth/otp/verify', { phone, code: String(form.get('code') ?? '').slice(0, 12) });
    if (!verified.data) return { step: 'code', phone, error: verified.error };
    return redirect(here, { headers: { 'Set-Cookie': proofCookie(phone, verified.data.phoneProof) } });
  }
  if (intent === 'register') {
    const name = String(form.get('name') ?? '').slice(0, 200);
    const proof = proofOf(request, phone);
    const answer = await accountCall<SessionAnswer>(request, 'POST', '/auth/register', {
      name, phone, password: String(form.get('password') ?? '').slice(0, 200), ...(proof ? { phoneProof: proof } : {}),
    });
    if (answer.data) {
      const headers = new Headers();
      headers.append('Set-Cookie', sessionCookie(answer.data.sessionToken));
      headers.append('Set-Cookie', clearProofCookie());
      return redirect(next, { headers });
    }
    // a proof that ran out sends the buyer back to the code
    if (answer.code === 'STOREFRONT_PHONE_PROOF_REQUIRED') return { step: 'phone', phone, error: answer.error };
    return { step: 'details', phone, name, error: answer.error };
  }
  return { step: 'phone', phone };
}

export default function SignUpPage({ loaderData, actionData }: Route.ComponentProps) {
  const { smsLogin, provenPhone, next } = loaderData;
  const answer = actionData as ActionAnswer | undefined;
  const busy = useNavigation().state === 'submitting';
  const step: Step = !smsLogin ? 'details'
    : answer?.step === 'code' ? 'code'
    : answer?.step === 'phone' ? 'phone'
    : provenPhone ? 'details' : 'phone';
  const phone = step === 'details' && smsLogin ? provenPhone || answer?.phone || '' : answer?.phone ?? '';
  const signIn = `/account/sign-in${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <AccountShell
      title="ساختن حساب"
      intro="با حساب، سفارش‌هایتان را یک‌جا می‌بینید. برای خرید لازم نیست حساب بسازید."
    >
      {step === 'phone' && (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="next" value={next} />
          <FormError message={answer?.error} />
          <PhoneField defaultValue={answer?.phone} autoFocus />
          <SubmitButton intent="send-code" busy={busy}>فرستادن کد تأیید</SubmitButton>
        </Form>
      )}

      {step === 'code' && (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="phone" value={phone} />
          {answer?.error ? <FormError message={answer.error} /> : <FormNote>کد تأیید به <span dir="ltr">{phone}</span> پیامک شد.</FormNote>}
          <CodeField />
          <SubmitButton intent="verify-code" busy={busy}>تأیید شماره</SubmitButton>
          <SubmitButton intent="send-code" busy={busy} secondary>کد نرسید؟ دوباره بفرست</SubmitButton>
        </Form>
      )}

      {step === 'details' && (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="next" value={next} />
          <FormError message={answer?.error} />
          {smsLogin ? (
            <>
              <input type="hidden" name="phone" value={phone} />
              <FormNote>شمارهٔ <span dir="ltr">{phone}</span> تأیید شد.</FormNote>
            </>
          ) : (
            <PhoneField defaultValue={answer?.phone} />
          )}
          <Field label="نام و نام خانوادگی" name="name" autoComplete="name" maxLength={120} defaultValue={answer?.name} autoFocus={smsLogin} />
          <Field label="رمز" name="password" type="password" autoComplete="new-password" dir="ltr" maxLength={200}
            hint="دست‌کم هشت نویسه، و نه خود شمارهٔ همراه." />
          <SubmitButton intent="register" busy={busy}>ساختن حساب</SubmitButton>
          {smsLogin && <SubmitButton intent="another-phone" busy={busy} secondary>شمارهٔ دیگری دارم</SubmitButton>}
        </Form>
      )}

      <p className="text-base leading-8 text-muted-foreground">
        حساب دارید؟ <Link to={signIn} className="font-bold text-brand underline-offset-4 hover:underline">ورود</Link>
      </p>
    </AccountShell>
  );
}
