// @vitest-environment node
/**
 * v11 phase 8.5b (docs/roadmap/V11_STOREFRONT_8_5_START_PLAN.md §5): the rules of a «صفحهٔ ویژه», shared by the server,
 * the ERP section and the site: what a page becomes when kept, why it may be refused, where it stands on a given day, and
 * how its plain text becomes paragraphs.
 */
import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_PRODUCTS_MAX, CAMPAIGN_TEMPLATES, campaignParagraphs, campaignProblem, campaignStatus, normalizedCampaign, tehranDayOf,
  type CampaignValues,
} from '../../lib/storefront/storefrontCampaignRules';

const page = (change: Partial<CampaignValues> = {}): CampaignValues => ({
  slug: 'yalda', title: 'یلدا با پاپیتال', summary: '', body: '', heroAssetId: null, source: 'collection', collection: 'یلدا', itemIds: [],
  discountCode: '', startsOn: '', endsOn: '', homeBanner: false, isActive: true, ...change,
});
const problemOf = (change: Partial<CampaignValues>) => campaignProblem(normalizedCampaign(page(change)))?.code ?? null;

describe('normalizedCampaign', () => {
  it('trims the texts, lowers the address, raises the code and keeps each item once in the owner\'s order', () => {
    const kept = normalizedCampaign(page({
      slug: ' Yalda-1405 ', title: ' یلدا ', body: 'یک\r\n\r\nدو\r\n', source: 'products', collection: 'نادیده', itemIds: [7, 3, 7, 5], discountCode: ' yalda1405 ',
    }));
    expect(kept).toMatchObject({ slug: 'yalda-1405', title: 'یلدا', body: 'یک\n\nدو', collection: '', itemIds: [7, 3, 5], discountCode: 'YALDA1405' });
  });

  it('keeps no items for a page of a collection', () => {
    expect(normalizedCampaign(page({ itemIds: [1, 2] })).itemIds).toEqual([]);
  });
});

describe('campaignProblem', () => {
  it('accepts a whole page', () => {
    expect(problemOf({})).toBeNull();
    expect(problemOf({ source: 'products', itemIds: [1], startsOn: '2026-12-01', endsOn: '2026-12-21', discountCode: 'YALDA-1405' })).toBeNull();
  });

  it('refuses an address that is not lowercase Latin words joined by dashes', () => {
    for (const slug of ['', 'یلدا', 'yalda_1405', 'yalda--1405', '-yalda', 'a'.repeat(61)]) expect(problemOf({ slug })).toBe('STOREFRONT_CAMPAIGN_SLUG_INVALID');
  });

  it('refuses a missing or long title and long texts', () => {
    expect(problemOf({ title: ' ' })).toBe('STOREFRONT_CAMPAIGN_TITLE_INVALID');
    expect(problemOf({ title: 'ی'.repeat(121) })).toBe('STOREFRONT_CAMPAIGN_TITLE_INVALID');
    expect(problemOf({ summary: 'ی'.repeat(301) })).toBe('STOREFRONT_CAMPAIGN_TEXT_TOO_LONG');
    expect(problemOf({ body: 'ی'.repeat(6001) })).toBe('STOREFRONT_CAMPAIGN_TEXT_TOO_LONG');
  });

  it('asks for a collection or at least one item, and at most the cap of items', () => {
    expect(problemOf({ collection: '' })).toBe('STOREFRONT_CAMPAIGN_PRODUCTS_REQUIRED');
    expect(problemOf({ source: 'products', itemIds: [] })).toBe('STOREFRONT_CAMPAIGN_PRODUCTS_REQUIRED');
    const many = Array.from({ length: CAMPAIGN_PRODUCTS_MAX + 1 }, (_, i) => i + 1);
    expect(problemOf({ source: 'products', itemIds: many })).toBe('STOREFRONT_CAMPAIGN_PRODUCTS_TOO_MANY');
  });

  it('refuses a code that cannot be one, a day that does not exist and an end before the start', () => {
    expect(problemOf({ discountCode: 'تخفیف' })).toBe('STOREFRONT_CAMPAIGN_CODE_INVALID');
    expect(problemOf({ startsOn: '2026-02-30' })).toBe('STOREFRONT_CAMPAIGN_DATE_INVALID');
    expect(problemOf({ endsOn: '21/12/2026' })).toBe('STOREFRONT_CAMPAIGN_DATE_INVALID');
    expect(problemOf({ startsOn: '2026-12-21', endsOn: '2026-12-20' })).toBe('STOREFRONT_CAMPAIGN_DATE_INVALID');
    expect(problemOf({ startsOn: '2026-12-21', endsOn: '2026-12-21' })).toBeNull();
  });

  it('starts every template as a page that only needs its products', () => {
    for (const template of CAMPAIGN_TEMPLATES) {
      expect(campaignProblem(normalizedCampaign(page({ ...template.values, collection: '' })))?.code).toBe('STOREFRONT_CAMPAIGN_PRODUCTS_REQUIRED');
      expect(template.values.body).toContain('متن موقت');
    }
  });
});

describe('campaignStatus and tehranDayOf', () => {
  it('reads the day in Tehran, which is ahead of UTC by three and a half hours', () => {
    expect(tehranDayOf(new Date('2026-12-20T20:29:00Z'))).toBe('2026-12-20');
    expect(tehranDayOf(new Date('2026-12-20T20:30:00Z'))).toBe('2026-12-21');
  });

  it('is off, scheduled, live through its last day, then ended', () => {
    const days = { startsOn: '2026-12-01', endsOn: '2026-12-21' };
    expect(campaignStatus({ isActive: false, ...days }, '2026-12-10')).toBe('off');
    expect(campaignStatus({ isActive: true, ...days }, '2026-11-30')).toBe('scheduled');
    expect(campaignStatus({ isActive: true, ...days }, '2026-12-01')).toBe('live');
    expect(campaignStatus({ isActive: true, ...days }, '2026-12-21')).toBe('live');
    expect(campaignStatus({ isActive: true, ...days }, '2026-12-22')).toBe('ended');
    expect(campaignStatus({ isActive: true, startsOn: '', endsOn: '' }, '2030-01-01')).toBe('live');
  });
});

describe('campaignParagraphs', () => {
  it('starts a paragraph at a blank line, keeps single breaks as lines and leaves markup as text', () => {
    expect(campaignParagraphs('یک\nدو\n\n\n  \nسه <b>پررنگ</b>\r\n')).toEqual([['یک', 'دو'], ['سه <b>پررنگ</b>']]);
    expect(campaignParagraphs('  \n\n ')).toEqual([]);
  });
});
