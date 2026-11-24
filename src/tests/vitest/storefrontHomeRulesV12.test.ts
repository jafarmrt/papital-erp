import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { STOREFRONT_HOME_PAGE_ROW } from '../../db/schema/storefrontPages';
import {
  HOME_KINDS_ONCE, HOME_PAGE_SLUG, HOME_PAGE_TITLE, HOME_SECTION_KINDS, PAGE_KINDS, PAGE_SECTION_KINDS, SECTION_KINDS, SECTION_KIND_TITLES, SLIDES_MAX, auditHomeSection,
  checkedPage, emptyHomeSection, emptySection, emptySlide, homeSectionLinks, pageAssetIds, todayHomeSections, type PageSection,
} from '../../lib/storefront/storefrontPageRules';
import { SITE_LINK_KINDS, checkedSiteLink, normalizedSiteLink, siteLinkWords } from '../../lib/storefront/storefrontSiteLinks';

/**
 * v12 phase 10e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the rules of «صفحهٔ اصلی» the server and the builder
 * share: the home row, its own parts, the switch that takes a part off the site, and a link chosen as in the menus.
 */
const page = (sections: unknown[], over: Record<string, unknown> = {}) => ({ title: HOME_PAGE_TITLE, slug: HOME_PAGE_SLUG, seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections, ...over });
const home = (sections: unknown[], forPublish = false, over: Record<string, unknown> = {}) => checkedPage(page(sections, over), { forPublish, baseSlug: null, home: true });
const slide = (over: Record<string, unknown> = {}) => ({ ...emptySlide(), imageAssetId: 7, imageAlt: 'کاشی', ...over });
const slider = (...slides: unknown[]) => ({ kind: 'slider', background: 'white', slides });
const link = (kind: string, over: Record<string, unknown> = {}) => ({ kind, target: '', itemId: null, campaignId: null, pageId: null, newsId: null, ...over });

describe('the home page row', () => {
  it('is one row of its own kind, as migration 0036 makes it and the factory reset makes it again', () => {
    expect(PAGE_KINDS).toContain('home');
    expect(STOREFRONT_HOME_PAGE_ROW).toEqual({ kind: 'home', slug: HOME_PAGE_SLUG, title: HOME_PAGE_TITLE });
    const sql = readFileSync('drizzle/0036_storefront_home_page.sql', 'utf8');
    expect(sql).toContain(`('home', '${HOME_PAGE_SLUG}', '${HOME_PAGE_TITLE}')`);
    expect(sql).toContain("CHECK (kind IN ('base', 'custom', 'fixed', 'home'))");
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_pages_home ON storefront_pages \(kind\) WHERE kind = 'home'/);
    expect(sql).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|DROP TABLE|DROP COLUMN/i);
  });

  it('keeps its name, is always in the search engines, and may carry a share image', () => {
    expect(home([]).problem).toBeNull();
    expect(home([], false, { slug: 'home' }).problem?.field).toBe('slug');
    expect(home([], false, { noindex: true }).problem?.field).toBe('noindex');
    expect(home([], false, { shareImageAssetId: 5 }).page?.shareImageAssetId).toBe(5);
    // the name is the home row's alone: no other page takes it
    expect(checkedPage(page([]), { forPublish: false, baseSlug: null }).problem?.code).toBe('STOREFRONT_PAGE_SLUG_INVALID');
  });
});

