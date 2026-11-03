import type { Route } from './+types/brandImage';
import { brand } from '../lib/api.server';
import { decodeDataUrl, imageVersion } from '../lib/brandImage.server';

/**
 * The logo or browser icon the owner set in the ERP («فروشگاه سایت» → «لوگو و آیکون»). An SVG opened on its own
 * runs nothing: the answer forbids every script and sandboxes the document.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
  if (params.kind !== 'logo' && params.kind !== 'favicon') throw new Response('پیدا نشد', { status: 404 });
  const dataUrl = (await brand())[params.kind];
  const image = decodeDataUrl(dataUrl);
  if (!image) throw new Response('پیدا نشد', { status: 404 });
  // kept for a year only under the current image's own version; an old or made-up ?v= is kept briefly
  const versioned = new URL(request.url).searchParams.get('v') === imageVersion(dataUrl);
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.type,
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
