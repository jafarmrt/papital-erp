import { describe, expect, it } from 'vitest';
import { COLLECTION_NAME_MAX, IMAGE_ALT_MAX } from '../../lib/storefront/storefrontPageParts';
import { readFileSync } from 'node:fs';
import {
  COLLECTION_INTRO_MAX, checkedCollectionText, collectionIntro, collectionTextShows,
} from '../../lib/storefront/storefrontCollectionRules';

/**
 * v12 phase 10e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the rules of «متن و تصویر کالکشن‌ها» the server and
 * the screen share, and the limits migration 0035 writes for the same fields.
 */
const base = { name: 'کاشی', intro: '', imageAssetId: null, imageAlt: '', morePageId: null };
const turn = String.fromCharCode(0x202e);
const bell = String.fromCharCode(7);
const loneHalf = String.fromCharCode(0xd83d);

describe('the words of a collection', () => {
  it('keeps an introduction as plain paragraphs: lines trimmed, one blank line between paragraphs at most', () => {
    expect(collectionIntro('  one  \r\n\r\n\r\n\r\n two\ttwo \r third  \n\n')).toBe('one\n\ntwo two\nthird');
    expect(collectionIntro(' \n \n ')).toBe('');
    const checked = checkedCollectionText({ ...base, intro: ' بند یک \n\n\n بند دو ', imageAssetId: 4, imageAlt: '  کاشی آبی ', morePageId: 9 });
    expect(checked.values).toEqual({ name: 'کاشی', intro: 'بند یک\n\nبند دو', imageAssetId: 4, imageAlt: 'کاشی آبی', morePageId: 9 });
  });

  it('takes the name as the items carry it and refuses one no item could carry', () => {
    expect(checkedCollectionText({ ...base, name: ' کاشی ' }).values?.name).toBe(' کاشی ');
    for (const name of ['', 'a\nb', `a${bell}`, `a${turn}`, `a${loneHalf}`, 'ب'.repeat(500), 7, null, undefined]) {
      expect(checkedCollectionText({ ...base, name }).problem?.field, String(name).slice(0, 12)).toBe('name');
    }
    for (const raw of [null, 'text', 7, []]) expect(checkedCollectionText(raw).problem?.code).toBe('STOREFRONT_COLLECTION_INVALID');
  });

  it('refuses an introduction that is too long, is no text, or hides a character', () => {
    expect(checkedCollectionText({ ...base, intro: 'ب'.repeat(COLLECTION_INTRO_MAX) }).problem).toBeNull();
    for (const intro of ['ب'.repeat(COLLECTION_INTRO_MAX + 1), 7, {}, `متن${bell}`, `متن${turn}وارونه`, `متن${loneHalf}`]) {
      const { problem } = checkedCollectionText({ ...base, intro });
      expect(problem?.field).toBe('intro');
      expect(problem?.code).toBe('STOREFRONT_COLLECTION_FIELD_INVALID');
    }
    // markup is only text here: it is kept as written and drawn as text
    expect(checkedCollectionText({ ...base, intro: '<script>alert(1)</script>' }).values?.intro).toBe('<script>alert(1)</script>');
  });

  it('takes an image and a page by a whole positive id, and drops an alternative text with no image', () => {
    for (const imageAssetId of [0, -1, 1.5, '4', {}]) expect(checkedCollectionText({ ...base, imageAssetId }).problem?.field).toBe('imageAssetId');
    for (const morePageId of [0, -1, 1.5, '4', {}]) expect(checkedCollectionText({ ...base, morePageId }).problem?.field).toBe('morePageId');
    expect(checkedCollectionText({ ...base, imageAlt: 'ب'.repeat(121), imageAssetId: 3 }).problem?.field).toBe('imageAlt');
    expect(checkedCollectionText({ ...base, imageAlt: 'کاشی آبی' }).values?.imageAlt).toBe('');
    expect(checkedCollectionText({ name: 'کاشی' }).values).toEqual(base);
  });

  it('shows on the site with a text or an image, never with a link alone', () => {
    expect(collectionTextShows({ intro: 'متن', imageAssetId: null })).toBe(true);
    expect(collectionTextShows({ intro: '', imageAssetId: 3 })).toBe(true);
    expect(collectionTextShows({ intro: '', imageAssetId: null })).toBe(false);
  });

  it('has the same limits in migration 0035', () => {
    const sql = readFileSync('drizzle/0035_storefront_collections.sql', 'utf8');
    expect(sql).toContain(`length(intro) <= ${COLLECTION_INTRO_MAX}`);
    expect(sql).toContain(`length(image_alt) <= ${IMAGE_ALT_MAX}`);
    expect(sql).toContain(`length(name) <= ${COLLECTION_NAME_MAX}`);
    expect(sql).toMatch(/CREATE UNIQUE INDEX[^;]*uq_storefront_collections_name/);
    expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i);
  });
});
