import { Link } from 'react-router';
import type { Route } from './+types/newsItem';
import { newsItem } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import { mediaPath } from '../lib/brand';
import { faFullDay } from '../lib/format';
import { breadcrumbLd, newsArticleLd } from '../lib/jsonLd';
import { brandOf, pageMeta } from '../lib/meta';
import { NEWS_PATH, newsDayStart, newsModifiedAt, newsPath, type SiteNewsItem } from '../lib/news';
import { isBlank, pageCardImage, pageDescription } from '../lib/pages';
import { useRootData } from '../root';
import { JsonLdScripts } from '../components/JsonLdScripts';
import { NewsCover } from '../components/NewsCover';
import { PageSections } from '../components/PageSections';

/**
 * v12 phase 10d: one news item of the ERP's «خبرهای سایت», at `/news/<its address>`: its title, day, main image and
 * text (parts of «متن» and «گالری تصاویر», drawn as a page's are). It is a page only while it is on the site; an item
 * waiting for its day, taken off or removed is a 404 like any other address.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const item = await newsItem(params.slug);
  if (!item) throw new Response('پیدا نشد', { status: 404 });
  return { item, siteUrl: siteEnv().siteUrl };
}

/** What a search engine reads of an item: the description written in the ERP, else its summary, else the start of its text */
const descriptionOf = (item: SiteNewsItem) => (!isBlank(item.page.seoDescription) || isBlank(item.summary) ? pageDescription(item.page) : item.summary);
const imageOf = (item: SiteNewsItem) => item.cover ?? pageCardImage(item.page);

export function meta({ data, matches }: Route.MetaArgs) {
  if (!data) return [];
  const { item, siteUrl } = data;
  const image = imageOf(item);
  return [
    ...pageMeta({
      matches, title: item.page.seoTitle.trim() || item.title, description: descriptionOf(item), path: newsPath(item.slug),
      image: image ? mediaPath(image.sha256) : undefined, siteUrl,
    }),
    { property: 'og:type', content: 'article' },
    { property: 'article:published_time', content: newsDayStart(item.date) },
    ...(newsModifiedAt(item) ? [{ property: 'article:modified_time', content: newsModifiedAt(item) }] : []),
    // the name of the brand as the publisher, for a reader that looks for one
    { property: 'article:publisher', content: brandOf(matches).fullName },
  ];
}

export default function NewsItemPage({ loaderData }: Route.ComponentProps) {
  const { item, siteUrl } = loaderData;
  const root = useRootData();
  const image = imageOf(item);
  return (
    <article data-news-item={item.slug}>
      <nav aria-label="مسیر" className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 px-4 pt-6 text-sm text-muted-foreground lg:px-8 lg:pt-8">
        <Link to="/" className="inline-flex min-h-10 items-center hover:text-foreground">خانه</Link>
        <span aria-hidden>/</span>
        <Link to={NEWS_PATH} className="inline-flex min-h-10 items-center hover:text-foreground">خبرها</Link>
      </nav>
      <PageSections
        sections={item.page.sections}
        shipping={null}
        keepHeader
        header={(
          <header className="mx-auto max-w-5xl px-4 pt-2 pb-2 lg:px-8">
            <h1 className="text-3xl font-extrabold leading-tight text-balance break-words lg:text-4xl">{item.title}</h1>
            <p className="mt-3 text-sm text-muted-foreground"><time dateTime={item.date}>{faFullDay(item.date)}</time></p>
            <div className="tile-rule mt-4 w-24" aria-hidden />
            {item.cover ? (
              <figure className="mt-6 overflow-hidden rounded-surface border border-border bg-muted">
                {/* the title is written just above: the image says nothing more to a screen reader; a tall image is held to a height */}
                <NewsCover image={{ ...item.cover, alt: '' }} sizes="(min-width: 1024px) 960px, 100vw" eager className="mx-auto h-auto max-h-[40rem] w-auto max-w-full" />
              </figure>
            ) : null}
          </header>
        )}
      />
      <p className="mx-auto max-w-5xl px-4 pb-10 lg:px-8">
        <Link to={NEWS_PATH} className="inline-flex min-h-11 items-center font-medium text-brand hover:underline">همهٔ خبرها</Link>
      </p>
      <JsonLdScripts
        blocks={[
          newsArticleLd(
            { title: item.title, description: descriptionOf(item), path: newsPath(item.slug), date: item.date, updatedAt: newsModifiedAt(item), image: image ? mediaPath(image.sha256) : '' },
            siteUrl, { name: root?.shop?.brand.fullName ?? '', logoUrl: root?.logoUrl ?? '' },
          ),
          breadcrumbLd([{ name: 'خانه', path: '/' }, { name: 'خبرها', path: NEWS_PATH }, { name: item.title, path: newsPath(item.slug) }], siteUrl),
        ]}
        siteUrl={siteUrl}
      />
    </article>
  );
}
