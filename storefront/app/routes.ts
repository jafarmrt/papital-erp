import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('products', 'routes/products.tsx', { id: 'products' }),
  route('collections/:name', 'routes/products.tsx', { id: 'collection' }),
  route('p/:slug', 'routes/product.tsx'),
  route('media/:file', 'routes/media.ts'),
  route('brand/:kind', 'routes/brandImage.ts'),
  route('healthz', 'routes/healthz.ts'),
  route('*', 'routes/notFound.tsx'),
] satisfies RouteConfig;
