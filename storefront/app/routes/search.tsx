import { Form, Link } from 'react-router';
import { Search } from 'lucide-react';
import type { Route } from './+types/search';
import { useRootData } from '../root';
import { siteEnv } from '../lib/site.server';
import { categoryPath } from '../lib/brand';
import { pageMeta } from '../lib/meta';

/**
 * v12 phase 8a: «جست‌وجو» of the phone's bottom bar: one wide field that searches the products (a GET form to /products,
 * so it works without JavaScript and counts against the same per-visitor search limit), and the categories to browse.
 */
export function loader() {
  return { siteUrl: siteEnv().siteUrl };
}

export function meta({ data }: Route.MetaArgs) {
  return [...pageMeta({ title: 'جست‌وجو', description: 'جست‌وجو در محصولات پاپیتال', path: '/search', siteUrl: data?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

export default function SearchPage() {
  const root = useRootData();
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 pb-16 lg:pt-10">
      <h1 className="text-2xl font-extrabold lg:text-3xl">جست‌وجو</h1>
      <Form method="get" action="/products" role="search" className="mt-6">
        <label className="relative flex items-center">
          <span className="sr-only">جست‌وجو در محصولات</span>
          <input
            type="search" name="q" placeholder="نام محصول، رنگ یا کالکشن" enterKeyHint="search" autoFocus
            className="h-14 w-full rounded-control border border-border bg-card pe-3 ps-12 text-base text-foreground placeholder:text-muted-foreground"
          />
          <Search className="pointer-events-none absolute start-4 size-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        </label>
        <button type="submit" className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-control bg-primary px-6 font-medium text-primary-foreground">جست‌وجو</button>
      </Form>
      {(root?.categories ?? []).length ? (
        <section className="mt-10" aria-label="دسته‌ها">
          <h2 className="text-lg font-bold">یا از دسته‌ها ببینید</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {(root?.categories ?? []).map(c => (
              <li key={c.name}><Link to={categoryPath(c.name)} className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 text-sm font-medium">{c.name}</Link></li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
