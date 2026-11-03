import type { Route } from './+types/brandImage';
import { brand } from '../lib/api.server';
import { decodeDataUrl } from '../lib/brandImage.server';

/**
 * The logo or browser icon the owner set in the ERP («فروشگاه سایت» → «لوگو و آیکون»). An SVG opened on its own
 * runs nothing: the answer forbids every script and sandboxes the document.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
  if (params.kind !== 'logo' && params.kind !== 'favicon') throw new Response('پیدا نشد', { status: 404 });
  const image = decodeDataUrl((await brand())[params.kind]);
  if (!image) throw new Response('پیدا نشد', { status: 404 });
  const versioned = new URL(request.url).searchParams.has('v');
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.type,
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
