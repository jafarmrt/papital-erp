import type { Route } from './+types/notFound';
import { legacyRedirect } from '../lib/legacyRedirect.server';

/** No page of the site: an old WooCommerce address goes to its new page (phase 8.5), anything else is the 404 */
export async function loader({ request }: Route.LoaderArgs) {
  const moved = await legacyRedirect(request);
  if (moved) throw moved;
  throw new Response('پیدا نشد', { status: 404 });
}

export default function NotFound() {
  return null;
}
