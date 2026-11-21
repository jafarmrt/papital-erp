import type { Route } from './+types/media';
import { mediaFile } from '../lib/api.server';

/** An image of a product, a campaign page or a published page, read from the ERP (and kept in memory); its name is its content hash, so the browser and any cache may keep it */
export async function loader({ params }: Route.LoaderArgs) {
  const upstream = await mediaFile(params.file);
  if (!upstream) throw new Response('پیدا نشد', { status: 404 });
  return new Response(upstream, {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
