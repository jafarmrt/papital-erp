import { redirect } from 'react-router';
import type { Route } from './+types/accountSignOut';
import { accountCall, clearProofCookie, clearSessionCookie, crossSite, sameSite, sessionOf } from '../lib/account.server';

/**
 * v11 phase 8.4b: signing out is a POST (a link or an image elsewhere cannot sign a buyer out); the ERP ends the session
 * and the cookies (session, and a phone proof still waiting) are cleared whatever it answered.
 */
export async function action({ request }: Route.ActionArgs) {
  if (!sameSite(request)) return crossSite();
  if (sessionOf(request)) await accountCall(request, 'POST', '/auth/logout');
  const headers = new Headers();
  headers.append('Set-Cookie', clearSessionCookie());
  headers.append('Set-Cookie', clearProofCookie());
  return redirect('/', { headers });
}

export function loader() {
  return redirect('/');
}