describe('the parts of the home page', () => {
  it('has a title for every kind and offers its own kinds to no other page', () => {
    expect(SECTION_KINDS).toEqual([...PAGE_SECTION_KINDS, ...HOME_SECTION_KINDS]);
    for (const kind of SECTION_KINDS) expect(SECTION_KIND_TITLES[kind], kind).toBeTruthy();
    for (const kind of HOME_SECTION_KINDS) {
      const part = emptySection(kind);
      expect(part.kind).toBe(kind);
      expect(home([part]).problem, kind).toBeNull();
      const elsewhere = checkedPage({ ...page([part]), slug: 'our-story' }, { forPublish: false, baseSlug: null }).problem;
      expect(elsewhere?.code, kind).toBe('STOREFRONT_PAGE_SECTION_INVALID');
      expect(elsewhere?.message, kind).toContain('فقط در صفحهٔ اصلی');
    }
    expect(home([emptySection('shippingMethods')]).problem?.code).toBe('STOREFRONT_PAGE_SECTION_INVALID');
  });

  it('starts from the home page the site has today, ready to publish as it is', () => {
    const today = todayHomeSections();
    expect(today.map(part => part.kind)).toEqual(['homeIntro', 'homeCategories', 'homeWhy', 'homeFeatured', 'homeCollections', 'homeNewest', 'homeWholesale']);
    expect(home(today, true).problem).toBeNull();
    // two calls give two copies: a change to one draft never reaches another
    expect(todayHomeSections()[0]).not.toBe(today[0]);
    for (const kind of HOME_KINDS_ONCE) {
      const twice = home([emptyHomeSection(kind), emptyHomeSection(kind)]).problem;
      expect(twice?.message, kind).toContain('یک بار می‌آید');
    }
    expect(home([slider(slide()), slider(slide())]).problem).toBeNull();
  });

  it('switches a part off without asking it to be finished, on the home page alone', () => {
    const unfinished = { kind: 'banner', background: 'white', imageAssetId: null, mobileImageAssetId: null, imageAlt: '', link: null };
    expect(home([unfinished, emptyHomeSection('homeIntro')], true).problem?.code).toBe('STOREFRONT_PAGE_UNFINISHED');
    const off = home([{ ...unfinished, hidden: true }, emptyHomeSection('homeIntro')], true);
    expect(off.problem).toBeNull();
    expect(off.page?.sections[0].hidden).toBe(true);
    expect('hidden' in (off.page?.sections[1] ?? {})).toBe(false);
    expect(home([{ ...emptyHomeSection('homeIntro'), hidden: false }]).page?.sections[0]).not.toHaveProperty('hidden');
    expect(home([{ ...emptyHomeSection('homeIntro'), hidden: 1 }]).problem?.code).toBe('STOREFRONT_PAGE_FIELD_INVALID');
    expect(home([{ ...emptyHomeSection('homeIntro'), hidden: true }], true).problem?.message).toContain('همهٔ بخش‌های صفحهٔ اصلی خاموش‌اند');
    const text = { kind: 'text', background: 'white', doc: { type: 'doc', content: [] }, hidden: true };
    expect(checkedPage({ ...page([text]), slug: 'our-story' }, { forPublish: false, baseSlug: null }).problem?.message).toContain('فقط در صفحهٔ اصلی');
  });

  it('checks a slide: its fields, its days, its count, and what it needs before it is published', () => {
    expect(home([slider(...Array.from({ length: SLIDES_MAX }, () => slide()))], true).problem).toBeNull();
    expect(home([slider(...Array.from({ length: SLIDES_MAX + 1 }, () => slide()))]).problem?.code).toBe('STOREFRONT_PAGE_TOO_MANY');
    expect(home([slider(slide({ script: 'x' }))]).problem?.code).toBe('STOREFRONT_PAGE_FIELD_UNKNOWN');
    expect(home([slider(slide({ title: 'ب'.repeat(81) }))]).problem?.code).toBe('STOREFRONT_PAGE_FIELD_TOO_LONG');
    for (const startsOn of ['2026-13-01', '2026-02-30', '1405-01-01', '2026/01/01', 5]) expect(home([slider(slide({ startsOn }))]).problem?.code, String(startsOn)).toBe('STOREFRONT_PAGE_FIELD_INVALID');
    expect(home([slider(slide({ startsOn: '2026-05-02', endsOn: '2026-05-01' }))]).problem?.message).toContain('پیش از روز آغاز');
    expect(home([slider(slide({ startsOn: '2026-05-01', endsOn: '2026-05-01' }))]).problem).toBeNull();
    const reasons = [
      [slider(), 'دست‌کم یک اسلاید'], [slider(slide(), slide({ imageAssetId: null })), 'اسلاید ۲ عکس ندارد'], [slider(slide({ imageAlt: '' })), 'متن جایگزین'],
      [slider(slide({ buttonLabel: 'دیدن' })), 'هم نوشته می‌خواهد و هم پیوند'], [slider(slide({ link: link('path', { target: '/products' }) })), 'هم نوشته می‌خواهد و هم پیوند'],
    ] as const;
    for (const [part, why] of reasons) {
      expect(home([part]).problem, why).toBeNull();
      expect(home([part], true).problem?.message, why).toContain(why);
    }
    expect(pageAssetIds({ shareImageAssetId: null, sections: home([slider(slide({ mobileImageAssetId: 9 }), slide())]).page?.sections ?? [] })).toEqual([7, 9]);
  });

  it('lets only the delivery point of the why-us part stay empty, and names every link for the server to check', () => {
    const why = (points: unknown[]) => home([{ kind: 'homeWhy', background: 'white', points }], true).problem;
    expect(why([{ icon: 'truck', text: '' }, { icon: 'leaf', text: 'کاشی' }])).toBeNull();
    expect(why([{ icon: 'leaf', text: '' }, { icon: 'truck', text: '' }])?.message).toContain('هر نکته متن می‌خواهد');
    expect(why([{ icon: 'leaf', text: 'یک' }])?.message).toContain('دست‌کم');
    const kept = home([
      slider(slide({ buttonLabel: 'یک', link: link('product', { itemId: 3 }) }), slide()),
      { kind: 'banner', background: 'white', imageAssetId: 8, mobileImageAssetId: null, imageAlt: 'بنر', link: link('news', { newsId: 4 }) },
    ]).page?.sections as PageSection[];
    expect(homeSectionLinks(kept)).toEqual([{ link: link('product', { itemId: 3 }), label: 'اسلاید ۱' }, { link: link('news', { newsId: 4 }), label: 'بنر' }]);
    expect(JSON.stringify(auditHomeSection(kept[0] as never))).toContain('product: کالا 3');
  });
});

