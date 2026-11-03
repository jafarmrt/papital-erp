// The storefront's production server: static files of the build, then every other request to React Router.
// It listens on STOREFRONT_PORT (default 3100) on the loopback; the web server in front serves papitalgallery.com.
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createRequestListener } from '@react-router/node';

const port = Number(process.env.STOREFRONT_PORT ?? 3100);
const host = process.env.STOREFRONT_HOST ?? '127.0.0.1';
if (!process.env.STOREFRONT_API_KEY) {
  console.error('STOREFRONT_API_KEY is not set: make a key in the ERP («فروشگاه سایت» tab) and give it to this server.');
  process.exit(1);
}
// The web server in front ends https and talks plain http to this one, so a form's `Origin` (https://papitalgallery.com)
// never matches the request's own address (http://…): React Router refuses such a post as a forged one unless the site's
// host is named as an allowed origin. Another site's post is still refused (its host is not the site's).
const siteHost = (() => {
  try {
    return new URL(process.env.STOREFRONT_SITE_URL ?? '').host;
  } catch {
    return '';
  }
})();
const build = { ...(await import('./build/server/index.js')), ...(siteHost ? { allowedActionOrigins: [siteHost] } : {}) };
const client = fileURLToPath(new URL('./build/client', import.meta.url));

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // everything the pages load comes from this site; the inline scripts are React Router's hydration data and JSON-LD
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});
// file names under /assets carry their content hash
app.use('/assets', express.static(`${client}/assets`, { immutable: true, maxAge: '1y', index: false }));
app.use(express.static(client, { maxAge: '7d', index: false }));
app.all('/{*path}', createRequestListener({ build, mode: process.env.NODE_ENV ?? 'production' }));

app.listen(port, host, () => console.log(`storefront listening on http://${host}:${port}`));
