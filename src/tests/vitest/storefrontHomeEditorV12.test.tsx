import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PageDetail } from '../../lib/storefront/storefrontPageContracts';
import { HOME_PAGE_SLUG, emptyHomeSection, emptySlide, type PageSection } from '../../lib/storefront/storefrontPageRules';

/**
 * v12 phase 10e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «صفحهٔ اصلی» in the page builder. The home page has no
 * address, title or «نیاید» to set, starts from the home page the site has today, takes its own parts (each of which
 * can be switched off), and a slide's button chooses its link as a menu item does. Another page is offered none of it.
 */
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (...args: unknown[]) => fetchJson(...(args as [])), isAbortError: () => false }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../contexts/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/AuthContext')>('../../contexts/AuthContext');
  return { ...actual, useHasPermission: () => true };
});
// the calendar of the date field is not this test's subject: a plain field that holds the same ISO day
vi.mock('../../components/common/JalaliDateInput', () => ({
  JalaliDateInput: ({ id, value, onChange }: { id?: string; value: string; onChange: (iso: string) => void }) => <input id={id} value={value} onChange={e => onChange(e.target.value)} />,
}));

const StorefrontPagesPage = (await import('../../pages/StorefrontPagesPage')).default;

const detailOf = (sections: PageSection[], over: Partial<PageDetail> = {}): PageDetail => ({
  id: 9, kind: 'home', slug: HOME_PAGE_SLUG, title: 'صفحهٔ اصلی', status: 'draft', publishedAt: '', updatedAt: '2026-11-21 10:00:00', updatedBy: '', version: 4,
  draft: { title: 'صفحهٔ اصلی', slug: HOME_PAGE_SLUG, seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections },
  menuPlaces: [], linkedCollections: [], linkedFromHome: false, assets: [{ assetId: 31, title: 'کاشی هفت‌رنگ در آفتاب', usable: true }], ...over,
});
const OPTIONS = {
  categories: ['گردنبند'], collections: ['کاشی'], campaigns: [], pages: [{ id: 8, title: 'داستان ما', live: true }], news: [{ id: 5, title: 'خبر تازه', live: false }],
  products: [{ itemId: 3, name: 'گردنبند فیروزه', sku: 'SF-1' }],
};

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

type Call = [string, { method?: string; body?: string } | undefined];
const saved = () => (fetchJson.mock.calls as Call[]).filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(String(init?.body)) as { sections: Array<Record<string, unknown>> } & Record<string, unknown>);

