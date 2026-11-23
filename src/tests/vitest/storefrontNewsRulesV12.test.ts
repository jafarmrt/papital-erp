// @vitest-environment node
/**
 * v12 phase 10d (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the rules of a news item of the site: what it may hold,
 * what is refused by name, what a draft may leave unfinished and what a published item may not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEWS_SECTION_KINDS, NEWS_SUMMARY_MAX, checkedNews, isNewsDate, newsAssetIds, newsExcerpt } from '../../lib/storefront/storefrontNewsRules';

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const text = (...content: unknown[]) => ({ kind: 'text', background: 'white', doc: { type: 'doc', content } });
const gallery = (...assetIds: number[]) => ({ kind: 'gallery', background: 'white', title: 'عکس‌های رونمایی', images: assetIds.map(assetId => ({ assetId, alt: 'عکس' })) });
const news = (over: Record<string, unknown> = {}) => ({
  title: 'کالکشن تازه رسید', slug: 'new-collection', summary: '  چند خط\nدربارهٔ کالکشن  ', coverAssetId: 7, newsDate: '2026-11-25', seoTitle: '', seoDescription: '',
  sections: [text(p('متن خبر')), gallery(8, 9)], ...over,
});
const problem = (raw: unknown, forPublish = false) => checkedNews(raw, { forPublish }).problem;

describe('a news item of the site', () => {
  it('keeps its known fields, one line of summary, and names its cover and the images of its body', () => {
    const checked = checkedNews({ ...news(), version: 3, published: { title: 'x' }, extra: 1 }, { forPublish: true });
    expect(checked.problem).toBeNull();
    expect(Object.keys(checked.news ?? {}).sort()).toEqual(['coverAssetId', 'newsDate', 'sections', 'seoDescription', 'seoTitle', 'slug', 'summary', 'title']);
    expect(checked.news?.summary).toBe('چند خط دربارهٔ کالکشن');
    expect(checked.news?.newsDate).toBe('2026-11-25');
    expect(newsAssetIds(checked.news!).sort()).toEqual([7, 8, 9]);
    expect(NEWS_SECTION_KINDS).toEqual(['text', 'gallery']);
  });

  it('takes only a text and a gallery in its body, and says which part does not belong', () => {
    for (const kind of [
      { kind: 'button', background: 'white', label: 'خرید', href: '/products' },
      { kind: 'hero', background: 'brand', title: 'x', text: '', imageAssetId: null, buttonLabel: '', buttonHref: '' },
      { kind: 'products', background: 'white', title: '', source: 'collection', collection: 'الف', itemIds: [] },
    ]) {
      const refused = problem(news({ sections: [text(p('متن')), kind] }));
      expect(refused, kind.kind).toMatchObject({ section: 1, code: 'STOREFRONT_PAGE_SECTION_INVALID' });
      expect(refused?.message, kind.kind).toContain('در خبر نمی‌آید');
    }
  });

  it('refuses by name what is unsafe or unreadable, in the words of a news item', () => {
    expect(problem(null)).toMatchObject({ code: 'STOREFRONT_NEWS_INVALID' });
    expect(problem(news({ title: ' ' }))).toMatchObject({ field: 'title', message: 'خبر عنوان می‌خواهد.' });
    for (const slug of ['', 'New', 'خبر', 'a--b', 'x'.repeat(61)]) expect(problem(news({ slug })), slug).toMatchObject({ field: 'slug' });
    // a message of the page's own rules is said of a news item
    for (const slug of ['feed', 'amp', 'fixed-cart']) {
      const refused = problem(news({ slug }));
      expect(refused, slug).toMatchObject({ field: 'slug' });
      expect(refused?.message, slug).toContain('نشانی خبر');
      expect(refused?.message, slug).not.toContain('صفحه');
    }
    expect(problem(news({ slug: 'Bad Address' }))?.message).toContain('new-collection');
    const unknownNode = problem(news({ sections: [text(p('x'), { type: 'iframe', attrs: { src: 'https://evil.example' } })] }));
    expect(unknownNode?.message).toContain('خبر');
    expect(unknownNode?.message).not.toContain('صفحه');
    expect(problem(news({ coverAssetId: 'seven' }))?.message).toContain('تصویر شاخص');
    // no message a news item can get is left half said of a page («صفحهٔ …» would become a broken word)
    const told = [
      news({ slug: 'feed' }), news({ slug: 'Bad Address' }), news({ title: '' }), news({ sections: 'x' }), news({ sections: [5] }), news({ sections: [{ kind: 'nothing' }] }),
      news({ sections: [text({ type: 'iframe' })] }), news({ sections: [{ ...gallery(1), images: 'x' }] }), news({ coverAssetId: -1 }), news({ seoTitle: 5 }),
      news({ sections: [{ kind: 'shippingMethods', background: 'white', title: '' }] }),
    ].map(raw => problem(raw)?.message ?? '');
    expect(told.every(message => message.length > 0)).toBe(true);
    expect(told.join(' | ')).not.toMatch(/صفحه|خبرٔ|our-story/);
    // the summary is one plain line: half of a broken emoji (which PostgreSQL refuses) and a direction mark are refused
    for (const code of [0xd800, 0xdc00, 0x202e, 0x2066, 0x0085]) {
      expect(problem(news({ summary: `a${String.fromCharCode(code)}b` })), code.toString(16)).toMatchObject({ field: 'summary', code: 'STOREFRONT_NEWS_FIELD_INVALID' });
    }
    expect(checkedNews(news({ summary: ' two\n lines\t here ' }), { forPublish: false }).news?.summary).toBe('two lines here');
    // a part of a news item has no background of its own
    expect(problem(news({ sections: [text(p('x')), { ...text(p('y')), background: 'dark' }] }))).toMatchObject({ section: 1, code: 'STOREFRONT_PAGE_SECTION_INVALID' });
    expect(problem(news({ summary: 'ب'.repeat(NEWS_SUMMARY_MAX + 1) }))).toMatchObject({ field: 'summary', code: 'STOREFRONT_NEWS_FIELD_INVALID' });
    expect(problem(news({ summary: 'ب'.repeat(NEWS_SUMMARY_MAX) }))).toBeNull();
    expect(problem(news({ summary: 5 }))).toMatchObject({ field: 'summary' });
    expect(problem(news({ coverAssetId: 'seven' }))).toMatchObject({ field: 'coverAssetId' });
    expect(problem(news({ coverAssetId: null }))).toBeNull();
    for (const day of ['2026-02-30', '25-11-2026', '1405-09-04', '2026-13-01', '1999-12-31', 'today', 20261125]) {
      expect(problem(news({ newsDate: day })), String(day)).toMatchObject({ field: 'newsDate', code: 'STOREFRONT_NEWS_DATE_INVALID' });
    }
    expect(problem(news({ newsDate: '' }))).toBeNull();
    expect(problem(news({ sections: [text(p('x'), { type: 'iframe', attrs: { src: 'https://evil.example' } })] }))).not.toBeNull();
  });

  it('lets a draft be unfinished and refuses an unfinished item at publishing', () => {
    expect(problem(news({ sections: [] }))).toBeNull();
    expect(problem(news({ sections: [] }), true)).toMatchObject({ code: 'STOREFRONT_PAGE_UNFINISHED', message: 'خبر هنوز بخشی ندارد.' });
    expect(problem(news({ sections: [gallery()] }))).toBeNull();
    expect(problem(news({ sections: [gallery()] }), true)).toMatchObject({ section: 0, code: 'STOREFRONT_PAGE_UNFINISHED' });
  });

  it('knows a day as it is kept, and the table of migration 0033 keeps the same limits', () => {
    expect(isNewsDate('2026-11-25')).toBe(true);
    expect(isNewsDate('2028-02-29')).toBe(true);
    expect(isNewsDate('2027-02-29')).toBe(false);
    const migration = fs.readFileSync(path.resolve(process.cwd(), 'drizzle/0033_storefront_news.sql'), 'utf8');
    expect(migration).toContain(`length(summary) <= ${NEWS_SUMMARY_MAX}`);
    expect(migration).toContain("content_kind IN ('page', 'news')");
    // both days are text days with the format check every day of this database has (AGENTS.md §2.10)
    for (const column of ['news_date', 'published_date']) {
      expect(migration).toContain(`${column} text,`);
      expect(migration).toContain(`CONSTRAINT chk_storefront_news_${column}_datefmt CHECK (erp_date_text_ok(${column}, 'iso'::text))`);
    }
  });

  it('takes the first words of the text for an item with no summary, as plain words cut at a limit', () => {
    const parts = checkedNews(news({ sections: [
      gallery(8, 9),
      text({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'سرخط' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'جملهٔ ' }, { type: 'text', text: 'نخست', marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, { type: 'text', text: 'خط دوم' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [p('یک')] }, { type: 'listItem', content: [p('دو')] }] }),
      text(p('بخش دیگر')),
    ] }), { forPublish: false }).news!.sections;
    // the first text part with words, its blocks a space apart and the pieces of a line run together
    expect(newsExcerpt(parts, 200)).toBe('سرخط جملهٔ نخست خط دوم یک دو');
    expect(newsExcerpt(parts, 12)).toBe('سرخط جملهٔ…');
    expect(newsExcerpt(parts, 12).length).toBeLessThanOrEqual(12);
    expect(newsExcerpt([], 200)).toBe('');
    expect(newsExcerpt(checkedNews(news({ sections: [gallery(8, 9)] }), { forPublish: false }).news!.sections, 200)).toBe('');
  });
});
