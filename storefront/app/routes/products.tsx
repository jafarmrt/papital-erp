import { Form, Link, useSubmit } from 'react-router';
import type { Route } from './+types/products';
import { catalog } from '../lib/api.server';
import { CATALOG_PAGE_SIZE, CATALOG_SORTS, parsePage, parseSort } from '../lib/catalog';
import { siteEnv } from '../lib/site.server';
import { SORT_TITLES, categoryPath, collectionPath } from '../lib/brand';
import { faNumber } from '../lib/format';
import { pageMeta } from '../lib/meta';
import { COLLECTION_TEXTS } from '../content/collections';
import { ProductGrid } from '../components/ProductCard';
import { Pagination } from '../components/Pagination';
import { useRootData } from '../root';

/** «همهٔ محصولات» (/products) and one collection (/collections/:name) share this page; filters live in the address */
export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const collection = params.name ?? '';
  const category = url.searchParams.get('category') ?? '';
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const sort = parseSort(url.searchParams.get('sort'));
  const page = parsePage(url.searchParams.get('page'));
  const result = await catalog({ page, collection, category, q, sort });
  if (collection && result.total === 0) throw new Response('پیدا نشد', { status: 404 });
  return { result, collection, category, q, sort, page, siteUrl: siteEnv().siteUrl, path: url.pathname + url.search };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const title = data.collection ? `کالکشن ${data.collection}` : data.category || (data.q ? `جست‌وجوی «${data.q}»` : 'همهٔ محصولات');
  const description = data.collection && COLLECTION_TEXTS[data.collection]
    ? COLLECTION_TEXTS[data.collection].slice(0, 160)
    : `${title} پاپیتال: زیورآلات دست‌ساز با نقش کاشی‌های ایران، با قیمت روشن و ارسال به سراسر ایران.`;
  return pageMeta({ title, description, path: data.path, siteUrl: data.siteUrl });
}

export default function Products({ loaderData }: Route.ComponentProps) {
  const { result, collection, category, q, sort, page } = loaderData;
  const root = useRootData();
  const submit = useSubmit();
  const pages = Math.ceil(result.total / (result.limit || CATALOG_PAGE_SIZE));
  const base = collection ? collectionPath(collection) : '/products';
  const hrefOf = (n: number) => {
    const s = new URLSearchParams();
    if (category) s.set('category', category);
    if (q) s.set('q', q);
    if (sort !== 'default') s.set('sort', sort);
    if (n > 1) s.set('page', String(n));
    return s.size ? `${base}?${s}` : base;
  };
  const title = collection ? `کالکشن ${collection}` : category || (q ? `نتیجهٔ جست‌وجوی «${q}»` : 'همهٔ محصولات');
  const intro = collection ? COLLECTION_TEXTS[collection] : '';
  const chip = (active: boolean) =>
    `inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors duration-(--motion) ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-foreground/30'}`;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 lg:px-8 lg:pt-12">
      <nav aria-label="مسیر" className="text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">خانه</Link>
        <span className="mx-2" aria-hidden>/</span>
        {collection ? <span>کالکشن‌ها</span> : <Link to="/products" className="hover:text-foreground">محصولات</Link>}
      </nav>
      <header className="mt-3 max-w-3xl">
        <h1 className="text-3xl font-extrabold lg:text-4xl">{title}</h1>
        {intro ? <p className="mt-4 text-lg leading-9 text-muted-foreground">{intro}</p> : null}
        <p className="mt-2 text-sm text-muted-foreground">{`${faNumber(result.total)} محصول`}</p>
      </header>

      <div className="sticky top-16 z-20 -mx-4 mt-6 flex items-center gap-2 border-y border-border bg-background/95 px-4 py-2.5 backdrop-blur lg:top-20 lg:mx-0 lg:rounded-surface lg:border">
        <ul className="scrollbar-none -my-1 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1" aria-label="دسته‌ها">
          <li><Link to={collection ? base : '/products'} className={chip(!category)}>همه</Link></li>
          {(root?.categories ?? []).map(c => (
            <li key={c.name}>
              <Link to={collection ? `${base}?category=${encodeURIComponent(c.name)}` : categoryPath(c.name)} className={chip(category === c.name)}>{c.name}</Link>
            </li>
          ))}
        </ul>
        <Form method="get" action={base} className="flex shrink-0 items-center gap-2">
          {category ? <input type="hidden" name="category" value={category} /> : null}
          {q ? <input type="hidden" name="q" value={q} /> : null}
          <label htmlFor="sort" className="sr-only text-sm text-muted-foreground sm:not-sr-only">ترتیب</label>
          <select
            id="sort"
            name="sort"
            defaultValue={sort}
            onChange={e => submit(e.currentTarget.form)}
            className="h-10 max-w-32 rounded-control border border-border bg-card px-2 text-sm sm:max-w-none sm:px-3"
          >
            {CATALOG_SORTS.map(s => <option key={s} value={s}>{SORT_TITLES[s]}</option>)}
          </select>
          <noscript><button type="submit" className="h-10 rounded-control border border-border px-3 text-sm">اعمال</button></noscript>
        </Form>
      </div>

      <div className="mt-8">
        {result.data.length ? (
          <ProductGrid products={result.data} eagerCount={4} />
        ) : (
          <div className="rounded-surface border border-dashed border-border px-6 py-16 text-center">
            <p className="text-lg font-medium">{q ? `برای «${q}» محصولی پیدا نشد.` : 'در این دسته فعلاً محصولی نیست.'}</p>
            <Link to="/products" className="mt-4 inline-flex min-h-11 items-center text-brand underline-offset-4 hover:underline">دیدن همهٔ محصولات</Link>
          </div>
        )}
      </div>
      <Pagination page={page} pages={pages} hrefOf={hrefOf} />
    </div>
  );
}
