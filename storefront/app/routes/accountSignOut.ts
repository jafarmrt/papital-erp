import { redirect } from 'react-router';
import type { Route } from './+types/accountSignOut';
import { accountCall, clearSessionCookie, sessionOf } from '../lib/account.server';

/**
 * v11 phase 8.4b: signing out is a POST (a link or an image elsewhere cannot sign a buyer out); the ERP ends the session
 * and the cookie is cleared whatever it answered.
 */
export async function action({ request }: Route.ActionArgs) {
  if (sessionOf(request)) await accountCall(request, 'POST', '/auth/logout');
  return redirect('/', { headers: { 'Set-Cookie': clearSessionCookie() } });
}

export function loader() {
  return redirect('/');
}
