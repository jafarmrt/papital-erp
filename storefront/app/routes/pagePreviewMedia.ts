import type { Route } from './+types/pagePreviewMedia';
import { pagePreviewMedia } from '../lib/api.server';

/**
 * v12 phase 10c: an image of a draft being previewed, read from the ERP under the preview's key each time. It is not
 * an image of the site: nothing may keep it, and a search engine is told not to list it.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const upstream = await pagePreviewMedia(params.token, params.file);
  if (!upstream) throw new Response('پیدا نشد', { status: 404 });
  return new Response(upstream, {
    headers: {
      'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
