import { STOREFRONT_SLUG_PATTERN } from './storefrontRules.js';
import { normalizeDiscountCode } from './storefrontDiscountRules.js';

/**
 * v11 phase 8.5b (docs/roadmap/V11_STOREFRONT_8_5_START_PLAN.md §5): the rules of a «صفحهٔ ویژه» (a campaign page of the
 * site), shared by the server, the ERP section and the storefront app. Nothing here reads the database; the server checks
 * the hero image, the items and the collection against it separately. The body is plain text: a blank line starts a new
 * paragraph, and nothing in it is ever read as HTML.
 */
export const CAMPAIGN_SOURCES = ['collection', 'products'] as const;
export type CampaignSource = typeof CAMPAIGN_SOURCES[number];
export const CAMPAIGN_SOURCE_TITLES: Readonly<Record<CampaignSource, string>> = { collection: 'یک کالکشن', products: 'محصولات انتخابی' };
export const isCampaignSource = (value: unknown): value is CampaignSource => CAMPAIGN_SOURCES.includes(value as CampaignSource);

export const CAMPAIGN_SLUG_MAX = 60;
export const CAMPAIGN_TITLE_MAX = 120;
export const CAMPAIGN_SUMMARY_MAX = 300;
export const CAMPAIGN_BODY_MAX = 6000;
export const CAMPAIGN_COLLECTION_MAX = 120;
export const CAMPAIGN_PRODUCTS_MAX = 48;
/** live and removed pages together stay small; a list is read whole */
export const CAMPAIGNS_MAX = 200;

export interface CampaignValues {
  slug: string;
  title: string;
  summary: string;
  body: string;
  heroAssetId: number | null;
  source: CampaignSource;
  collection: string;
  itemIds: number[];
  discountCode: string;
  /** the first day it shows, a Tehran calendar day `YYYY-MM-DD`, or '' from now */
  startsOn: string;
  /** the last day it shows (to the end of that Tehran day), or '' for no end */
  endsOn: string;
  homeBanner: boolean;
  isActive: boolean;
}

