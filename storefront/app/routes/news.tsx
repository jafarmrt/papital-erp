import { Link } from 'react-router';
import type { Route } from './+types/news';
import { newsList } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import { parsePage } from '../lib/catalog';
import { faFullDay, faNumber } from '../lib/format';
import { breadcrumbLd } from '../lib/jsonLd';
import { pageMeta } from '../lib/meta';
import { NEWS_PATH, newsListPath, newsPath } from '../lib/news';
import { JsonLdScripts } from '../components/JsonLdScripts';
import { NewsCover } from '../components/NewsCover';
import { Pagination } from '../components/Pagination';

/**
 * v12 phase 10d: the news of the shop, written in the ERP's «خبرهای سایت», the newest day first, a page at a time (the
 * ERP pages the list). It is a page only while the shop has turned «خبرها روی سایت بیایند» on and an item is on the
 * site; otherwise, and past the last page, its address is a 404 like any other.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const page = parsePage(new URL(request.url).searchParams.get('page'));
  const list = await newsList(page);
  const pages = list ? Math.ceil(list.total / list.pageSize) : 0;
  if (!list || list.total === 0 || page > pages || list.items.length === 0) throw new Response('پیدا نشد', { status: 404 });
  return { items: list.items, page, pages, siteUrl: siteEnv().siteUrl };
}

const TITLE = 'خبرها';

export function meta({ data, matches }: Route.MetaArgs) {
  if (!data) return [];
  const { page, siteUrl } = data;
  return pageMeta({
    matches,
    title: page > 1 ? `${TITLE}، صفحهٔ ${faNumber(page)}` : TITLE,
    description: 'تازه‌ترین خبرها و رویدادهای گالری.',
    path: newsListPath(page),
    siteUrl,
  });
}

export default function NewsListPage({ loaderData }: Route.ComponentProps) {
  const { items, page, pages, siteUrl } = loaderData;
  return (
    <div className="mx-auto max-w-5xl px-4 pt-6 lg:px-8 lg:pt-10" data-news-list>
      <nav aria-label="مسیر" className="text-sm text-muted-foreground">
        <Link to="/" className="inline-flex min-h-10 items-center hover:text-foreground">خانه</Link>
      </nav>
      <header className="mt-2">
        <h1 className="text-3xl font-extrabold text-balance lg:text-4xl">{TITLE}</h1>
        <div className="tile-rule mt-4 w-24" aria-hidden />
      </header>
      <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => (
          <li key={item.slug}>
            <article className="flex h-full flex-col overflow-hidden rounded-surface border border-border bg-card">
              {item.cover ? (
                <Link to={newsPath(item.slug)} tabIndex={-1} aria-hidden className="block aspect-[16/10] overflow-hidden bg-muted">
                  <NewsCover image={{ ...item.cover, alt: '' }} sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw" eager={i === 0 && page === 1} className="size-full object-cover" />
                </Link>
              ) : null}
              <div className="flex flex-1 flex-col p-4">
                <p className="text-sm text-muted-foreground"><time dateTime={item.date}>{faFullDay(item.date)}</time></p>
                <h2 className="mt-1 text-lg font-bold leading-8 break-words">
                  <Link to={newsPath(item.slug)} className="hover:text-brand">{item.title}</Link>
                </h2>
                {item.summary ? <p className="mt-2 line-clamp-4 leading-7 text-muted-foreground break-words">{item.summary}</p> : null}
              </div>
            </article>
          </li>
        ))}
      </ul>
      <Pagination page={page} pages={pages} hrefOf={newsListPath} />
      <JsonLdScripts blocks={[breadcrumbLd([{ name: 'خانه', path: '/' }, { name: TITLE, path: NEWS_PATH }], siteUrl)]} siteUrl={siteUrl} />
    </div>
  );
}