function open(first: PageDetail) {
  let detail = first;
  fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url === '/storefront/menus/link-options') return { data: OPTIONS };
    if (url === '/storefront/pages' && !init) return { data: [{ ...first, draft: undefined }] };
    if (url === '/storefront/pages/9' && !init) return { data: detail };
    if (init?.method === 'PUT') {
      detail = { ...detail, version: detail.version + 1, draft: (({ version: _v, ...draft }) => draft)(JSON.parse(init.body ?? '{}')) };
      return { data: detail };
    }
    throw new Error(`unexpected call ${init?.method ?? 'GET'} ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/site-pages?page=9']}><StorefrontPagesPage /></MemoryRouter></QueryClientProvider>);
}
const parts = () => within(screen.getByRole('region', { name: 'بخش‌های صفحه' })).getAllByRole('listitem').filter(li => li.getAttribute('aria-label')?.startsWith('بخش '));
const kindsOffered = () => within(screen.getByLabelText('بخش تازه')).getAllByRole('option').map(option => option.textContent);
const save = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'ذخیرهٔ پیش‌نویس' }));
  await waitFor(() => expect(saved().length).toBeGreaterThan(0));
  return saved()[saved().length - 1];
};

describe('the home page in the page builder', () => {
  it('has no address, title or search switch to set, no preview and no removal', async () => {
    open(detailOf([]));
    await screen.findByText(/این صفحهٔ اصلی سایت است/);
    const details = screen.getByRole('region', { name: 'مشخصات صفحه' });
    expect((within(details).getByLabelText('عنوان صفحه').closest('div') as HTMLElement).hidden).toBe(true);
    expect((within(details).getByLabelText('نشانی لاتین').closest('div[hidden]'))).not.toBeNull();
    expect(within(details).queryByLabelText('این صفحه در موتور جست‌وجو نیاید')).toBeNull();
    expect(within(details).getByLabelText('عنوان جست‌وجو (اختیاری)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /پیش‌نمایش/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'حذف صفحه' })).toBeNull();
  });

  it('starts from the home page the site has today and saves it as it is', async () => {
    open(detailOf([]));
    fireEvent.click(await screen.findByRole('button', { name: 'شروع از صفحهٔ اصلی امروز' }));
    expect(parts().map(li => li.getAttribute('aria-label'))).toEqual([
      'بخش ۱، سربرگ صفحهٔ اصلی', 'بخش ۲، خرید بر اساس دسته', 'بخش ۳، چرا پاپیتال', 'بخش ۴، برگزیده‌های کارگاه', 'بخش ۵، کالکشن‌ها', 'بخش ۶، تازه‌های کارگاه', 'بخش ۷، هدیهٔ سازمانی و خرید عمده',
    ]);
    expect(screen.queryByRole('button', { name: 'شروع از صفحهٔ اصلی امروز' })).toBeNull();
    // a part the home page takes once is no longer offered; a slider, a banner and the parts of every page still are
    expect(kindsOffered()).toEqual(expect.arrayContaining(['اسلایدر', 'بنر', 'معرفی کالکشن', 'تازه‌ترین خبرها', 'متن', 'ردیف محصولات']));
    expect((screen.getByLabelText('عنوان جست‌وجو (اختیاری)').parentElement as HTMLElement).textContent).toContain('عنوان خود سایت');
    expect(kindsOffered()).not.toEqual(expect.arrayContaining(['سربرگ صفحهٔ اصلی']));
    expect(kindsOffered()).not.toContain('روش‌ها و هزینهٔ ارسال');
    // the parts whose look is the site's own take no ground
    expect((parts()[0].querySelector('select[id*="-background-"]') as HTMLSelectElement).hidden).toBe(true);
    expect(within(parts()[0]).queryByText('زمینه')).toBeNull();
    const body = await save();
    expect(body.sections.map(section => section.kind)).toEqual(['homeIntro', 'homeCategories', 'homeWhy', 'homeFeatured', 'homeCollections', 'homeNewest', 'homeWholesale']);
    expect(body.sections[0]).toEqual(emptyHomeSection('homeIntro'));
    expect(body).toMatchObject({ slug: HOME_PAGE_SLUG, noindex: false, version: 4 });
  });

  it('switches a part off and on again without losing its words', async () => {
    open(detailOf([emptyHomeSection('homeIntro'), emptyHomeSection('homeCategories')]));
    const [intro] = await waitFor(parts);
    const toggle = within(intro).getByRole('checkbox', { name: 'بخش ۱، سربرگ صفحهٔ اصلی: روی سایت نشان داده شود' }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(within(intro).getByText('خاموش است')).toBeTruthy();
    const off = await save();
    expect(off.sections[0]).toEqual({ ...emptyHomeSection('homeIntro'), hidden: true });
    expect(off.sections[1]).not.toHaveProperty('hidden');
    fireEvent.click(within(parts()[0]).getByRole('checkbox', { name: /روی سایت نشان داده شود/ }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'ذخیرهٔ پیش‌نویس' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'ذخیرهٔ پیش‌نویس' }));
    await waitFor(() => expect(saved().length).toBe(2));
    expect(saved()[1].sections[0]).toEqual(emptyHomeSection('homeIntro'));
  });

  it('builds a slide: its words, its days and a button whose link is chosen as in the menus', async () => {
    open(detailOf([{ kind: 'slider', background: 'white', slides: [{ ...emptySlide(), imageAssetId: 31 }] }]));
    const [slider] = await waitFor(parts);
    const slide = within(slider).getByRole('listitem', { name: 'بخش ۱، اسلاید ۱' });
    expect(within(slide).getByText('کاشی هفت‌رنگ در آفتاب')).toBeTruthy();
    fireEvent.change(within(slide).getByLabelText('متن جایگزین عکس'), { target: { value: 'کاشی آبی' } });
    fireEvent.change(within(slide).getByLabelText('تیتر (اختیاری)'), { target: { value: 'کالکشن تازه' } });
    fireEvent.change(within(slide).getByLabelText('نوشتهٔ دکمه (اختیاری)'), { target: { value: 'دیدن' } });
    fireEvent.change(within(slide).getByLabelText('نمایش از روز (اختیاری)'), { target: { value: '2026-12-01' } });
    // no link yet: nothing to choose a target for
    expect(within(slide).queryByLabelText('دکمه: مقصد')).toBeNull();
    const kind = within(slide).getByLabelText('دکمه: پیوند به') as HTMLSelectElement;
    expect(within(kind).getAllByRole('option').map(option => option.textContent)).toEqual([
      'بی پیوند', 'صفحه‌ای از سایت', 'صفحهٔ متنی', 'خبر', 'دسته', 'کالکشن', 'صفحهٔ ویژه', 'محصول', 'نشانی درون سایت', 'نشانی بیرونی',
    ]);
    fireEvent.change(kind, { target: { value: 'product' } });
    // half a link is named before a save
    expect(screen.getByRole('alert').textContent).toContain('مقصد «پیوند اسلاید» را برگزینید');
    fireEvent.change(within(slide).getByLabelText('دکمه: مقصد'), { target: { value: '3' } });
    const withProduct = await save();
    expect((withProduct.sections[0].slides as Array<Record<string, unknown>>)[0]).toEqual({
      imageAssetId: 31, mobileImageAssetId: null, imageAlt: 'کاشی آبی', title: 'کالکشن تازه', text: '', buttonLabel: 'دیدن',
      link: { kind: 'product', target: '', itemId: 3, campaignId: null, pageId: null, newsId: null }, startsOn: '2026-12-01', endsOn: '',
    });
    // another kind empties what the first one chose
    fireEvent.change(within(parts()[0]).getByLabelText('دکمه: پیوند به'), { target: { value: 'content' } });
    expect(within(within(parts()[0]).getByLabelText('دکمه: مقصد')).getAllByRole('option').map(option => option.textContent)).toEqual(['برگزینید', 'داستان ما']);
    fireEvent.change(within(parts()[0]).getByLabelText('دکمه: مقصد'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیرهٔ پیش‌نویس' }));
    await waitFor(() => expect(saved().length).toBe(2));
    expect((saved()[1].sections[0].slides as Array<Record<string, unknown>>)[0].link).toEqual({ kind: 'content', target: '', itemId: null, campaignId: null, pageId: 8, newsId: null });
    // a second slide, moved before the first
    fireEvent.click(within(parts()[0]).getByRole('button', { name: 'اسلاید تازه' }));
    fireEvent.click(within(parts()[0]).getByRole('button', { name: 'بخش ۱، اسلاید ۲ بالاتر' }));
    fireEvent.click(screen.getByRole('button', { name: 'ذخیرهٔ پیش‌نویس' }));
    await waitFor(() => expect(saved().length).toBe(3));
    expect((saved()[2].sections[0].slides as Array<Record<string, unknown>>).map(s => s.title)).toEqual(['', 'کالکشن تازه']);
    // each slide keeps its own fields where it now stands, and its controls say which slide they are for
    const [nowFirst, nowSecond] = within(parts()[0]).getAllByRole('listitem').filter(li => li.getAttribute('aria-label')?.includes('اسلاید'));
    expect((within(nowSecond).getByLabelText('تیتر (اختیاری)') as HTMLInputElement).value).toBe('کالکشن تازه');
    expect(within(nowSecond).getByRole('button', { name: 'برداشتن عکس اسلاید ۲' })).toBeTruthy();
    expect(within(nowFirst).queryByRole('button', { name: /^برداشتن/ })).toBeNull();
    // one slider on the home page: it is no longer offered
    expect(kindsOffered()).not.toContain('اسلایدر');
  });

  it('chooses the collection of the collection intro from the collections of the site and keeps one that left it', async () => {
    open(detailOf([{ kind: 'collectionIntro', background: 'cream', title: '', collection: 'قدیمی' }]));
    const [part] = await waitFor(parts);
    const select = within(part).getByLabelText('کالکشن') as HTMLSelectElement;
    await waitFor(() => expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['یک کالکشن را برگزینید', 'قدیمی', 'کاشی']));
    expect((within(part).getByLabelText('زمینه', { selector: 'select' }) as HTMLSelectElement).hidden).toBe(false);
    fireEvent.change(select, { target: { value: 'کاشی' } });
    expect((await save()).sections[0]).toEqual({ kind: 'collectionIntro', background: 'cream', title: '', collection: 'کاشی' });
  });

  it('offers another page none of the home page: no part of it, no switch, no start from today', async () => {
    open(detailOf([{ kind: 'button', background: 'white', label: 'محصولات', href: '/products' }], { kind: 'custom', slug: 'our-story', title: 'داستان ما', draft: { title: 'داستان ما', slug: 'our-story', seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections: [{ kind: 'button', background: 'white', label: 'محصولات', href: '/products' }] } }));
    await waitFor(parts);
    expect(kindsOffered()).toEqual(['سربرگ', 'متن', 'متن و تصویر', 'کارت‌های آیکون‌دار', 'گالری تصاویر', 'کارت افراد', 'نقشه', 'ردیف محصولات', 'دکمه']);
    expect(screen.queryByRole('checkbox', { name: /روی سایت نشان داده شود/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'شروع از صفحهٔ اصلی امروز' })).toBeNull();
    expect(screen.queryByText(/این صفحهٔ اصلی سایت است/)).toBeNull();
  });
});
