import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('products', 'routes/products.tsx', { id: 'products' }),
  route('collections/:name', 'routes/products.tsx', { id: 'collection' }),
  route('p/:slug', 'routes/product.tsx'),
  route('media/:file', 'routes/media.ts'),
  route('brand/:kind', 'routes/brandImage.ts'),
  route('healthz', 'routes/healthz.ts'),
  route('robots.txt', 'routes/robots.ts'),
  route('sitemap.xml', 'routes/sitemap.ts'),
  route('manifest.webmanifest', 'routes/manifest.ts'),
  route('sw.js', 'routes/serviceWorker.ts'),
  ...(['about', 'contact', 'shipping', 'terms', 'privacy'] as const).map(slug => route(slug, 'routes/info.tsx', { id: `info-${slug}` })),
  // v11 phase 8.4b: sign-in, sign-up, the set-password link and sign-out (the /account area itself is 8.2b's)
  route('account/sign-in', 'routes/accountSignIn.tsx'),
  route('account/sign-up', 'routes/accountSignUp.tsx'),
  route('account/set-password', 'routes/accountSetPassword.tsx'),
  route('account/sign-out', 'routes/accountSignOut.ts'),
  route('*', 'routes/notFound.tsx'),
] satisfies RouteConfig;
