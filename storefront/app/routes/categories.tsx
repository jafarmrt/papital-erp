import { Link } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import type { Route } from './+types/categories';
import { useRootData } from '../root';
import { siteEnv } from '../lib/site.server';
import { categoryPath, collectionPath } from '../lib/brand';
import { faNumber } from '../lib/format';
import { pageMeta } from '../lib/meta';

/**
 * v12 phase 8a: «دسته‌ها» of the phone's bottom bar: every category and collection on the site as one tappable list,
 * from the same counts the header's menu reads (the root loader), so it costs no extra request to the ERP.
 */
export function loader() {
  return { siteUrl: siteEnv().siteUrl };
}

export function meta({ data }: Route.MetaArgs) {
  return pageMeta({ title: 'دسته‌ها', description: 'همهٔ دسته‌ها و کالکشن‌های پاپیتال', path: '/categories', siteUrl: data?.siteUrl ?? '' });
}

function Rows({ title, rows }: { title: string; rows: Array<{ to: string; label: string; count?: number }> }) {
  if (!rows.length) return null;
  return (
    <section className="mt-8" aria-label={title}>
      <h2 className="text-lg font-bold">{title}</h2>
      <ul className="mt-3 divide-y divide-border rounded-control border border-border bg-card">
        {rows.map(row => (
          <li key={row.to}>
            <Link to={row.to} className="flex min-h-14 items-center justify-between gap-3 px-4 text-base font-medium">
              <span>{row.label}</span>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                {row.count ? `${faNumber(row.count)} کالا` : null}
                <ChevronLeft className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CategoriesPage() {
  const root = useRootData();
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 pb-16 lg:pt-10">
      <h1 className="text-2xl font-extrabold lg:text-3xl">دسته‌ها</h1>
      <div className="tile-rule mt-4 w-24" aria-hidden />
      <Rows title="دسته‌ها" rows={[{ to: '/products', label: 'همهٔ محصولات' }, ...(root?.categories ?? []).map(c => ({ to: categoryPath(c.name), label: c.name, count: c.count }))]} />
      <Rows title="کالکشن‌ها" rows={(root?.collections ?? []).map(c => ({ to: collectionPath(c.name), label: c.name, count: c.count }))} />
    </div>
  );
}
