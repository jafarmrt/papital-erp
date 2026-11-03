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
const build = await import('./build/server/index.js');
const client = fileURLToPath(new URL('./build/client', import.meta.url));

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
// file names under /assets carry their content hash
app.use('/assets', express.static(`${client}/assets`, { immutable: true, maxAge: '1y', index: false }));
app.use(express.static(client, { maxAge: '7d', index: false }));
app.all('/{*path}', createRequestListener({ build, mode: process.env.NODE_ENV ?? 'production' }));

app.listen(port, host, () => console.log(`storefront listening on http://${host}:${port}`));
