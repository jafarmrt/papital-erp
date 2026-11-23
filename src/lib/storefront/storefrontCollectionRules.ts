import { hasLoneSurrogate, isId, text } from './storefrontPageParts.js';
import { COLLECTION_NAME_MAX, IMAGE_ALT_MAX } from './storefrontPageParts.js';

/**
 * v12 phase 10e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the rules of «متن و تصویر کالکشن‌ها», shared by the
 * server and the screen (no I/O). A collection's own words are an introduction of a few plain paragraphs (a blank line
 * starts a paragraph; nothing in it is read as markup), an image of the media library with its alternative text, and
 * an optional link «آشنایی بیشتر» to a page of «صفحه‌های سایت».
 */
export const COLLECTION_INTRO_MAX = 1500;
/** the collections the ERP's screen lists and the site reads at most */
export const COLLECTION_TEXTS_MAX = 500;

export interface CollectionTextValues {
  /** the collection's name as the items carry it */
  name: string;
  intro: string;
  imageAssetId: number | null;
  /** what the image shows, for a screen reader ('' = the site says the collection's name) */
  imageAlt: string;
  /** a page of «صفحه‌های سایت» the site links to as «آشنایی بیشتر» (null = no link) */
  morePageId: number | null;
}
export interface CollectionTextProblem { field: keyof CollectionTextValues; message: string; code: string }
export type CheckedCollectionText = { values: CollectionTextValues; problem: null } | { values: null; problem: CollectionTextProblem };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const refuse = (field: keyof CollectionTextValues, message: string, code = 'STOREFRONT_COLLECTION_FIELD_INVALID'): CheckedCollectionText => ({ values: null, problem: { field, message, code } });
// a control character other than the line break, and the characters that turn the direction of a line over
// eslint-disable-next-line no-control-regex
const UNSAFE_IN_PARAGRAPHS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

/** An introduction as it is kept: its lines trimmed, at most one blank line between paragraphs, none at either end */
export function collectionIntro(value: string): string {
  return value.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A collection's own words as they are kept, from whatever a request carried */
export function checkedCollectionText(raw: unknown): CheckedCollectionText {
  if (!isRecord(raw)) return refuse('name', 'متن کالکشن خوانا نیست.', 'STOREFRONT_COLLECTION_INVALID');
  let imageAlt: string;
  // the name is the items' own, taken as it is (trimming it would name another collection)
  const name = typeof raw.name === 'string' ? raw.name : '';
  if (name === '' || name.length > COLLECTION_NAME_MAX || name.includes('\n') || UNSAFE_IN_PARAGRAPHS.test(name) || hasLoneSurrogate(name)) return refuse('name', 'نام کالکشن خوانا نیست.');
  if (raw.intro !== undefined && typeof raw.intro !== 'string') return refuse('intro', 'متن معرفی کالکشن باید متن باشد.');
  const intro = collectionIntro(String(raw.intro ?? ''));
  if (UNSAFE_IN_PARAGRAPHS.test(intro) || hasLoneSurrogate(intro)) return refuse('intro', 'متن معرفی کالکشن متن ساده است؛ نویسهٔ پنهان یا ناقص در آن نمی‌آید.');
  if (intro.length > COLLECTION_INTRO_MAX) return refuse('intro', `متن معرفی کالکشن حداکثر ${COLLECTION_INTRO_MAX.toLocaleString('fa-IR')} نویسه است.`);
  if (raw.imageAssetId !== null && raw.imageAssetId !== undefined && !isId(raw.imageAssetId)) return refuse('imageAssetId', 'تصویر کالکشن خوانا نیست.');
  const imageAssetId = isId(raw.imageAssetId) ? raw.imageAssetId : null;
  try {
    imageAlt = text(raw.imageAlt ?? '', IMAGE_ALT_MAX, 'متن جایگزین تصویر');
  } catch (err) {
    return refuse('imageAlt', (err as Error).message);
  }
  if (raw.morePageId !== null && raw.morePageId !== undefined && !isId(raw.morePageId)) return refuse('morePageId', 'صفحهٔ «آشنایی بیشتر» خوانا نیست.');
  const morePageId = isId(raw.morePageId) ? raw.morePageId : null;
  // an alternative text with no image, and a link with no words to lead to it, have nothing to belong to
  return { values: { name, intro, imageAssetId, imageAlt: imageAssetId === null ? '' : imageAlt, morePageId }, problem: null };
}

/** Whether a collection's words show anything on the site: a text or an image (a link alone is not drawn) */
export const collectionTextShows = (values: Pick<CollectionTextValues, 'intro' | 'imageAssetId'>): boolean => values.intro !== '' || values.imageAssetId !== null;
