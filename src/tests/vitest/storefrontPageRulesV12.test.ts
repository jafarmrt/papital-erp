// @vitest-environment node
/**
 * v12 phase 10b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the rules of the site's pages: what a section and the
 * editor's text may hold, what is refused by name, what a draft may leave unfinished and what a published page may not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STOREFRONT_BASE_PAGE_ROWS, STOREFRONT_FIXED_PAGE_ROWS } from '../../db/schema/storefrontPages';
import {
  BASE_PAGES, FIXED_PAGES, FIXED_PAGE_PREFIX, PAGE_SECTIONS_MAX, PAGE_TEMPLATES, RICH_TEXT_CHARS_MAX, SECTION_KINDS, checkedPage, emptySection, isReservedPageSlug,
  pageAssetIds, pageItemIds, pageLink, safeRichDoc, type PageSection,
} from '../../lib/storefront/storefrontPageRules';

const draft = { forPublish: false, baseSlug: null } as const;
const live = { forPublish: true, baseSlug: null } as const;
const page = (sections: unknown[], over: Record<string, unknown> = {}) => ({ title: 'داستان ما', slug: 'our-story', sections, ...over });
const p = (text: string, marks?: unknown[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const textSection = (...content: unknown[]) => ({ kind: 'text', background: 'white', doc: doc(...content) });
const refusal = (raw: unknown, options: Parameters<typeof checkedPage>[1] = draft) => checkedPage(raw, options).problem;

describe('a link of a page', () => {
  it('is a path of this site or an https address on a plain host, and nothing else', () => {
    expect(pageLink('')).toBe('');
    expect(pageLink('/products?category=x')).toBe('/products?category=x');
    expect(pageLink(' https://example.com/a ')).toBe('https://example.com/a');
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'http://example.com', '//evil.example', '/\\evil.example', '/a//b',
      '/a b', 'mailto:a@b.example', 'tel:021', 'https://evil.example;x/y', '/../x', 7, null, `/${'a'.repeat(301)}`,
      // 10b review: a quote or an angle bracket is never part of a path as written, and an address by number is not a host
      '/x\'"><script>', '/a`b', '/a<b', 'https://0x7f.1/', 'https://127.0.0.1/x', 'https://2130706433/']) {
      expect(pageLink(bad), String(bad)).toBeNull();
    }
  });
});

describe('the editor\'s text', () => {
  it('keeps the known nodes and marks, rebuilt from their known attributes alone', () => {
    const kept = safeRichDoc(doc(
      { type: 'heading', attrs: { level: 2, textAlign: 'center', id: 'x', onclick: 'alert(1)' }, content: [{ type: 'text', text: 'تیتر' }] },
      p('متن', [{ type: 'bold' }, { type: 'link', attrs: { href: '/about', target: '_blank', rel: 'x', class: 'y', onclick: 'alert(1)' } }, { type: 'textColor', attrs: { color: 'brand' } }]),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('یک')] }] },
      { type: 'blockquote', content: [p('نقل')] },
      { type: 'horizontalRule' },
      { type: 'libraryImage', attrs: { assetId: 12, alt: ' عکس کارگاه ', src: 'https://evil.example/x.png' } },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p('الف')] }, { type: 'tableCell', content: [p('ب')] }] }] },
    ));
    expect(kept.problem).toBeNull();
    const text = JSON.stringify(kept.doc);
    // an attribute the editor or a forged request adds never survives: no event handler, no address of an image
    expect(text).not.toMatch(/onclick|evil\.example|target|"rel"|"class"|colwidth|"id"/);
    expect(kept.doc?.content[0]).toEqual({ type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: 'تیتر' }] });
    expect(kept.doc?.content[1].content?.[0].marks).toEqual([{ type: 'bold' }, { type: 'link', attrs: { href: '/about' } }, { type: 'textColor', attrs: { color: 'brand' } }]);
    expect(kept.doc?.content[5]).toEqual({ type: 'libraryImage', attrs: { assetId: 12, alt: 'عکس کارگاه' } });
  });

  it('refuses, by name, anything it does not know: a script, a frame, raw HTML, an image by address', () => {
    const cases: Array<[unknown, string]> = [
      [doc({ type: 'script', content: [{ type: 'text', text: 'alert(1)' }] }), 'STOREFRONT_PAGE_NODE_UNKNOWN'],
      [doc({ type: 'iframe', attrs: { src: 'https://evil.example' } }), 'STOREFRONT_PAGE_NODE_UNKNOWN'],
      [doc({ type: 'html', attrs: { html: '<img src=x onerror=alert(1)>' } }), 'STOREFRONT_PAGE_NODE_UNKNOWN'],
      [doc({ type: 'image', attrs: { src: 'https://evil.example/x.png' } }), 'STOREFRONT_PAGE_NODE_UNKNOWN'],
      [doc({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'x' }] }), 'STOREFRONT_PAGE_NODE_UNKNOWN'],
      [doc(p('x', [{ type: 'code' }])), 'STOREFRONT_PAGE_MARK_UNKNOWN'],
      [doc(p('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])), 'STOREFRONT_PAGE_LINK_INVALID'],
      [doc(p('x', [{ type: 'link', attrs: { href: 'http://example.com' } }])), 'STOREFRONT_PAGE_LINK_INVALID'],
      [doc(p('x', [{ type: 'link', attrs: {} }])), 'STOREFRONT_PAGE_LINK_INVALID'],
      [doc(p('x', [{ type: 'textColor', attrs: { color: 'red;background:url(https://evil.example)' } }])), 'STOREFRONT_PAGE_FIELD_INVALID'],
      [doc({ type: 'paragraph', attrs: { textAlign: 'center;position:fixed' }, content: [{ type: 'text', text: 'x' }] }), 'STOREFRONT_PAGE_FIELD_INVALID'],
      [doc({ type: 'libraryImage', attrs: { assetId: '12' } }), 'STOREFRONT_PAGE_IMAGE_INVALID'],
      [doc({ type: 'paragraph', content: [{ type: 'libraryImage', attrs: { assetId: 1 } }] }), 'STOREFRONT_PAGE_NODE_MISPLACED'],
      [doc({ type: 'listItem', content: [p('x')] }), 'STOREFRONT_PAGE_NODE_MISPLACED'],
      [doc({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [p('x')] }] }] }), 'STOREFRONT_PAGE_TABLE_INVALID'],
      [doc({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('x')] }] }, { type: 'tableRow', content: [] }] }), 'STOREFRONT_PAGE_TABLE_INVALID'],
      [doc(p('x\u0000y')), 'STOREFRONT_PAGE_FIELD_INVALID'],
      [doc(p('x'.repeat(RICH_TEXT_CHARS_MAX + 1))), 'STOREFRONT_PAGE_TEXT_TOO_LONG'],
      [{ type: 'paragraph' }, 'STOREFRONT_PAGE_NODE_UNKNOWN'],
      ['<p>html</p>', 'STOREFRONT_PAGE_NODE_UNKNOWN'],
    ];
    for (const [value, code] of cases) expect(safeRichDoc(value).problem?.code, JSON.stringify(value).slice(0, 80)).toBe(code);
    // nesting past the limit is refused, never walked without end
    let deep: unknown = p('x');
    for (let i = 0; i < 12; i += 1) deep = { type: 'bulletList', content: [{ type: 'listItem', content: [deep] }] };
    expect(safeRichDoc(doc(deep)).problem?.code).toBe('STOREFRONT_PAGE_TEXT_TOO_DEEP');
    // a tag typed as text is only text
    expect(safeRichDoc(doc(p('<script>alert(1)</script>'))).problem).toBeNull();
  });

  it('names a known node in the wrong place in the colleague\'s words, never by the editor\'s English name (10b review)', () => {
    const list = { type: 'bulletList', content: [{ type: 'listItem', content: [p('یک')] }] };
    const cell = (...content: unknown[]) => doc({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content }] }] });
    const cases: Array<[unknown, string]> = [
      [cell(list), '«فهرست نقطه‌ای» درون خانهٔ جدول نمی‌آید'],
      [cell({ type: 'libraryImage', attrs: { assetId: 1, alt: '' } }), '«عکس» درون خانهٔ جدول نمی‌آید'],
      [cell({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'x' }] }), '«تیتر» درون خانهٔ جدول نمی‌آید'],
      [doc({ type: 'blockquote', content: [list] }), '«فهرست نقطه‌ای» درون نقل‌قول نمی‌آید'],
      [doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p('x'), { type: 'horizontalRule' }] }] }), '«خط جداکننده» درون گزینهٔ فهرست نمی‌آید'],
    ];
    for (const [value, words] of cases) {
      const problem = safeRichDoc(value).problem;
      expect(problem?.code, words).toBe('STOREFRONT_PAGE_NODE_MISPLACED');
      expect(problem?.message, words).toContain(words);
      expect(problem?.message, words).not.toMatch(/[A-Za-z]/);
    }
  });

  it('refuses a node that must hold something and holds nothing, as the editor itself would (10b review)', () => {
    // red before: each of these was saved, and the editor then could not open the text
    for (const empty of [
      { type: 'bulletList' }, { type: 'orderedList', content: [] }, { type: 'bulletList', content: [{ type: 'listItem' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p('x')] }] }] }] },
      { type: 'blockquote' }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell' }] }] },
    ]) expect(safeRichDoc(doc(empty)).problem?.code, JSON.stringify(empty)).toBe('STOREFRONT_PAGE_NODE_EMPTY');
    for (const leaf of [{ type: 'horizontalRule', content: [p('x')] }, { type: 'libraryImage', attrs: { assetId: 1 }, content: [p('x')] }]) {
      expect(safeRichDoc(doc(leaf)).problem?.code, leaf.type).toBe('STOREFRONT_PAGE_NODE_MISPLACED');
    }
    // an empty paragraph and an empty cell's paragraph are ordinary
    expect(safeRichDoc(doc({ type: 'paragraph' }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] })).problem).toBeNull();
  });

  it('keeps where a numbered list starts, and refuses half of a surrogate pair instead of failing the save (10b review)', () => {
    const numbered = (attrs?: unknown) => doc({ type: 'orderedList', ...(attrs ? { attrs } : {}), content: [{ type: 'listItem', content: [p('پنجم')] }] });
    // red before: a list pasted as starting at 5 came back starting at 1
    expect(safeRichDoc(numbered({ start: 5, type: 'a' })).doc?.content[0]).toMatchObject({ type: 'orderedList', attrs: { start: 5 } });
    expect(safeRichDoc(numbered({ start: 1 })).doc?.content[0]).not.toHaveProperty('attrs');
    expect(safeRichDoc(numbered({ start: -3 })).doc?.content[0]).not.toHaveProperty('attrs');
    expect(safeRichDoc(numbered({ start: '5;x' })).doc?.content[0]).not.toHaveProperty('attrs');
    // red before: PostgreSQL refused the text and the save answered 500
    expect(safeRichDoc(doc(p('a\ud800b'))).problem?.code).toBe('STOREFRONT_PAGE_FIELD_INVALID');
    expect(refusal(page([{ kind: 'hero', title: 'a\udc00b' }]))).toMatchObject({ code: 'STOREFRONT_PAGE_FIELD_INVALID' });
    expect(refusal(page([], { title: 'a\ud800' }))).toMatchObject({ field: 'title' });
    // a whole pair (an emoji) is ordinary text
    expect(safeRichDoc(doc(p('خوش آمدید \ud83d\ude00'))).problem).toBeNull();
  });
});

describe('a page', () => {
  it('is rebuilt from its known fields, and an unknown field or kind is refused by name', () => {
    const checked = checkedPage(page([{ kind: 'button', background: 'dark', label: ' خرید ', href: '/products' }], { title: '  داستان   ما ', seoTitle: 'x' }), draft);
    expect(checked.problem).toBeNull();
    expect(checked.page).toEqual({
      title: 'داستان ما', slug: 'our-story', seoTitle: 'x', seoDescription: '', noindex: false, shareImageAssetId: null,
      sections: [{ kind: 'button', background: 'dark', label: 'خرید', href: '/products' }],
    });
    expect(refusal(page([{ kind: 'html', html: '<b>x</b>' }]))).toMatchObject({ section: 0, code: 'STOREFRONT_PAGE_FIELD_INVALID' });
    expect(refusal(page([{ kind: 'button', label: 'x', href: '/x', onclick: 'alert(1)' }]))).toMatchObject({ section: 0, code: 'STOREFRONT_PAGE_FIELD_UNKNOWN' });
    expect(refusal(page([{ kind: 'button', label: 'x', href: 'javascript:alert(1)' }]))).toMatchObject({ section: 0, code: 'STOREFRONT_PAGE_LINK_INVALID' });
    expect(refusal(page([{ kind: 'hero', background: 'red', title: 'x' }]))).toMatchObject({ section: 0, code: 'STOREFRONT_PAGE_FIELD_INVALID' });
    expect(refusal(page([{ kind: 'hero', title: 'x', imageAssetId: 'https://evil.example/x.png' }]))).toMatchObject({ code: 'STOREFRONT_PAGE_IMAGE_INVALID' });
    expect(refusal(page([{ kind: 'map', neshanUrl: '/products' }]))).toMatchObject({ code: 'STOREFRONT_PAGE_LINK_INVALID' });
    expect(refusal(page([{ kind: 'iconCards', cards: [{ icon: 'bomb', title: 'x', text: '' }] }]))).toMatchObject({ code: 'STOREFRONT_PAGE_FIELD_INVALID' });
    expect(refusal(page([{ kind: 'products', itemIds: [1, 1] }]))).toMatchObject({ code: 'STOREFRONT_PAGE_SECTION_INVALID' });
    expect(refusal(page([textSection(p('ok')), textSection({ type: 'script' })]))).toMatchObject({ section: 1, code: 'STOREFRONT_PAGE_NODE_UNKNOWN' });
    expect(refusal(page(Array.from({ length: PAGE_SECTIONS_MAX + 1 }, () => textSection(p('x')))))).toMatchObject({ code: 'STOREFRONT_PAGE_TOO_MANY' });
  });

  it('needs a title and a lowercase Latin address; a base page keeps its own address', () => {
    expect(refusal(page([], { title: ' ' }))).toMatchObject({ field: 'title', code: 'STOREFRONT_PAGE_TITLE_INVALID' });
    expect(refusal(page([], { title: 'خط\nدو' }))).toMatchObject({ field: 'title' });
    for (const slug of ['', 'Our-Story', 'our story', 'داستان', '-x', 'x-', 'a--b', 'x'.repeat(61), '../x']) {
      expect(refusal(page([], { slug })), slug).toMatchObject({ field: 'slug', code: 'STOREFRONT_PAGE_SLUG_INVALID' });
    }
    expect(refusal(page([], { slug: 'about' }), { forPublish: false, baseSlug: 'about' })).toBeNull();
    expect(refusal(page([], { slug: 'about-us' }), { forPublish: false, baseSlug: 'about' })).toMatchObject({ field: 'slug' });
    expect(BASE_PAGES.map(b => b.slug)).toEqual(['about', 'contact', 'shipping', 'terms', 'privacy']);
    // the migration, the rules and the list the factory reset makes the pages again from are the same five
    expect(STOREFRONT_BASE_PAGE_ROWS.map(({ slug, title }) => ({ slug, title }))).toEqual(BASE_PAGES.map(({ slug, title }) => ({ slug, title })));
    const migration = fs.readFileSync(path.resolve(process.cwd(), 'drizzle/0029_storefront_pages.sql'), 'utf8');
    for (const base of BASE_PAGES) expect(migration, base.slug).toContain(`('base', '${base.slug}', '${base.title}')`);
  });

  it('keeps a fixed page to its words: its own name, at most one text, no search switch and no share image (v12 phase 10c)', () => {
    const fixedOf = (slug: string) => ({ forPublish: false, baseSlug: null, fixedSlug: slug });
    const text = { kind: 'text', background: 'white', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'متن بالای صفحه' }] }] } };
    const button = { kind: 'button', background: 'white', label: 'خرید', href: '/products' };
    expect(refusal(page([], { slug: 'fixed-cart' }), fixedOf('fixed-cart'))).toBeNull();
    expect(refusal(page([text], { slug: 'fixed-cart' }), fixedOf('fixed-cart'))).toBeNull();
    // a fixed page goes on the site with a title alone
    expect(refusal(page([], { slug: 'fixed-cart' }), { ...fixedOf('fixed-cart'), forPublish: true })).toBeNull();
    expect(refusal(page([], { slug: 'fixed-search' }), fixedOf('fixed-cart'))).toMatchObject({ field: 'slug', code: 'STOREFRONT_PAGE_SLUG_INVALID' });
    expect(refusal(page([text, text], { slug: 'fixed-cart' }), fixedOf('fixed-cart'))).toMatchObject({ code: 'STOREFRONT_PAGE_SECTION_INVALID' });
    expect(refusal(page([button], { slug: 'fixed-cart' }), fixedOf('fixed-cart'))).toMatchObject({ code: 'STOREFRONT_PAGE_SECTION_INVALID' });
    expect(refusal(page([], { slug: 'fixed-cart', noindex: true }), fixedOf('fixed-cart'))).toMatchObject({ field: 'noindex' });
    expect(refusal(page([], { slug: 'fixed-cart', shareImageAssetId: 5 }), fixedOf('fixed-cart'))).toMatchObject({ field: 'shareImageAssetId' });
    // a few lines at most; a page the shop makes keeps its own, larger limit
    const long = (letters: number) => ({ kind: 'text', background: 'white', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ب'.repeat(letters) }] }] } });
    expect(refusal(page([long(2000)], { slug: 'fixed-cart' }), fixedOf('fixed-cart'))).toBeNull();
    expect(refusal(page([long(2001)], { slug: 'fixed-cart' }), fixedOf('fixed-cart'))).toMatchObject({ code: 'STOREFRONT_PAGE_SECTION_INVALID' });
    expect(refusal(page([long(2001)]))).toBeNull();
    // no other page may take a name under `fixed-`
    expect(refusal(page([], { slug: 'fixed-cart' }))).toMatchObject({ field: 'slug', code: 'STOREFRONT_PAGE_SLUG_INVALID' });
    expect(refusal(page([], { slug: 'fixed-anything' }))).toMatchObject({ field: 'slug' });
    expect(refusal(page([], { slug: 'fixedprice' }))).toBeNull();
    expect(isReservedPageSlug('fixed-x')).toBe(true);
    // the migration, the rules and the list the factory reset makes the rows again from are the same nine
    expect(FIXED_PAGES.every(fixed => fixed.slug.startsWith(FIXED_PAGE_PREFIX))).toBe(true);
    expect(STOREFRONT_FIXED_PAGE_ROWS.map(({ slug, title }) => ({ slug, title }))).toEqual(FIXED_PAGES.map(({ slug, title }) => ({ slug, title })));
    const migration = fs.readFileSync(path.resolve(process.cwd(), 'drizzle/0032_storefront_fixed_pages.sql'), 'utf8');
    for (const fixed of FIXED_PAGES) expect(migration, fixed.slug).toContain(`('fixed', '${fixed.slug}', '${fixed.title}')`);
    expect(new Set(FIXED_PAGES.map(fixed => fixed.path).filter(Boolean)).size).toBe(FIXED_PAGES.length - 1);
  });

  it('keeps the live shipping section for the shipping page alone, once', () => {
    const shipping = { kind: 'shippingMethods', title: 'روش‌های ارسال' };
    expect(refusal(page([shipping]))).toMatchObject({ code: 'STOREFRONT_PAGE_SECTION_INVALID' });
    expect(refusal(page([shipping], { slug: 'about' }), { forPublish: false, baseSlug: 'about' })).toMatchObject({ code: 'STOREFRONT_PAGE_SECTION_INVALID' });
    expect(refusal(page([shipping], { slug: 'shipping' }), { forPublish: true, baseSlug: 'shipping' })).toBeNull();
    expect(refusal(page([shipping, shipping], { slug: 'shipping' }), { forPublish: false, baseSlug: 'shipping' })).toMatchObject({ code: 'STOREFRONT_PAGE_SECTION_INVALID' });
  });

  it('saves an unfinished draft, and refuses to publish it with the section and the reason', () => {
    const unfinished: unknown[] = SECTION_KINDS.filter(kind => kind !== 'shippingMethods').map(kind => emptySection(kind));
    // every new section of the builder is a draft that saves
    expect(refusal(page(unfinished))).toBeNull();
    for (const [index, section] of unfinished.entries()) {
      const problem = refusal(page([section]), live);
      expect(problem, (section as PageSection).kind).toMatchObject({ section: 0, code: 'STOREFRONT_PAGE_UNFINISHED' });
      expect(problem?.message, String(index)).toMatch(/^بخش ۱: /);
    }
    expect(refusal(page([]), live)).toMatchObject({ code: 'STOREFRONT_PAGE_UNFINISHED' });
    const finished = [
      { kind: 'hero', background: 'brand', title: 'درباره ما' },
      textSection(p('متن')),
      { kind: 'textImage', title: 'تیم', doc: doc(p('متن')), imageAssetId: 5, imageAlt: 'عکس گروه', imageSide: 'left' },
      { kind: 'iconCards', cards: [{ icon: 'leaf', title: 'یک', text: '' }, { icon: 'handshake', title: 'دو', text: '' }] },
      { kind: 'gallery', images: [{ assetId: 6, alt: 'یک' }, { assetId: 7, alt: 'دو' }] },
      { kind: 'people', people: [{ imageAssetId: null, name: 'نام نمونه', role: '', contact: '' }] },
      { kind: 'map', imageAssetId: 8, neshanUrl: 'https://neshan.org/maps/x' },
      { kind: 'products', source: 'items', itemIds: [3, 4] },
      { kind: 'button', label: 'خرید', href: '/products' },
    ];
    const published = checkedPage(page(finished, { shareImageAssetId: 9 }), live);
    expect(published.problem).toBeNull();
    // the images and products a page names, each once, for the server's checks
    expect(pageAssetIds(published.page!).sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9]);
    expect(pageItemIds(published.page!)).toEqual([3, 4]);
    // a button half written is unfinished wherever it is
    expect(refusal(page([{ kind: 'hero', title: 'x', buttonLabel: 'خرید' }]), live)).toMatchObject({ code: 'STOREFRONT_PAGE_UNFINISHED' });
    // an image inside a text counts as one of the page's images
    expect(pageAssetIds(checkedPage(page([textSection({ type: 'libraryImage', attrs: { assetId: 44, alt: '' } })]), draft).page!)).toEqual([44]);
  });

  it('offers templates that are valid drafts and hold no person\'s name or contact', () => {
    expect(PAGE_TEMPLATES.map(t => t.key)).toEqual(['about', 'contact']);
    for (const template of PAGE_TEMPLATES) {
      const checked = checkedPage(page(template.sections()), draft);
      expect(checked.problem, template.key).toBeNull();
      // the checker changes nothing of a template: it is already in the kept form
      expect(checked.page?.sections, template.key).toEqual(template.sections());
      for (const section of template.sections()) {
        if (section.kind === 'people') expect(section.people.every(person => !person.name && !person.contact && !person.role)).toBe(true);
      }
      // a template waits for its photos, so it cannot be published as it is
      expect(refusal(page(template.sections()), live), template.key).toMatchObject({ code: 'STOREFRONT_PAGE_UNFINISHED' });
    }
  });
});
