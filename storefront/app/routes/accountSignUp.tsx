import { Form, Link, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/accountSignUp';
import { publicSettings } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import {
  accountCall, clearProofCookie, crossSite, normalizePhone, proofCookie, proofOf, provenPhoneOf, safeNext, sameSite, sessionCookie, type SessionAnswer,
} from '../lib/account.server';
import {
  EMAIL_PROOF_COOKIE, clearKeptProofCookie, contactOf, contactWrong, keptProofCookie, keptProofOf, proofFields, sendCode, verifyCode,
  type Contact,
} from '../lib/contactCode.server';
import { pageMeta } from '../lib/meta';
import { contactLabel } from '../lib/contactLabel';
import { formStamp, keptStamp, trapRefusal } from '../lib/botTrap.server';
import { AccountShell, BotTrapFields, CodeField, ContactField, Field, FormError, FormNote, PhoneField, SubmitButton } from '../components/AccountForm';

/**
 * v11 phase 8.4b: making a retail account. While the ERP signs in by SMS the phone is proven first (phone, then the
 * code), and the proof waits in an httpOnly cookie while the buyer writes the name and password; the sign-up presents it.
 * While SMS is off it is one form, as in 8.2b. The ERP decides every rule (a phone with an account, a weak password).
 * v12 phase 8a (site review 2.12): the form that makes the account carries the robot trap, checked before the ERP is asked.
 */
type Step = 'contact' | 'code' | 'details';
interface ActionAnswer { step: Step; contact: string; error?: string; name?: string; stamp?: string; phone?: string }

/**
 * v12 phase 8e (start plan §5): the account is made with a phone, an email or both. The first step takes either and
 * sends its code (an SMS while `smsLogin` is on, an email while `emailLogin` is on); the proof waits in its httpOnly
 * cookie. With an email proven and the texts off, a phone may be added unproven (a contact for orders).
 */
function provenOf(request: Request): { contact: Contact; proof: string } | null {
  const phone = provenPhoneOf(request);
  if (phone) return { contact: { kind: 'phone', value: phone }, proof: proofOf(request, phone) };
  return keptProofOf(request, EMAIL_PROOF_COOKIE);
}

export async function loader({ request }: Route.LoaderArgs) {
  const settings = await publicSettings();
  return {
    smsLogin: settings.smsLogin === true,
    emailLogin: settings.emailLogin === true,
    proven: provenOf(request)?.contact ?? null,
    next: safeNext(new URL(request.url).searchParams.get('next')),
    siteUrl: siteEnv().siteUrl,
    stamp: formStamp(),
  };
}

export function meta({ data }: Route.MetaArgs) {
  return [...pageMeta({ title: 'ساختن حساب', description: 'ساختن حساب خرید در پاپیتال', path: '/account/sign-up', siteUrl: data?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

function clearProofs(headers: Headers) {
  headers.append('Set-Cookie', clearProofCookie());
  headers.append('Set-Cookie', clearKeptProofCookie(EMAIL_PROOF_COOKIE, '/account'));
}

const PROOF_EXPIRED = 'مهلت تأیید گذشت؛ دوباره کد بخواهید و تأیید کنید.';

export async function action({ request }: Route.ActionArgs): Promise<ActionAnswer | Response> {
  if (!sameSite(request)) return crossSite();
  const settings = await publicSettings();
  const ways = { sms: settings.smsLogin === true, email: settings.emailLogin === true };
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const next = safeNext(String(form.get('next') ?? ''));
  const here = `/account/sign-up${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`;
  if (intent === 'another-phone') {
    const headers = new Headers();
    clearProofs(headers);
    return redirect(here, { headers });
  }
  const typed = String(form.get('contact') ?? '').slice(0, 254);
  const contact = contactOf(typed);

  if (intent === 'send-code' || intent === 'verify-code') {
    if (!contact) return { step: 'contact', contact: typed, error: contactWrong(ways.sms, ways.email) };
    if (intent === 'send-code') {
      const sent = await sendCode(request, contact, ways);
      return sent.error && !sent.wait ? { step: 'contact', contact: contact.value, error: sent.error } : { step: 'code', contact: contact.value, error: sent.error || undefined };
    }
    const verified = await verifyCode(request, contact, form.get('code'));
    if (!verified.proof) return { step: 'code', contact: contact.value, error: verified.error };
    // review: one proof at a time, so a contact proven later is the one the sign-up uses
    const headers = new Headers();
    headers.append('Set-Cookie', contact.kind === 'phone' ? clearKeptProofCookie(EMAIL_PROOF_COOKIE, '/account') : clearProofCookie());
    headers.append('Set-Cookie', contact.kind === 'phone' ? proofCookie(contact.value, verified.proof) : keptProofCookie(EMAIL_PROOF_COOKIE, '/account', contact, verified.proof));
    return redirect(here, { headers });
  }
  if (intent === 'register') {
    const name = String(form.get('name') ?? '').slice(0, 200);
    const stamp = keptStamp(form);
    const typedPhone = String(form.get('phone') ?? '').slice(0, 20);
    const trapped = trapRefusal(form);
    if (trapped) return { step: 'details', contact: '', name, error: trapped, stamp, phone: typedPhone };
    const proven = provenOf(request);
    // with no code ways on the account is made as in 8.2b, with an unproven phone
    const extraPhone = typedPhone ? normalizePhone(typedPhone) : '';
    // with no code ways on the phone is the account's one way in, as in 8.2b
    // delta review: with a code way on and no proof kept, the proof ran out (ten minutes): ask for a new code
    if (!proven && (ways.sms || ways.email) && !typedPhone) return { step: 'contact', contact: '', error: PROOF_EXPIRED };
    if ((typedPhone && !extraPhone) || (!proven && !extraPhone)) return { step: 'details', contact: '', name, error: 'شمارهٔ همراه را درست بنویسید (مانند ۰۹۱۲۱۲۳۴۵۶۷).', stamp, phone: typedPhone };
    const body = {
      name, password: String(form.get('password') ?? '').slice(0, 200),
      ...(proven ? proofFields(proven.contact, proven.proof) : {}),
      ...(extraPhone && proven?.contact.kind !== 'phone' ? { phone: extraPhone } : {}),
    };
    const answer = await accountCall<SessionAnswer>(request, 'POST', '/auth/register', body);
    if (answer.data) {
      const headers = new Headers();
      headers.append('Set-Cookie', sessionCookie(answer.data.sessionToken));
      clearProofs(headers);
      return redirect(next, { headers });
    }
    // a proof that ran out sends the buyer back to the code
    if (answer.code === 'STOREFRONT_PHONE_PROOF_REQUIRED' || answer.code === 'STOREFRONT_EMAIL_PROOF_REQUIRED') return { step: 'contact', contact: proven?.contact.value ?? '', error: answer.error };
    return { step: 'details', contact: '', name, error: answer.error, stamp, phone: typedPhone };
  }
  return { step: 'contact', contact: contact?.value ?? typed };
}

export default function SignUpPage({ loaderData, actionData }: Route.ComponentProps) {
  const { smsLogin, emailLogin, proven, next } = loaderData;
  const codes = smsLogin || emailLogin;
  const answer = actionData as ActionAnswer | undefined;
  const busy = useNavigation().state === 'submitting';
  const step: Step = !codes ? 'details'
    : answer?.step === 'code' ? 'code'
    : answer?.step === 'contact' ? 'contact'
    : proven ? 'details' : 'contact';
  const signIn = `/account/sign-in${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`;
  const sentBy = answer?.contact?.includes('@') ? 'به ایمیل' : 'با پیامک به';

  return (
    <AccountShell
      title="ساختن حساب"
      intro="با حساب، سفارش‌هایتان را یک‌جا می‌بینید. برای خرید لازم نیست حساب بسازید."
    >
      {step === 'contact' && (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="next" value={next} />
          <FormError message={answer?.error} />
          <ContactField label={contactLabel(smsLogin, emailLogin)} ways={{ sms: smsLogin, email: emailLogin }} defaultValue={answer?.contact} autoFocus />
          <SubmitButton intent="send-code" busy={busy}>فرستادن کد تأیید</SubmitButton>
        </Form>
      )}

      {step === 'code' && answer && (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="contact" value={answer.contact} />
          {answer.error ? <FormError message={answer.error} /> : <FormNote>{`کد تأیید ${sentBy} `}<span dir="ltr">{answer.contact}</span>{' فرستاده شد.'}</FormNote>}
          <CodeField byEmail={answer.contact.includes('@')} />
          <SubmitButton intent="verify-code" busy={busy}>تأیید</SubmitButton>
          <SubmitButton intent="send-code" busy={busy} secondary>کد نرسید؟ دوباره بفرست</SubmitButton>
        </Form>
      )}

      {step === 'details' && (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="next" value={next} />
          <FormError message={answer?.error} />
          <BotTrapFields stamp={answer?.stamp ?? loaderData.stamp} />
          {codes && proven && <FormNote>{`${proven.kind === 'phone' ? 'شمارهٔ' : 'ایمیل'} `}<span dir="ltr">{proven.value}</span>{' تأیید شد.'}</FormNote>}
          {/* no code ways: the phone as in 8.2b; an email proven with the texts off: a phone may go beside it, unproven */}
          {(!codes || (proven?.kind === 'email' && !smsLogin)) && <PhoneField defaultValue={answer?.phone} />}
          <Field label="نام و نام خانوادگی" name="name" autoComplete="name" maxLength={120} defaultValue={answer?.name} autoFocus={codes} />
          <Field label="رمز" name="password" type="password" autoComplete="new-password" dir="ltr" maxLength={200}
            hint={proven?.kind === 'email' ? 'دست‌کم هشت نویسه.' : 'دست‌کم هشت نویسه، و نه خود شمارهٔ همراه.'} />
          <SubmitButton intent="register" busy={busy}>ساختن حساب</SubmitButton>
          {codes && <SubmitButton intent="another-phone" busy={busy} secondary>{proven?.kind === 'email' ? 'ایمیل یا شمارهٔ دیگری دارم' : 'شمارهٔ دیگری دارم'}</SubmitButton>}
        </Form>
      )}

      <p className="text-base leading-8 text-muted-foreground">
        حساب دارید؟ <Link to={signIn} className="font-bold text-brand underline-offset-4 hover:underline">ورود</Link>
      </p>
    </AccountShell>
  );
}
