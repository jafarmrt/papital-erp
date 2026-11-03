import { useEffect, useState } from 'react';
import { Form, Link, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/accountSetPassword';
import { siteEnv } from '../lib/site.server';
import { accountCall, crossSite, sameSite, sessionCookie, type SessionAnswer } from '../lib/account.server';
import { pageMeta } from '../lib/meta';
import { AccountShell, Field, FormError, SubmitButton } from '../components/AccountForm';

/**
 * v11 phase 8.4b: the page of the one-time set-password link a colleague sends (8.2b, `…/account/set-password#pw_…`).
 * The key is after `#`, so it never reaches this server's log or the browser's Referer; the page copies it into the form
 * once it runs in the browser, and the form sends it with the new password. A used or expired link is the ERP's 404.
 */
const LINK_KEY = /^pw_[A-Za-z0-9_-]{8,200}$/;

export function loader() {
  return { siteUrl: siteEnv().siteUrl };
}

export function meta({ data }: Route.MetaArgs) {
  return [...pageMeta({ title: 'گذاشتن رمز حساب', description: 'گذاشتن رمز حساب خرید در پاپیتال', path: '/account/set-password', siteUrl: data?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

export async function action({ request }: Route.ActionArgs) {
  if (!sameSite(request)) return crossSite();
  const form = await request.formData();
  const token = String(form.get('token') ?? '');
  if (!LINK_KEY.test(token)) return { error: 'پیوند کامل باز نشده است؛ پیوندی را که فروشگاه فرستاده، کامل باز کنید.' };
  const answer = await accountCall<SessionAnswer>(request, 'POST', '/auth/set-password', { token, password: String(form.get('password') ?? '').slice(0, 200) });
  if (answer.data) return redirect('/', { headers: { 'Set-Cookie': sessionCookie(answer.data.sessionToken) } });
  return { error: answer.error };
}

export default function SetPasswordPage({ actionData }: Route.ComponentProps) {
  const [token, setToken] = useState('');
  const [read, setRead] = useState(false);
  const busy = useNavigation().state === 'submitting';
  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#/, '');
    setToken(LINK_KEY.test(fromHash) ? fromHash : '');
    setRead(true);
  }, []);

  return (
    <AccountShell title="گذاشتن رمز حساب" intro="رمزی برای حساب خود بگذارید. پس از آن با شمارهٔ همراه و همین رمز وارد می‌شوید.">
      <noscript>
        <p className="rounded-control border border-border bg-card px-4 py-3 text-sm leading-7">برای این صفحه، جاوااسکریپت مرورگر را روشن کنید.</p>
      </noscript>
      {read && !token ? (
        <FormError message="این پیوند کامل نیست؛ پیوندی را که فروشگاه فرستاده، کامل باز کنید یا پیوند تازه بخواهید." />
      ) : (
        <Form method="post" className="space-y-5" replace>
          <input type="hidden" name="token" value={token} />
          <FormError message={actionData?.error} />
          <Field label="رمز تازه" name="password" type="password" autoComplete="new-password" dir="ltr" maxLength={200} autoFocus
            hint="دست‌کم هشت نویسه، و نه خود شمارهٔ همراه." />
          <SubmitButton busy={busy || !token}>گذاشتن رمز و ورود</SubmitButton>
        </Form>
      )}
      <p className="text-base leading-8 text-muted-foreground">
        <Link to="/account/sign-in" className="font-bold text-brand underline-offset-4 hover:underline">ورود به حساب</Link>
      </p>
    </AccountShell>
  );
}
