import { siteEnv } from '../lib/site.server';

/** Search engines may read every page and image (the logo too: the shop's structured data points at it); a preview or test address is shut whole */
export function loader() {
  const { siteUrl, indexable } = siteEnv();
  const body = indexable
    ? ['User-agent: *', 'Allow: /', 'Disallow: /healthz', '', `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n')
    : ['User-agent: *', 'Disallow: /', ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
