import { normalizeDecimalString } from '../numericInput';

/**
 * v10.0.25 (N-05 PR 2): the product card of the media library — the item fields collections (a tag list, product-owner
 * decision ت۲), design year, transfer code, description and technical notes. Shared by the server (item form, Excel import,
 * `PUT /media/products/:itemId/info`) and the browser forms, so both read a value the same way. Migration 0097 holds the
 * same limits as CHECK constraints (design year, number of collections).
 */
export const PRODUCT_CARD_LIMITS = {
  collections: 20,
  collectionLength: 60,
  designYearMin: 1300,
  designYearMax: 1500,
  transferCode: 30,
  text: 5000,
} as const;

export const PRODUCT_CARD_TEXT = {
  collectionsTooMany: `حداکثر ۲۰ کالکشن برای هر محصول پذیرفته است.`,
  collectionTooLong: `نام کالکشن حداکثر ۶۰ نویسه است.`,
  designYearInvalid: 'سال طراحی باید سال شمسی چهاررقمی میان ۱۳۰۰ و ۱۵۰۰ باشد.',
  transferCodeTooLong: `کد ترنسفر حداکثر ۳۰ نویسه است.`,
  textTooLong: `توضیح و نکته فنی هر کدام حداکثر ۵٬۰۰۰ نویسه است.`,
} as const;

/** Excel headers of the product card (item export, import template and import); the import reads the English key too */
export const PRODUCT_CARD_COLUMNS = {
  collections: 'کالکشن',
  designYear: 'سال طراحی',
  transferCode: 'کد ترنسفر',
  productDescription: 'توضیح محصول',
  technicalNotes: 'نکته‌های فنی',
} as const;

export type ProductCardResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** A list of collection names: trimmed, inner spaces folded, empty and repeated names (letter case ignored) dropped */
export function normalizeCollections(input: unknown): ProductCardResult<string[]> {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[،,;\n]/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const name = String(entry ?? '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    if (name.length > PRODUCT_CARD_LIMITS.collectionLength) return { ok: false, error: PRODUCT_CARD_TEXT.collectionTooLong };
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  if (out.length > PRODUCT_CARD_LIMITS.collections) return { ok: false, error: PRODUCT_CARD_TEXT.collectionsTooMany };
  return { ok: true, value: out };
}

/** A design year: empty is none; Persian or Arabic digits are read; anything but a whole year 1300..1500 is an error */
export function parseDesignYear(input: unknown): ProductCardResult<number | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  const text = normalizeDecimalString(String(input)).trim();
  if (text === '') return { ok: true, value: null };
  if (!/^\d{4}$/.test(text)) return { ok: false, error: PRODUCT_CARD_TEXT.designYearInvalid };
  const year = Number(text);
  if (year < PRODUCT_CARD_LIMITS.designYearMin || year > PRODUCT_CARD_LIMITS.designYearMax) {
    return { ok: false, error: PRODUCT_CARD_TEXT.designYearInvalid };
  }
  return { ok: true, value: year };
}

/** A transfer code or a text field: trimmed, empty is none */
export function parseCardText(input: unknown, max: number, error: string): ProductCardResult<string | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  const text = String(input).trim();
  if (text === '') return { ok: true, value: null };
  if (text.length > max) return { ok: false, error };
  return { ok: true, value: text };
}

const PRODUCT_CODE_PARTS = /^(\d{4})-[A-Za-z]+-(\d{3})-\d{2}$/;

/** Design year and transfer code read from a product code «1404-N-101-01», the rule migration 0097 filled them with */
export function productCardFromCode(code: string): { designYear: number | null; transferCode: string | null } {
  const match = PRODUCT_CODE_PARTS.exec(String(code ?? '').trim());
  if (!match) return { designYear: null, transferCode: null };
  const year = Number(match[1]);
  const designYear = year >= PRODUCT_CARD_LIMITS.designYearMin && year <= PRODUCT_CARD_LIMITS.designYearMax ? year : null;
  return { designYear, transferCode: designYear === null ? null : match[2] };
}