describe('a link chosen as in the menus', () => {
  it('takes every kind of the menu but a heading, with only the fields its kind uses', () => {
    expect(SITE_LINK_KINDS).not.toContain('none');
    expect(checkedSiteLink(null, 'پیوند')).toEqual({ link: null, problem: null });
    expect(checkedSiteLink(link('product', { itemId: 3, target: '/x', pageId: 9 }), 'پیوند').link).toEqual(link('product', { itemId: 3 }));
    expect(checkedSiteLink(link('page', { target: 'products' }), 'پیوند').problem).toBeNull();
    expect(checkedSiteLink(link('collection', { target: ' کاشی ' }), 'پیوند').link?.target).toBe('کاشی');
    expect(normalizedSiteLink('url', { target: 'https://example.com', itemId: 3 })).toEqual(link('url', { target: 'https://example.com' }));
    expect(siteLinkWords(link('content', { pageId: 5 }) as never)).toBe('content: صفحهٔ متنی 5');
  });

  it('refuses half a link and anything that is not one', () => {
    const bad: unknown[] = [
      'text', 7, [], link('none'), link('gopher'), link('page', { target: 'admin' }), link('category'), link('product'), link('campaign'), link('content'), link('news'),
      link('path', { target: '//evil.example' }), link('path', { target: 'javascript:alert(1)' }), link('url', { target: 'http://example.com' }),
      link('url', { target: 'https://user:pass@example.com' }), { ...link('path', { target: '/x' }), extra: 1 }, link('product', { itemId: 1.5 }), link('path', { target: 5 }),
    ];
    for (const value of bad) expect(checkedSiteLink(value, 'پیوند').problem, JSON.stringify(value)).toBeTruthy();
  });
});
