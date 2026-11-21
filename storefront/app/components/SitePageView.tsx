import { Link } from 'react-router';
import { breadcrumbLd } from '../lib/jsonLd';
import { pagePath, type SitePage } from '../lib/pages';
import { JsonLdScripts } from './JsonLdScripts';
import { PageSections, type ShippingView } from './PageSections';

/**
 * v12 phase 10c: a page written in the ERP's «صفحه‌های سایت», as the site draws it: the way back home, the page's
 * sections, and its place for a search engine. The page's `<h1>` is the title of its first section when that has one,
 * else the page's own title above the sections.
 */
export function SitePageView({ page, shipping, siteUrl }: { page: SitePage; shipping: ShippingView | null; siteUrl: string }) {
  return (
    <div data-site-page={page.slug}>
      <nav aria-label="مسیر" className="mx-auto max-w-5xl px-4 pt-6 text-sm text-muted-foreground lg:px-8 lg:pt-8">
        <Link to="/" className="inline-flex min-h-10 items-center hover:text-foreground">خانه</Link>
      </nav>
      <PageSections
        sections={page.sections}
        shipping={shipping}
        header={(
          <header className="mx-auto max-w-5xl px-4 pt-2 pb-2 lg:px-8">
            <h1 className="text-3xl font-extrabold text-balance break-words lg:text-4xl">{page.title}</h1>
            <div className="tile-rule mt-4 w-24" aria-hidden />
          </header>
        )}
      />
      <JsonLdScripts blocks={[breadcrumbLd([{ name: 'خانه', path: '/' }, { name: page.title, path: pagePath(page) }], siteUrl)]} siteUrl={siteUrl} />
    </div>
  );
}