export interface CampaignProblem {
  field: keyof CampaignValues;
  message: string;
  code: string;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (day: string) => DAY_PATTERN.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`))
  && new Date(Date.parse(`${day}T00:00:00Z`)).toISOString().slice(0, 10) === day;
const faNumber = (n: number) => n.toLocaleString('fa-IR');

/** The page as it is kept: texts trimmed, the code in capitals, the items once each in the owner's order */
export function normalizedCampaign(input: CampaignValues): CampaignValues {
  const source = isCampaignSource(input.source) ? input.source : 'collection';
  const itemIds: number[] = [];
  for (const id of Array.isArray(input.itemIds) ? input.itemIds : []) if (!itemIds.includes(Number(id))) itemIds.push(Number(id));
  const code = String(input.discountCode ?? '').trim();
  return {
    slug: String(input.slug ?? '').trim().toLowerCase(),
    title: String(input.title ?? '').trim(),
    summary: String(input.summary ?? '').trim(),
    body: String(input.body ?? '').replace(/\r\n?/g, '\n').trim(),
    heroAssetId: input.heroAssetId ? Number(input.heroAssetId) : null,
    source,
    collection: source === 'collection' ? String(input.collection ?? '').trim() : '',
    itemIds: source === 'products' ? itemIds : [],
    // a code that cannot be one stays as typed, so the check below names it
    discountCode: code ? (normalizeDiscountCode(code) || code) : '',
    startsOn: String(input.startsOn ?? '').trim(),
    endsOn: String(input.endsOn ?? '').trim(),
    homeBanner: Boolean(input.homeBanner),
    isActive: Boolean(input.isActive),
  };
}

/** The first reason a (normalized) page cannot be saved; null when it can */
export function campaignProblem(v: CampaignValues): CampaignProblem | null {
  const problem = (field: keyof CampaignValues, message: string, code: string): CampaignProblem => ({ field, message, code });
  if (!v.slug) return problem('slug', 'نشانی لاتین صفحه لازم است، مانند yalda.', 'STOREFRONT_CAMPAIGN_SLUG_INVALID');
  if (v.slug.length > CAMPAIGN_SLUG_MAX || !STOREFRONT_SLUG_PATTERN.test(v.slug)) {
    return problem('slug', `نشانی لاتین حداکثر ${faNumber(CAMPAIGN_SLUG_MAX)} نویسه است و فقط حرف کوچک انگلیسی، رقم و خط تیره میان کلمه‌ها دارد.`, 'STOREFRONT_CAMPAIGN_SLUG_INVALID');
  }
  if (!v.title) return problem('title', 'عنوان صفحه لازم است.', 'STOREFRONT_CAMPAIGN_TITLE_INVALID');
  if (v.title.length > CAMPAIGN_TITLE_MAX) return problem('title', `عنوان حداکثر ${faNumber(CAMPAIGN_TITLE_MAX)} نویسه است.`, 'STOREFRONT_CAMPAIGN_TITLE_INVALID');
  if (v.summary.length > CAMPAIGN_SUMMARY_MAX) return problem('summary', `خلاصه حداکثر ${faNumber(CAMPAIGN_SUMMARY_MAX)} نویسه است.`, 'STOREFRONT_CAMPAIGN_TEXT_TOO_LONG');
  if (v.body.length > CAMPAIGN_BODY_MAX) return problem('body', `متن صفحه حداکثر ${faNumber(CAMPAIGN_BODY_MAX)} نویسه است.`, 'STOREFRONT_CAMPAIGN_TEXT_TOO_LONG');
  if (v.heroAssetId !== null && (!Number.isInteger(v.heroAssetId) || v.heroAssetId < 1)) {
    return problem('heroAssetId', 'تصویر سرصفحه شناخته نیست.', 'STOREFRONT_CAMPAIGN_HERO_INVALID');
  }
  if (v.source === 'collection') {
    if (!v.collection) return problem('collection', 'کالکشن این صفحه را انتخاب کنید.', 'STOREFRONT_CAMPAIGN_PRODUCTS_REQUIRED');
    if (v.collection.length > CAMPAIGN_COLLECTION_MAX) return problem('collection', 'نام کالکشن بیش از اندازه بلند است.', 'STOREFRONT_CAMPAIGN_PRODUCTS_REQUIRED');
  } else {
    if (v.itemIds.length === 0) return problem('itemIds', 'دست‌کم یک محصول برای این صفحه انتخاب کنید.', 'STOREFRONT_CAMPAIGN_PRODUCTS_REQUIRED');
    if (v.itemIds.length > CAMPAIGN_PRODUCTS_MAX) return problem('itemIds', `یک صفحه حداکثر ${faNumber(CAMPAIGN_PRODUCTS_MAX)} محصول دارد.`, 'STOREFRONT_CAMPAIGN_PRODUCTS_TOO_MANY');
    if (v.itemIds.some(id => !Number.isInteger(id) || id < 1)) return problem('itemIds', 'محصول انتخاب‌شده شناخته نیست.', 'STOREFRONT_CAMPAIGN_PRODUCTS_REQUIRED');
  }
  if (v.discountCode && !normalizeDiscountCode(v.discountCode)) {
    return problem('discountCode', 'کد تخفیف ۳ تا ۳۰ نویسه است: حرف لاتین، رقم و «-».', 'STOREFRONT_CAMPAIGN_CODE_INVALID');
  }
  if (v.startsOn && !isDay(v.startsOn)) return problem('startsOn', 'روز آغاز تاریخ درستی نیست.', 'STOREFRONT_CAMPAIGN_DATE_INVALID');
  if (v.endsOn && !isDay(v.endsOn)) return problem('endsOn', 'روز پایان تاریخ درستی نیست.', 'STOREFRONT_CAMPAIGN_DATE_INVALID');
  if (v.startsOn && v.endsOn && v.endsOn < v.startsOn) return problem('endsOn', 'روز پایان نباید پیش از روز آغاز باشد.', 'STOREFRONT_CAMPAIGN_DATE_INVALID');
  return null;
}

/** Iran keeps +03:30 all year, so a Tehran day is a fixed span of UTC */
const TEHRAN_OFFSET_MS = 3.5 * 3600 * 1000;
export const tehranDayOf = (at: Date): string => new Date(at.getTime() + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);

export const CAMPAIGN_STATUSES = ['off', 'scheduled', 'live', 'ended'] as const;
export type CampaignStatus = typeof CAMPAIGN_STATUSES[number];
export const CAMPAIGN_STATUS_TITLES: Readonly<Record<CampaignStatus, string>> = {
  off: 'خاموش', scheduled: 'در انتظار روز آغاز', live: 'روی سایت', ended: 'پایان‌یافته',
};

/** Where a page stands on a Tehran day: the site shows it only while «live» */
export function campaignStatus(page: { isActive: boolean; startsOn: string; endsOn: string }, today: string): CampaignStatus {
  if (!page.isActive) return 'off';
  if (page.startsOn && today < page.startsOn) return 'scheduled';
  if (page.endsOn && today > page.endsOn) return 'ended';
  return 'live';
}

/** The body's paragraphs, each a list of lines: what the site writes as `<p>` with line breaks, never as HTML */
export function campaignParagraphs(body: string): string[][] {
  return body.replace(/\r\n?/g, '\n').split(/\n\s*\n/)
    .map(block => block.split('\n').map(line => line.trim()).filter(Boolean))
    .filter(lines => lines.length > 0);
}

/**
 * A ready start for a page. The texts are placeholders the owner rewrites (content never holds the technical work back);
 * a template leaves the products, the hero and the dates to choose.
 */
export const CAMPAIGN_TEMPLATES = [
  {
    key: 'yalda',
    title: 'یلدا',
    values: {
      slug: 'yalda',
      title: 'یلدا با پاپیتال',
      summary: 'هدیه‌های دست‌ساز پاپیتال برای بلندترین شب سال، با نقش کاشی‌های ایران.',
      body: [
        'متن موقت: این متن را با متن یلدای امسال عوض کنید.',
        'یلدا شب کنار هم بودن است. برای این شب، قطعه‌هایی را کنار هم گذاشته‌ایم که نقش کاشی‌های ایران را به هدیه‌ای ماندگار تبدیل می‌کنند.',
        'سفارش‌های یلدا تا چند روز پیش از شب یلدا ارسال می‌شوند. اگر هدیه‌ای برای جمع یا سازمان خود می‌خواهید، از فرم هدیهٔ سازمانی با ما در تماس باشید.',
      ].join('\n\n'),
    },
  },
] as const;
