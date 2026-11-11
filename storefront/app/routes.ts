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
  // v11 phase 8.5b: the product feed (Google's format)
  route('feeds/google.xml', 'routes/feedGoogle.ts'),
  route('manifest.webmanifest', 'routes/manifest.ts'),
  route('sw.js', 'routes/serviceWorker.ts'),
  ...(['about', 'contact', 'shipping', 'terms', 'privacy'] as const).map(slug => route(slug, 'routes/info.tsx', { id: `info-${slug}` })),
  // v11 phase 8.4b: sign-in, sign-up, the set-password link and sign-out (the /account area itself is 8.2b's)
  route('account/sign-in', 'routes/accountSignIn.tsx'),
  route('account/sign-up', 'routes/accountSignUp.tsx'),
  route('account/set-password', 'routes/accountSetPassword.tsx'),
  route('account/sign-out', 'routes/accountSignOut.ts'),
  // v11 phase 8.2: the cart, the checkout, an order's page and the account's own orders
  route('account', 'routes/account.tsx'),
  route('cart', 'routes/cart.tsx'),
  route('checkout', 'routes/checkout.tsx'),
  route('orders/track', 'routes/orderTrack.tsx'),
  route('orders/:number', 'routes/order.tsx'),
  // v11 phase 8.2c: the corporate gift form (a CRM lead in the ERP)
  route('corporate-gift', 'routes/corporateGift.tsx'),
  // v11 phase 8.5b: «صفحه‌های ویژه», the campaign and occasion pages (Yalda first)
  route('campaigns/:slug', 'routes/campaign.tsx'),
  // v12 phase 8a: the phone's bottom bar (دسته‌ها، جست‌وجو) and «درخواست خرید عمده» (site review 2.3)
  route('categories', 'routes/categories.tsx'),
  route('search', 'routes/search.tsx'),
  route('wholesale', 'routes/wholesale.tsx'),
  route('*', 'routes/notFound.tsx'),
] satisfies RouteConfig;
